/**
 * Evaluates a PlotScene or DiagramScene into exact numeric geometry, analytical facts,
 * and laid-out coordinates (Redraw v2).
 */
import type { Fill, LineStyle, Pos, Range } from '../common.ts';
import { bisect, type Jump } from '../analyze.ts';
import { nice, niceRange } from '../nice.ts';
import { asLine, classify, contour, eigen, findEquilibria, nullclines, type Equilibrium, type LineEq } from '../phase.ts';
import { findMeets, integrate } from '../region.ts';
import { autoY, sampleFn, type Pt } from '../sample.ts';
import { compileLatex2, compileLatexExpr, evalBound, parseCasesExpr } from './latexExpr.ts';
import { measureAndRenderMath, type MathBox } from './mathSvg.ts';
import type { CurveLayer, DiagramEdge, DiagramNode, DiagramScene, FieldLayer, FlowLayer, PlotScene, SceneSpec, ShadeLayer } from './scene.ts';
import { COLORS, GRAY } from '../svg.ts';

export interface EvalCurve {
  n: number;
  layer: CurveLayer;
  text: string;
  color: string;
  style: LineStyle;
  piecewise: boolean;
  pieces: { expr: string; text: string; on: Range; ends: [Fill | null, Fill | null]; f: (x: number) => number }[];
  segments: Pt[][];
  zeros: number[];
  maxima: Pt[];
  minima: Pt[];
  jumps: Jump[];
  asymptotes: number[];
  gaps: [number, number][];
  constant: [number, number, number][];
  oscillation: 'decaying' | 'growing' | 'steady' | null;
  points: { x: number; y: number; fill: Fill }[];
  jumpGuides: { x: number; y0: number; y1: number }[];
}

export interface EvalRiemannRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Optional trapezoid corners for trapezoidal rule. */
  poly?: Pt[];
}

export interface EvalShade {
  layer: ShadeLayer;
  polygon: Pt[];
  color: string;
  axis: 'x' | 'y';
  a: number;
  b: number;
  hiText: string;
  loText: string;
  area: number;
  riemannRects: EvalRiemannRect[];
  riemannSum: number | null;
  slice: { rect: [Pt, Pt]; label: string | null; at: number; lo: number; hi: number } | null;
  roc?: { gt?: number; lt?: number };
  guides: number[];
}

export interface EvalField {
  layer: FieldLayer;
  mode: 'slope' | 'vector';
  names: [string, string];
  text: string[];
  arrows: { at: Pt; dir: Pt }[];
  equilibria: Equilibrium[];
  nullclines: { which: 0 | 1; segments: Pt[][]; lines: LineEq[] | null; color: string; style: LineStyle; label: string }[];
}

export interface EvalFlow {
  layer: FlowLayer;
  path: Pt[];
  heads: { at: Pt; dir: Pt }[];
  summary: string;
}

export interface EvaluatedPlot {
  kind: 'plot';
  spec: PlotScene;
  params: Record<string, number>;
  xWindow: Range;
  yWindow: Range;
  aspect: number;
  axes: { x: string; y: string };
  curves: EvalCurve[];
  shades: EvalShade[];
  fields: EvalField[];
  flows: EvalFlow[];
  marks: {
    points: { x: number; y: number; fill: Fill; label: string | null; pos: Pos | null; color?: string; auto?: boolean }[];
    poles: { x: number; y: number; label: string | null }[];
    zeros: { x: number; y: number; label: string | null }[];
    impulses: { at: number; size: number; label: string | null }[];
    arrows: { from: Pt; to: Pt; style: LineStyle; label: string | null }[];
    projections: Pt[];
    signs: { a: number | '-inf'; b: number | 'inf'; sign: '+' | '-' | '0' | 'undef' }[];
    intervals: { a: number | '-inf'; b: number | 'inf'; ends: [Fill, Fill]; label: string | null }[];
    labels: { x: number; y: number; text: string }[];
  };
  ticks: { x: { at: number; label: string }[] | null; y: { at: number; label: string }[] | null };
  /** All drawable curve polylines for ink verification. */
  polylines: Pt[][];
}

export interface LaidOutNode extends DiagramNode {
  x: number;
  y: number;
  w: number;
  h: number;
  box: MathBox;
}

export interface LaidOutEdge extends DiagramEdge {
  pts: Pt[];
  labelBox: MathBox | null;
  labelAt: Pt | null;
}

