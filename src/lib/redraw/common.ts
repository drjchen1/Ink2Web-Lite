/**
 * The parts of a redraw spec every kind shares (2.2 dev): the equation on the page,
 * window, axes, ticks, marked points, and free labels. Each kind adds its own fields
 * (spec.ts for "graph", region.ts for "region").
 *
 *   from     the equation as transcribed on the page: what the redraw is checked
 *            against. Required: no equation on the page, no redraw.
 *   window   { "x": [a, b], "y": [c, d] }
 *   axes     { "x": "t", "y": "y" }          axis labels
 *   var      the independent variable, if its axis label isn't a single letter
 *   ticks    { "x": [0, 2, {"at": 3.14159, "label": "π"}], "y": [...] }
 *   points   [{ "at": [0, 1], "label": "(0, 1)", "fill": "closed" | "open", "pos": "above" },
 *             { "on": { "curve": 1, "at": 2 } }]   (what "curve" may name depends on the kind)
 *   labels   [{ "at": [4, 0.5], "text": "envelope" }]
 */
import { ExprError, FUNCS, SCHEMATIC_FUNCS, compile, isConstantExpr, parse, toText, type Env } from './expr.ts';

export type Fill = 'closed' | 'open';
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type Pos = 'above' | 'below' | 'left' | 'right';
export type Range = [number, number];

export interface Tick {
  at: number;
  label: string | null;
}

export interface PointMark {
  x: number;
  y: number;
  label: string | null;
  fill: Fill;
  pos: Pos | null;
  /** Added by the app (e.g. intersections, jump endpoints), not written in the spec. */
  auto?: boolean;
  /** Optional stroke/fill color override (defaults to axis ink). */
  color?: string;
}

export interface TextLabel {
  x: number;
  y: number;
  text: string;
}

export interface Common {
  from: string;
  /** The independent variable. */
  v: string;
  /** Symbolic parameter values, e.g. { c: 2 } so expressions and bounds can use "c". */
  params: Record<string, number>;
  /** True when the figure illustrates a schematic function such as f(t) vs f(t − c). */
  schematic?: boolean;
  window: { x: Range | null; y: Range | null };
  axes: { x: string; y: string };
  ticks: { x: Tick[] | null; y: Tick[] | null };
  points: PointMark[];
  labels: TextLabel[];
}

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const pair = (p: unknown): Range | null =>
  Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]) && p[0] < p[1] ? [p[0], p[1]] : null;

export const COMMON_FIELDS = ['kind', 'from', 'var', 'params', 'schematic', 'window', 'axes', 'ticks', 'points', 'labels'];

export interface Messages {
  errors: string[];
  warnings: string[];
}

export function warnUnknown(raw: Obj, known: string[], m: Messages) {
  for (const k of Object.keys(raw)) if (!known.includes(k)) m.warnings.push(`Ignored unknown field “${k}”.`);
}

/**
 * Extracts valid symbolic parameter values before numbersFromConstants() runs, so
 * window/ticks/bounds can already reference parameter names like "c".
 */
export function extractPrelimParams(raw: Obj): Record<string, number> {
  const out: Record<string, number> = {};
  const p = raw.params;
  const add = (name: unknown, val: unknown) => {
    if (typeof name !== 'string' || !/^[A-Za-z]$/.test(name.trim())) return;
    const k = name.trim();
    if (k === 'e' || k === 'i') return;
    const n = isNum(val) ? val : typeof val === 'string' ? constantValue(val) : null;
    if (n !== null && Number.isFinite(n)) out[k] = n;
  };
  if (Array.isArray(p)) {
    for (const item of p) if (isObj(item)) add(item.name, item.value);
  } else if (isObj(p)) {
    for (const [k, v] of Object.entries(p)) add(k, v);
  }
  return out;
}

export function parseParams(rawParams: unknown, v: string, m: Messages): Record<string, number> {
  const out: Record<string, number> = {};
  if (rawParams === undefined) return out;
  const add = (name: unknown, val: unknown, where: string) => {
    if (typeof name !== 'string' || !/^[A-Za-z]$/.test(name.trim())) {
      m.errors.push(`${where}: parameter name must be a single letter.`);
      return;
    }
    const k = name.trim();
    if (k === v || k === 'e' || k === 'i') {
      m.errors.push(`${where}: parameter can’t be called ${k}.`);
      return;
    }
    if (!isNum(val)) {
      m.errors.push(`${where}: value for “${k}” must be a finite number.`);
      return;
    }
    out[k] = val;
  };
  if (Array.isArray(rawParams)) {
    rawParams.forEach((item, i) => {
      if (!isObj(item)) m.errors.push(`params[${i}]: must be { "name": "c", "value": 2 }.`);
      else add(item.name, item.value, `params[${i}]`);
    });
  } else if (isObj(rawParams)) {
    for (const [k, val] of Object.entries(rawParams)) add(k, val, `params.${k}`);
  } else {
    m.errors.push('params must be a list of { "name": "c", "value": 2 } or an object.');
  }
  return out;
}

