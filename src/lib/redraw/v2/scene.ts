/**
 * Composable Scene AST, compact Line-DSL parser/formatter, and v1-to-v2 upgrader (Redraw v2).
 */
import type { Fill, LineStyle, Pos } from '../common.ts';
import { checkSpec, type Spec } from '../spec.ts';
import { stripThinkingTraces } from '../../transcript.ts';
import { evalBound } from './latexExpr.ts';
import { expandEqRefs, type EqItem } from './eqMenu.ts';

export type SpaceKind = 'cartesian' | '1d' | 'polar' | 'complex';

export interface ParamDef {
  name: string;
  value: number;
}

export interface TickSpec {
  at: number | string;
  label?: string;
}

export type CurveForm = 'y' | 'x' | 'polar' | 'parametric' | 'implicit' | 'cases';

export interface CurveLayer {
  kind: 'curve';
  expr: string;
  /** Second expression for parametric curves [x(t), y(t)]. */
  exprY?: string;
  form?: CurveForm;
  style?: LineStyle;
  label?: string;
  domain?: [number | string, number | string];
  ends?: [Fill | null, Fill | null];
  guides?: boolean;
}

export interface ShadeLayer {
  kind: 'shade';
  top: string;
  bottom?: string;
  axis?: 'x' | 'y';
  on?: [number | string, number | string] | 'intersections';
  slice?: { at: number | string; label?: string };
  riemann?: { n: number; rule: 'left' | 'right' | 'midpoint' | 'trapezoid' };
  area?: boolean;
  label?: string;
  /** Complex half-plane Region of Convergence (e.g. Re(s) > -2). */
  roc?: { gt?: number; lt?: number };
}

export interface FieldLayer {
  kind: 'field';
  mode: 'slope' | 'vector';
  /** For slope: [dy/dt]. For vector: [dx/dt, dy/dt]. */
  exprs: [string] | [string, string];
  vars?: [string, string];
  show?: ('field' | 'isoclines' | 'equilibria' | 'nullclines' | 'eigenvectors')[];
}

export interface FlowLayer {
  kind: 'flow';
  start: [number | string, number | string];
  direction?: 'both' | 'forward' | 'backward';
  label?: string;
}

export type MarkItem =
  | { mark: 'point'; at: [number | string, number | string]; fill?: Fill; label?: string; pos?: Pos }
  | { mark: 'pole'; at: [number | string, number | string]; label?: string }
  | { mark: 'zero'; at: [number | string, number | string]; label?: string }
  | { mark: 'impulse'; at: number | string; size?: number; label?: string }
  | { mark: 'arrow'; from: [number | string, number | string]; to: [number | string, number | string]; style?: LineStyle; label?: string }
  | { mark: 'projection'; at: [number | string, number | string] }
  | { mark: 'sign'; on: [number | string, number | string]; sign: '+' | '-' | '0' | 'undef' }
  | { mark: 'interval'; on: [number | string, number | string]; ends: [Fill, Fill]; label?: string }
  | { mark: 'label'; at: [number | string, number | string]; text: string };

export interface MarkLayer {
  kind: 'mark';
  item: MarkItem;
}

export type SceneLayer = CurveLayer | ShadeLayer | FieldLayer | FlowLayer | MarkLayer;

export interface PlotScene {
  scene: 'plot';
  from: string;
  space?: SpaceKind;
  axes?: { x?: string; y?: string };
  window?: { x?: [number | string, number | string]; y?: [number | string, number | string] };
  aspect?: number;
  schematic?: boolean;
  params?: ParamDef[];
  ticks?: { x?: TickSpec[]; y?: TickSpec[] };
  layers: SceneLayer[];
}

export type NodeShape = 'box' | 'circle' | 'sum' | 'mass' | 'wall' | 'tank' | 'ground' | 'point';
export type EdgeStyle = 'arrow' | 'line' | 'dashed' | 'spring' | 'damper';

export interface DiagramNode {
  id: string;
  shape: NodeShape;
  label: string;
  col: number;
  row: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  kind: EdgeStyle;
  label?: string;
  bend?: number;
}

