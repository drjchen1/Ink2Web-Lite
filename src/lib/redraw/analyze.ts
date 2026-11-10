/**
 * Computed facts about each curve of a redraw graph (2.2 dev): where it crosses the
 * axis, its turning points, jumps, asymptotes, and where it is undefined. These feed
 * the alt text, so every statement in it is calculated rather than described by a
 * model. Values come from the expressions themselves (bisection on f or f′), not
 * from the drawing, so they are accurate to ~1e-10 and nice() can recognize π/6.
 */
import type { Curve, GraphSpec, Piece } from './spec.ts';
import { sampleFn, type Pt, type Sampled } from './sample.ts';

export interface Jump {
  x: number;
  from: number;
  to: number;
}

export interface CurveFacts {
  curve: Curve;
  /** Drawable polylines (math coordinates). */
  segments: Pt[][];
  start: Pt | null;
  end: Pt | null;
  zeros: number[];
  maxima: Pt[];
  minima: Pt[];
  jumps: Jump[];
  asymptotes: number[];
  gaps: [number, number][];
  /** Stretches where the curve is constant: [from, to, value]. */
  constant: [number, number, number][];
  /** Turning points alternate and their size steadily changes. */
  oscillation: 'decaying' | 'growing' | 'steady' | null;
}

export interface GraphFacts {
  kind: 'graph';
  spec: GraphSpec;
  yWindow: [number, number];
  curves: CurveFacts[];
}

const fin = Number.isFinite;

/** Root of g in [lo, hi] given a sign change. */
export function bisect(g: (x: number) => number, lo: number, hi: number): number {
  let glo = g(lo);
  for (let i = 0; i < 80 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo)); i++) {
    const m = (lo + hi) / 2;
    const gm = g(m);
    if (!fin(gm)) break;
    if (gm === 0) return m;
    if (Math.sign(gm) === Math.sign(glo)) [lo, glo] = [m, gm];
    else hi = m;
  }
  return (lo + hi) / 2;
}

const deriv = (f: (x: number) => number) => (x: number) => {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (f(x + h) - f(x - h)) / (2 * h);
};

function isConstant(p: Piece, lo: number, hi: number): number | null {
  const y0 = p.f(lo);
  if (!fin(y0)) return null;
  for (let k = 1; k <= 16; k++) {
    const y = p.f(lo + ((hi - lo) * k) / 16);
    if (!fin(y) || Math.abs(y - y0) > 1e-12 * Math.max(1, Math.abs(y0))) return null;
  }
  return y0;
}

/**
 * Stretches where f is constant inside one expression (u(t − 2)·sin(t − 2) is 0 for
 * t < 2), longer than 1% of the range, with their ends located exactly.
 */
function constantRuns(p: Piece, s: Sampled, lo: number, hi: number): [number, number, number][] {
  const runs: [number, number, number][] = [];
  const same = (y: number, v: number) => Math.abs(y - v) <= 1e-12 * Math.max(1, Math.abs(v));
  for (const seg of s.segments) {
    let i = 0;
    while (i < seg.length) {
      const v = seg[i][1];
      let j = i;
      while (j + 1 < seg.length && same(seg[j + 1][1], v)) j++;
      if (j > i && seg[j][0] - seg[i][0] > (hi - lo) * 0.01) {
        // Push each end out to where f stops being v.
        const edge = (inside: number, outside: number) => {
          for (let k = 0; k < 60; k++) {
            const mid = (inside + outside) / 2;
            if (same(p.f(mid), v)) inside = mid;
            else outside = mid;
          }
          return inside;
        };
        const from = i > 0 ? edge(seg[i][0], seg[i - 1][0]) : seg[i][0];
        const to = j + 1 < seg.length ? edge(seg[j][0], seg[j + 1][0]) : seg[j][0];
        runs.push([from, to, v === 0 ? 0 : v]);
      }
      i = j + 1;
    }
  }
  return runs;
}

/** Facts for one piece's sampled range. */
function pieceFacts(p: Piece, s: Sampled, lo: number, hi: number, yr: [number, number]) {
  const zeros: number[] = [];
  const maxima: Pt[] = [];
  const minima: Pt[] = [];
  const cval = isConstant(p, lo, hi);
  if (cval !== null) return { zeros, maxima, minima, constant: [[lo, hi, cval]] as [number, number, number][] };
  const df = deriv(p.f);
  const span = hi - lo;
  for (const seg of s.segments) {
    for (let i = 1; i < seg.length; i++) {
      const [x0, y0] = seg[i - 1];
      const [x1, y1] = seg[i];
      if (y0 === 0 && i === 1 && x0 > lo + span * 1e-9) zeros.push(x0);
      if (y1 === 0) zeros.push(x1);
      else if (y0 !== 0 && Math.sign(y0) !== Math.sign(y1)) zeros.push(bisect(p.f, x0, x1));
    }
    // Turning points: the slope between samples changes sign (flat steps ignored).
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
        if (!(df(lo2) * df(hi2) < 0)) x = seg[i - 1][0]; // a corner (|t − 1|): use the sample
        const y = p.f(x);
        if (fin(y) && x > lo + span * 1e-6 && x < hi - span * 1e-6) (prev > 0 ? maxima : minima).push([x, y]);
      }
      prev = sg;
      prevIdx = i;
    }
  }
  // A turning point on the axis is also a zero (t^2 touches 0 without crossing).
  const tiny = (yr[1] - yr[0]) * 1e-9;
  for (const [x, y] of [...maxima, ...minima]) if (Math.abs(y) < tiny) zeros.push(x);
  return { zeros, maxima, minima, constant: constantRuns(p, s, lo, hi) };
}