export interface EvaluatedDiagram {
  kind: 'diagram';
  spec: DiagramScene;
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

export type EvaluatedScene = EvaluatedPlot | EvaluatedDiagram;

function evalNumBound(v: number | string, params: Record<string, number>, fallback: number): number {
  const n = evalBound(v, params);
  return typeof n === 'number' ? n : fallback;
}

function deriv(f: (x: number) => number) {
  return (x: number) => {
    const h = 1e-5 * Math.max(1, Math.abs(x));
    return (f(x + h) - f(x - h)) / (2 * h);
  };
}

function isConstPiece(f: (x: number) => number, lo: number, hi: number): number | null {
  const y0 = f(lo);
  if (!Number.isFinite(y0)) return null;
  for (let k = 1; k <= 12; k++) {
    const y = f(lo + ((hi - lo) * k) / 12);
    if (!Number.isFinite(y) || Math.abs(y - y0) > 1e-11 * Math.max(1, Math.abs(y0))) return null;
  }
  return y0;
}

/** Evaluates a PlotScene or DiagramScene; returns errors if any math/geometry fails. */
export function evaluateScene(
  scene: SceneSpec,
  opts?: { aspect?: number },
): { evaluated: EvaluatedScene; errors: string[]; warnings: string[] } | { evaluated: null; errors: string[]; warnings: string[] } {
  if (scene.scene === 'diagram') return { evaluated: evaluateDiagram(scene), errors: [], warnings: [] };
  return evaluatePlot(scene, opts?.aspect);
}

const GREEK_VAR_MAP: Record<string, string> = {
  θ: 'theta',
  theta: 'theta',
  ω: 'omega',
  omega: 'omega',
  α: 'alpha',
  alpha: 'alpha',
  φ: 'phi',
  phi: 'phi',
  τ: 'tau',
  tau: 'tau',
};

function axisVar(raw: string, fallback: string): string {
  const t = raw.trim().replace(/^\\/, '');
  if (GREEK_VAR_MAP[t]) return GREEK_VAR_MAP[t];
  if (/^[A-Za-z]$/.test(t)) return t;
  return fallback;
}

function evaluatePlot(
  scene: PlotScene,
  defaultAspect?: number,
): { evaluated: EvaluatedPlot; errors: string[]; warnings: string[] } | { evaluated: null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const params: Record<string, number> = {};
  for (const p of scene.params ?? []) {
    if (Number.isFinite(p.value)) params[p.name] = p.value;
  }

  const space = scene.space ?? 'cartesian';
  const axX = scene.axes?.x ?? (space === 'complex' ? 'Re(s)' : 'x');
  const axY = scene.axes?.y ?? (space === 'complex' ? 'Im(s)' : 'y');
  const indep = space === 'polar' ? 'theta' : axisVar(axX, 'x');
  const dep = axisVar(axY, 'y');

  // Resolve X window first (from window.x, pole/zero/point bounds, or default).
  const numBounds: number[] = [];
  const numYBounds: number[] = [];
  for (const l of scene.layers) {
    if (l.kind === 'mark') {
      const it = l.item;
      if (it.mark === 'point' || it.mark === 'pole' || it.mark === 'zero' || it.mark === 'projection' || it.mark === 'label') {
        const bx = evalBound(it.at[0], params);
        const by = evalBound(it.at[1], params);
        if (typeof bx === 'number') numBounds.push(bx);
        if (typeof by === 'number') numYBounds.push(by);
      } else if (it.mark === 'impulse') {
        const bx = evalBound(it.at, params);
        if (typeof bx === 'number') numBounds.push(bx);
        if (typeof it.size === 'number') numYBounds.push(it.size);
      } else if (it.mark === 'sign' || it.mark === 'interval') {
        const a = evalBound(it.on[0], params);
        const b = evalBound(it.on[1], params);
        if (typeof a === 'number') numBounds.push(a);
        if (typeof b === 'number') numBounds.push(b);
      } else if (it.mark === 'arrow') {
        for (const p of [it.from, it.to]) {
          const bx = evalBound(p[0], params);
          const by = evalBound(p[1], params);
          if (typeof bx === 'number') numBounds.push(bx);
          if (typeof by === 'number') numYBounds.push(by);
        }
      }
    } else if (l.kind === 'flow') {
      const bx = evalBound(l.start[0], params);
      const by = evalBound(l.start[1], params);
      if (typeof bx === 'number') numBounds.push(bx);
      if (typeof by === 'number') numYBounds.push(by);
    } else if (l.kind === 'curve' && l.domain) {
      const d0 = evalBound(l.domain[0], params);
      const d1 = evalBound(l.domain[1], params);
      if (typeof d0 === 'number') numBounds.push(d0);
      if (typeof d1 === 'number') numBounds.push(d1);
    } else if (l.kind === 'shade') {
      if (l.roc?.gt !== undefined) numBounds.push(l.roc.gt);
      if (l.roc?.lt !== undefined) numBounds.push(l.roc.lt);
      if (Array.isArray(l.on)) {
        const a = evalBound(l.on[0], params);
        const b = evalBound(l.on[1], params);
        if (typeof a === 'number') numBounds.push(a);
        if (typeof b === 'number') numBounds.push(b);
      }
    }
  }

  let xWindow: Range;
  if (scene.window?.x) {
    const a = evalNumBound(scene.window.x[0], params, -4);
    const b = evalNumBound(scene.window.x[1], params, 4);
    xWindow = a < b ? [a, b] : [b, a];
  } else if (space === 'polar') {
    xWindow = [-3, 3];
  } else if (numBounds.length) {
    const lo = Math.min(...numBounds);
    const hi = Math.max(...numBounds);
    const span = Math.max(2, hi - lo);
    xWindow = niceRange(lo - 0.2 * span, hi + 0.2 * span);
  } else if (scene.layers.some((l) => l.kind === 'field')) {
    xWindow = [-3, 3];
  } else if (scene.layers.some((l) => l.kind === 'shade' && l.on === 'intersections')) {
    xWindow = [-10, 10];
  } else {
    xWindow = [0, 5];
  }

  const [wx0, wx1] = xWindow;
  const tol = (wx1 - wx0) * 1e-7;
  let schematicFlag = !!scene.schematic;

  /* 1. Compile curves & group adjacent piecewise curves or cases */
  interface PrePiece {
    expr: string;
    text: string;
    on: Range;
    ends: [Fill | null, Fill | null];
    f: (x: number) => number;
  }
  interface PreCurve {
    n: number;
    layer: CurveLayer;
    text: string;
    form: CurveLayer['form'];
    style: LineStyle;
    pieces: PrePiece[];
    fn2?: (x: number, y: number) => number;
    fnY?: (t: number) => number;
    paramDomain?: Range;
  }

  const preCurves: PreCurve[] = [];
  let colorIdx = 0;

  scene.layers.forEach((l, li) => {
    if (l.kind !== 'curve') return;
    const cases = parseCasesExpr(l.expr, params);
    const form = cases ? 'cases' : (l.form ?? (space === 'polar' ? 'polar' : 'y'));
    if (form === 'polar' || form === 'parametric') {
      try {
        const cx = compileLatexExpr(l.expr, [form === 'polar' ? 'theta' : 't'], params, schematicFlag);
        const cy = form === 'parametric' && l.exprY ? compileLatexExpr(l.exprY, ['t'], params, schematicFlag) : null;
        const dom: Range = l.domain
          ? [evalNumBound(l.domain[0], params, 0), evalNumBound(l.domain[1], params, 2 * Math.PI)]
          : [0, 2 * Math.PI];
        preCurves.push({
          n: li + 1,
          layer: l,
          text: cy ? `(${cx.text}, ${cy.text})` : cx.text,
          form,
          style: l.style ?? 'solid',
          pieces: [{ expr: l.expr, text: cx.text, on: dom, ends: [null, null], f: cx.f }],
          fnY: cy?.f,
          paramDomain: dom,
        });
      } catch (e) {
        errors.push(`curve ${li + 1}: ${(e as Error).message}`);
      }
      return;
    }

    if (form === 'implicit') {
      try {
        const lhsRhs = l.expr.split('=');
        const expr = lhsRhs.length === 2 ? `(${lhsRhs[0]}) - (${lhsRhs[1]})` : l.expr;
        const c2 = compileLatex2(expr, indep, dep, params);
        preCurves.push({
          n: li + 1,
          layer: l,
          text: l.expr,
          form: 'implicit',
          style: l.style ?? 'solid',
          pieces: [],
          fn2: c2.f,
        });
      } catch (e) {
        errors.push(`curve ${li + 1}: ${(e as Error).message}`);
      }
      return;
    }

    if (cases) {
      const pcs: PrePiece[] = [];
      for (const c of cases) {
        try {
          const comp = compileLatexExpr(c.expr, [indep], params, schematicFlag);
          if (comp.schematicUsed) schematicFlag = true;
          const lo = c.on[0] === '-inf' ? wx0 : Math.max(wx0, c.on[0] as number);
          const hi = c.on[1] === 'inf' ? wx1 : Math.min(wx1, c.on[1] as number);
          if (hi > lo + tol) pcs.push({ expr: c.expr, text: comp.text, on: [lo, hi], ends: c.ends, f: comp.f });
        } catch (e) {
          errors.push(`curve ${li + 1} piece: ${(e as Error).message}`);
        }
      }
      pcs.sort((p, q) => p.on[0] - q.on[0]);
      if (pcs.length) {
        preCurves.push({ n: li + 1, layer: l, text: l.label ?? pcs.map((p) => p.text).join('; '), form: 'cases', style: l.style ?? 'solid', pieces: pcs });
      }
      return;
    }

    const vName = form === 'x' ? dep : indep;
    try {
      const comp = compileLatexExpr(l.expr, [vName], params, schematicFlag);
      if (comp.schematicUsed) schematicFlag = true;
      const dom: Range = l.domain
        ? [evalNumBound(l.domain[0], params, wx0), evalNumBound(l.domain[1], params, wx1)]
        : [wx0, wx1];
      preCurves.push({
        n: li + 1,
        layer: l,
        text: comp.text,
        form,
        style: l.style ?? 'solid',
        pieces: [{ expr: l.expr, text: comp.text, on: dom, ends: l.ends ?? [null, null], f: comp.f }],
      });
    } catch (e) {
      errors.push(`curve ${li + 1}: ${(e as Error).message}`);
    }
  });

  /* 2. Compile shades */
  interface PreShade {
    layer: ShadeLayer;
    axis: 'x' | 'y';
    hiF: (x: number) => number;
    loF: (x: number) => number;
    hiText: string;
    loText: string;
    a: number;
    b: number;
  }
  const preShades: PreShade[] = [];
  for (const l of scene.layers) {
    if (l.kind !== 'shade' || l.roc) continue;
    const axis = l.axis ?? 'x';
    const vName = axis === 'x' ? indep : dep;
    try {
      const hi = compileLatexExpr(l.top, [vName], params, schematicFlag);
      const lo = compileLatexExpr(l.bottom ?? '0', [vName], params, schematicFlag);
      let a = wx0;
      let b = wx1;
      if (Array.isArray(l.on)) {
        a = evalNumBound(l.on[0], params, wx0);
        b = evalNumBound(l.on[1], params, wx1);
      } else {
        const meets = findMeets((x) => hi.f(x) - lo.f(x), wx0, wx1);
        if (meets.length >= 2) [a, b] = [meets[0], meets[meets.length - 1]];
        else errors.push('shade: could not find two intersection points between the curves.');
      }
      if (b > a) preShades.push({ layer: l, axis, hiF: hi.f, loF: lo.f, hiText: hi.text, loText: lo.text, a, b });
    } catch (e) {
      errors.push(`shade: ${(e as Error).message}`);
    }
  }

  /* 3. Compile fields */
  const preFields: { layer: FieldLayer; f1: (x: number, y: number) => number; f2?: (x: number, y: number) => number; names: [string, string]; texts: string[] }[] = [];
  for (const l of scene.layers) {
    if (l.kind !== 'field') continue;
    const vx = l.vars?.[0] ? axisVar(l.vars[0], indep) : indep;
    const vy = l.vars?.[1] ? axisVar(l.vars[1], dep) : dep;
    const names: [string, string] = [vx, vy];
    try {
      if (l.mode === 'slope') {
        const c1 = compileLatex2(l.exprs[0], vx, vy, params, names);
        preFields.push({ layer: l, f1: c1.f, names, texts: [c1.text] });
      } else {
        const c1 = compileLatex2(l.exprs[0], vx, vy, params, names);
        const c2 = compileLatex2(l.exprs[1]!, vx, vy, params, names);
        preFields.push({ layer: l, f1: c1.f, f2: c2.f, names, texts: [c1.text, c2.text] });
      }
    } catch (e) {
      errors.push(`field: ${(e as Error).message}`);
    }
  }

  if (errors.length) return { evaluated: null, errors, warnings };

  // Narrow window if region uses intersections & window.x wasn't explicit
  if (!scene.window?.x && preShades.length && !preCurves.length) {
    const a = Math.min(...preShades.map((s) => s.a));
    const b = Math.max(...preShades.map((s) => s.b));
    const span = Math.max(1, b - a);
    xWindow = niceRange(a - 0.12 * span, b + 0.12 * span);
  }

  /* 4. Determine Y window */
  let yWindow: Range;
  if (scene.window?.y) {
    const c = evalNumBound(scene.window.y[0], params, -3);
    const d = evalNumBound(scene.window.y[1], params, 3);
    yWindow = c < d ? [c, d] : [d, c];
  } else if (space === '1d') {
    yWindow = [-1, 1];
  } else if (space === 'polar') {
    // Frame polar curve bounds
    const ys: number[] = [];
    for (const pc of preCurves) {
      const [t0, t1] = pc.paramDomain ?? [0, 2 * Math.PI];
      for (let k = 0; k <= 180; k++) {
        const t = t0 + ((t1 - t0) * k) / 180;
        const r = pc.pieces[0].f(t);
        if (Number.isFinite(r)) ys.push(r * Math.sin(t), r * Math.cos(t));
      }
    }
    const m = Math.max(2, ...ys.map(Math.abs));
    if (!scene.window?.x) xWindow = niceRange(-m * 1.1, m * 1.1);
    yWindow = niceRange(-m * 1.1, m * 1.1);
  } else if (preFields.length && !preCurves.length) {
    yWindow = numYBounds.length ? niceRange(Math.min(...numYBounds, -3), Math.max(...numYBounds, 3)) : [-3, 3];
  } else if (space === 'complex' || (numYBounds.length && !preCurves.length && !preShades.length)) {
    const lo = numYBounds.length ? Math.min(0, ...numYBounds) - 1 : -3;
    const hi = numYBounds.length ? Math.max(0, ...numYBounds) + 1 : 3;
    yWindow = niceRange(lo, hi);
  } else {
    const fs: ((x: number) => number)[] = [];
    for (const pc of preCurves) {
      if (pc.form === 'y' || pc.form === 'cases') {
        for (const p of pc.pieces) fs.push(p.f);
      }
    }
    for (const sh of preShades) {
      if (sh.axis === 'x') fs.push(sh.hiF, sh.loF);
    }
    if (fs.length) {
      yWindow = autoY(fs, xWindow, numYBounds);
    } else {
      yWindow = [-3, 3];
    }
  }

  /* 5. Sample curves + compute exact curve facts */
  const curves: EvalCurve[] = [];
  const polylines: Pt[][] = [];

  for (const pc of preCurves) {
    const color = pc.style === 'dashed' && !pc.layer.label ? GRAY : COLORS[colorIdx++ % COLORS.length];
    const out: EvalCurve = {
      n: pc.n,
      layer: pc.layer,
      text: pc.text,
      color,
      style: pc.style,
      piecewise: pc.pieces.length > 1 || !!pc.layer.domain,
      pieces: pc.pieces,
      segments: [],
      zeros: [],
      maxima: [],
      minima: [],
      jumps: [],
      asymptotes: [],
      gaps: [],
      constant: [],
      oscillation: null,
      points: [],
      jumpGuides: [],
    };

    if (pc.form === 'implicit' && pc.fn2) {
      out.segments = contour(pc.fn2, xWindow, yWindow);
      polylines.push(...out.segments);
      curves.push(out);
      continue;
    }

    if (pc.form === 'polar' || pc.form === 'parametric') {
      const [t0, t1] = pc.paramDomain ?? [0, 2 * Math.PI];
      const f1 = pc.pieces[0].f;
      const seg: Pt[] = [];
      for (let k = 0; k <= 360; k++) {
        const t = t0 + ((t1 - t0) * k) / 360;
        const pt: Pt =
          pc.form === 'polar'
            ? [f1(t) * Math.cos(t), f1(t) * Math.sin(t)]
            : [f1(t), pc.fnY!(t)];
        if (Number.isFinite(pt[0]) && Number.isFinite(pt[1])) seg.push(pt);
        else if (seg.length) {
          out.segments.push([...seg]);
          seg.length = 0;
        }
      }
      if (seg.length) out.segments.push(seg);
      polylines.push(...out.segments);
      curves.push(out);
      continue;
    }

    const toXY = (p: Pt): Pt => (pc.form === 'x' ? [p[1], p[0]] : p);
    const [iWin, dWin] = pc.form === 'x' ? [yWindow, xWindow] : [xWindow, yWindow];
    const R = dWin[1] - dWin[0];

    for (const p of pc.pieces) {
      const lo = Math.max(iWin[0], p.on[0]);
      const hi = Math.min(iWin[1], p.on[1]);
      if (hi <= lo) continue;
      const s = sampleFn(p.f, [lo, hi], dWin);
      out.segments.push(...s.segments.map((seg) => seg.map(toXY)));
      out.gaps.push(...s.gaps);
      for (const br of s.breaks) {
        if (br.kind === 'blowup') out.asymptotes.push(br.x);
        else out.jumps.push({ x: br.x, from: br.left, to: br.right });
      }
      const cval = isConstPiece(p.f, lo, hi);
      if (cval !== null) {
        out.constant.push([lo, hi, cval]);
      } else {
        const df = deriv(p.f);
        for (const seg of s.segments) {
          for (let i = 1; i < seg.length; i++) {
            const [x0, y0] = seg[i - 1];
            const [x1, y1] = seg[i];
            if (y1 === 0) out.zeros.push(x1);
            else if (y0 !== 0 && Math.sign(y0) !== Math.sign(y1)) out.zeros.push(bisect(p.f, x0, x1));
          }
          let prev = 0;
          let prevIdx = 0;
          for (let i = 1; i < seg.length; i++) {
            const dy = seg[i][1] - seg[i - 1][1];
            const sg = Math.abs(dy) < 1e-14 ? 0 : Math.sign(dy);
            if (!sg) continue;
            if (prev && sg !== prev) {
              const lo2 = seg[Math.max(0, prevIdx - 1)][0];
              const hi2 = seg[i][0];
              let x = bisect(df, lo2, hi2);
              if (!(df(lo2) * df(hi2) < 0)) x = seg[i - 1][0];
              const y = p.f(x);
              if (Number.isFinite(y) && x > lo + (hi - lo) * 1e-5 && x < hi - (hi - lo) * 1e-5) {
                (prev > 0 ? out.maxima : out.minima).push(toXY([x, y]));
              }
            }
            prev = sg;
            prevIdx = i;
          }
        }
      }
      // Endpoint open/closed dots from ends specification (inside interior breakpoints).
      for (const [endIdx, endX] of [[0, p.on[0]], [1, p.on[1]]] as const) {
        const fill = p.ends[endIdx];
        if (!fill) continue;
        if (endX <= iWin[0] + tol || endX >= iWin[1] - tol) continue;
        const y = p.f(endX);
        if (Number.isFinite(y)) out.points.push({ x: endX, y, fill });
      }
    }

    // Jumps & guides between consecutive pieces of one cases curve
    for (let k = 1; k < pc.pieces.length; k++) {
      const p0 = pc.pieces[k - 1];
      const p1 = pc.pieces[k];
      if (Math.abs(p0.on[1] - p1.on[0]) <= tol) {
        const y0 = p0.f(p0.on[1]);
        const y1 = p1.f(p1.on[0]);
        if (Number.isFinite(y0) && Number.isFinite(y1) && Math.abs(y1 - y0) > R * 1e-7) {
          out.jumps.push({ x: p1.on[0], from: y0, to: y1 });
          if (pc.layer.guides) out.jumpGuides.push({ x: p1.on[0], y0, y1 });
        }
      }
    }
    if (pc.layer.guides && pc.pieces.length === 1) {
      for (const j of out.jumps) out.jumpGuides.push({ x: j.x, y0: j.from, y1: j.to });
    }

    polylines.push(...out.segments);
    curves.push(out);
  }

  /* 6. Cross-curve jumpGuides for adjacent single-piece curves sharing a breakpoint */
  const hasAnyGuides = scene.layers.some((l) => l.kind === 'curve' && l.guides);
  if (hasAnyGuides) {
    const pieceCurves = curves.filter((c) => c.pieces.length === 1 && c.layer.domain);
    for (let i = 1; i < pieceCurves.length; i++) {
      const a = pieceCurves[i - 1].pieces[0];
      const b = pieceCurves[i].pieces[0];
      if (Math.abs(a.on[1] - b.on[0]) <= tol) {
        const y0 = a.f(a.on[1]);
        const y1 = b.f(b.on[0]);
        if (Number.isFinite(y0) && Number.isFinite(y1) && Math.abs(y1 - y0) > (yWindow[1] - yWindow[0]) * 1e-6) {
          pieceCurves[i].jumpGuides.push({ x: b.on[0], y0, y1 });
        }
      }
    }
  }

  /* 7. Evaluate shades & Riemann sums */
  const shades: EvalShade[] = [];
  for (const ps of preShades) {
    const { a, b, axis, hiF, loF, layer } = ps;
    const toXY = (p: Pt): Pt => (axis === 'x' ? p : [p[1], p[0]]);
    const dWin = axis === 'x' ? yWindow : xWindow;
    const topPts = sampleFn(hiF, [a, b], dWin).segments.flat();
    const botPts = sampleFn(loF, [a, b], dWin).segments.flat().reverse();
    const polygon = [...topPts, ...botPts].map(toXY);
    const area = Math.abs(integrate((x) => hiF(x) - loF(x), a, b));

    const riemannRects: EvalRiemannRect[] = [];
    let riemannSum: number | null = null;
    if (layer.riemann) {
      const { n, rule } = layer.riemann;
      const dx = (b - a) / n;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const x0 = a + k * dx;
        const x1 = x0 + dx;
        if (rule === 'trapezoid') {
          const y0 = hiF(x0);
          const y1 = hiF(x1);
          const l0 = loF(x0);
          const l1 = loF(x1);
          sum += 0.5 * ((y0 - l0) + (y1 - l1)) * dx;
          riemannRects.push({
            x0,
            x1,
            y0: Math.min(l0, l1),
            y1: Math.max(y0, y1),
            poly: [toXY([x0, l0]), toXY([x0, y0]), toXY([x1, y1]), toXY([x1, l1])],
          });
        } else {
          const sampleX = rule === 'left' ? x0 : rule === 'right' ? x1 : (x0 + x1) / 2;
          const yTop = hiF(sampleX);
          const yBot = loF(sampleX);
          sum += (yTop - yBot) * dx;
          riemannRects.push({ x0, x1, y0: Math.min(yBot, yTop), y1: Math.max(yBot, yTop) });
        }
      }
      riemannSum = sum;
    }

    let slice: EvalShade['slice'] = null;
    if (layer.slice) {
      const at = evalNumBound(layer.slice.at, params, (a + b) / 2);
      const half = (b - a) / 48;
      const yLo = Math.min(loF(at), hiF(at));
      const yHi = Math.max(loF(at), hiF(at));
      slice = { rect: [toXY([at - half, yLo]), toXY([at + half, yHi])], label: layer.slice.label ?? null, at, lo: yLo, hi: yHi };
    }

    shades.push({
      layer,
      polygon,
      color: COLORS[5],
      axis,
      a,
      b,
      hiText: ps.hiText,
      loText: ps.loText,
      area,
      riemannRects,
      riemannSum,
      slice,
      guides: [],
    });
    // Also add boundary curve segments to polylines when not already drawn by curve layers
    if (!curves.length) {
      const bs = sampleFn(hiF, [a, b], dWin).segments.map((s) => s.map(toXY));
      polylines.push(...bs);
    }
  }
  for (const l of scene.layers) {
    if (l.kind !== 'shade' || !l.roc) continue;
    const r0 = Math.max(xWindow[0], l.roc.gt ?? xWindow[0]);
    const r1 = Math.min(xWindow[1], l.roc.lt ?? xWindow[1]);
    const guides: number[] = [];
    if (l.roc.gt !== undefined) guides.push(l.roc.gt);
    if (l.roc.lt !== undefined) guides.push(l.roc.lt);
    shades.push({
      layer: l,
      polygon:
        r1 > r0
          ? [
              [r0, yWindow[0]],
              [r1, yWindow[0]],
              [r1, yWindow[1]],
              [r0, yWindow[1]],
            ]
          : [],
      color: COLORS[5],
      axis: 'x',
      a: r0,
      b: r1,
      hiText: '',
      loText: '',
      area: 0,
      riemannRects: [],
      riemannSum: null,
      slice: null,
      roc: l.roc,
      guides,
    });
  }

