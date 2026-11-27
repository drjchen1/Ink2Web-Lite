/**
 * Redraw: figures recreated from their mathematics (2.2 dev; not yet used by the app).
 *
 *   const r = redraw(specJson, { id: 'p3-fig2' });
 *   if (r.ok) element.innerHTML = r.svg;   // r.alt.short / r.alt.long for alt text
 *
 * common.ts   shared spec fields         spec.ts     checks, dispatch, "graph"
 * region.ts   "region" (spec, facts, alt text)
 * phase.ts    "phase" (spec, equilibria, nullclines, trajectories, alt text)
 * expr.ts     calculator-syntax expressions (no eval)
 * sample.ts   adaptive sampling with jumps, asymptotes, and gaps
 * analyze.ts  graph facts                describe.ts graph alt text + shared helpers
 * svg.ts      the drawing (every kind becomes a Plot)
 */
import { analyzeGraph, type GraphFacts } from './analyze.ts';
import { describeGraph, mathifyAlt } from './describe.ts';
import { analyzeRegion, describeRegion, intersectionMarks, regionWindows, type RegionFacts } from './region.ts';
import { analyzePhase, clipLine, describePhase, isStable, phaseWindows, type PhaseFacts } from './phase.ts';
import { analyzeSlope, describeSlope, type SlopeFacts } from './slope.ts';
import { analyzeLine, describeLine, renderLineSvg, type LineFacts } from './line.ts';
import { autoY, type Pt } from './sample.ts';
import { nice } from './nice.ts';
import { checkSpec, valueAt, type GraphSpec, type Spec } from './spec.ts';
import { COLORS, GRAY, renderPlot, type Arrow, type Plot, type PlotCurve } from './svg.ts';
import {
  formatSceneDsl,
  parseSceneDsl,
  upgradeV1ToScene,
  V2_TEMPLATES,
  type SceneLayer,
  type SceneSpec,
  type SpaceKind,
  type V2TemplateKey,
} from './v2/scene.ts';
import { evaluateScene, type EvaluatedScene } from './v2/evaluate.ts';
import { describeScene } from './v2/describeScene.ts';
import { renderSceneSvg } from './v2/render.ts';

export type Facts = GraphFacts | RegionFacts | PhaseFacts | SlopeFacts | LineFacts | { kind: 'scene'; evaluated: EvaluatedScene };

