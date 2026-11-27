/**
 * Region between curves (2.2 dev).
 *
 *   {
 *     "kind": "region",
 *     "from": "A = \\int_0^1 (\\sqrt{x} - x^2)\\,dx",
 *     "top": "sqrt(x)", "bottom": "x^2",        // vertical slices (dir "dx", the default)
 *     "between": "intersections",                // or [a, b]
 *     "slice": { "at": 0.6, "label": "Δx" },
 *     "markIntersections": true, "area": true
 *   }
 *
 * - dir "dx": boundaries are y = top(x) and y = bottom(x); bottom defaults to 0 (the axis).
 * - dir "dy": boundaries are x = right(y) and x = left(y); left defaults to 0. Using
 *   left/right without top/bottom implies "dy".
 * - Each boundary is an expression or { "expr": …, "label": "y = √x" }.
 * - between: [a, b] in the independent variable, or "intersections" (the default): the
 *   first and last places the boundaries meet, searched over the window (or −10 to 10).
 * - If the curves cross inside the region, the region still lies between them; the
 *   alt text says where the upper (or right) curve changes.
 * - window is optional: by default it frames the region with a margin.
 * - "area": true adds the computed area to the alt text. It is off by default because
 *   a figure in a worksheet shouldn't give the answer away.
 */
import { bisect } from './analyze.ts';
import {
  COMMON_FIELDS,
  compileExpr,
  isNum,
  isObj,
  pair,
  parseCommon,
  parsePoints,
  str,
  warnUnknown,
  type Common,
  type Compiled1,
  type Messages,
  type Obj,
  type Range,
} from './common.ts';
import { describeMarks, list, num, pt } from './describe.ts';
import { autoY, sampleFn, type Pt } from './sample.ts';
import { nice, niceRange, say } from './nice.ts';

export type Dir = 'dx' | 'dy';
export type Role = 'top' | 'bottom' | 'left' | 'right';

export interface Boundary extends Compiled1 {
  role: Role;
  label: string | null;
}

export interface RegionSpec extends Common {
  kind: 'region';
  dir: Dir;
  /** Upper boundary (dx) or right boundary (dy), as written. */
  hi: Boundary;
  /** Lower (dx) or left (dy). */
  lo: Boundary;
  /** The region's extent in the independent variable. */
  a: number;
  b: number;
  between: 'intersections' | 'given';
  /** Every place in [a, b] where the boundaries meet (including a and b when they do). */
  meets: number[];
  /** Places inside (a, b) where the boundaries cross (the upper one changes). */
  swaps: number[];
  slice: { at: number; width: number; label: string | null } | null;
  markIntersections: boolean;
  showArea: boolean;
}

const REGION_FIELDS = [...COMMON_FIELDS, 'dir', 'top', 'bottom', 'left', 'right', 'between', 'slice', 'markIntersections', 'area'];
const SEARCH: Range = [-10, 10];

/** f, but at an end of [a, b] where f is undefined, its one-sided limit (ln x at 0 stays undefined). */
function safe(f: (x: number) => number, a: number, b: number): (x: number) => number {
  const h = (b - a) * 1e-9;
  return (x) => {
    const y = f(x);
    if (Number.isFinite(y)) return y;
    if (Math.abs(x - a) < h * 10) return f(a + h);
    if (Math.abs(x - b) < h * 10) return f(b - h);
    return y;
  };
}