export interface DiagramScene {
  scene: 'diagram';
  from: string;
  title?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export type SceneSpec = PlotScene | DiagramScene;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();

function splitPipes(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote = false;
  let braces = 0;
  let brackets = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === '"') quote = !quote;
    if (!quote) {
      if (ch === '{') braces++;
      else if (ch === '}') braces = Math.max(0, braces - 1);
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets = Math.max(0, brackets - 1);
      else if (ch === '|' && braces === 0 && brackets === 0) {
        parts.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function splitTopCommas(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') quote = !quote;
    if (!quote) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parsePairTokens(s: string): [number | string, number | string] | null {
  const t = s.trim();
  const inner = (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('(') && t.endsWith(')')) ? t.slice(1, -1) : t;
  const parts = splitTopCommas(inner);
  if (parts.length !== 2) return null;
  const tok = (x: string): number | string => {
    const u = unquote(x);
    return /^-?\d+(?:\.\d+)?$/.test(u) ? Number(u) : u;
  };
  return [tok(parts[0]), tok(parts[1])];
}

function parseSingleBound(s: string): number | string {
  const u = unquote(s);
  return /^-?\d+(?:\.\d+)?$/.test(u) ? Number(u) : u;
}

function joinMultilineDirectives(raw: string): string[] {
  const rawLines = raw.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    // Merge lines while an open \begin{...} lacks \end{...} or braces are unbalanced.
    while (i + 1 < rawLines.length) {
      const hasOpenCases = /\\begin\{cases\}/.test(line) && !/\\end\{cases\}/.test(line);
      const opens = (line.match(/(?<!\\)\{/g) ?? []).length;
      const closes = (line.match(/(?<!\\)\}/g) ?? []).length;
      if (!hasOpenCases && opens <= closes) break;
      line += ' ' + rawLines[++i].trim();
    }
    out.push(line);
  }
  return out;
}

/** Parses either a V2 SceneSpec JSON object/string or compact Line-DSL into a typed SceneSpec. */
export function parseSceneDsl(
  input: unknown,
  eqMenu: EqItem[] = [],
): { scene: SceneSpec | 'image' | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isObj(input)) {
    if (input.scene === 'image' || input.kind === 'none') return { scene: 'image', errors, warnings };
    if (input.scene === 'plot' || input.scene === 'diagram') {
      return validateScene(input as unknown as SceneSpec, errors, warnings);
    }
    return { scene: null, errors: ['Expected scene: "plot" or "diagram".'], warnings };
  }

  if (typeof input !== 'string') return { scene: null, errors: ['Spec must be text or JSON.'], warnings };
  const stripped = stripThinkingTraces(input)
    .trim()
    .replace(/^```(?:[a-zA-Z]+)?\s*\n?|\s*```$/g, '')
    .trim();
  if (!stripped) return { scene: null, errors: ['The spec is empty.'], warnings };

  const expanded = expandEqRefs(stripped, eqMenu);
  if (expanded.startsWith('{')) {
    try {
      const parsed = JSON.parse(expanded);
      return parseSceneDsl(parsed);
    } catch (e) {
      return { scene: null, errors: [`Not valid JSON: ${(e as Error).message}`], warnings };
    }
  }

  const lines = joinMultilineDirectives(expanded);
  let mode: 'plot' | 'diagram' | 'image' = 'plot';
  const plot: PlotScene = { scene: 'plot', from: '', layers: [] };
  const diag: DiagramScene = { scene: 'diagram', from: '', nodes: [], edges: [] };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const colon = line.indexOf(':');
    if (colon < 0) {
      warnings.push(`Line ${li + 1}: ignored line without ":" (${line.slice(0, 40)}).`);
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();

    if (key === 'scene') {
      const m = val.toLowerCase();
      if (m === 'image' || m === 'none') return { scene: 'image', errors, warnings };
      if (m === 'diagram') mode = 'diagram';
      else if (m === 'plot') mode = 'plot';
      else warnings.push(`Unknown scene mode “${val}”.`);
      continue;
    }

    if (key === 'from') {
      plot.from = unquote(val);
      diag.from = unquote(val);
      continue;
    }

    if (key === 'title' && mode === 'diagram') {
      diag.title = unquote(val);
      continue;
    }

    if (mode === 'diagram') {
      if (key === 'node') {
        // node: g = box("G(s)") @ (1, 0)
        const m = val.match(/^([A-Za-z0-9_-]+)\s*=\s*(box|circle|sum|mass|wall|tank|ground|point)\s*\(\s*([\s\S]*?)\s*\)\s*(?:@\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\))?$/i);
        if (!m) {
          errors.push(`Line ${li + 1}: invalid node syntax (use "node: id = box(\\"label\\") @ (col, row)").`);
        } else {
          diag.nodes.push({
            id: m[1],
            shape: m[2].toLowerCase() as NodeShape,
            label: unquote(m[3]),
            col: m[4] !== undefined ? Number(m[4]) : diag.nodes.length,
            row: m[5] !== undefined ? Number(m[5]) : 0,
          });
        }
        continue;
      }
      if (key === 'edge' || key === 'connect') {
        const segs = splitPipes(val);
        const link = segs[0]?.match(/^([A-Za-z0-9_-]+)\s*(?:->|—|--)\s*([A-Za-z0-9_-]+)$/);
        if (!link) {
          errors.push(`Line ${li + 1}: invalid edge syntax (use "edge: a -> b | arrow | label=\\"...\\"").`);
          continue;
        }
        let kind: EdgeStyle = 'arrow';
        let label: string | undefined;
        let bend: number | undefined;
        for (const opt of segs.slice(1)) {
          const lo = opt.toLowerCase();
          if (lo === 'arrow' || lo === 'line' || lo === 'dashed' || lo === 'spring' || lo === 'damper') kind = lo;
          else if (/^label\s*=/.test(lo)) label = unquote(opt.slice(opt.indexOf('=') + 1));
          else if (/^bend\s*=/.test(lo)) bend = Number(opt.slice(opt.indexOf('=') + 1));
        }
        diag.edges.push({ from: link[1], to: link[2], kind, ...(label ? { label } : {}), ...(Number.isFinite(bend) ? { bend } : {}) });
        continue;
      }
    }

    /* Plot directives */
    if (key === 'space') {
      const sp = val.toLowerCase();
      if (sp === 'cartesian' || sp === '1d' || sp === 'polar' || sp === 'complex') plot.space = sp;
      else warnings.push(`Unknown space “${val}”.`);
    } else if (key === 'schematic') {
      plot.schematic = val.toLowerCase() !== 'false';
    } else if (key === 'aspect') {
      const a = Number(val);
      if (Number.isFinite(a) && a > 0.3 && a < 4) plot.aspect = a;
    } else if (key === 'param' || key === 'params') {
      plot.params = plot.params ?? [];
      for (const item of splitTopCommas(val)) {
        const eq = item.match(/^([A-Za-z])\s*=\s*(.+)$/);
        if (eq) {
          const n = evalBound(eq[2]);
          if (typeof n === 'number') plot.params.push({ name: eq[1], value: n });
          else errors.push(`param ${eq[1]}: expected numeric value, got “${eq[2]}”.`);
        }
      }
    } else if (key === 'axes') {
      // axes: t [0, 4], f(t) [-45, 35]   OR   axes: x, y
      const parts = splitTopCommas(val);
      plot.axes = plot.axes ?? {};
      const parseAxisPart = (part: string, axis: 'x' | 'y') => {
        const m = part.match(/^(.+?)\s*(\[[^\]]+\])$/);
        if (m) {
          plot.axes![axis] = unquote(m[1]);
          const range = parsePairTokens(m[2]);
          if (range) {
            plot.window = plot.window ?? {};
            plot.window[axis] = range;
          }
        } else {
          plot.axes![axis] = unquote(part);
        }
      };
      if (parts[0]) parseAxisPart(parts[0], 'x');
      if (parts[1]) parseAxisPart(parts[1], 'y');
    } else if (key === 'window') {
      plot.window = plot.window ?? {};
      for (const item of splitTopCommas(val)) {
        const m = item.match(/^([xy])\s*=\s*(\[[^\]]+\])$/i);
        if (m) {
          const r = parsePairTokens(m[2]);
          if (r) plot.window[m[1].toLowerCase() as 'x' | 'y'] = r;
        }
      }
    } else if (key === 'tick-x' || key === 'tick-y') {
      const axis = key === 'tick-x' ? 'x' : 'y';
      plot.ticks = plot.ticks ?? {};
      plot.ticks[axis] = splitTopCommas(val).map((t) => {
        const kv = t.match(/^([^:]+):(.*)$/);
        if (kv) return { at: parseSingleBound(kv[1]), label: unquote(kv[2]) };
        return { at: parseSingleBound(t) };
      });
    } else if (key === 'curve' || key === 'plot') {
      const segs = splitPipes(val);
      const expr = segs[0] ?? '';
      if (!expr) {
        errors.push(`Line ${li + 1}: curve expression missing.`);
        continue;
      }
      const layer: CurveLayer = { kind: 'curve', expr };
      for (const opt of segs.slice(1)) {
        const lo = opt.toLowerCase();
        if (lo === 'solid' || lo === 'dashed' || lo === 'dotted') layer.style = lo;
        else if (lo === 'guides' || lo === 'jumpguides') layer.guides = true;
        else if (/^label\s*=/.test(lo)) layer.label = unquote(opt.slice(opt.indexOf('=') + 1));
        else if (/^domain\s*=/.test(lo) || /^on\s*=/.test(lo)) {
          const r = parsePairTokens(opt.slice(opt.indexOf('=') + 1));
          if (r) layer.domain = r;
        } else if (/^ends\s*=/.test(lo)) {
          const r = parsePairTokens(opt.slice(opt.indexOf('=') + 1));
          if (r) {
            const fOf = (x: number | string): Fill | null => (x === 'closed' || x === 'open' ? x : null);
            layer.ends = [fOf(r[0]), fOf(r[1])];
          }
        } else if (/^form\s*=/.test(lo)) {
          const fm = opt.slice(opt.indexOf('=') + 1).trim().toLowerCase();
          if (fm === 'y' || fm === 'x' || fm === 'polar' || fm === 'parametric' || fm === 'implicit' || fm === 'cases') {
            layer.form = fm;
            if (fm === 'polar' && !plot.space) plot.space = 'polar';
          }
        } else if (/^y\s*=/.test(lo) && layer.form === 'parametric') {
          layer.exprY = opt.slice(opt.indexOf('=') + 1).trim();
        }
      }
      if (layer.form === 'parametric' && !layer.exprY && expr.includes(';')) {
        const [ex, ey] = expr.split(';').map((s) => s.trim());
        layer.expr = ex;
        layer.exprY = ey;
      }
      plot.layers.push(layer);
    } else if (key === 'shade' || key === 'fill') {
      const segs = splitPipes(val);
      const spec = segs[0] ?? '';
      const sepIdx = spec.indexOf('..');
      const top = sepIdx >= 0 ? spec.slice(0, sepIdx).trim() : spec.trim();
      const bottom = sepIdx >= 0 ? spec.slice(sepIdx + 2).trim() : undefined;
      const layer: ShadeLayer = { kind: 'shade', top, ...(bottom ? { bottom } : {}) };
      for (const opt of segs.slice(1)) {
        const lo = opt.toLowerCase();
        if (lo === 'area') layer.area = true;
        else if (/^axis\s*=\s*(x|y)$/i.test(lo)) layer.axis = lo.slice(-1) as 'x' | 'y';
        else if (/^on\s*=/.test(lo)) {
          const rhs = opt.slice(opt.indexOf('=') + 1).trim();
          if (/^intersections$/i.test(rhs)) layer.on = 'intersections';
          else {
            const r = parsePairTokens(rhs);
            if (r) layer.on = r;
          }
        } else if (/^slice\s*=/.test(lo)) {
          const rhs = opt.slice(opt.indexOf('=') + 1).trim();
          const [atS, lbl] = rhs.split(':');
          layer.slice = { at: parseSingleBound(atS), ...(lbl ? { label: unquote(lbl) } : {}) };
        } else if (/^riemann\s*=/.test(lo)) {
          const rhs = opt.slice(opt.indexOf('=') + 1).trim();
          const [nS, ruleS] = rhs.split(':');
          const n = Math.max(1, Math.min(60, Math.round(Number(nS) || 4)));
          const rule = (ruleS?.trim().toLowerCase() ?? 'left') as 'left' | 'right' | 'midpoint' | 'trapezoid';
          layer.riemann = { n, rule: ['left', 'right', 'midpoint', 'trapezoid'].includes(rule) ? rule : 'left' };
        } else if (/^label\s*=/.test(lo)) layer.label = unquote(opt.slice(opt.indexOf('=') + 1));
      }
      plot.layers.push(layer);
    } else if (key === 'roc') {
      if (!plot.space) plot.space = 'complex';
      const gtM = val.match(/Re\s*\(\s*[A-Za-z]\s*\)\s*>\s*(.+)$/i);
      const ltM = val.match(/Re\s*\(\s*[A-Za-z]\s*\)\s*<\s*(.+)$/i);
      const gt = gtM ? evalBound(gtM[1]) : undefined;
      const lt = ltM ? evalBound(ltM[1]) : undefined;
      plot.layers.push({
        kind: 'shade',
        top: '0',
        roc: {
          ...(typeof gt === 'number' ? { gt } : {}),
          ...(typeof lt === 'number' ? { lt } : {}),
        },
      });
    } else if (key === 'field') {
      const segs = splitPipes(val);
      const body = segs[0] ?? '';
      const shows: FieldLayer['show'] = [];
      let fieldVars: [string, string] | undefined;
      for (const opt of segs.slice(1)) {
        const lo = opt.toLowerCase();
        if (lo === 'field' || lo === 'isoclines' || lo === 'equilibria' || lo === 'nullclines' || lo === 'eigenvectors') {
          shows.push(lo);
        } else if (/^vars\s*=/.test(lo)) {
          const vp = parsePairTokens(opt.slice(opt.indexOf('=') + 1));
          if (vp) fieldVars = [String(vp[0]), String(vp[1])];
        }
      }
      if (/^slope\s+/i.test(body)) {
        const expr = body.replace(/^slope\s+/i, '').trim();
        plot.layers.push({
          kind: 'field',
          mode: 'slope',
          exprs: [expr],
          ...(fieldVars ? { vars: fieldVars } : {}),
          show: shows.length ? shows : ['field'],
        });
      } else {
        const rawVec = body.replace(/^vector\s+/i, '').trim();
        const parts = rawVec.split(';').map((s) => s.trim());
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          errors.push(`Line ${li + 1}: vector field needs two expressions separated by ";".`);
        } else {
          plot.layers.push({
            kind: 'field',
            mode: 'vector',
            exprs: [parts[0], parts[1]],
            ...(fieldVars ? { vars: fieldVars } : {}),
            show: shows.length ? shows : ['field', 'equilibria'],
          });
        }
      }
    } else if (key === 'flow' || key === 'trajectory' || key === 'solution') {
      const segs = splitPipes(val);
      const p = parsePairTokens(segs[0] ?? '');
      if (!p) {
        errors.push(`Line ${li + 1}: flow requires start point [x, y].`);
        continue;
      }
      const fl: FlowLayer = { kind: 'flow', start: p };
      for (const opt of segs.slice(1)) {
        const lo = opt.toLowerCase();
        if (lo === 'forward' || lo === 'backward' || lo === 'both') fl.direction = lo;
        else if (/^label\s*=/.test(lo)) fl.label = unquote(opt.slice(opt.indexOf('=') + 1));
      }
      plot.layers.push(fl);
    } else if (key === 'point') {
      const segs = splitPipes(val);
      const p = parsePairTokens(segs[0] ?? '') ?? [parseSingleBound(segs[0] ?? ''), 0];
      const item: MarkItem = { mark: 'point', at: p };
      for (const opt of segs.slice(1)) {
        const lo = opt.toLowerCase();
        if (lo === 'open' || lo === 'closed') item.fill = lo;
        else if (/^label\s*=/.test(lo)) item.label = unquote(opt.slice(opt.indexOf('=') + 1));
        else if (/^pos\s*=/.test(lo)) {
          const ps = opt.slice(opt.indexOf('=') + 1).trim().toLowerCase();
          if (ps === 'above' || ps === 'below' || ps === 'left' || ps === 'right') item.pos = ps;
        }
      }
      plot.layers.push({ kind: 'mark', item });
    } else if (key === 'pole' || key === 'zero') {
      if (!plot.space) plot.space = 'complex';
      const segs = splitPipes(val);
      const lblOpt = segs.slice(1).find((o) => /^label\s*=/.test(o.toLowerCase()));
      const lbl = lblOpt ? unquote(lblOpt.slice(lblOpt.indexOf('=') + 1)) : undefined;
      for (const m of segs[0].matchAll(/\[[^\[\]]+\]/g)) {
        const pt = parsePairTokens(m[0]);
        if (pt) plot.layers.push({ kind: 'mark', item: { mark: key, at: pt, ...(lbl ? { label: lbl } : {}) } });
      }
    } else if (key === 'impulse') {
      const segs = splitPipes(val);
      const at = parseSingleBound(segs[0] ?? '0');
      let size = 1;
      let label: string | undefined;
      for (const opt of segs.slice(1)) {
        const lo = opt.toLowerCase();
        if (/^size\s*=/.test(lo)) size = Number(opt.slice(opt.indexOf('=') + 1)) || 1;
        else if (/^label\s*=/.test(lo)) label = unquote(opt.slice(opt.indexOf('=') + 1));
      }
      plot.layers.push({ kind: 'mark', item: { mark: 'impulse', at, size, ...(label ? { label } : {}) } });
    } else if (key === 'arrow' || key === 'vector') {
      const segs = splitPipes(val);
      const pts = segs[0].split('->').map((s) => s.trim());
      const a = pts[0] ? parsePairTokens(pts[0]) : null;
      const b = pts[1] ? parsePairTokens(pts[1]) : null;
      if (!a || !b) {
        errors.push(`Line ${li + 1}: arrow needs [x0, y0] -> [x1, y1].`);
        continue;
      }
      let style: LineStyle = 'solid';
      let label: string | undefined;
      for (const opt of segs.slice(1)) {
        const lo = opt.toLowerCase();
        if (lo === 'dashed' || lo === 'solid' || lo === 'dotted') style = lo;
        else if (/^label\s*=/.test(lo)) label = unquote(opt.slice(opt.indexOf('=') + 1));
      }
      plot.layers.push({ kind: 'mark', item: { mark: 'arrow', from: a, to: b, style, ...(label ? { label } : {}) } });
    } else if (key === 'projection' || key === 'guide') {
      const p = parsePairTokens(val);
      if (p) plot.layers.push({ kind: 'mark', item: { mark: 'projection', at: p } });
    } else if (key === 'sign') {
      for (const chunk of splitTopCommas(val)) {
        const m = chunk.match(/^(\[[^\[\]]+\])\s*:\s*(\+|-|−|0|undef)$/i);
        if (m) {
          const r = parsePairTokens(m[1]);
          const sg = m[2] === '−' ? '-' : (m[2].toLowerCase() as '+' | '-' | '0' | 'undef');
          if (r) plot.layers.push({ kind: 'mark', item: { mark: 'sign', on: r, sign: sg } });
        }
      }
    } else if (key === 'interval') {
      const segs = splitPipes(val);
      const rawInt = segs[0]?.trim() ?? '';
      const openL = rawInt.startsWith('(') ? 'open' : 'closed';
      const openR = rawInt.endsWith(')') ? 'open' : 'closed';
      const r = parsePairTokens(rawInt);
      const lblOpt = segs.slice(1).find((o) => /^label\s*=/.test(o.toLowerCase()));
      if (r) {
        plot.layers.push({
          kind: 'mark',
          item: { mark: 'interval', on: r, ends: [openL, openR], ...(lblOpt ? { label: unquote(lblOpt.slice(lblOpt.indexOf('=') + 1)) } : {}) },
        });
      }
    } else if (key === 'label') {
      const segs = splitPipes(val);
      const p = parsePairTokens(segs[0] ?? '');
      const text = unquote(segs[1] ?? '');
      if (p && text) plot.layers.push({ kind: 'mark', item: { mark: 'label', at: p, text } });
    } else {
      warnings.push(`Line ${li + 1}: ignored unknown key “${key}”.`);
    }
  }

  if (mode === 'diagram') return validateScene(diag, errors, warnings);
  if (!plot.space) {
    const has1d = plot.layers.some((l) => l.kind === 'mark' && (l.item.mark === 'sign' || l.item.mark === 'interval'));
    const has2d = plot.layers.some((l) => l.kind !== 'mark');
    if (has1d && !has2d) plot.space = '1d';
  }
  return validateScene(plot, errors, warnings);
}

