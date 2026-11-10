/**
 * Adaptive sampling for redraw figures (2.2 dev).
 *
 * Samples f on [a, b] densely enough that straight segments look smooth at figure
 * size, and splits the curve where it must not be connected:
 *  - jumps (u(t − 2), floor(x), a piecewise rule written as one expression),
 *  - vertical asymptotes (tan(x), 1/(x − 1), ln|x| at 0),
 *  - gaps where f has no real value (sqrt(x) for x < 0, ln(x) for x <= 0).
 *
 * Everything is measured in "window units" (the output range's height is 1), so the
 * tolerances mean the same on every figure. Values far outside the window are kept
 * (the renderer clamps and clips) but never refined, so exp(10t) on a small window
 * costs nothing extra.
 */
import { niceRange } from './nice.ts';

export type Pt = [number, number];

export interface Break {
  x: number;
  kind: 'jump' | 'blowup';
  /** Values just left and right of x (very large for a blow-up). */
  left: number;
  right: number;
}

export interface Sampled {
  segments: Pt[][];
  breaks: Break[];
  /** Intervals (within the sampled range) where f has no real value. */
  gaps: [number, number][];
}

const START = 96; // initial intervals
const MAX_DEPTH = 14; // ~1/1.5 million of the window width
const BEND = 0.0015; // midpoint deviation that triggers refinement (~0.5 px at 320 px)
const JUMP = 0.02; // a step this tall across a tiny interval is a break (~6 px)