/** Where h = 0 in [lo, hi]: sign changes (not poles) and touching zeros. */
export function findMeets(h: (x: number) => number, lo: number, hi: number): number[] {
  const N = 2000;
  const xs: number[] = [];
  const hs: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N;
    xs.push(x);
    hs.push(h(x));
  }
  let scale = 0;
  for (const v of hs) if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v));
  const small = (v: number, rel: number) => Math.abs(v) <= rel * (1 + Math.min(scale, 1e6));
  const roots: number[] = [];
  for (let i = 0; i <= N; i++) {
    const y = hs[i];
    if (!Number.isFinite(y)) continue;
    if (y === 0) {
      roots.push(xs[i]);
      continue;
    }
    const yp = hs[i - 1];
    if (i > 0 && Number.isFinite(yp) && yp !== 0 && Math.sign(yp) !== Math.sign(y)) {
      const r = bisect(h, xs[i - 1], xs[i]);
      if (small(h(r), 1e-6)) roots.push(r); // not a pole like tan's
    }
    // A touching zero: |h| dips to ~0 without changing sign.
    const yn = hs[i + 1];
    if (i > 0 && i < N && Number.isFinite(yp) && Number.isFinite(yn) && Math.abs(y) < Math.abs(yp) && Math.abs(y) <= Math.abs(yn)) {
      if (Math.sign(yp) === Math.sign(y) && Math.sign(yn) === Math.sign(y)) {
        let p = xs[i - 1];
        let q = xs[i + 1];
        for (let k = 0; k < 120; k++) {
          const m1 = p + (q - p) / 3;
          const m2 = q - (q - p) / 3;
          if (Math.abs(h(m1)) < Math.abs(h(m2))) q = m2;
          else p = m1;
        }
        const r = (p + q) / 2;
        if (small(h(r), 1e-9)) roots.push(r);
      }
    }
  }
  // The ends themselves, when h is zero there up to rounding (√2 is never hit exactly).
  for (const i of [0, N]) if (Number.isFinite(hs[i]) && small(hs[i], 1e-9)) roots.push(xs[i]);
  const tol = (hi - lo) * 1e-7;
  return roots.sort((p, q) => p - q).filter((x, i, arr) => i === 0 || x - arr[i - 1] > tol);
}