  /* 8. Evaluate fields + flows */
  const fields: EvalField[] = [];
  const flows: EvalFlow[] = [];

  for (const pf of preFields) {
    const mode = pf.layer.mode;
    const show = new Set(pf.layer.show ?? (mode === 'slope' ? ['field'] : ['field', 'equilibria']));
    const arrows: { at: Pt; dir: Pt }[] = [];
    const nx = 18;
    const ny = 12;
    if (show.has('field')) {
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const x = xWindow[0] + ((i + 0.5) * (xWindow[1] - xWindow[0])) / nx;
          const y = yWindow[0] + ((j + 0.5) * (yWindow[1] - yWindow[0])) / ny;
          const dir: Pt = mode === 'slope' ? [1, pf.f1(x, y)] : [pf.f1(x, y), pf.f2!(x, y)];
          if (Number.isFinite(dir[0]) && Number.isFinite(dir[1]) && (dir[0] || dir[1])) arrows.push({ at: [x, y], dir });
        }
      }
    }

    let equilibria: Equilibrium[] = [];
    const nclOut: EvalField['nullclines'] = [];
    if (mode === 'vector' && pf.f2) {
      const F = (x: number, y: number): Pt => [pf.f1(x, y), pf.f2!(x, y)];
      if (show.has('equilibria') || show.has('eigenvectors')) {
        const pts = findEquilibria(F, xWindow, yWindow);
        equilibria = pts.map((at) => {
          const J = [
            [(F(at[0] + 1e-5, at[1])[0] - F(at[0] - 1e-5, at[1])[0]) / 2e-5, (F(at[0], at[1] + 1e-5)[0] - F(at[0], at[1] - 1e-5)[0]) / 2e-5],
            [(F(at[0] + 1e-5, at[1])[1] - F(at[0] - 1e-5, at[1])[1]) / 2e-5, (F(at[0], at[1] + 1e-5)[1] - F(at[0], at[1] - 1e-5)[1]) / 2e-5],
          ] as [[number, number], [number, number]];
          const ev = eigen(J);
          return { at, J, eigen: ev, type: classify(J, ev) };
        });
      }
      if (show.has('nullclines')) {
        const fakePhase = { F, vars: pf.names, names: pf.names } as unknown as Parameters<typeof nullclines>[0];
        for (const n of nullclines(fakePhase, xWindow, yWindow)) {
          nclOut.push({
            which: n.which,
            segments: n.segments,
            lines: n.lines,
            color: n.which ? COLORS[2] : COLORS[1],
            style: n.which ? 'dotted' : 'dashed',
            label: `${n.which ? pf.names[1] : pf.names[0]}' = 0`,
          });
        }
      }
    } else if (mode === 'slope' && show.has('isoclines')) {
      const segs = contour(pf.f1, xWindow, yWindow);
      const lines = segs.map((s) => asLine(s, xWindow, yWindow)).filter((x): x is LineEq => x !== null);
      nclOut.push({
        which: 1,
        segments: segs,
        lines: lines.length === segs.length && lines.length > 0 ? lines : null,
        color: COLORS[1],
        style: 'dashed',
        label: `${pf.names[1]}' = 0`,
      });
    }

    fields.push({ layer: pf.layer, mode, names: pf.names, text: pf.texts, arrows, equilibria, nullclines: nclOut });
  }

  // Integrate flows along primary field
  const primaryField = preFields[0];
  if (primaryField) {
    const sx = xWindow[1] - xWindow[0];
    const sy = yWindow[1] - yWindow[0];
    const ds = 1 / 300;
    const F = (x: number, y: number): Pt =>
      primaryField.layer.mode === 'slope' ? [1, primaryField.f1(x, y)] : [primaryField.f1(x, y), primaryField.f2!(x, y)];
    const eqPts = fields[0]?.equilibria.map((e) => e.at) ?? [];

    const integrateDir = (start: Pt, sign: 1 | -1): { pts: Pt[]; end: string } => {
      const pts: Pt[] = [start];
      let p = start;
      for (let k = 0; k < 2500; k++) {
        const v1 = F(p[0], p[1]);
        const n1 = Math.hypot(v1[0] / sx, v1[1] / sy);
        if (!Number.isFinite(n1) || n1 < 1e-12) return { pts, end: 'stops' };
        const step = (sign * ds) / n1;
        const v2 = F(p[0] + 0.5 * step * v1[0], p[1] + 0.5 * step * v1[1]);
        const v3 = F(p[0] + 0.5 * step * v2[0], p[1] + 0.5 * step * v2[1]);
        const v4 = F(p[0] + step * v3[0], p[1] + step * v3[1]);
        const next: Pt = [
          p[0] + (step / 6) * (v1[0] + 2 * v2[0] + 2 * v3[0] + v4[0]),
          p[1] + (step / 6) * (v1[1] + 2 * v2[1] + 2 * v3[1] + v4[1]),
        ];
        if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return { pts, end: 'stops' };
        p = next;
        pts.push(p);
        if (p[0] < xWindow[0] - 0.04 * sx) return { pts, end: 'left edge' };
        if (p[0] > xWindow[1] + 0.04 * sx) return { pts, end: 'right edge' };
        if (p[1] < yWindow[0] - 0.04 * sy) return { pts, end: 'bottom edge' };
        if (p[1] > yWindow[1] + 0.04 * sy) return { pts, end: 'top edge' };
        if (k > 15 && eqPts.some((e) => Math.hypot((p[0] - e[0]) / sx, (p[1] - e[1]) / sy) < 0.008)) {
          return { pts, end: 'equilibrium' };
        }
        if (k > 30 && Math.hypot((p[0] - start[0]) / sx, (p[1] - start[1]) / sy) < 1.5 * ds) {
          pts.push(start);
          return { pts, end: 'closed orbit' };
        }
      }
      return { pts, end: 'stays inside' };
    };

    for (const l of scene.layers) {
      if (l.kind !== 'flow') continue;
      const start: Pt = [evalNumBound(l.start[0], params, 0), evalNumBound(l.start[1], params, 0)];
      const fwd = l.direction !== 'backward' ? integrateDir(start, 1) : { pts: [start], end: '' };
      const bwd = l.direction !== 'forward' && fwd.end !== 'closed orbit' ? integrateDir(start, -1) : { pts: [start], end: '' };
      const path = [...[...bwd.pts].reverse(), ...fwd.pts.slice(1)];
      const heads: { at: Pt; dir: Pt }[] = [];
      if (path.length > 10) {
        const idx = Math.floor(path.length * 0.55);
        const qIdx = Math.min(path.length - 1, idx + 2);
        heads.push({ at: path[idx], dir: [path[qIdx][0] - path[idx][0], path[qIdx][1] - path[idx][1]] });
      }
      const descBits = [bwd.end && `enters/comes from ${bwd.end}`, fwd.end && `goes to ${fwd.end}`].filter(Boolean);
      flows.push({ layer: l, path, heads, summary: descBits.join(' and ') || 'trajectory' });
      polylines.push(path);
    }
  }

  /* 9. Collect marks */
  const marks: EvaluatedPlot['marks'] = {
    points: [],
    poles: [],
    zeros: [],
    impulses: [],
    arrows: [],
    projections: [],
    signs: [],
    intervals: [],
    labels: [],
  };
  for (const f of fields) {
    for (const e of f.equilibria) {
      marks.points.push({
        x: e.at[0],
        y: e.at[1],
        fill: e.type.startsWith('stable') || e.type === 'center' ? 'closed' : 'open',
        label: null,
        pos: null,
        auto: true,
      });
    }
  }
  for (const c of curves) {
    for (const p of c.points) {
      marks.points.push({ x: p.x, y: p.y, fill: p.fill, label: null, pos: null, color: c.color, auto: true });
    }
  }
  for (const l of scene.layers) {
    if (l.kind !== 'mark') continue;
    const it = l.item;
    if (it.mark === 'point') {
      marks.points.push({
        x: evalNumBound(it.at[0], params, 0),
        y: evalNumBound(it.at[1], params, 0),
        fill: it.fill ?? 'closed',
        label: it.label ?? null,
        pos: it.pos ?? null,
      });
    } else if (it.mark === 'pole') {
      marks.poles.push({ x: evalNumBound(it.at[0], params, 0), y: evalNumBound(it.at[1], params, 0), label: it.label ?? null });
    } else if (it.mark === 'zero') {
      marks.zeros.push({ x: evalNumBound(it.at[0], params, 0), y: evalNumBound(it.at[1], params, 0), label: it.label ?? null });
    } else if (it.mark === 'impulse') {
      marks.impulses.push({ at: evalNumBound(it.at, params, 0), size: it.size ?? 1, label: it.label ?? null });
    } else if (it.mark === 'arrow') {
      marks.arrows.push({
        from: [evalNumBound(it.from[0], params, 0), evalNumBound(it.from[1], params, 0)],
        to: [evalNumBound(it.to[0], params, 0), evalNumBound(it.to[1], params, 0)],
        style: it.style ?? 'solid',
        label: it.label ?? null,
      });
    } else if (it.mark === 'projection') {
      marks.projections.push([evalNumBound(it.at[0], params, 0), evalNumBound(it.at[1], params, 0)]);
    } else if (it.mark === 'sign') {
      const lo = evalBound(it.on[0], params);
      const hi = evalBound(it.on[1], params);
      marks.signs.push({
        a: lo === null || lo === 'inf' ? '-inf' : lo,
        b: hi === null || hi === '-inf' ? 'inf' : hi,
        sign: it.sign,
      });
    } else if (it.mark === 'interval') {
      const lo = evalBound(it.on[0], params);
      const hi = evalBound(it.on[1], params);
      marks.intervals.push({
        a: lo === null || lo === 'inf' ? '-inf' : lo,
        b: hi === null || hi === '-inf' ? 'inf' : hi,
        ends: it.ends,
        label: it.label ?? null,
      });
    } else if (it.mark === 'label') {
      marks.labels.push({ x: evalNumBound(it.at[0], params, 0), y: evalNumBound(it.at[1], params, 0), text: it.text });
    }
  }

  /* 10. Pedagogical ticks (exact params, piecewise jumps/levels, suppressed on schematic axes) */
  const resolveExplicitTicks = (raw?: { at: number | string; label?: string }[]) => {
    if (!raw?.length) return null;
    const out: { at: number; label: string }[] = [];
    for (const t of raw) {
      const n = evalBound(t.at, params);
      if (typeof n !== 'number') continue;
      out.push({ at: n, label: t.label ?? (nice(n).exact ? nice(n).text : String(t.at)) });
    }
    return out;
  };

  let tx = resolveExplicitTicks(scene.ticks?.x);
  let ty = resolveExplicitTicks(scene.ticks?.y);

  if (!tx) {
    const paramTicks = Object.entries(params)
      .filter(([, v]) => v > xWindow[0] + tol && v < xWindow[1] - tol)
      .sort((a, b) => a[1] - b[1])
      .map(([name, val]) => ({ at: val, label: name }));
    const jumpXs = new Set<number>();
    for (const c of curves) {
      if (c.piecewise) {
        for (const p of c.pieces) {
          if (p.on[0] > xWindow[0] + tol && p.on[0] < xWindow[1] - tol) jumpXs.add(p.on[0]);
          if (p.on[1] > xWindow[0] + tol && p.on[1] < xWindow[1] - tol) jumpXs.add(p.on[1]);
        }
      }
    }
    if (paramTicks.length) tx = paramTicks;
    else if (jumpXs.size > 0 && jumpXs.size <= 6) {
      tx = [...jumpXs].sort((a, b) => a - b).map((v) => ({ at: v, label: nice(v).exact ? nice(v).text : String(v) }));
    } else if (schematicFlag) {
      tx = [];
    }
  }

  if (!ty) {
    const constVals = new Set<number>();
    for (const c of curves) for (const [, , val] of c.constant) constVals.add(val);
    if (schematicFlag && space !== 'complex') {
      ty = [];
    } else if (constVals.size >= 2 && constVals.size <= 6 && [...constVals].every((v) => nice(v).exact)) {
      ty = [...constVals].sort((a, b) => a - b).map((v) => ({ at: v, label: nice(v).text }));
    }
  }

  const aspect = scene.aspect ?? defaultAspect ?? (space === '1d' ? 3.5 : 1.45);
  return {
    evaluated: {
      kind: 'plot',
      spec: scene,
      params,
      xWindow,
      yWindow,
      aspect,
      axes: { x: axX, y: axY },
      curves,
      shades,
      fields,
      flows,
      marks,
      ticks: { x: tx, y: ty },
      polylines,
    },
    errors,
    warnings,
  };
}

