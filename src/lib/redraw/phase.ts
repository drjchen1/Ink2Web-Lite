/**
 * Phase plane for an autonomous 2D system (2.2 dev).
 *
 *   {
 *     "kind": "phase",
 *     "from": "x' = y, \\; y' = -2x - 3y",
 *     "system": { "x": "y", "y": "-2x - 3y" },       // or "A": [[0, 1], [-2, -3]]
 *     "window": { "x": [-3, 3], "y": [-2, 2] },       // optional
 *     "show": ["field", "equilibria", "nullclines", "eigenvectors"],
 *     "trajectories": [{ "start": [2, 0] }, { "start": [-1, 2], "direction": "forward" }]
 *   }
 *
 * - The two state variables are the axis labels when they are single letters (else
 *   "vars": ["u", "v"]); `system` is keyed by them. No t: the system must be autonomous.
 * - show (default ["field", "equilibria"]):
 *     field         short arrows on a grid, the direction of motion
 *     equilibria    dots, filled when stable and open when unstable
 *     nullclines    where x′ = 0 (dashed) and where y′ = 0 (dotted)
 *     eigenvectors  the eigen-directions at each equilibrium with real eigenvalues
 * - trajectories: the curves through the starting points the sketch shows. Each is
 *   integrated forward and backward in time (RK4) until it leaves the window, reaches an
 *   equilibrium, or closes up; "direction": "forward" | "backward" limits it.
 * - labelEquilibria: true writes the coordinates beside each equilibrium.
 *
 * Everything said about the figure is computed: equilibria by Newton's method, their
 * type from the Jacobian's eigenvalues, nullclines by contouring, trajectories by
 * integration, and what each trajectory does.
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
import { nice, niceRange, niceTicks } from './nice.ts';
import type { Pt } from './sample.ts';
import { PLOT_ASPECT } from './svg.ts';

export type Show = 'field' | 'equilibria' | 'nullclines' | 'eigenvectors';
const SHOWS: Show[] = ['field', 'equilibria', 'nullclines', 'eigenvectors'];

export interface Trajectory {
  n: number;
  start: Pt;
  direction: 'both' | 'forward' | 'backward';
  label: string | null;
}

export interface PhaseSpec extends Common {
  kind: 'phase';
  vars: [string, string];
  /** How the variables are written in text: the axis labels when they are one character (θ, ω). */
  names: [string, string];
  /** Readable right-hand sides: "y", "−2x − 3y". */
  text: [string, string];
  F: (x: number, y: number) => Pt;
  show: Set<Show>;
  trajectories: Trajectory[];
  labelEquilibria: boolean;
}

const PHASE_FIELDS = [...COMMON_FIELDS, 'vars', 'system', 'A', 'show', 'trajectories', 'labelEquilibria'];
const DEFAULT_SHOW: Show[] = ['field', 'equilibria'];

/** "-2x - 3y" for a matrix row, as a person would write it. */
function rowExpr(r: number[], vx: string, vy: string): string {
  let out = '';
  for (const [k, v] of [[r[0], vx], [r[1], vy]] as [number, string][]) {
    if (!k) continue;
    const mag = Math.abs(k) === 1 ? '' : String(Math.abs(k));
    out += out ? ` ${k < 0 ? '-' : '+'} ${mag}${v}` : `${k < 0 ? '-' : ''}${mag}${v}`;
  }
  return out || '0';
}