export function checkRegion(raw: Obj, m: Messages): RegionSpec | null {
  warnUnknown(raw, REGION_FIELDS, m);
  const has = (k: string) => raw[k] !== undefined;
  let dir: Dir;
  if (raw.dir === 'dx' || raw.dir === 'dy') dir = raw.dir;
  else {
    if (raw.dir !== undefined) m.errors.push('dir must be "dx" (vertical slices) or "dy" (horizontal slices).');
    dir = (has('left') || has('right')) && !has('top') && !has('bottom') ? 'dy' : 'dx';
  }
  const [hiRole, loRole]: [Role, Role] = dir === 'dx' ? ['top', 'bottom'] : ['right', 'left'];
  const wrong = dir === 'dx' ? ['left', 'right'] : ['top', 'bottom'];
  for (const k of wrong)
    if (has(k))
      m.errors.push(
        dir === 'dx'
          ? `${k}: left/right are for horizontal slices; use top/bottom, or set "dir": "dy".`
          : `${k}: top/bottom are for vertical slices; use left/right, or set "dir": "dx".`,
      );

  const common = parseCommon(raw, m, dir === 'dx' ? 'x' : 'y');
  const v = common.v;

  const boundary = (role: Role, dflt: string | null): Boundary | null => {
    const r = raw[role];
    if (r === undefined && dflt === null) {
      m.errors.push(`${role}: give the ${role} boundary as an expression in ${v}.`);
      return null;
    }
    const src = r === undefined ? dflt : isObj(r) ? r.expr : r;
    const c = compileExpr(src, v, role, m, common.params);
    return c ? { ...c, role, label: isObj(r) ? str(r.label) : null } : null;
  };
  let hi = boundary(hiRole, null);
  let lo = boundary(loRole, '0');
  if (!hi || !lo) return null;

  /* the extent */
  const indepWin = dir === 'dx' ? common.window.x : common.window.y;
  const h0 = (x: number) => hi!.f(x) - lo!.f(x);
  let a: number;
  let b: number;
  let between: RegionSpec['between'];
  if (raw.between === undefined || raw.between === 'intersections') {
    between = 'intersections';
    const [s0, s1] = indepWin ?? SEARCH;
    const found = findMeets(h0, s0, s1);
    if (found.length < 2) {
      m.errors.push(
        `between: found ${found.length ? 'only one place' : 'no place'} where ${hiRole} and ${loRole} meet for ${v} from ${s0} to ${s1}. ` +
          `Give "between": [a, b]${indepWin ? '' : `, or a window.${dir === 'dx' ? 'x' : 'y'} to search`}.`,
      );
      return null;
    }
    [a, b] = [found[0], found[found.length - 1]];
  } else {
    const p = pair(raw.between);
    if (!p) {
      m.errors.push('between must be [a, b] with a < b, or "intersections".');
      return null;
    }
    between = 'given';
    [a, b] = p;
  }

  // Both boundaries must be defined across the region.
  for (const bd of [hi, lo]) {
    for (let k = 1; k < 200; k++) {
      const x = a + ((b - a) * k) / 200;
      if (!Number.isFinite(bd.f(x))) {
        m.errors.push(`${bd.role}: not defined everywhere for ${v} from ${say(a)} to ${say(b)} (for example at ${v} = ${say(x)}).`);
        return null;
      }
    }
  }
  // …and without a vertical asymptote inside (1/x on [−1, 1.01] has finite samples).
  for (const bd of [hi, lo]) {
    const yr = autoY([bd.f], [a, b]);
    const pole = sampleFn(safe(bd.f, a, b), [a, b], yr).breaks.find((br) => br.kind === 'blowup');
    if (pole) {
      m.errors.push(`${bd.role}: has a vertical asymptote at ${v} = ${say(pole.x)}, inside the region.`);
      return null;
    }
  }
  const hiF = safe(hi.f, a, b);
  const loF = safe(lo.f, a, b);
  const h = (x: number) => hiF(x) - loF(x);

  const span = b - a;
  const meets = findMeets(h, a, b).map((x) => (Math.abs(x - a) < span * 1e-7 ? a : Math.abs(x - b) < span * 1e-7 ? b : x));
  const d = span * 1e-6;
  const swaps = meets.filter((x) => x > a + d && x < b - d && Math.sign(h(x - d)) * Math.sign(h(x + d)) < 0);

  // Written the other way round everywhere: swap, so "top" really is on top.
  // (Judged by the signed area of each part: a midpoint can be a touching zero.)
  const cuts = [a, ...swaps, b];
  const signs = cuts.slice(1).map((q, i) => Math.sign(integrate(h, cuts[i], q)));
  if (signs.every((s) => s < 0)) {
    m.warnings.push(`“${hiRole}” (${hi.text}) is ${dir === 'dx' ? 'below' : 'left of'} “${loRole}” (${lo.text}) everywhere in the region, so they were swapped.`);
    [hi, lo] = [{ ...lo, role: hiRole }, { ...hi, role: loRole }];
  }

  /* slice */
  let slice: RegionSpec['slice'] = null;
  if (raw.slice !== undefined) {
    const s = raw.slice;
    if (!isObj(s) || !isNum(s.at)) m.errors.push('slice: give "at": a number.');
    else if (s.at <= a || s.at >= b) m.errors.push(`slice: ${v} = ${s.at} is outside the region (${say(a)} to ${say(b)}).`);
    else {
      const width = isNum(s.width) && s.width > 0 ? Math.min(s.width, span / 2) : span / 24;
      slice = { at: s.at, width, label: str(s.label) };
    }
  }

  /* points: "on": { "curve": "top", "at": t } */
  const hiB = hi;
  const loB = lo;
  const points = parsePoints(
    raw.points,
    (ref, t) => {
      const bd = ref === hiB.role ? hiB : ref === loB.role ? loB : null;
      if (!bd) return `"curve" must be "${hiRole}" or "${loRole}".`;
      const y = bd.f(t);
      if (!Number.isFinite(y)) return `${bd.role} has no value at ${v} = ${t}.`;
      return dir === 'dx' ? [t, y] : [y, t];
    },
    m,
  );

  return {
    kind: 'region',
    ...common,
    points,
    dir,
    hi,
    lo,
    a,
    b,
    between,
    meets,
    swaps,
    slice,
    markIntersections: raw.markIntersections === true,
    showArea: raw.area === true,
  };
}

/* ---------------- analysis ---------------- */

export interface RegionPiece {
  from: number;
  to: number;
  upper: Boundary;
  lower: Boundary;
  area: number;
}

export interface RegionFacts {
  kind: 'region';
  spec: RegionSpec;
  xWindow: Range;
  yWindow: Range;
  /** The shaded region's outline (x, y). */
  polygon: Pt[];
  /** Boundaries across the whole window, for drawing (x, y); the axis (constant 0) is left out. */
  boundaries: { b: Boundary; segments: Pt[][] }[];
  pieces: RegionPiece[];
  area: number;
  /** Where the boundaries meet, as (x, y) points. */
  meetPoints: Pt[];
  /** Straight sides at a or b (x, y), where the region has height there. */
  edges: { at: number; from: Pt; to: Pt }[];
  strip: { rect: [Pt, Pt]; from: Pt; to: Pt; lower: Boundary; upper: Boundary } | null;
}