const dedupe = (xs: number[], tol: number) => xs.sort((p, q) => p - q).filter((x, i, arr) => i === 0 || x - arr[i - 1] > tol);

export function analyzeGraph(spec: GraphSpec, yWindow: [number, number]): GraphFacts {
  const [a, b] = spec.window.x;
  const tol = (b - a) * 1e-7;
  const R = yWindow[1] - yWindow[0];
  const curves = spec.curves.map((curve): CurveFacts => {
    const out: CurveFacts = {
      curve,
      segments: [],
      start: null,
      end: null,
      zeros: [],
      maxima: [],
      minima: [],
      jumps: [],
      asymptotes: [],
      gaps: [],
      constant: [],
      oscillation: null,
    };
    let covered = a;
    let prevEnd: { x: number; y: number } | null = null;
    for (const p of curve.pieces) {
      const lo = Math.max(a, p.on[0]);
      const hi = Math.min(b, p.on[1]);
      if (hi <= lo) continue;
      if (lo > covered + tol) out.gaps.push([covered, lo]);
      const s = sampleFn(p.f, [lo, hi], yWindow);
      out.segments.push(...s.segments);
      out.gaps.push(...s.gaps);
      for (const br of s.breaks) {
        if (br.kind === 'blowup') out.asymptotes.push(br.x);
        else out.jumps.push({ x: br.x, from: br.left, to: br.right });
      }
      const pf = pieceFacts(p, s, lo, hi, yWindow);
      out.zeros.push(...pf.zeros);
      out.maxima.push(...pf.maxima);
      out.minima.push(...pf.minima);
      out.constant.push(...pf.constant);
      // A gap whose edge runs off to infinity is an asymptote (ln x at 0).
      const runsOff = (x: number, dir: -1 | 1) => {
        const w = hi - lo;
        const near = p.f(x + dir * w * 1e-10);
        const far = p.f(x + dir * w * 1e-4);
        return fin(near) && fin(far) && Math.abs(near - far) > 0.5 * R && (near > yWindow[1] || near < yWindow[0]);
      };
      for (const [g0, g1] of s.gaps) {
        if (g0 > lo && runsOff(g0, -1)) out.asymptotes.push(g0);
        if (g1 < hi && runsOff(g1, 1)) out.asymptotes.push(g1);
      }
      // Where two pieces meet, a different value on each side is a jump.
      const first = s.segments[0]?.[0];
      if (prevEnd && first && Math.abs(first[0] - prevEnd.x) <= tol) {
        if (Math.abs(first[1] - prevEnd.y) > R * 1e-9) out.jumps.push({ x: first[0], from: prevEnd.y, to: first[1] });
      }
      const lastSeg = s.segments[s.segments.length - 1];
      const last = lastSeg?.[lastSeg.length - 1];
      prevEnd = last ? { x: last[0], y: last[1] } : null;
      covered = hi;
    }
    if (covered < b - tol) out.gaps.push([covered, b]);

    out.zeros = dedupe(out.zeros, tol);
    out.asymptotes = dedupe(out.asymptotes, tol);
    out.jumps.sort((p, q) => p.x - q.x);
    out.gaps.sort((p, q) => p[0] - q[0]);
    // Points inside a constant run aren't turning points or isolated zeros.
    const inConst = (x: number) => out.constant.some(([p, q]) => x >= p - tol && x <= q + tol);
    out.maxima = out.maxima.filter(([x]) => !inConst(x));
    out.minima = out.minima.filter(([x]) => !inConst(x));
    out.zeros = out.zeros.filter((x) => !inConst(x));

    const segs = out.segments;
    if (segs.length) {
      out.start = segs[0][0];
      const ls = segs[segs.length - 1];
      out.end = ls[ls.length - 1];
    }
    out.oscillation = oscillation(out.maxima, out.minima);
    return out;
  });
  return { kind: 'graph', spec, yWindow, curves };
}

/** Decaying, growing, or steady oscillation, from alternating turning points. */
function oscillation(maxima: Pt[], minima: Pt[]): CurveFacts['oscillation'] {
  const turns = [...maxima.map((p) => ({ p, max: true })), ...minima.map((p) => ({ p, max: false }))].sort(
    (u, w) => u.p[0] - w.p[0],
  );
  if (turns.length < 4) return null;
  for (let i = 1; i < turns.length; i++) if (turns[i].max === turns[i - 1].max) return null;
  const amps: number[] = [];
  for (let i = 1; i < turns.length; i++) amps.push(Math.abs(turns[i].p[1] - turns[i - 1].p[1]));
  const changes = amps.slice(1).map((amp, i) => (amp - amps[i]) / Math.max(amp, amps[i]));
  if (changes.every((r) => Math.abs(r) < 0.03)) return 'steady';
  if (changes.every((r) => r < 0)) return 'decaying';
  if (changes.every((r) => r > 0)) return 'growing';
  return null;
}