function evaluateDiagram(scene: DiagramScene): EvaluatedDiagram {
  const padX = 28;
  const padY = 26;
  const colGap = 118;
  const rowGap = 76;
  const cols = scene.nodes.map((n) => n.col);
  const rows = scene.nodes.map((n) => n.row);
  const minCol = Math.min(...cols);
  const minRow = Math.min(...rows);

  const nodes: LaidOutNode[] = scene.nodes.map((n) => {
    const box = measureAndRenderMath(n.label, 14);
    const w =
      n.shape === 'box' || n.shape === 'mass'
        ? Math.max(54, box.width + 24)
        : n.shape === 'tank'
          ? Math.max(64, box.width + 26)
          : n.shape === 'sum' || n.shape === 'circle'
            ? Math.max(30, Math.ceil(Math.max(box.width, box.height) + 14))
            : n.shape === 'wall' || n.shape === 'ground'
              ? 18
              : Math.max(18, box.width + 8);
    const h =
      n.shape === 'box' || n.shape === 'mass'
        ? Math.max(36, box.height + 16)
        : n.shape === 'tank'
          ? 56
          : n.shape === 'sum' || n.shape === 'circle'
            ? w
            : n.shape === 'wall'
              ? 64
              : 24;
    const x = padX + 40 + (n.col - minCol) * colGap;
    const y = padY + 34 + (n.row - minRow) * rowGap;
    return { ...n, x, y, w, h, box };
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let maxX = 240;
  let maxY = 120;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.w / 2 + padX + 20);
    maxY = Math.max(maxY, n.y + n.h / 2 + padY + 20);
  }

  const edges: LaidOutEdge[] = [];
  for (const e of scene.edges) {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const anchor = (n: LaidOutNode, tx: number, ty: number): Pt => {
      if (n.shape === 'point') return [n.x, n.y];
      if (Math.abs(tx) * n.h >= Math.abs(ty) * n.w) {
        return [n.x + Math.sign(tx || 1) * (n.w / 2), n.y];
      }
      return [n.x, n.y + Math.sign(ty || 1) * (n.h / 2)];
    };
    const p0 = anchor(a, dx, dy);
    const p1 = anchor(b, -dx, -dy);
    const pts: Pt[] = [p0, p1];
    const mid: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const labelBox = e.label ? measureAndRenderMath(e.label, 13) : null;
    const labelAt: Pt | null = labelBox
      ? Math.abs(dx) >= Math.abs(dy)
        ? [mid[0], mid[1] - 10]
        : [mid[0] + 10, mid[1] + 4]
      : null;
    if (labelBox && labelAt) {
      maxX = Math.max(maxX, labelAt[0] + labelBox.width + 16);
      maxY = Math.max(maxY, labelAt[1] + 16);
    }
    edges.push({ ...e, pts, labelBox, labelAt });
  }

  return {
    kind: 'diagram',
    spec: scene,
    width: Math.round(maxX),
    height: Math.round(maxY),
    nodes,
    edges,
  };
}