function validateScene(
  scene: SceneSpec,
  errors: string[],
  warnings: string[],
): { scene: SceneSpec | null; errors: string[]; warnings: string[] } {
  if (!scene.from?.trim() && !(scene.scene === 'diagram' && scene.title?.trim())) {
    errors.push('from: quote the equation or title from the notes.');
  }
  if (scene.scene === 'plot') {
    if (!scene.layers?.length) errors.push('Plot scene needs at least one curve, shade, field, or mark layer.');
  } else {
    if (!scene.nodes?.length) errors.push('Diagram scene needs at least one node.');
    const ids = new Set(scene.nodes.map((n) => n.id));
    for (const e of scene.edges) {
      if (!ids.has(e.from)) errors.push(`Edge references unknown node “${e.from}”.`);
      if (!ids.has(e.to)) errors.push(`Edge references unknown node “${e.to}”.`);
    }
  }
  return errors.length ? { scene: null, errors, warnings } : { scene, errors, warnings };
}

const fmtVal = (v: number | string) => (typeof v === 'number' ? String(v) : v);

/** Serializes any SceneSpec to readable, round-trippable Line-DSL. */
export function formatSceneDsl(scene: SceneSpec): string {
  const out: string[] = [];
  if (scene.scene === 'diagram') {
    out.push('scene: diagram');
    if (scene.from) out.push(`from: ${scene.from}`);
    if (scene.title) out.push(`title: ${scene.title}`);
    for (const n of scene.nodes) out.push(`node: ${n.id} = ${n.shape}("${n.label}") @ (${n.col}, ${n.row})`);
    for (const e of scene.edges) {
      const opts = [e.kind, ...(e.label ? [`label="${e.label}"`] : []), ...(e.bend ? [`bend=${e.bend}`] : [])];
      out.push(`edge: ${e.from} -> ${e.to} | ${opts.join(' | ')}`);
    }
    return out.join('\n');
  }

  if (scene.from) out.push(`from: ${scene.from}`);
  if (scene.space && scene.space !== 'cartesian') out.push(`space: ${scene.space}`);
  if (scene.schematic) out.push('schematic: true');
  if (scene.params?.length) out.push(`param: ${scene.params.map((p) => `${p.name} = ${p.value}`).join(', ')}`);
  if (scene.axes || scene.window) {
    const axX = scene.axes?.x ?? 'x';
    const axY = scene.axes?.y ?? 'y';
    const wx = scene.window?.x ? ` [${fmtVal(scene.window.x[0])}, ${fmtVal(scene.window.x[1])}]` : '';
    const wy = scene.window?.y ? ` [${fmtVal(scene.window.y[0])}, ${fmtVal(scene.window.y[1])}]` : '';
    if (scene.space === '1d') out.push(`axes: ${axX}${wx}`);
    else out.push(`axes: ${axX}${wx}, ${axY}${wy}`);
  }
  if (scene.ticks?.x?.length) out.push(`tick-x: ${scene.ticks.x.map((t) => (t.label ? `${fmtVal(t.at)}:"${t.label}"` : fmtVal(t.at))).join(', ')}`);
  if (scene.ticks?.y?.length) out.push(`tick-y: ${scene.ticks.y.map((t) => (t.label ? `${fmtVal(t.at)}:"${t.label}"` : fmtVal(t.at))).join(', ')}`);

  for (const l of scene.layers) {
    if (l.kind === 'curve') {
      const head = l.form === 'parametric' && l.exprY ? `${l.expr}; ${l.exprY}` : l.expr;
      const opts: string[] = [];
      if (l.form && l.form !== 'y') opts.push(`form=${l.form}`);
      if (l.style && l.style !== 'solid') opts.push(l.style);
      if (l.domain) opts.push(`domain=[${fmtVal(l.domain[0])}, ${fmtVal(l.domain[1])}]`);
      if (l.ends && (l.ends[0] || l.ends[1])) opts.push(`ends=[${l.ends[0] ?? 'none'}, ${l.ends[1] ?? 'none'}]`);
      if (l.label) opts.push(`label="${l.label}"`);
      if (l.guides) opts.push('guides');
      out.push(`curve: ${[head, ...opts].join(' | ')}`);
    } else if (l.kind === 'shade') {
      if (l.roc) {
        const conds: string[] = [];
        if (l.roc.gt !== undefined) conds.push(`Re(s) > ${l.roc.gt}`);
        if (l.roc.lt !== undefined) conds.push(`Re(s) < ${l.roc.lt}`);
        out.push(`roc: ${conds.join(', ')}`);
      } else {
        const head = l.bottom ? `${l.top} .. ${l.bottom}` : l.top;
        const opts: string[] = [];
        if (l.axis === 'y') opts.push('axis=y');
        if (l.on === 'intersections') opts.push('on=intersections');
        else if (l.on) opts.push(`on=[${fmtVal(l.on[0])}, ${fmtVal(l.on[1])}]`);
        if (l.slice) opts.push(`slice=${fmtVal(l.slice.at)}${l.slice.label ? `:"${l.slice.label}"` : ''}`);
        if (l.riemann) opts.push(`riemann=${l.riemann.n}:${l.riemann.rule}`);
        if (l.area) opts.push('area');
        out.push(`shade: ${[head, ...opts].join(' | ')}`);
      }
    } else if (l.kind === 'field') {
      const head = l.mode === 'slope' ? `slope ${l.exprs[0]}` : `vector ${l.exprs[0]} ; ${l.exprs[1]}`;
      const axX = scene.axes?.x ?? 'x';
      const axY = scene.axes?.y ?? 'y';
      const varsOpt = l.vars && (l.vars[0] !== axX || l.vars[1] !== axY) ? [`vars=[${l.vars[0]}, ${l.vars[1]}]`] : [];
      const opts = [...(l.show ?? []), ...varsOpt];
      out.push(`field: ${[head, ...opts].join(' | ')}`);
    } else if (l.kind === 'flow') {
      const opts: string[] = [];
      if (l.direction && l.direction !== 'both') opts.push(l.direction);
      if (l.label) opts.push(`label="${l.label}"`);
      out.push(`flow: ${[`[${fmtVal(l.start[0])}, ${fmtVal(l.start[1])}]`, ...opts].join(' | ')}`);
    } else {
      const it = l.item;
      if (it.mark === 'point') {
        const opts: string[] = [];
        if (it.fill === 'open') opts.push('open');
        if (it.label) opts.push(`label="${it.label}"`);
        if (it.pos) opts.push(`pos=${it.pos}`);
        out.push(`point: ${[`[${fmtVal(it.at[0])}, ${fmtVal(it.at[1])}]`, ...opts].join(' | ')}`);
      } else if (it.mark === 'pole' || it.mark === 'zero') {
        out.push(`${it.mark}: [${fmtVal(it.at[0])}, ${fmtVal(it.at[1])}]${it.label ? ` | label="${it.label}"` : ''}`);
      } else if (it.mark === 'impulse') {
        out.push(`impulse: ${fmtVal(it.at)}${it.size && it.size !== 1 ? ` | size=${it.size}` : ''}${it.label ? ` | label="${it.label}"` : ''}`);
      } else if (it.mark === 'arrow') {
        const opts = [...(it.style && it.style !== 'solid' ? [it.style] : []), ...(it.label ? [`label="${it.label}"`] : [])];
        out.push(`arrow: ${[`[${fmtVal(it.from[0])}, ${fmtVal(it.from[1])}] -> [${fmtVal(it.to[0])}, ${fmtVal(it.to[1])}]`, ...opts].join(' | ')}`);
      } else if (it.mark === 'projection') {
        out.push(`projection: [${fmtVal(it.at[0])}, ${fmtVal(it.at[1])}]`);
      } else if (it.mark === 'sign') {
        out.push(`sign: [${fmtVal(it.on[0])}, ${fmtVal(it.on[1])}]:${it.sign}`);
      } else if (it.mark === 'interval') {
        const lB = it.ends[0] === 'open' ? '(' : '[';
        const rB = it.ends[1] === 'open' ? ')' : ']';
        out.push(`interval: ${lB}${fmtVal(it.on[0])}, ${fmtVal(it.on[1])}${rB}${it.label ? ` | label="${it.label}"` : ''}`);
      } else if (it.mark === 'label') {
        out.push(`label: [${fmtVal(it.at[0])}, ${fmtVal(it.at[1])}] | "${it.text}"`);
      }
    }
  }
  return out.join('\n');
}