export function checkPhase(raw: Obj, m: Messages): PhaseSpec | null {
  warnUnknown(raw, PHASE_FIELDS, m);
  if (raw.var !== undefined) m.warnings.push('Ignored “var”; a phase plane uses "vars": ["x", "y"].');
  const common = parseCommon(raw, m, 'x');

  /* the two variables */
  let vx = /^[A-Za-z]$/.test(common.axes.x) ? common.axes.x : 'x';
  let vy = /^[A-Za-z]$/.test(common.axes.y) ? common.axes.y : 'y';
  if (raw.vars !== undefined) {
    const vs = raw.vars;
    if (Array.isArray(vs) && vs.length === 2 && vs.every((v) => typeof v === 'string' && /^[A-Za-z]$/.test(v))) [vx, vy] = vs as [string, string];
    else m.errors.push('vars must be two single letters, e.g. ["x", "y"].');
  }
  if (vx === vy) m.errors.push(`The two variables must differ (both are “${vx}”).`);
  for (const v of [vx, vy]) if (v === 'e' || v === 't') m.errors.push(`A state variable can’t be called ${v}.`);

  /* the system */
  let src: [string, string] | null = null;
  if (raw.A !== undefined) {
    const A = raw.A;
    const ok = Array.isArray(A) && A.length === 2 && A.every((r) => Array.isArray(r) && r.length === 2 && r.every(isNum));
    if (!ok) m.errors.push('A must be a 2×2 matrix of numbers, e.g. [[0, 1], [-2, -3]].');
    else src = [rowExpr(A[0] as number[], vx, vy), rowExpr(A[1] as number[], vx, vy)];
    if (raw.system !== undefined) m.warnings.push('Both A and system are given; using A.');
  } else if (isObj(raw.system)) {
    const sys = raw.system;
    const keys = Object.keys(sys);
    const get = (v: string) => (typeof sys[v] === 'number' ? String(sys[v]) : str(sys[v]));
    if (!keys.includes(vx) || !keys.includes(vy) || keys.length !== 2)
      m.errors.push(`system must have exactly the keys "${vx}" and "${vy}" (the axis variables), e.g. { "${vx}": "${vy}", "${vy}": "-${vx}" }.`);
    else {
      const a = get(vx);
      const b = get(vy);
      if (!a || !b) m.errors.push(`system: give ${vx}′ and ${vy}′ as expressions.`);
      else src = [a, b];
    }
  } else m.errors.push(`system: give { "${vx}": …, "${vy}": … } (the right-hand sides of ${vx}′ and ${vy}′), or "A": [[a, b], [c, d]].`);
  if (!src || m.errors.length) return null;

  const disp = (label: string, v: string) => ([...label].length === 1 ? label : v);
  const names: [string, string] = [disp(common.axes.x, vx), disp(common.axes.y, vy)];
  const fs: ((env: Record<string, number>) => number)[] = [];
  const text: string[] = [];
  for (const [i, s] of src.entries()) {
    const which = `${i ? vy : vx}′`;
    try {
      const tree = parse(s, [vx, vy]);
      fs.push(compile(tree));
      text.push(toText(tree, { [vx]: names[0], [vy]: names[1] }));
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      let msg = e.message;
      try {
        parse(s, [vx, vy, 't']);
        msg = 'it uses t, but a phase plane needs an autonomous system (no t).';
      } catch {
        /* keep the original message */
      }
      m.errors.push(`${which}: ${msg}`);
    }
  }
  if (fs.length < 2) return null;
  const env: Record<string, number> = { [vx]: 0, [vy]: 0 };
  const F = (x: number, y: number): Pt => {
    env[vx] = x;
    env[vy] = y;
    return [fs[0](env), fs[1](env)];
  };

  // A system with no real values anywhere near the window was almost surely misread.
  {
    const xr = common.window.x ?? [-3, 3];
    const yr = common.window.y ?? [-3, 3];
    let ok = 0;
    for (let i = 0; i <= 12; i++)
      for (let j = 0; j <= 12; j++) {
        const [f, g] = F(xr[0] + ((xr[1] - xr[0]) * i) / 12, yr[0] + ((yr[1] - yr[0]) * j) / 12);
        if (Number.isFinite(f) && Number.isFinite(g)) ok++;
      }
    if (!ok) m.errors.push('system: gives no real values anywhere in the window.');
  }

  /* what to show */
  const show = new Set<Show>(DEFAULT_SHOW);
  if (raw.show !== undefined) {
    show.clear();
    if (!Array.isArray(raw.show)) m.errors.push(`show must be a list, e.g. ["field", "equilibria"].`);
    else
      for (const s of raw.show) {
        if (SHOWS.includes(s as Show)) show.add(s as Show);
        else m.warnings.push(`show: ignored “${String(s)}” (use ${SHOWS.join(', ')}).`);
      }
  }

  /* trajectories */
  const trajectories: Trajectory[] = [];
  if (raw.trajectories !== undefined && !Array.isArray(raw.trajectories)) m.errors.push('trajectories must be a list.');
  (Array.isArray(raw.trajectories) ? raw.trajectories : []).forEach((t, i) => {
    const where = `trajectory ${i + 1}`;
    if (!isObj(t) || !Array.isArray(t.start) || t.start.length !== 2 || !isNum(t.start[0]) || !isNum(t.start[1]))
      return void m.errors.push(`${where}: give "start": [${vx}, ${vy}].`);
    const start: Pt = [t.start[0], t.start[1]];
    const [fx, fy] = F(...start);
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return void m.errors.push(`${where}: the system isn’t defined at ${pt(...start)}.`);
    const direction = t.direction === 'forward' || t.direction === 'backward' ? t.direction : 'both';
    trajectories.push({ n: i + 1, start, direction, label: str(t.label) });
  });
  if (trajectories.length > 20) m.warnings.push('More than 20 trajectories: the figure may be crowded.');

  const points = parsePoints(raw.points, () => 'points on trajectories aren’t supported; use "at": [x, y].', m);

  if (m.errors.length) return null;
  return {
    kind: 'phase',
    ...common,
    v: vx,
    points,
    vars: [vx, vy],
    names,
    text: [text[0], text[1]],
    F,
    show,
    trajectories,
    labelEquilibria: raw.labelEquilibria === true,
  };
}

/* ---------------- linear algebra ---------------- */

export type Mat = [[number, number], [number, number]];

/** Numerical Jacobian, with entries snapped to exact values when they are (2, −3, 0.5). */
export function jacobian(F: PhaseSpec['F'], x: number, y: number): Mat {
  const hx = 1e-5 * Math.max(1, Math.abs(x));
  const hy = 1e-5 * Math.max(1, Math.abs(y));
  const [a1, c1] = F(x + hx, y);
  const [a0, c0] = F(x - hx, y);
  const [b1, d1] = F(x, y + hy);
  const [b0, d0] = F(x, y - hy);
  const snap = (v: number) => {
    const r = Math.round(v * 1e6) / 1e6;
    return Math.abs(v - r) < 1e-7 ? (Object.is(r, -0) ? 0 : r) : v;
  };
  return [
    [snap((a1 - a0) / (2 * hx)), snap((b1 - b0) / (2 * hy))],
    [snap((c1 - c0) / (2 * hx)), snap((d1 - d0) / (2 * hy))],
  ];
}

export type EqType =
  | 'stable node'
  | 'unstable node'
  | 'saddle'
  | 'stable spiral'
  | 'unstable spiral'
  | 'center'
  | 'stable degenerate node'
  | 'unstable degenerate node'
  | 'stable star'
  | 'unstable star'
  | 'degenerate';

export interface Eigen {
  /** Real eigenvalues (sorted ascending), or the complex pair α ± βi. */
  values: { re: number; im: number }[];
  /** Readable: "−1 and −2", "−1 ± 2i", "(−3 ± √5)/2". */
  text: string;
  /** Eigenvectors for real, distinct eigenvalues, matching values. */
  vectors: Pt[];
}

/** √n as text when n is a positive integer: √5, or 2√3 when it simplifies. */
function surd(n: number): string | null {
  if (!(n > 0) || Math.abs(n - Math.round(n)) > 1e-9) return null;
  let k = Math.round(n);
  let out = 1;
  for (let f = 2; f * f <= k; f++) while (k % (f * f) === 0) {
    out *= f;
    k /= f * f;
  }
  return k === 1 ? String(out) : `${out === 1 ? '' : out}√${k}`;
}

