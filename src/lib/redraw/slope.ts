/**
 * 1D ODE direction (slope) field y' = f(t, y), zero-isocline contour, and RK4
 * solution curves (non-autonomous ODEs allowed).
 */
import { ExprError, compile, parse, toText } from './expr.ts';
import {
  COMMON_FIELDS,
  isNum,
  isObj,
  parseCommon,
  parsePoints,
  str,
  warnUnknown,
  type Common,
  type Messages,
  type Obj,
  type Range,
} from './common.ts';
import { describeMarks, list, num, pt } from './describe.ts';
import { asLine, contour, lineText, type LineEq } from './phase.ts';
import type { Pt } from './sample.ts';

export type SlopeShow = 'field' | 'isoclines';
const SHOWS: SlopeShow[] = ['field', 'isoclines'];

export interface SlopeSolution {
  n: number;
  start: Pt;
  direction: 'both' | 'forward' | 'backward';
  label: string | null;
}

export interface SlopeSpec extends Common {
  kind: 'slope';
  vars: [string, string];
  names: [string, string];
  slopeExpr: string;
  slopeText: string;
  f: (t: number, y: number) => number;
  show: Set<SlopeShow>;
  solutions: SlopeSolution[];
}

export type SlopeExit = 'left' | 'right' | 'top' | 'bottom' | 'stops';

export interface SlopeSolFacts {
  s: SlopeSolution;
  path: Pt[];
  forward: SlopeExit | null;
  backward: SlopeExit | null;
}

export interface SlopeFacts {
  kind: 'slope';
  spec: SlopeSpec;
  xWindow: Range;
  yWindow: Range;
  isocline: Pt[][];
  isoclineLines: LineEq[] | null;
  solutions: SlopeSolFacts[];
}

const SLOPE_FIELDS = [...COMMON_FIELDS, 'vars', 'slope', 'show', 'solutions'];
const DEFAULT_SHOW: SlopeShow[] = ['field'];