export type RedrawResult =
  | { ok: true; svg: string; alt: { short: string; long: string; markdown: string }; facts: Facts; spec: Spec | SceneSpec; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function graphPlot(spec: GraphSpec, f: GraphFacts): Plot {
  let colorIdx = 0;
  const [a, b] = spec.window.x;
  const tol = (b - a) * 1e-7;
  const curveColors = f.curves.map((c) =>
    c.curve.style === 'dashed' && !c.curve.label ? GRAY : COLORS[colorIdx++ % COLORS.length],
  );
  const autoPoints: typeof spec.points = [];
  f.curves.forEach((c, ci) => {
    if (!c.curve.piecewise) return;
    const color = curveColors[ci];
    const hasMark = (x: number, y: number, fill: 'open' | 'closed') =>
      spec.points.some((p) => p.fill === fill && Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) ||
      autoPoints.some((p) => p.fill === fill && Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol);
    for (const piece of c.curve.pieces) {
      const ends: [number, 'open' | 'closed' | null][] = [
        [piece.on[0], piece.ends[0]],
        [piece.on[1], piece.ends[1]],
      ];
      for (const [x, fill] of ends) {
        if (!fill || x <= a + tol || x >= b - tol) continue;
        const atJump = c.jumps.some((j) => Math.abs(j.x - x) <= tol);
        if (!atJump && fill !== 'open') continue;
        const y = piece.f(x);
        if (!Number.isFinite(y) || hasMark(x, y, fill)) continue;
        autoPoints.push({ x, y, label: null, fill, pos: null, auto: true, color });
      }
    }
  });
  return {
    xWindow: spec.window.x,
    yWindow: f.yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills: [],
    curves: f.curves.map((c, ci) => ({
      segments: c.segments,
      style: c.curve.style,
      label: c.curve.label,
      color: curveColors[ci],
    })),
    edges: [],
    strips: [],
    guides: f.curves.flatMap((c) => c.asymptotes),
    jumpGuides: spec.jumpGuides
      ? f.curves.flatMap((c) => c.jumps.map((j) => ({ x: j.x, y0: j.from, y1: j.to })))
      : [],
    impulses: spec.impulses,
    points: [...autoPoints, ...spec.points],
    labels: spec.labels,
  };
}

function regionPlot(f: RegionFacts): Plot {
  const { spec } = f;
  const points = spec.markIntersections ? [...intersectionMarks(f), ...spec.points] : spec.points;
  return {
    xWindow: f.xWindow,
    yWindow: f.yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills: [{ polygon: f.polygon, color: COLORS[5] }],
    curves: f.boundaries.map(({ b, segments }) => ({
      segments,
      style: 'solid' as const,
      label: b.label,
      color: b === spec.hi ? COLORS[0] : COLORS[1],
    })),
    edges: f.edges.map((e) => [e.from, e.to]),
    strips: f.strip ? [{ rect: f.strip.rect, label: spec.slice?.label ?? null, side: spec.dir === 'dx' ? 'below' : 'right' }] : [],
    guides: [],
    impulses: [],
    points,
    labels: spec.labels,
  };
}

function phasePlot(f: PhaseFacts): Plot {
  const { spec } = f;
  const [x0, x1] = f.xWindow;
  const [y0, y1] = f.yWindow;
  const curves: PlotCurve[] = [];
  const arrows: Arrow[] = [];
  const heads: Arrow[] = [];

  if (spec.show.has('field')) {
    const nx = 19;
    const ny = 12;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const at: Pt = [x0 + ((i + 0.5) * (x1 - x0)) / nx, y0 + ((j + 0.5) * (y1 - y0)) / ny];
        const dir = spec.F(...at);
        if (Number.isFinite(dir[0]) && Number.isFinite(dir[1]) && (dir[0] || dir[1])) arrows.push({ at, dir });
      }
  }
  if (spec.show.has('eigenvectors'))
    for (const e of f.equilibria)
      for (const v of e.eigen.vectors) {
        const seg = clipLine(e.at, v, f.xWindow, f.yWindow);
        if (seg) curves.push({ segments: [seg], style: 'dashed', label: null, color: GRAY, width: 1.2 });
      }
  const [vx, vy] = spec.names;
  for (const n of f.nullclines)
    if (n.segments.length)
      curves.push({
        segments: n.segments,
        style: n.which ? 'dotted' : 'dashed',
        label: `${n.which ? vy : vx}′ = 0`,
        color: n.which ? COLORS[2] : COLORS[1],
        width: 1.8,
      });

  // Trajectories, with arrowheads spaced along the part inside the window.
  const sx = x1 - x0;
  const sy = y1 - y0;
  for (const t of f.trajectories) {
    curves.push({ segments: [t.path], style: 'solid', label: t.t.label, color: COLORS[0], width: 1.9 });
    const inWin = (p: Pt) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    let len = 0;
    const along: number[] = [0];
    for (let i = 1; i < t.path.length; i++) {
      const [p, q] = [t.path[i - 1], t.path[i]];
      len += inWin(q) ? Math.hypot((q[0] - p[0]) / sx, (q[1] - p[1]) / sy) : 0;
      along.push(len);
    }
    const count = Math.max(1, Math.min(3, Math.floor(len / 0.45)));
    // Keep arrowheads off the axes, where they would collide with tick labels.
    const ax = x0 <= 0 && 0 <= x1 ? 0 : x0;
    const ay = y0 <= 0 && 0 <= y1 ? 0 : y0;
    const clear = (p: Pt) => Math.abs(p[0] - ax) / sx > 0.04 && Math.abs(p[1] - ay) / sy > 0.06;
    for (let k = 0; k < count; k++) {
      let i = -1;
      for (const shift of [0, 0.12, -0.12, 0.24, -0.24]) {
        const target = (len * (k + 0.5 + shift)) / count;
        const j = along.findIndex((s) => s >= target);
        if (j > 0 && j < t.path.length - 1 && clear(t.path[j])) {
          i = j;
          break;
        }
      }
      if (i < 0) i = along.findIndex((s) => s >= (len * (k + 0.5)) / count);
      if (i <= 0 || i >= t.path.length - 1) continue;
      const p = t.path[i];
      const q = t.path[Math.min(t.path.length - 1, i + 2)];
      heads.push({ at: p, dir: [q[0] - p[0], q[1] - p[1]], color: COLORS[0] });
    }
  }

  const eqPoints = spec.show.has('equilibria')
    ? f.equilibria.map((e) => ({
        x: e.at[0],
        y: e.at[1],
        label: spec.labelEquilibria ? `(${e.at.map((v) => nice(v).text).join(', ')})` : null,
        fill: (isStable(e.type) ? 'closed' : 'open') as 'closed' | 'open',
        pos: null,
        auto: true,
      }))
    : [];
  return {
    xWindow: f.xWindow,
    yWindow: f.yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills: [],
    curves,
    edges: [],
    strips: [],
    guides: [],
    impulses: [],
    points: [...eqPoints, ...spec.points],
    labels: spec.labels,
    arrows,
    heads,
  };
}