/** Adaptive Simpson; accurate to ~1e-10 for smooth integrands. */
export function integrate(f: (x: number) => number, a: number, b: number): number {
  const simpson = (fa: number, fm: number, fb: number, w: number) => (w / 6) * (fa + 4 * fm + fb);
  const rec = (a0: number, b0: number, fa: number, fm: number, fb: number, whole: number, eps: number, depth: number): number => {
    const m = (a0 + b0) / 2;
    const lm = (a0 + m) / 2;
    const rm = (m + b0) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(fa, flm, fm, m - a0);
    const right = simpson(fm, frm, fb, b0 - m);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return rec(a0, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b0, fm, frm, fb, right, eps / 2, depth - 1);
  };
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  return rec(a, b, fa, fm, fb, simpson(fa, fm, fb, b - a), 1e-12, 48);
}

/** The window: as given, or framing the region with a margin. */
export function regionWindows(spec: RegionSpec): { x: Range; y: Range } {
  const span = spec.b - spec.a;
  const given = spec.dir === 'dx' ? spec.window.x : spec.window.y;
  const indep = given ?? niceRange(spec.a - 0.1 * span, spec.b + 0.1 * span);
  const dGiven = spec.dir === 'dx' ? spec.window.y : spec.window.x;
  const at = (x: number) => [spec.hi.f(x), spec.lo.f(x)];
  const extra = [...at(spec.a), ...at(spec.b), ...at((spec.a + spec.b) / 2)].filter(Number.isFinite);
  // Frame the region itself; the boundary curves run on beyond it and are clipped.
  const dep = dGiven ?? autoY([safe(spec.hi.f, spec.a, spec.b), safe(spec.lo.f, spec.a, spec.b)], [spec.a, spec.b], extra);
  return spec.dir === 'dx' ? { x: indep, y: dep } : { x: dep, y: indep };
}

export function analyzeRegion(spec: RegionSpec, xWindow: Range, yWindow: Range): RegionFacts {
  const dx = spec.dir === 'dx';
  const [iw, dw] = dx ? [xWindow, yWindow] : [yWindow, xWindow];
  const toXY = (p: Pt): Pt => (dx ? p : [p[1], p[0]]);
  const { a, b } = spec;
  const hiF = safe(spec.hi.f, a, b);
  const loF = safe(spec.lo.f, a, b);

  const boundaries = [spec.hi, spec.lo]
    .filter((bd) => !(bd.constant && bd.f(0) === 0))
    .map((bd) => ({ b: bd, segments: sampleFn(bd.f, iw, dw).segments.map((s) => s.map(toXY)) }));

  const run = (f: (x: number) => number) => sampleFn(f, [a, b], dw).segments.flat();
  const top = run(hiF);
  const bottom = run(loF).reverse();
  const polygon = [...top, ...bottom].map(toXY);

  const cuts = [a, ...spec.swaps, b];
  const pieces: RegionPiece[] = cuts.slice(1).map((to, i) => {
    const from = cuts[i];
    const signed = integrate((x) => hiF(x) - loF(x), from, to);
    const [upper, lower] = signed >= 0 ? [spec.hi, spec.lo] : [spec.lo, spec.hi];
    return { from, to, upper, lower, area: Math.abs(signed) };
  });
  const area = pieces.reduce((s, p) => s + p.area, 0);

  const meetPoints = spec.meets.map((t) => toXY([t, hiF(t)]));
  const tiny = (dw[1] - dw[0]) * 1e-6;
  const edges = [a, b]
    .filter((t) => Math.abs(hiF(t) - loF(t)) > tiny)
    .map((t) => ({ at: t, from: toXY([t, Math.min(hiF(t), loF(t))]), to: toXY([t, Math.max(hiF(t), loF(t))]) }));

  let strip: RegionFacts['strip'] = null;
  if (spec.slice) {
    const { at, width } = spec.slice;
    const piece = pieces.find((p) => at >= p.from && at <= p.to) ?? pieces[0];
    const lowV = piece.lower === spec.hi ? hiF(at) : loF(at);
    const upV = piece.upper === spec.hi ? hiF(at) : loF(at);
    strip = {
      rect: [toXY([at - width / 2, lowV]), toXY([at + width / 2, upV])],
      from: toXY([at, lowV]),
      to: toXY([at, upV]),
      lower: piece.lower,
      upper: piece.upper,
    };
  }
  return { kind: 'region', spec, xWindow, yWindow, polygon, boundaries, pieces, area, meetPoints, edges, strip };
}