/**
 * (tr ± √d)/2 written exactly when it can be: "−1 ± √3", "±√3", "(−1 ± √13)/2",
 * "(−1 ± i√3)/2", "±i√3". `i` is '' for real roots, 'i' for complex ones.
 */
function surdPair(tr: number, d: number, i: string): string | null {
  const half = surd(d / 4);
  if (half && nice(tr / 2).exact) return `${tr === 0 ? '' : `${nice(tr / 2).text} `}± ${i}${half}`.replace(/^± /, '±');
  const whole = surd(d);
  if (whole && nice(tr).exact) return tr === 0 ? `±${i}${whole}/2` : `(${nice(tr).text} ± ${i}${whole})/2`;
  return null;
}

export function eigen(J: Mat): Eigen {
  const [[a, b], [c, d]] = J;
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  const scale = Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d) + 1e-300;
  const tiny = 1e-9 * scale * scale;
  const n = (v: number) => num(v);
  if (disc > tiny) {
    const r = Math.sqrt(disc);
    const l1 = (tr - r) / 2;
    const l2 = (tr + r) / 2;
    let text = `${n(l1)} and ${n(l2)}`;
    if (!nice(l1).exact || !nice(l2).exact) text = surdPair(tr, disc, '') ?? text;
    // Eigenvectors: (λ − d, c) or (b, λ − a), whichever is better conditioned.
    const vec = (l: number): Pt => {
      const p: Pt = [l - d, c];
      const q: Pt = [b, l - a];
      const v = Math.hypot(...p) >= Math.hypot(...q) ? p : q;
      const len = Math.hypot(...v) || 1;
      return [v[0] / len, v[1] / len];
    };
    return { values: [{ re: l1, im: 0 }, { re: l2, im: 0 }], text, vectors: [vec(l1), vec(l2)] };
  }
  if (disc < -tiny) {
    const alpha = tr / 2;
    const beta = Math.sqrt(-disc) / 2;
    let text: string;
    const bn = nice(beta);
    const bText = bn.exact ? (bn.text === '1' ? '' : bn.text) : null;
    if (bText !== null) text = `${alpha === 0 ? '' : `${num(alpha)} `}± ${bText}i`;
    else text = surdPair(tr, -disc, 'i') ?? `${alpha === 0 ? '' : `${num(alpha)} `}± ${num(beta)}i`;
    text = text.replace(/^\(± /, '(±').replace(/^± /, '±');
    return { values: [{ re: alpha, im: -beta }, { re: alpha, im: beta }], text, vectors: [] };
  }
  const l = tr / 2;
  return { values: [{ re: l, im: 0 }, { re: l, im: 0 }], text: `${n(l)} (repeated)`, vectors: [] };
}

export function classify(J: Mat, ev: Eigen): EqType {
  const [[a, b], [c, d]] = J;
  const scale = Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d) + 1e-300;
  const det = a * d - b * c;
  const tr = a + d;
  if (Math.abs(det) < 1e-9 * scale * scale) return 'degenerate';
  if (det < 0) return 'saddle';
  const [l1, l2] = ev.values;
  if (l1.im !== 0) {
    if (Math.abs(tr) < 1e-9 * scale) return 'center';
    return tr < 0 ? 'stable spiral' : 'unstable spiral';
  }
  if (l1.re !== l2.re) return tr < 0 ? 'stable node' : 'unstable node';
  // Repeated eigenvalue: a star when J is a multiple of I, otherwise a degenerate node.
  const star = Math.abs(b) < 1e-9 * scale && Math.abs(c) < 1e-9 * scale;
  return ((tr < 0 ? 'stable ' : 'unstable ') + (star ? 'star' : 'degenerate node')) as EqType;
}

export const isStable = (t: EqType) => t.startsWith('stable') || t === 'center';

/* ---------------- equilibria ---------------- */

export interface Equilibrium {
  at: Pt;
  J: Mat;
  eigen: Eigen;
  type: EqType;
}