export function sampleFn(f: (x: number) => number, xr: [number, number], yr: [number, number]): Sampled {
  const [a, b] = xr;
  const [c, d] = yr;
  const R = d - c;
  const sy = 1 / R;
  const segments: Pt[][] = [];
  const breaks: Break[] = [];
  const gaps: [number, number][] = [];
  let cur: Pt[] | null = null;
  let gapFrom: number | null = null;
  /** f just before the gap (to tell a pole like 1/x at a sample point from a real gap). */
  let gapFromY = NaN;

  const fin = Number.isFinite;
  const emit = (x: number, y: number) => {
    if (!cur) {
      cur = [];
      segments.push(cur);
    }
    cur.push([x, y]);
  };
  const end = () => {
    cur = null;
  };
  const above = (y: number) => y > d + 0.05 * R;
  const below = (y: number) => y < c - 0.05 * R;
  const big = (y: number) => y > d + 10 * R || y < c - 10 * R;

  /** The edge between where f is finite and where it isn't, in [lo, hi] (either order). */
  const edge = (lo: number, hi: number) => {
    const fLo = fin(f(lo));
    for (let i = 0; i < 50; i++) {
      const m = (lo + hi) / 2;
      if (fin(f(m)) === fLo) lo = m;
      else hi = m;
    }
    return fLo ? lo : hi;
  };

  const breakAt = (x0: number, y0: number, x1: number, y1: number) => {
    // Narrow the step to machine precision so x is exact (2, not 2.0000003).
    for (let i = 0; i < 60 && x1 - x0 > 1e-15 * Math.max(1, Math.abs(x0)); i++) {
      const m = (x0 + x1) / 2;
      const ym = f(m);
      if (!fin(ym)) break;
      if (Math.abs(ym - y0) > Math.abs(y1 - ym)) [x1, y1] = [m, ym];
      else [x0, y0] = [m, ym];
    }
    breaks.push({ x: (x0 + x1) / 2, kind: big(y0) || big(y1) ? 'blowup' : 'jump', left: y0, right: y1 });
    return { x0, y0, x1, y1 };
  };

  function refine(x0: number, y0: number, x1: number, y1: number, depth: number): void {
    const f0 = fin(y0);
    const f1 = fin(y1);
    if (!f0 && !f1) {
      // Look a little inside for an island where f is defined.
      if (depth < 6) {
        const xm = (x0 + x1) / 2;
        const ym = f(xm);
        refine(x0, y0, xm, ym, depth + 1);
        refine(xm, ym, x1, y1, depth + 1);
      }
      return;
    }
    if (f0 && !f1) {
      const xe = edge(x0, x1);
      refine(x0, y0, xe, f(xe), depth + 1);
      end();
      gapFrom = xe;
      gapFromY = f(xe);
      return;
    }
    if (!f0 && f1) {
      const xs = edge(x1, x0);
      const g0 = gapFrom ?? x0;
      if (xs - g0 < (b - a) * 1e-6 && fin(gapFromY)) {
        // Undefined at a single point: a pole (1/x at 0) or a removable hole (sin(x)/x).
        const yr2 = f(xs);
        // Slow divergence (ln|x| at 0) still runs far away within a short distance.
        const runsOff = (x: number, y: number, dir: -1 | 1) => {
          const far = f(x + dir * (b - a) * 1e-4);
          return fin(far) && Math.abs(y - far) > 0.5 * R && (y > d || y < c);
        };
        if (big(gapFromY) || big(yr2) || runsOff(g0, gapFromY, -1) || runsOff(xs, yr2, 1))
          breaks.push({ x: (g0 + xs) / 2, kind: 'blowup', left: gapFromY, right: yr2 });
        else if (Math.abs(yr2 - gapFromY) * sy > JUMP) breaks.push({ x: (g0 + xs) / 2, kind: 'jump', left: gapFromY, right: yr2 });
      } else gaps.push([g0, xs]);
      gapFrom = null;
      emit(xs, f(xs));
      refine(xs, f(xs), x1, y1, depth + 1);
      return;
    }
    // Both ends defined.
    if ((above(y0) && above(y1)) || (below(y0) && below(y1))) {
      // Off screen on one side: no detail needed, unless something dips into view.
      const ym = f((x0 + x1) / 2);
      if (!fin(ym) || !((above(y0) && above(ym)) || (below(y0) && below(ym)))) {
        if (depth < MAX_DEPTH) {
          const xm = (x0 + x1) / 2;
          refine(x0, y0, xm, ym, depth + 1);
          refine(xm, ym, x1, y1, depth + 1);
          return;
        }
      }
      emit(x1, y1);
      return;
    }
    const stepSize = Math.abs(y1 - y0) * sy;
    if (depth >= MAX_DEPTH) {
      if (stepSize > JUMP) {
        const r = breakAt(x0, y0, x1, y1);
        emit(r.x0, r.y0);
        end();
        emit(r.x1, r.y1);
      }
      emit(x1, y1);
      return;
    }
    const xm = (x0 + x1) / 2;
    const ym = f(xm);
    if (!fin(ym) || Math.abs(ym - (y0 + y1) / 2) * sy > BEND || stepSize > JUMP) {
      refine(x0, y0, xm, ym, depth + 1);
      refine(xm, ym, x1, y1, depth + 1);
    } else emit(x1, y1);
  }

  let x0 = a;
  let y0 = f(a);
  if (fin(y0)) emit(a, y0);
  else gapFrom = a;
  for (let i = 1; i <= START; i++) {
    const x1 = i === START ? b : a + ((b - a) * i) / START;
    const y1 = f(x1);
    refine(x0, y0, x1, y1, 0);
    x0 = x1;
    y0 = y1;
  }
  if (gapFrom !== null) gaps.push([gapFrom, b]);

  return {
    segments: segments.filter((s) => s.length > 1 || segments.length === 1),
    breaks,
    gaps: gaps.filter(([p, q]) => q - p > (b - a) * 1e-3),
  };
}

/** A window that shows the functions' interesting part (asymptotes don't blow it up). */
export function autoY(fs: ((x: number) => number)[], xr: [number, number], extra: number[] = []): [number, number] {
  const [a, b] = xr;
  const ys: number[] = [];
  for (const f of fs)
    for (let k = 0; k <= 400; k++) {
      const y = f(a + ((b - a) * k) / 400);
      if (Number.isFinite(y)) ys.push(y);
    }
  if (!ys.length) return [-1, 1];
  ys.sort((p, q) => p - q);
  const q = (t: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(t * (ys.length - 1))))];
  let lo = q(0.02);
  let hi = q(0.98);
  const span = hi - lo || Math.max(1, Math.abs(hi));
  lo = Math.max(ys[0], lo - 0.5 * span);
  hi = Math.min(ys[ys.length - 1], hi + 0.5 * span);
  for (const y of extra) if (Number.isFinite(y)) [lo, hi] = [Math.min(lo, y), Math.max(hi, y)];
  return niceRange(lo, hi);
}