/** Upgrades any v1 spec (validated Spec or raw v1 object) into an equivalent PlotScene. */
export function upgradeV1ToScene(input: Spec | Record<string, unknown>): PlotScene {
  const checked =
    'params' in input && input.params && 'ticks' in input && 'points' in input ? (input as Spec) : checkSpec(input).spec;
  const spec = checked ?? (input as Spec);
  const params = Object.entries(spec.params ?? {}).map(([name, value]) => ({ name, value }));
  const ticks = {
    ...(spec.ticks?.x ? { x: spec.ticks.x.map((t) => ({ at: t.at, ...(t.label ? { label: t.label } : {}) })) } : {}),
    ...(spec.ticks?.y ? { y: spec.ticks.y.map((t) => ({ at: t.at, ...(t.label ? { label: t.label } : {}) })) } : {}),
  };
  const win: PlotScene['window'] = {
    ...(spec.window?.x ? { x: spec.window.x } : {}),
    ...(spec.window?.y ? { y: spec.window.y } : {}),
  };
  const pointLayers: MarkLayer[] = (spec.points ?? []).map((p) => ({
    kind: 'mark',
    item: { mark: 'point', at: [p.x, p.y], fill: p.fill, ...(p.label ? { label: p.label } : {}), ...(p.pos ? { pos: p.pos } : {}) },
  }));
  const labelLayers: MarkLayer[] = (spec.labels ?? []).map((l) => ({
    kind: 'mark',
    item: { mark: 'label', at: [l.x, l.y], text: l.text },
  }));

  if (spec.kind === 'graph') {
    const layers: SceneLayer[] = [];
    for (const c of spec.curves) {
      if (c.piecewise) {
        c.pieces.forEach((p, idx) => {
          layers.push({
            kind: 'curve',
            expr: p.expr,
            style: c.style,
            domain: p.on,
            ends: p.ends,
            ...(idx === 0 && c.label ? { label: c.label } : {}),
            ...(spec.jumpGuides && idx === 0 ? { guides: true } : {}),
          });
        });
      } else {
        layers.push({
          kind: 'curve',
          expr: c.pieces[0].expr,
          style: c.style,
          ...(c.label ? { label: c.label } : {}),
        });
      }
    }
    for (const im of spec.impulses) {
      layers.push({ kind: 'mark', item: { mark: 'impulse', at: im.at, size: im.size, ...(im.label ? { label: im.label } : {}) } });
    }
    return {
      scene: 'plot',
      from: spec.from,
      axes: spec.axes,
      window: win,
      ...(spec.schematic ? { schematic: true } : {}),
      ...(params.length ? { params } : {}),
      ...(ticks.x || ticks.y ? { ticks } : {}),
      layers: [...layers, ...pointLayers, ...labelLayers],
    };
  }

  if (spec.kind === 'region') {
    return {
      scene: 'plot',
      from: spec.from,
      axes: spec.axes,
      window: win,
      ...(params.length ? { params } : {}),
      layers: [
        {
          kind: 'shade',
          top: spec.hi.expr,
          bottom: spec.lo.expr,
          axis: spec.dir === 'dy' ? 'y' : 'x',
          on: spec.between === 'intersections' ? 'intersections' : [spec.a, spec.b],
          ...(spec.slice ? { slice: { at: spec.slice.at, ...(spec.slice.label ? { label: spec.slice.label } : {}) } } : {}),
          ...(spec.showArea ? { area: true } : {}),
        },
        ...pointLayers,
        ...labelLayers,
      ],
    };
  }

  if (spec.kind === 'phase') {
    const [nx, ny] = spec.names;
    return {
      scene: 'plot',
      from: spec.from,
      axes: spec.axes,
      window: win,
      ...(params.length ? { params } : {}),
      ...(ticks.x || ticks.y ? { ticks } : {}),
      layers: [
        {
          kind: 'field',
          mode: 'vector',
          exprs: [spec.text[0].replace(/−/g, '-').replace(/·/g, '*'), spec.text[1].replace(/−/g, '-').replace(/·/g, '*')],
          vars: [nx, ny],
          show: [...spec.show],
        },
        ...spec.trajectories.map((t): FlowLayer => ({ kind: 'flow', start: t.start, direction: t.direction, ...(t.label ? { label: t.label } : {}) })),
        ...pointLayers,
        ...labelLayers,
      ],
    };
  }

  if (spec.kind === 'slope') {
    return {
      scene: 'plot',
      from: spec.from,
      axes: spec.axes,
      window: win,
      ...(params.length ? { params } : {}),
      ...(ticks.x || ticks.y ? { ticks } : {}),
      layers: [
        { kind: 'field', mode: 'slope', exprs: [spec.slopeExpr], vars: spec.vars, show: [...spec.show] },
        ...spec.solutions.map((s): FlowLayer => ({ kind: 'flow', start: s.start, direction: s.direction, ...(s.label ? { label: s.label } : {}) })),
        ...pointLayers,
        ...labelLayers,
      ],
    };
  }

  // line
  const lineLayers: SceneLayer[] = [
    ...spec.intervals.map((it): MarkLayer => ({ kind: 'mark', item: { mark: 'interval', on: it.on, ends: it.ends, ...(it.label ? { label: it.label } : {}) } })),
    ...spec.signs.map((s): MarkLayer => ({ kind: 'mark', item: { mark: 'sign', on: s.on, sign: s.sign } })),
    ...spec.poles.map((p): MarkLayer => ({ kind: 'mark', item: { mark: 'pole', at: p } })),
    ...spec.zeros.map((z): MarkLayer => ({ kind: 'mark', item: { mark: 'zero', at: z } })),
    ...(spec.roc ? [{ kind: 'shade' as const, top: '0', roc: spec.roc }] : []),
    ...pointLayers,
    ...labelLayers,
  ];
  return {
    scene: 'plot',
    from: spec.from,
    space: spec.mode === 'splane' ? 'complex' : '1d',
    axes: spec.axes,
    window: { x: spec.window.x ?? (spec.mode === '1d' ? [-5, 5] : [-4, 4]), ...(spec.window.y ? { y: spec.window.y } : {}) },
    layers: lineLayers,
  };
}