/**
 * Everything shared except the points (which need the kind's curves).
 * `indep` is the axis whose label names the independent variable.
 */
export function parseCommon(raw: Obj, m: Messages, indep: 'x' | 'y'): Omit<Common, 'points'> {
  const from = str(raw.from);
  if (!from) m.errors.push('from: quote the equation on the page that this figure shows (e.g. "y = e^{-t}\\cos(3t)").');

  const axesIn = isObj(raw.axes) ? raw.axes : {};
  const ax = str(axesIn.x) ?? 'x';
  const ay = str(axesIn.y) ?? 'y';
  const named = indep === 'x' ? ax : ay;
  let v = str(raw.var) ?? (/^[A-Za-z]$/.test(named) ? named : indep);
  if (!/^[A-Za-z]$/.test(v)) {
    m.errors.push(`var must be a single letter (got “${v}”).`);
    v = indep;
  }
  if (v === 'e') m.errors.push('The variable can’t be called e (that’s the constant).');

  const params = parseParams(raw.params, v, m);

  const win = isObj(raw.window) ? raw.window : {};
  const axisRange = (k: 'x' | 'y'): Range | null => {
    const r = win[k];
    if (r === undefined || r === 'auto') return null;
    const p = pair(r);
    if (!p) m.errors.push(`window.${k} must be [${k === 'x' ? 'left, right' : 'bottom, top'}] with the first smaller, or "auto".`);
    return p;
  };
  const wx = axisRange('x');
  const wy = axisRange('y');

  const ticksIn = isObj(raw.ticks) ? raw.ticks : {};
  const tickList = (t: unknown, axis: string): Tick[] | null => {
    if (t === undefined || t === 'auto') return null;
    if (!Array.isArray(t)) {
      m.errors.push(`ticks.${axis} must be a list or "auto".`);
      return null;
    }
    const out: Tick[] = [];
    for (const k of t) {
      if (isNum(k)) out.push({ at: k, label: null });
      else if (isObj(k) && isNum(k.at)) out.push({ at: k.at, label: str(k.label) });
      else m.warnings.push(`ticks.${axis}: ignored ${JSON.stringify(k)}.`);
    }
    return out;
  };
  let tx = tickList(ticksIn.x, 'x');
  if (ticksIn.x === undefined && Object.keys(params).length > 0 && wx) {
    const symTicks = Object.entries(params)
      .filter(([, val]) => val > wx[0] + 1e-9 && val < wx[1] - 1e-9)
      .sort((a, b) => a[1] - b[1])
      .map(([name, val]) => ({ at: val, label: name }));
    if (symTicks.length) tx = symTicks;
  }

  const labels: TextLabel[] = [];
  if (raw.labels !== undefined && !Array.isArray(raw.labels)) m.errors.push('labels must be a list.');
  (Array.isArray(raw.labels) ? raw.labels : []).forEach((l, i) => {
    if (isObj(l) && Array.isArray(l.at) && isNum(l.at[0]) && isNum(l.at[1]) && str(l.text))
      labels.push({ x: l.at[0], y: l.at[1], text: str(l.text)! });
    else m.errors.push(`label ${i + 1}: give "at": [x, y] and "text".`);
  });

  return {
    from: from ?? '',
    v,
    params,
    ...(raw.schematic === true ? { schematic: true } : {}),
    window: { x: wx, y: wy },
    axes: { x: ax, y: ay },
    ticks: { x: tx, y: tickList(ticksIn.y, 'y') },
    labels,
  };
}

/**
 * Resolves `"on": { "curve": ref, "at": t }` to a point, or explains why not.
 * Each kind decides what `ref` may be (a curve number, "top", ...).
 */
export type OnCurve = (ref: unknown, at: number, fill: Fill) => [number, number] | string;

export function parsePoints(raw: unknown, onCurve: OnCurve, m: Messages): PointMark[] {
  const points: PointMark[] = [];
  const posOf = (p: unknown): Pos | null => (p === 'above' || p === 'below' || p === 'left' || p === 'right' ? p : null);
  if (raw !== undefined && !Array.isArray(raw)) m.errors.push('points must be a list.');
  (Array.isArray(raw) ? raw : []).forEach((p, i) => {
    const where = `point ${i + 1}`;
    if (!isObj(p)) return void m.errors.push(`${where}: must be an object.`);
    const label = str(p.label);
    const fill: Fill = p.fill === 'open' ? 'open' : 'closed';
    const pos = posOf(p.pos);
    if (Array.isArray(p.at) && p.at.length === 2 && isNum(p.at[0]) && isNum(p.at[1])) {
      points.push({ x: p.at[0], y: p.at[1], label, fill, pos });
    } else if (isObj(p.on) && isNum(p.on.at) && p.on.curve !== undefined) {
      const r = onCurve(p.on.curve, p.on.at, fill);
      if (typeof r === 'string') return void m.errors.push(`${where}: ${r}`);
      points.push({ x: r[0], y: r[1], label, fill, pos });
    } else m.errors.push(`${where}: give "at": [x, y] or "on": { "curve": …, "at": … }.`);
  });
  return points;
}