export function checkSlope(raw: Obj, m: Messages): SlopeSpec | null {
  warnUnknown(raw, SLOPE_FIELDS, m);
  // Default axes for a 1D ODE are (t, y) unless specified.
  const axesIn = isObj(raw.axes) ? raw.axes : {};
  const normalizedRaw: Obj = {
    ...raw,
    axes: {
      x: str(axesIn.x) ?? 't',
      y: str(axesIn.y) ?? 'y',
    },
  };
  const common = parseCommon(normalizedRaw, m, 'x');

  let vx = /^[A-Za-z]$/.test(common.axes.x) ? common.axes.x : 't';
  let vy = /^[A-Za-z]$/.test(common.axes.y) ? common.axes.y : 'y';
  if (raw.vars !== undefined) {
    const vs = raw.vars;
    if (Array.isArray(vs) && vs.length === 2 && vs.every((v) => typeof v === 'string' && /^[A-Za-z]$/.test(v)))
      [vx, vy] = vs as [string, string];
    else m.errors.push('vars must be two single letters, e.g. ["t", "y"].');
  }
  if (vx === vy) m.errors.push(`The two variables must differ (both are “${vx}”).`);
  for (const v of [vx, vy]) if (v === 'e') m.errors.push('A variable can’t be called e.');

  const slopeExpr = typeof raw.slope === 'number' && Number.isFinite(raw.slope) ? String(raw.slope) : str(raw.slope);
  if (!slopeExpr) {
    m.errors.push(`slope: give ${vy}′ as an expression in ${vx} and ${vy} (e.g. "${vx} - ${vy}").`);
    return null;
  }

  const disp = (label: string, v: string) => ([...label].length === 1 ? label : v);
  const names: [string, string] = [disp(common.axes.x, vx), disp(common.axes.y, vy)];
  let compiledFn: ((env: Record<string, number>) => number) | null = null;
  let slopeText = '';
  try {
    const tree = parse(slopeExpr, [vx, vy, ...Object.keys(common.params)]);
    compiledFn = compile(tree);
    slopeText = toText(tree, { [vx]: names[0], [vy]: names[1] });
  } catch (e) {
    if (!(e instanceof ExprError)) throw e;
    m.errors.push(`slope: ${e.message}`);
  }
  if (!compiledFn || m.errors.length) return null;

  const env: Record<string, number> = { ...common.params, [vx]: 0, [vy]: 0 };
  const f = (t: number, y: number): number => {
    env[vx] = t;
    env[vy] = y;
    return compiledFn!(env);
  };

  {
    const xr = common.window.x ?? [-3, 3];
    const yr = common.window.y ?? [-3, 3];
    let ok = 0;
    for (let i = 0; i <= 12; i++)
      for (let j = 0; j <= 12; j++) {
        const z = f(xr[0] + ((xr[1] - xr[0]) * i) / 12, yr[0] + ((yr[1] - yr[0]) * j) / 12);
        if (Number.isFinite(z)) ok++;
      }
    if (!ok) m.errors.push('slope: gives no real values anywhere in the window.');
  }

  const show = new Set<SlopeShow>(DEFAULT_SHOW);
  if (raw.show !== undefined) {
    show.clear();
    if (!Array.isArray(raw.show)) m.errors.push('show must be a list, e.g. ["field", "isoclines"].');
    else
      for (const s of raw.show) {
        if (SHOWS.includes(s as SlopeShow)) show.add(s as SlopeShow);
        else m.warnings.push(`show: ignored “${String(s)}” (use ${SHOWS.join(', ')}).`);
      }
  }

  const solutions: SlopeSolution[] = [];
  if (raw.solutions !== undefined && !Array.isArray(raw.solutions)) m.errors.push('solutions must be a list.');
  (Array.isArray(raw.solutions) ? raw.solutions : []).forEach((s, i) => {
    const where = `solution ${i + 1}`;
    if (!isObj(s) || !Array.isArray(s.start) || s.start.length !== 2 || !isNum(s.start[0]) || !isNum(s.start[1]))
      return void m.errors.push(`${where}: give "start": [${vx}, ${vy}].`);
    const start: Pt = [s.start[0], s.start[1]];
    if (!Number.isFinite(f(...start))) return void m.errors.push(`${where}: the slope isn’t defined at ${pt(...start)}.`);
    const direction = s.direction === 'forward' || s.direction === 'backward' ? s.direction : 'both';
    solutions.push({ n: i + 1, start, direction, label: str(s.label) });
  });

  const points = parsePoints(raw.points, () => 'points on solution curves aren’t supported; use "at": [x, y].', m);
  if (m.errors.length) return null;

  return {
    kind: 'slope',
    ...common,
    v: vx,
    points,
    vars: [vx, vy],
    names,
    slopeExpr,
    slopeText,
    f,
    show,
    solutions,
  };
}

function integrateSlope(
  f: (t: number, y: number) => number,
  start: Pt,
  sign: 1 | -1,
  xw: Range,
  yw: Range,
): { pts: Pt[]; exit: SlopeExit } {
  const sx = xw[1] - xw[0];
  const sy = yw[1] - yw[0];
  const ds = 1 / 300;
  const dirVec = (p: Pt): Pt | null => {
    const s = f(p[0], p[1]);
    if (!Number.isFinite(s)) return null;
    const norm = Math.hypot(1 / sx, s / sy);
    if (!Number.isFinite(norm) || norm <= 0) return null;
    return [sign / norm, (sign * s) / norm];
  };
  const inside = (p: Pt) => p[0] >= xw[0] - 0.03 * sx && p[0] <= xw[1] + 0.03 * sx && p[1] >= yw[0] - 0.05 * sy && p[1] <= yw[1] + 0.05 * sy;
  const pts: Pt[] = [start];
  let p = start;
  for (let k = 0; k < 4000; k++) {
    const v1 = dirVec(p);
    if (!v1) return { pts, exit: 'stops' };
    const step = ds;
    const add = (q: Pt, v: Pt, c: number): Pt => [q[0] + c * v[0], q[1] + c * v[1]];
    const v2 = dirVec(add(p, v1, step / 2));
    if (!v2) return { pts, exit: 'stops' };
    const v3 = dirVec(add(p, v2, step / 2));
    if (!v3) return { pts, exit: 'stops' };
    const v4 = dirVec(add(p, v3, step));
    if (!v4) return { pts, exit: 'stops' };
    const next: Pt = [
      p[0] + (step / 6) * (v1[0] + 2 * v2[0] + 2 * v3[0] + v4[0]),
      p[1] + (step / 6) * (v1[1] + 2 * v2[1] + 2 * v3[1] + v4[1]),
    ];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return { pts, exit: 'stops' };
    p = next;
    pts.push(p);
    if (!inside(p)) {
      const side: SlopeExit =
        p[0] < xw[0] ? 'left' : p[0] > xw[1] ? 'right' : p[1] < yw[0] ? 'bottom' : 'top';
      return { pts, exit: side };
    }
  }
  return { pts, exit: sign > 0 ? 'right' : 'left' };
}