/* ---------------- alt text ---------------- */

/** "y = √x" style name, the label as written, or "the x-axis" for a 0 boundary. */
export function boundaryName(bd: Boundary, spec: RegionSpec): string {
  if (bd.label) return bd.label;
  if (bd.constant && bd.f(0) === 0) return `the ${spec.v}-axis`;
  const dx = spec.dir === 'dx';
  const dAxis = dx ? spec.axes.y : spec.axes.x;
  const dep = /^[A-Za-z]$/.test(dAxis) ? dAxis : dx ? 'y' : 'x';
  return `${dep} = ${bd.text}`;
}

export function describeRegion(f: RegionFacts): { short: string; long: string } {
  const { spec } = f;
  const v = spec.v;
  const dx = spec.dir === 'dx';
  const name = (bd: Boundary) => boundaryName(bd, spec);
  const short = `Region between ${name(spec.hi)} and ${name(spec.lo)} for ${v} from ${num(spec.a)} to ${num(spec.b)}.`;

  const parts: string[] = [
    `Horizontal axis ${spec.axes.x} from ${num(f.xWindow[0])} to ${num(f.xWindow[1])}; ` +
      `vertical axis ${spec.axes.y} from ${num(f.yWindow[0])} to ${num(f.yWindow[1])}.`,
  ];
  const extent = `for ${v} from ${num(spec.a)} to ${num(spec.b)}`;
  if (!spec.swaps.length) {
    parts.push(
      dx
        ? `The shaded region lies below ${name(spec.hi)} and above ${name(spec.lo)}, ${extent}.`
        : `The shaded region lies to the left of ${name(spec.hi)} and to the right of ${name(spec.lo)}, ${extent}.`,
    );
  } else {
    parts.push(`The shaded region lies between ${name(spec.hi)} and ${name(spec.lo)}, ${extent}.`);
    const where = dx ? 'on top' : 'on the right';
    const ranges = f.pieces.map((p, i) => `${i ? '' : `${name(p.upper)} is ${where} `}${i ? `${name(p.upper)} ` : ''}for ${num(p.from)} < ${v} < ${num(p.to)}`);
    parts.push(
      `The curves cross at ${v} = ${list(spec.swaps.map(num))}, so the ${dx ? 'upper' : 'right-hand'} curve changes: ${list(ranges)}.`,
    );
  }
  if (f.meetPoints.length) parts.push(`The curves meet at ${list(f.meetPoints.map((p) => pt(...p)))}.`);
  if (f.edges.length) {
    const sides = dx ? ['left', 'right'] : ['bottom', 'top'];
    const kind = dx ? 'vertical' : 'horizontal';
    if (f.edges.length === 2)
      parts.push(`Its ${sides[0]} and ${sides[1]} sides are the ${kind} lines ${v} = ${num(f.edges[0].at)} and ${v} = ${num(f.edges[1].at)}.`);
    else parts.push(`Its ${f.edges[0].at === spec.a ? sides[0] : sides[1]} side is the ${kind} line ${v} = ${num(f.edges[0].at)}.`);
  }
  if (f.strip && spec.slice) {
    const s = f.strip;
    const size = spec.slice.label ? ` of ${dx ? 'width' : 'height'} ${spec.slice.label}` : '';
    parts.push(
      dx
        ? `A thin vertical strip${size} is drawn at ${v} = ${num(spec.slice.at)}, reaching from ${pt(...s.from)} on ${name(s.lower)} up to ${pt(...s.to)} on ${name(s.upper)}.`
        : `A thin horizontal strip${size} is drawn at ${v} = ${num(spec.slice.at)}, reaching from ${pt(...s.from)} on ${name(s.lower)} across to ${pt(...s.to)} on ${name(s.upper)}.`,
    );
  }
  if (spec.showArea) parts.push(`The shaded area is ${say(f.area)}.`);
  parts.push(...describeMarks(spec));
  return { short, long: parts.join(' ') };
}

/** Intersection dots added by "markIntersections": true. */
export function intersectionMarks(f: RegionFacts): Common['points'] {
  return f.meetPoints.map(([x, y]) => ({
    x,
    y,
    label: `(${nice(x).exact ? nice(x).text : '≈' + nice(x).text}, ${nice(y).exact ? nice(y).text : '≈' + nice(y).text})`,
    fill: 'closed' as const,
    pos: null,
    auto: true,
  }));
}