export interface Compiled1 {
  expr: string;
  /** Readable form for alt text. */
  text: string;
  f: (x: number) => number;
  /** No variable in it ("0", "2"). */
  constant: boolean;
  schematicUsed?: boolean;
}

/** Parses an expression in `v` (and any symbolic `params`), recording a readable error under `where`. */
export function compileExpr(
  e: unknown,
  v: string,
  where: string,
  m: Messages,
  params: Record<string, number> = {},
  schematic = false,
): Compiled1 | null {
  const s = typeof e === 'number' && Number.isFinite(e) ? String(e) : str(e);
  if (!s) {
    m.errors.push(`${where}: the expression is missing.`);
    return null;
  }
  try {
    const paramNames = Object.keys(params);
    const useSchematic =
      schematic || (/\b[fg]\s*\(/.test(s) && v !== 'f' && v !== 'g' && !('f' in params) && !('g' in params));
    const extra = useSchematic ? SCHEMATIC_FUNCS : {};
    const tree = parse(s, [v, ...paramNames], extra);
    const g = compile(tree, extra);
    const env: Env = { ...params, [v]: 0 };
    const f = (x: number) => {
      env[v] = x;
      return g(env);
    };
    return { expr: s, f, text: toText(tree), constant: isConstantExpr(tree), schematicUsed: useSchematic };
  } catch (err) {
    if (err instanceof ExprError) m.errors.push(`${where}: ${err.message}`);
    else throw err;
    return null;
  }
}

/* ---------------- constants in number fields (2.2.2) ---------------- */

/** Fields whose values are numbers (and everything inside them). */
const NUMERIC_KEYS = new Set(['window', 'between', 'at', 'start', 'on', 'size', 'width', 'A', 'ticks', 'params', 'poles', 'zeros', 'roc']);
/** Fields that hold text or expressions, never converted. */
const TEXT_KEYS = new Set([
  'kind', 'from', 'var', 'vars', 'axes', 'expr', 'top', 'bottom', 'left', 'right', 'system', 'slope',
  'label', 'text', 'style', 'show', 'direction', 'ends', 'curve', 'name', 'sign',
]);
/** Words that number fields accept as they are. */
const KEEP_WORDS = new Set(['auto', 'intersections', 'inf', '-inf', '+inf', '∞', '-∞']);

/** A constant such as "pi/2", "2pi", "-π", "e", "sqrt(2)" (or a declared param) as a number, or null. */
export function constantValue(text: string, params: Record<string, number> = {}): number | null {
  const paramNames = Object.keys(params);
  // Each run of letters must be one name ("pie" is a typo here, not π·e).
  for (const run of text.match(/[A-Za-z]+/g) ?? []) {
    if (run !== 'pi' && run !== 'e' && !(run in FUNCS) && !paramNames.includes(run)) return null;
  }
  try {
    const v = compile(parse(text, paramNames))(params);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Lets number fields be written as constants: "between": [0, "pi"], "window":
 * { "x": ["-2pi", "2pi"] }, "start": ["pi/2", 0]. Converts them to numbers before the
 * checks run (so π is recognized exactly in the alt text) and reports any that aren't
 * constants. Text fields (expressions, labels, …) are never touched.
 */
export function numbersFromConstants(raw: unknown, m: Messages, params: Record<string, number> = {}): unknown {
  const walk = (v: unknown, path: string, numeric: boolean): unknown => {
    if (typeof v === 'string') {
      if (!numeric || KEEP_WORDS.has(v.trim())) return v;
      const n = constantValue(v, params);
      if (n === null) {
        m.errors.push(`${path}: “${v}” isn’t a number. Use a number or a constant such as pi/2, 2pi, or e.`);
        return v;
      }
      return n;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, numeric));
    if (isObj(v)) {
      const out: Obj = {};
      for (const [k, x] of Object.entries(v)) out[k] = TEXT_KEYS.has(k) ? x : walk(x, path ? `${path}.${k}` : k, numeric || NUMERIC_KEYS.has(k));
      return out;
    }
    return v;
  };
  return walk(raw, '', false);
}