export function analyzeSlope(spec: SlopeSpec): SlopeFacts {
  const xWindow = spec.window.x ?? [-3, 3];
  const yWindow = spec.window.y ?? [-3, 3];
  let isocline: Pt[][] = [];
  let isoclineLines: LineEq[] | null = null;
  if (spec.show.has('isoclines')) {
    isocline = contour(spec.f, xWindow, yWindow);
    if (isocline.length) {
      const lines = isocline.map((seg) => asLine(seg, xWindow, yWindow));
      if (lines.every((l): l is LineEq => l !== null)) isoclineLines = lines;
    }
  }
  const solutions: SlopeSolFacts[] = spec.solutions.map((s) => {
    let fwdPts: Pt[] = [s.start];
    let bwdPts: Pt[] = [s.start];
    let forward: SlopeExit | null = null;
    let backward: SlopeExit | null = null;
    if (s.direction !== 'backward') {
      const r = integrateSlope(spec.f, s.start, 1, xWindow, yWindow);
      fwdPts = r.pts;
      forward = r.exit;
    }
    if (s.direction !== 'forward') {
      const r = integrateSlope(spec.f, s.start, -1, xWindow, yWindow);
      bwdPts = r.pts;
      backward = r.exit;
    }
    return { s, path: [...[...bwdPts].reverse(), ...fwdPts.slice(1)], forward, backward };
  });
  return { kind: 'slope', spec, xWindow, yWindow, isocline, isoclineLines, solutions };
}

export function describeSlope(f: SlopeFacts): { short: string; long: string } {
  const { spec, xWindow, yWindow } = f;
  const [vx, vy] = spec.names;
  const short = `Slope field for ${vy}′ = ${spec.slopeText} for ${vx} from ${num(xWindow[0])} to ${num(xWindow[1])}.`;
  const parts: string[] = [
    `Horizontal axis ${spec.axes.x} from ${num(xWindow[0])} to ${num(xWindow[1])}; vertical axis ${spec.axes.y} from ${num(yWindow[0])} to ${num(yWindow[1])}.`,
  ];
  if (spec.show.has('field')) parts.push(`Short direction segments show slopes given by ${vy}′ = ${spec.slopeText}.`);
  if (spec.show.has('isoclines')) {
    if (!f.isocline.length) parts.push(`${vy}′ is never 0 in the window.`);
    else if (f.isoclineLines)
      parts.push(`The zero-isocline (${vy}′ = 0, dashed) is ${list(f.isoclineLines.map((l) => lineText(l, vx, vy)))}.`);
    else parts.push(`The zero-isocline (where ${vy}′ = 0) is drawn dashed.`);
  }
  for (const sol of f.solutions) {
    const head = `${f.solutions.length === 1 ? 'The solution curve' : `Solution ${sol.s.n}`} through ${pt(...sol.s.start)}${sol.s.label ? ` (${sol.s.label})` : ''}`;
    const bwd = sol.backward ? (sol.backward === 'stops' ? 'begins where the slope is undefined' : `enters across the ${sol.backward} edge`) : '';
    const fwd = sol.forward ? (sol.forward === 'stops' ? 'stops where the slope is undefined' : `exits across the ${sol.forward} edge`) : '';
    parts.push(`${head} ${[bwd, fwd].filter(Boolean).join(' and ')}.`);
  }
  parts.push(...describeMarks(spec));
  return { short, long: parts.join(' ') };
}