function slopePlot(f: SlopeFacts): Plot {
  const { spec } = f;
  const [x0, x1] = f.xWindow;
  const [y0, y1] = f.yWindow;
  const [, vy] = spec.names;
  const curves: PlotCurve[] = [];
  const arrows: Arrow[] = [];

  if (spec.show.has('field')) {
    const nx = 19;
    const ny = 12;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const t = x0 + ((i + 0.5) * (x1 - x0)) / nx;
        const y = y0 + ((j + 0.5) * (y1 - y0)) / ny;
        const s = spec.f(t, y);
        if (Number.isFinite(s)) arrows.push({ at: [t, y], dir: [1, s] });
      }
  }
  if (f.isocline.length) {
    curves.push({
      segments: f.isocline,
      style: 'dashed',
      label: `${vy}′ = 0`,
      color: COLORS[1],
      width: 1.8,
    });
  }
  const startDots = f.solutions.map((s) => ({
    x: s.s.start[0],
    y: s.s.start[1],
    label: null,
    fill: 'closed' as const,
    pos: null,
    auto: true,
    color: COLORS[0],
  }));
  for (const s of f.solutions) {
    curves.push({ segments: [s.path], style: 'solid', label: s.s.label, color: COLORS[0], width: 2.1 });
  }
  return {
    xWindow: f.xWindow,
    yWindow: f.yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills: [],
    curves,
    edges: [],
    strips: [],
    guides: [],
    impulses: [],
    points: [...startDots, ...spec.points],
    labels: spec.labels,
    arrows,
  };
}

function looksLikeV2(input: unknown): boolean {
  if (typeof input === 'object' && input !== null && 'scene' in input) return true;
  if (typeof input !== 'string') return false;
  const s = input
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:[a-zA-Z]+)?\s*\n?|\s*```$/g, '')
    .trim();
  if (!s) return false;
  if (s.startsWith('{')) return /"scene"\s*:/.test(s);
  return true;
}

export function redraw(input: unknown, opts: { id: string }): RedrawResult {
  if (looksLikeV2(input)) {
    const parsed = parseSceneDsl(input);
    if (parsed.scene === 'image') {
      return { ok: false, errors: ['Set to keep the original image (scene: image).'], warnings: parsed.warnings };
    }
    if (!parsed.scene) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
    const ev = evaluateScene(parsed.scene);
    if (!ev.evaluated) {
      return { ok: false, errors: ev.errors, warnings: [...parsed.warnings, ...ev.warnings] };
    }
    const alt = describeScene(ev.evaluated);
    const svg = renderSceneSvg(ev.evaluated, { id: opts.id, title: alt.short, desc: alt.long });
    return {
      ok: true,
      svg,
      alt,
      facts: { kind: 'scene', evaluated: ev.evaluated },
      spec: parsed.scene,
      warnings: [...parsed.warnings, ...ev.warnings],
    };
  }
  const { spec, errors, warnings } = checkSpec(input);
  if (!spec) return { ok: false, errors, warnings };
  let facts: Facts;
  let altBase: { short: string; long: string };
  let svg: string;
  if (spec.kind === 'graph') {
    const yWindow =
      spec.window.y ??
      autoY(
        spec.curves.map((c) => (x: number) => valueAt(c, x)),
        spec.window.x,
        [...spec.points.map((p) => p.y), ...spec.impulses.map((m) => m.size), ...spec.labels.map((l) => l.y)],
      );
    const g = analyzeGraph(spec, yWindow);
    facts = g;
    altBase = describeGraph(g);
    svg = renderPlot(graphPlot(spec, g), { id: opts.id, title: altBase.short, desc: altBase.long });
  } else if (spec.kind === 'phase') {
    const w = phaseWindows(spec);
    const p = analyzePhase(spec, w.x, w.y);
    if (typeof p === 'string') return { ok: false, errors: [p], warnings };
    facts = p;
    altBase = describePhase(p);
    svg = renderPlot(phasePlot(p), { id: opts.id, title: altBase.short, desc: altBase.long });
  } else if (spec.kind === 'slope') {
    const sf = analyzeSlope(spec);
    facts = sf;
    altBase = describeSlope(sf);
    svg = renderPlot(slopePlot(sf), { id: opts.id, title: altBase.short, desc: altBase.long });
  } else if (spec.kind === 'line') {
    const lf = analyzeLine(spec);
    facts = lf;
    altBase = describeLine(lf);
    svg = renderLineSvg(lf, { id: opts.id, title: altBase.short, desc: altBase.long });
  } else {
    const w = regionWindows(spec);
    const r = analyzeRegion(spec, w.x, w.y);
    facts = r;
    altBase = describeRegion(r);
    svg = renderPlot(regionPlot(r), { id: opts.id, title: altBase.short, desc: altBase.long });
  }
  const alt = { ...altBase, markdown: mathifyAlt(altBase.long) };
  return { ok: true, svg, alt, facts, spec, warnings };
}

export { checkSpec } from './spec.ts';
export { parse, toText, ExprError } from './expr.ts';
export {
  parseSceneDsl,
  formatSceneDsl,
  upgradeV1ToScene,
  V2_TEMPLATES,
  type V2TemplateKey,
  type SceneSpec,
  type SceneLayer,
  type SpaceKind,
};