/** Equilibria in the window: Newton's method from a grid of seeds. */
export function findEquilibria(F: PhaseSpec['F'], xw: Range, yw: Range): Pt[] {
  const sx = xw[1] - xw[0];
  const sy = yw[1] - yw[0];
  const found: Pt[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      let x = xw[0] - 0.1 * sx + (1.2 * sx * i) / N;
      let y = yw[0] - 0.1 * sy + (1.2 * sy * j) / N;
      let ok = false;
      for (let k = 0; k < 60; k++) {
        const [f, g] = F(x, y);
        if (!Number.isFinite(f) || !Number.isFinite(g)) break;
        const J = jacobian(F, x, y);
        const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        if (!det || !Number.isFinite(det)) break;
        const dx = (J[1][1] * f - J[0][1] * g) / det;
        const dy = (-J[1][0] * f + J[0][0] * g) / det;
        // Damped step: never jump more than a window across.
        const s = Math.min(1, sx / (Math.abs(dx) + 1e-300), sy / (Math.abs(dy) + 1e-300));
        x -= s * dx;
        y -= s * dy;
        if (Math.abs(dx) < 1e-13 * (1 + Math.abs(x)) && Math.abs(dy) < 1e-13 * (1 + Math.abs(y))) {
          ok = true;
          break;
        }
      }
      if (!ok) continue;
      const [f, g] = F(x, y);
      if (!(Math.abs(f) < 1e-9 && Math.abs(g) < 1e-9)) continue;
      if (x < xw[0] - 1e-9 * sx || x > xw[1] + 1e-9 * sx || y < yw[0] - 1e-9 * sy || y > yw[1] + 1e-9 * sy) continue;
      const snap = (v: number, s: number) => {
        const n = nice(v, 1e-9);
        return n.exact ? Math.round(v * 1e9) / 1e9 : Math.abs(v) < 1e-12 * s ? 0 : v;
      };
      const p: Pt = [snap(x, sx), snap(y, sy)];
      if (!found.some((q) => Math.abs(q[0] - p[0]) < 1e-6 * sx && Math.abs(q[1] - p[1]) < 1e-6 * sy)) found.push(p);
    }
  return found.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/* ---------------- nullclines ---------------- */

export interface LineEq {
  /** x = c (vertical) or y = m x + c. */
  vertical: boolean;
  m: number;
  c: number;
}

export interface Nullcline {
  /** 0: x′ = 0, 1: y′ = 0. */
  which: 0 | 1;
  segments: Pt[][];
  /** The straight lines it consists of, when it is made of lines only. */
  lines: LineEq[] | null;
}

/** Contours of h = 0 by marching squares, joined into polylines. */
export function contour(h: (x: number, y: number) => number, xw: Range, yw: Range, nx = 160, ny = 110): Pt[][] {
  const X = (i: number) => xw[0] + ((xw[1] - xw[0]) * i) / nx;
  const Y = (j: number) => yw[0] + ((yw[1] - yw[0]) * j) / ny;
  const v: number[][] = [];
  for (let i = 0; i <= nx; i++) {
    v.push([]);
    for (let j = 0; j <= ny; j++) {
      const z = h(X(i), Y(j));
      // Exact zeros nudged off zero so a line through grid points is still found once.
      v[i].push(z === 0 ? 1e-300 : z);
    }
  }
  // Crossing on an edge, keyed so neighbouring cells share the same point.
  const cross = new Map<string, Pt>();
  const edge = (i0: number, j0: number, i1: number, j1: number): string => {
    const key = `${i0},${j0},${i1},${j1}`;
    if (!cross.has(key)) {
      // Bisection on the edge, so a straight nullcline comes out exactly straight.
      let lo = 0;
      let hi = 1;
      const at = (t: number): Pt => [X(i0) + (X(i1) - X(i0)) * t, Y(j0) + (Y(j1) - Y(j0)) * t];
      const s0 = v[i0][j0] > 0;
      for (let k = 0; k < 48; k++) {
        const mid = (lo + hi) / 2;
        const z = h(...at(mid));
        if (!Number.isFinite(z)) break;
        if (z > 0 === s0) lo = mid;
        else hi = mid;
      }
      cross.set(key, at((lo + hi) / 2));
    }
    return key;
  };
  const segs: [string, string][] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const c = [v[i][j], v[i + 1][j], v[i + 1][j + 1], v[i][j + 1]];
      if (!c.every(Number.isFinite)) continue;
      const s = c.map((z) => z > 0);
      const edges: string[] = [];
      const E = [
        [i, j, i + 1, j],
        [i + 1, j, i + 1, j + 1],
        [i, j + 1, i + 1, j + 1],
        [i, j, i, j + 1],
      ];
      const corners = [[0, 1], [1, 2], [3, 2], [0, 3]];
      for (let k = 0; k < 4; k++) if (s[corners[k][0]] !== s[corners[k][1]]) edges.push(edge(...(E[k] as [number, number, number, number])));
      // A sign change across a pole (1/x) is not a zero: the value at the middle is huge.
      const mid = h((X(i) + X(i + 1)) / 2, (Y(j) + Y(j + 1)) / 2);
      if (!(Math.abs(mid) <= 2 * Math.max(...c.map(Math.abs)))) continue;
      if (edges.length === 2) segs.push([edges[0], edges[1]]);
      else if (edges.length === 4) {
        // Saddle cell: pair by the centre's sign.
        const centre = mid > 0;
        if (centre === s[0]) segs.push([edges[0], edges[1]], [edges[2], edges[3]]);
        else segs.push([edges[0], edges[3]], [edges[1], edges[2]]);
      }
    }
  // Join segments into polylines.
  const adj = new Map<string, number[]>();
  segs.forEach(([p, q], k) => {
    for (const e of [p, q]) adj.set(e, [...(adj.get(e) ?? []), k]);
  });
  const used = new Array(segs.length).fill(false);
  const lines: Pt[][] = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = true;
    const chain = [segs[k][0], segs[k][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const endKey = dir === 1 ? chain[chain.length - 1] : chain[0];
        const next = (adj.get(endKey) ?? []).find((s) => !used[s]);
        if (next === undefined) break;
        used[next] = true;
        const other = segs[next][0] === endKey ? segs[next][1] : segs[next][0];
        if (dir === 1) chain.push(other);
        else chain.unshift(other);
      }
    }
    lines.push(chain.map((key) => cross.get(key)!));
  }
  return lines;
}

/** The straight line a polyline lies on, if it does (within 1e-6 of the window). */
export function asLine(poly: Pt[], xw: Range, yw: Range): LineEq | null {
  if (poly.length < 2) return null;
  const sx = xw[1] - xw[0];
  const sy = yw[1] - yw[0];
  let [p, q] = [poly[0], poly[poly.length - 1]];
  let best = 0;
  for (const r of poly) {
    const dd = Math.hypot((r[0] - p[0]) / sx, (r[1] - p[1]) / sy);
    if (dd > best) [best, q] = [dd, r];
  }
  if (best < 0.05) return null; // too short to tell
  const ux = (q[0] - p[0]) / sx;
  const uy = (q[1] - p[1]) / sy;
  const len = Math.hypot(ux, uy);
  for (const r of poly) {
    const d = Math.abs(((r[0] - p[0]) / sx) * uy - ((r[1] - p[1]) / sy) * ux) / len;
    if (d > 1e-5) return null;
  }
  const snap = (v: number) => (nice(v, 1e-5).exact ? Math.round(v * 1e5) / 1e5 : v);
  if (Math.abs(q[0] - p[0]) / sx < 1e-7 * Math.max(1, Math.abs(q[1] - p[1]) / sy)) return { vertical: true, m: 0, c: snap((p[0] + q[0]) / 2) };
  const m = (q[1] - p[1]) / (q[0] - p[0]);
  return { vertical: false, m: snap(m), c: snap(p[1] - m * p[0]) };
}