export type V2TemplateKey = 'graph' | 'region' | 'phase' | 'line' | 'diagram';

export const V2_TEMPLATES: Record<V2TemplateKey, string> = {
  graph: [
    'from: y = u_c(t)(t - c)',
    'param: c = 2',
    'axes: t [0, 5], y [-0.5, 3]',
    'curve: 0 | domain=[0, c] | ends=[closed, open]',
    'curve: t - c | domain=[c, 5] | ends=[closed, closed] | label="t - c" | guides',
  ].join('\n'),
  region: [
    'from: A = \\int_0^1 (\\sqrt{x} - x^2)\\,dx',
    'axes: x, y',
    'shade: \\sqrt{x} .. x^2 | on=intersections | slice=0.55:"\\Delta x" | area',
  ].join('\n'),
  phase: [
    "from: x' = y,\\; y' = -2x - 3y",
    'axes: x [-3, 3], y [-3, 3]',
    'field: vector y ; -2x - 3y | field | equilibria | eigenvectors',
    'flow: [2.2, 0]',
  ].join('\n'),
  line: [
    'from: F(s) = \\frac{s + 1}{(s + 2)^2 + 4}',
    'space: complex',
    'axes: Re(s), Im(s)',
    'zero: [-1, 0]',
    'pole: [-2, 2]',
    'pole: [-2, -2]',
    'roc: Re(s) > -2',
  ].join('\n'),
  diagram: [
    'scene: diagram',
    'from: Feedback control loop H(s)',
    'node: r = point("R(s)") @ (0, 0)',
    'node: s = sum("+") @ (1, 0)',
    'node: g = box("G(s)") @ (2, 0)',
    'node: y = point("Y(s)") @ (3, 0)',
    'node: h = box("H(s)") @ (2, 1)',
    'edge: r -> s | arrow',
    'edge: s -> g | arrow | label="E(s)"',
    'edge: g -> y | arrow',
    'edge: y -> h | arrow',
    'edge: h -> s | arrow | label="-"',
  ].join('\n'),
};