/** "y = −(2/3)x + 1", "x = 2", "y = 0". */
export function lineText(l: LineEq, vx: string, vy: string): string {
  if (l.vertical) return `${vx} = ${num(l.c)}`;
  const mN = nice(l.m, 1e-5);
  const cN = nice(l.c, 1e-5);
  const approx = !mN.exact || !cN.exact;
  const coef = (n: typeof mN) => {
    if (n.text === '1') return '';
    if (n.text === '−1') return '−';
    return n.text.includes('/') ? `${n.text.startsWith('−') ? '−' : ''}(${n.text.replace('−', '')})` : n.text;
  };
  let rhs = '';
  if (mN.text !== '0') rhs = `${coef(mN)}${vx}`;
  if (cN.text !== '0' || !rhs) rhs = rhs ? `${rhs} ${cN.text.startsWith('−') ? '−' : '+'} ${cN.text.replace('−', '')}` : cN.text;
  return `${vy} ${approx ? '≈' : '='} ${rhs}`;
}

/** Splits a polyline where it turns sharply (where two nullcline branches cross). */
function splitCorners(poly: Pt[], xw: Range, yw: Range): Pt[][] {
  const sx = xw[1] - xw[0];
  const sy = yw[1] - yw[0];
  const out: Pt[][] = [];
  let cur: Pt[] = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    cur.push(poly[i]);
    if (i < poly.length - 1) {
      const a = Math.atan2((poly[i][1] - poly[i - 1][1]) / sy, (poly[i][0] - poly[i - 1][0]) / sx);
      const b = Math.atan2((poly[i + 1][1] - poly[i][1]) / sy, (poly[i + 1][0] - poly[i][0]) / sx);
      let d = Math.abs(b - a);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 0.5) {
        out.push(cur);
        cur = [poly[i]];
      }
    }
  }
  out.push(cur);
  return out;
}

const sameLine = (k: LineEq, l: LineEq) =>
  k.vertical === l.vertical && Math.abs(k.m - l.m) < 1e-4 * Math.max(1, Math.abs(l.m)) && Math.abs(k.c - l.c) < 1e-4 * Math.max(1, Math.abs(l.c));

/** Distance (window units) from a point to a line. */
function offLine(p: Pt, l: LineEq, xw: Range, yw: Range): number {
  const sx = xw[1] - xw[0];
  const sy = yw[1] - yw[0];
  if (l.vertical) return Math.abs(p[0] - l.c) / sx;
  const dy = Math.abs(p[1] - (l.m * p[0] + l.c)) / sy;
  return dy / Math.hypot(1, (l.m * sx) / sy);
}

function isShort(poly: Pt[], xw: Range, yw: Range): boolean {
  const [p, q] = [poly[0], poly[poly.length - 1]];
  return Math.hypot((q[0] - p[0]) / (xw[1] - xw[0]), (q[1] - p[1]) / (yw[1] - yw[0])) < 0.05;
}

export function nullclines(spec: PhaseSpec, xw: Range, yw: Range): Nullcline[] {
  return ([0, 1] as const).map((which) => {
    const segments = contour((x, y) => spec.F(x, y)[which], xw, yw);
    const pieces = segments.flatMap((s) => splitCorners(s, xw, yw));
    let lines: LineEq[] | null = pieces.length ? [] : null;
    const short: Pt[][] = [];
    for (const piece of pieces) {
      if (!lines) break;
      // A point cutting the corner where two branches cross may end a piece: allow dropping it.
      const l =
        asLine(piece, xw, yw) ?? asLine(piece.slice(1), xw, yw) ?? asLine(piece.slice(0, -1), xw, yw) ?? asLine(piece.slice(1, -1), xw, yw);
      if (l) {
        if (!lines.some((k) => sameLine(k, l))) lines.push(l);
      } else if (piece.length < 2 || isShort(piece, xw, yw)) short.push(piece);
      else lines = null;
    }
    // Short bits (near a crossing) must lie on one of the lines.
    if (lines) for (const piece of short) if (!piece.every((p) => lines!.some((l) => offLine(p, l, xw, yw) < 0.01))) lines = null;
    if (lines && !lines.length) lines = null;
    return { which, segments, lines };
  });
}

/* ---------------- trajectories ---------------- */

export type Fate =
  | { kind: 'equilibrium'; eq: number }
  | { kind: 'exits'; side: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'closed'; around: number | null; turn: 'clockwise' | 'counterclockwise' }
  | { kind: 'circles'; turn: 'clockwise' | 'counterclockwise' }
  | { kind: 'stops'; at: Pt }
  | { kind: 'stays' };

export interface TrajFacts {
  t: Trajectory;
  /** In time order (backward part reversed, then forward). */
  path: Pt[];
  forward: Fate | null;
  backward: Fate | null;
}

/**
 * Integrates along the direction field with RK4, in steps of a fixed length on screen
 * (time steps adapt to the speed), so slow and fast parts are drawn equally well.
 */
function integrate(spec: PhaseSpec, start: Pt, sign: 1 | -1, xw: Range, yw: Range, eqs: Pt[]): { pts: Pt[]; fate: Fate } {
  const sx = xw[1] - xw[0];
  const sy = yw[1] - yw[0];
  const ds = 1 / 350;
  const V = (p: Pt): Pt => {
    const [f, g] = spec.F(p[0], p[1]);
    return [sign * f, sign * g];
  };
  const speed = (v: Pt) => Math.hypot(v[0] / sx, v[1] / sy);
  const nearEq = (p: Pt) => eqs.findIndex((e) => Math.hypot((p[0] - e[0]) / sx, (p[1] - e[1]) / sy) < 0.004);
  const inside = (p: Pt, m: number) => p[0] >= xw[0] - m * sx && p[0] <= xw[1] + m * sx && p[1] >= yw[0] - m * sy && p[1] <= yw[1] + m * sy;
  const pts: Pt[] = [start];
  let p = start;
  let length = 0;
  let turning = 0;
  let prevDir: number | null = null;
  const startEq = nearEq(start);
  for (let k = 0; k < 8000; k++) {
    const v1 = V(p);
    const s = speed(v1);
    if (!Number.isFinite(s)) return { pts, fate: { kind: 'stops', at: p } };
    if (s < 1e-12) {
      const e = nearEq(p);
      return { pts, fate: e >= 0 ? { kind: 'equilibrium', eq: e } : { kind: 'stops', at: p } };
    }
    const h = Math.min(ds / s, 50);
    const add = (q: Pt, v: Pt, c: number): Pt => [q[0] + c * v[0], q[1] + c * v[1]];
    const v2 = V(add(p, v1, h / 2));
    const v3 = V(add(p, v2, h / 2));
    const v4 = V(add(p, v3, h));
    const next: Pt = [p[0] + (h / 6) * (v1[0] + 2 * v2[0] + 2 * v3[0] + v4[0]), p[1] + (h / 6) * (v1[1] + 2 * v2[1] + 2 * v3[1] + v4[1])];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return { pts, fate: { kind: 'stops', at: p } };
    const step = Math.hypot((next[0] - p[0]) / sx, (next[1] - p[1]) / sy);
    const dir = Math.atan2((next[1] - p[1]) / sy, (next[0] - p[0]) / sx);
    if (prevDir !== null) {
      let dθ = dir - prevDir;
      while (dθ > Math.PI) dθ -= 2 * Math.PI;
      while (dθ < -Math.PI) dθ += 2 * Math.PI;
      turning += dθ;
    }
    prevDir = dir;
    length += step;
    p = next;
    pts.push(p);
    if (!inside(p, 0.05)) {
      // Which edge it crossed last.
      const q = pts[pts.length - 2];
      const exitT = (lo: number, hi: number, a: number, b: number) => (a < lo ? (lo - a) / (b - a) : a > hi ? (hi - a) / (b - a) : Infinity);
      const tx = p[0] < xw[0] ? exitT(xw[0], xw[1], q[0], p[0]) : p[0] > xw[1] ? exitT(xw[0], xw[1], q[0], p[0]) : Infinity;
      const ty = p[1] < yw[0] ? exitT(yw[0], yw[1], q[1], p[1]) : p[1] > yw[1] ? exitT(yw[0], yw[1], q[1], p[1]) : Infinity;
      const side = Math.abs(tx) <= Math.abs(ty) ? (p[0] < xw[0] ? 'left' : 'right') : p[1] < yw[0] ? 'bottom' : 'top';
      return { pts, fate: { kind: 'exits', side } };
    }
    const e = nearEq(p);
    if (e >= 0 && (e !== startEq || length > 0.05)) {
      pts.push(eqs[e]);
      return { pts, fate: { kind: 'equilibrium', eq: e } };
    }
    // Back at the start, heading the same way: a closed orbit.
    if (length > 30 * ds && Math.hypot((p[0] - start[0]) / sx, (p[1] - start[1]) / sy) < 1.2 * ds && Math.abs(turning) > Math.PI) {
      pts.push(start);
      return { pts, fate: { kind: 'closed', around: null, turn: turning > 0 ? 'counterclockwise' : 'clockwise' } };
    }
  }
  if (Math.abs(turning) >= 4 * Math.PI) return { pts, fate: { kind: 'circles', turn: turning > 0 ? 'counterclockwise' : 'clockwise' } };
  return { pts, fate: { kind: 'stays' } };
}

function flipTurn(f: Fate): Fate {
  // Integrated backward, rotation is seen reversed; report it in forward time.
  if (f.kind === 'closed' || f.kind === 'circles') return { ...f, turn: f.turn === 'clockwise' ? 'counterclockwise' : 'clockwise' };
  return f;
}

/** Whether a closed polygon winds around a point (ray casting). */
function encloses(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function trajectory(spec: PhaseSpec, t: Trajectory, xw: Range, yw: Range, eqs: Pt[]): TrajFacts {
  let forward: Fate | null = null;
  let backward: Fate | null = null;
  let fwd: Pt[] = [t.start];
  let bwd: Pt[] = [t.start];
  if (t.direction !== 'backward') ({ pts: fwd, fate: forward } = integrate(spec, t.start, 1, xw, yw, eqs));
  if (forward?.kind === 'closed') {
    const around = eqs.findIndex((e) => encloses(fwd, e));
    return { t, path: fwd, forward: { ...forward, around: around >= 0 ? around : null }, backward: null };
  }
  if (t.direction !== 'forward') {
    const r = integrate(spec, t.start, -1, xw, yw, eqs);
    bwd = r.pts;
    backward = flipTurn(r.fate);
    if (backward.kind === 'closed') {
      const around = eqs.findIndex((e) => encloses(bwd, e));
      return { t, path: [...bwd].reverse(), forward: { ...backward, around: around >= 0 ? around : null }, backward: null };
    }
  }
  return { t, path: [...[...bwd].reverse(), ...fwd.slice(1)], forward, backward };
}

/* ---------------- windows, facts ---------------- */

export interface PhaseFacts {
  kind: 'phase';
  spec: PhaseSpec;
  xWindow: Range;
  yWindow: Range;
  equilibria: Equilibrium[];
  linear: boolean;
  nullclines: Nullcline[];
  trajectories: TrajFacts[];
}

/** Given, or framing the equilibria and starting points at equal scale. */
export function phaseWindows(spec: PhaseSpec): { x: Range; y: Range } {
  if (spec.window.x && spec.window.y) return { x: spec.window.x, y: spec.window.y };
  const search: Range = [-10, 10];
  const eqs = findEquilibria(spec.F, spec.window.x ?? search, spec.window.y ?? search).filter(
    (e) => Math.abs(e[0]) <= 6 && Math.abs(e[1]) <= 6,
  );
  const pts = [...eqs, ...spec.trajectories.map((t) => t.start), ...spec.points.map((p): Pt => [p.x, p.y])];
  // Centred on the equilibria (else on the marked points), with room around everything.
  const box = (k: 0 | 1, given: Range | null): Range => {
    if (given) return given;
    const around = eqs.length ? eqs : pts.length ? pts : [[0, 0] as Pt];
    const vs = around.map((p) => p[k]);
    const mid = (Math.min(...vs) + Math.max(...vs)) / 2;
    const half = Math.max(2, ...pts.map((p) => Math.abs(p[k] - mid) + 1));
    return niceRange(mid - half, mid + half);
  };
  let x = box(0, spec.window.x);
  let y = box(1, spec.window.y);
  // Rounded outward to half the tick step, so the scales are nearly (not exactly)
  // equal and the window's ends stay round numbers.
  const widen = (r: Range, span: number): Range => {
    const mid = (r[0] + r[1]) / 2;
    const step = niceTicks(mid - span / 2, mid + span / 2, 6).step / 2;
    return [Math.floor((mid - span / 2) / step + 1e-9) * step, Math.ceil((mid + span / 2) / step - 1e-9) * step];
  };
  const want = (y[1] - y[0]) * PLOT_ASPECT;
  if (!spec.window.x && x[1] - x[0] < want) x = widen(x, want);
  else if (!spec.window.y && (x[1] - x[0]) / PLOT_ASPECT > y[1] - y[0]) y = widen(y, (x[1] - x[0]) / PLOT_ASPECT);
  return { x, y };
}

function isLinear(spec: PhaseSpec, xw: Range, yw: Range): boolean {
  const J0 = jacobian(spec.F, (xw[0] + xw[1]) / 2, (yw[0] + yw[1]) / 2);
  for (const [u, w] of [[0.13, 0.71], [0.87, 0.29], [0.41, 0.93], [0.66, 0.08]]) {
    const J = jacobian(spec.F, xw[0] + u * (xw[1] - xw[0]), yw[0] + w * (yw[1] - yw[0]));
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (Math.abs(J[i][j] - J0[i][j]) > 1e-6 * (1 + Math.abs(J0[i][j]))) return false;
  }
  return true;
}

export function analyzePhase(spec: PhaseSpec, xw: Range, yw: Range): PhaseFacts | string {
  const linear = isLinear(spec, xw, yw);
  if (linear) {
    // F(p) = J p + F0. With det J = 0 there is either no equilibrium (fine) or a whole
    // line (or plane) of them, which isn't supported.
    const J = jacobian(spec.F, 0, 0);
    const scale = Math.abs(J[0][0]) + Math.abs(J[0][1]) + Math.abs(J[1][0]) + Math.abs(J[1][1]);
    if (Math.abs(J[0][0] * J[1][1] - J[0][1] * J[1][0]) <= 1e-12 * (1 + scale) ** 2) {
      const F0 = spec.F(0, 0);
      const col: Pt = Math.hypot(J[0][0], J[1][0]) >= Math.hypot(J[0][1], J[1][1]) ? [J[0][0], J[1][0]] : [J[0][1], J[1][1]];
      const f0 = Math.hypot(...F0);
      const solvable = scale < 1e-12 ? f0 < 1e-12 : Math.abs(col[0] * F0[1] - col[1] * F0[0]) <= 1e-9 * Math.hypot(...col) * (1 + f0);
      if (solvable)
        return 'Every point on a line (or the whole plane) is an equilibrium here; that isn’t supported yet. Keep the cropped image for this figure.';
    }
  }
  const pts = findEquilibria(spec.F, xw, yw);
  const equilibria = pts.map((at): Equilibrium => {
    const J = jacobian(spec.F, ...at);
    const ev = eigen(J);
    return { at, J, eigen: ev, type: classify(J, ev) };
  });
  const ncl = spec.show.has('nullclines') ? nullclines(spec, xw, yw) : [];
  const trajectories = spec.trajectories.map((t) => trajectory(spec, t, xw, yw, pts));
  return { kind: 'phase', spec, xWindow: xw, yWindow: yw, equilibria, linear, nullclines: ncl, trajectories };
}

/* ---------------- alt text ---------------- */

const article = (s: string) => (/^[aeiou]/.test(s) ? 'an' : 'a');

/** "the stable node at (0, 0)", or "the origin, a stable node". */
function eqName(e: Equilibrium): string {
  return `the ${e.type} at ${pt(...e.at)}`;
}

/** Line through p in direction v. */
function lineThrough(p: Pt, v: Pt): LineEq {
  if (Math.abs(v[0]) < 1e-9) return { vertical: true, m: 0, c: p[0] };
  const m = v[1] / v[0];
  const snap = (z: number) => (nice(z, 1e-6).exact ? Math.round(z * 1e6) / 1e6 : z);
  return { vertical: false, m: snap(m), c: snap(p[1] - m * p[0]) };
}

/** What is said about an equilibrium after its coordinates. */
function eqDetails(e: Equilibrium, f: PhaseFacts, plural: boolean): string {
  const [vx, vy] = f.spec.names;
  let s = plural ? `${e.type}s` : `${article(e.type)} ${e.type}`;
  if (e.type === 'degenerate') s += ' (an eigenvalue is 0, so the linearization doesn’t decide its type)';
  else s += ` (eigenvalues ${e.eigen.text})`;
  if (e.type === 'center' && !f.linear)
    s = s.replace(/^(a center|centers)/, (w) => `${w} of the linearization`) + '; the nonlinear terms decide whether nearby orbits close up';
  if (e.type.includes('spiral') || e.type === 'center') {
    const turn = e.J[1][0] > 0 ? 'counterclockwise' : 'clockwise';
    s += `; nearby trajectories turn ${turn}`;
  }
  if (f.spec.show.has('eigenvectors') && e.eigen.vectors.length === 2) {
    const [slow, fast] = Math.abs(e.eigen.values[0].re) <= Math.abs(e.eigen.values[1].re) ? [0, 1] : [1, 0];
    const L = (i: number) => `the line ${lineText(lineThrough(e.at, e.eigen.vectors[i]), vx, vy)}`;
    if (e.type === 'saddle') {
      const st = e.eigen.values[0].re < 0 ? 0 : 1;
      s += `; it attracts along ${L(st)} and repels along ${L(1 - st)}`;
    } else if (e.type === 'stable node') s += `; nearby trajectories approach it tangent to ${L(slow)}, except those along ${L(fast)}`;
    else if (e.type === 'unstable node') s += `; nearby trajectories leave it tangent to ${L(slow)}, except those along ${L(fast)}`;
  }
  return s;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** Equilibria, grouping those described identically (the pendulum's centers). */
function describeEquilibria(f: PhaseFacts): string {
  const eqs = f.equilibria;
  if (eqs.length === 1) return `One equilibrium, at ${pt(...eqs[0].at)}: ${eqDetails(eqs[0], f, false)}.`;
  const groups = new Map<string, Equilibrium[]>();
  for (const e of eqs) {
    const key = eqDetails(e, f, false);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const parts = [...groups.values()].map((g) =>
    g.length === 1 ? `${pt(...g[0].at)}, ${eqDetails(g[0], f, false)}` : `${list(g.map((e) => pt(...e.at)))}, ${eqDetails(g[0], f, true)}`,
  );
  return `${WORDS[eqs.length] ?? eqs.length} equilibria: ${parts.join('; ')}.`;
}

function fateText(fate: Fate, f: PhaseFacts, forward: boolean): string {
  const eqs = f.equilibria;
  switch (fate.kind) {
    case 'equilibrium':
      return forward ? `approaches ${eqName(eqs[fate.eq])}` : `comes out of ${eqName(eqs[fate.eq])}`;
    case 'exits':
      return forward ? `leaves the window across the ${fate.side} edge` : `enters the window across the ${fate.side} edge`;
    case 'circles':
      return forward ? `keeps circling ${fate.turn} without settling` : `has been circling ${fate.turn}`;
    case 'stops':
      return forward ? `stops at ${pt(...fate.at)}, where the system is not defined` : `starts where the system is not defined, near ${pt(...fate.at)}`;
    case 'stays':
      return forward ? 'stays inside the window' : 'has been inside the window';
    case 'closed':
      return 'is a closed loop';
  }
}

export function describePhase(f: PhaseFacts): { short: string; long: string } {
  const { spec } = f;
  const [vx, vy] = spec.names;
  const system = `${vx}′ = ${spec.text[0]}, ${vy}′ = ${spec.text[1]}`;
  const short = `Phase plane for ${system}.`;
  const parts: string[] = [
    `Horizontal axis ${spec.axes.x} from ${num(f.xWindow[0])} to ${num(f.xWindow[1])}; vertical axis ${spec.axes.y} from ${num(f.yWindow[0])} to ${num(f.yWindow[1])}.`,
  ];
  if (spec.show.has('field')) parts.push('Short arrows across the plane show the direction of motion.');

  if (spec.show.has('equilibria')) {
    const eqs = f.equilibria;
    if (!eqs.length) parts.push('There is no equilibrium in the window.');
    else parts.push(describeEquilibria(f));
    if (eqs.length) parts.push('Equilibria are drawn as dots: filled when stable, open when unstable.');
  } else if (spec.show.has('eigenvectors') && f.equilibria.length) {
    parts.push(`Eigen-directions are drawn at ${list(f.equilibria.map((e) => pt(...e.at)))}.`);
  }

  for (const n of f.nullclines) {
    const v = n.which ? vy : vx;
    const style = n.which ? 'dotted' : 'dashed';
    if (!n.segments.length) parts.push(`${v}′ is never 0 in the window.`);
    else if (n.lines)
      parts.push(
        `The ${v}-nullcline (where ${v}′ = 0, ${style}) is ${n.lines.length === 1 ? 'the line' : 'the lines'} ${list(n.lines.map((l) => lineText(l, vx, vy)))}.`,
      );
    else parts.push(`The ${v}-nullcline (where ${v}′ = 0) is drawn ${style}.`);
  }

  const tr = f.trajectories;
  if (tr.length) {
    const sentences = tr.map((t) => {
      const head = `${tr.length === 1 ? 'The trajectory' : `Trajectory ${t.t.n}`} through ${pt(...t.t.start)}${t.t.label ? ` (${t.t.label})` : ''}`;
      if (t.forward?.kind === 'closed') {
        const around = t.forward.around !== null ? ` around ${eqName(f.equilibria[t.forward.around])}` : '';
        return `${head} is a closed loop${around}, traversed ${t.forward.turn}.`;
      }
      const bits: string[] = [];
      if (t.backward) bits.push(fateText(t.backward, f, false));
      if (t.forward) bits.push(fateText(t.forward, f, true));
      return `${head} ${bits.join(' and ')}.`;
    });
    parts.push(...sentences);
  }
  parts.push(...describeMarks(spec));
  return { short, long: parts.join(' ') };
}

/* ---------------- geometry helper for drawing ---------------- */

/** The part of the line through p with direction v that lies in the window. */
export function clipLine(p: Pt, v: Pt, xw: Range, yw: Range): [Pt, Pt] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, d, lo, hi] of [
    [p[0], v[0], xw[0], xw[1]],
    [p[1], v[1], yw[0], yw[1]],
  ]) {
    if (Math.abs(d) < 1e-15) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t1 > t0)) return null;
  return [
    [p[0] + t0 * v[0], p[1] + t0 * v[1]],
    [p[0] + t1 * v[0], p[1] + t1 * v[1]],
  ];
}
