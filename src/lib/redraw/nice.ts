/**
 * Numbers for people (redraw, 2.2 dev): recognizes values that are almost certainly
 * exact (integers, short decimals, simple multiples of π, simple fractions such as 1/3)
 * and writes everything else to 3 significant figures marked as approximate.
 *
 * Numbers found numerically (roots, extrema, areas) are accurate to about 1e-10, so a
 * match within `tol` is a safe bet; a tolerance any looser would start "recognizing"
 * coincidences.
 */

export interface Nice {
  text: string;
  /** True for integers, short decimals, fractions, and π multiples; false for rounded values. */
  exact: boolean;
}

const MINUS = '−';

function fraction(v: number, tol: number, maxDen: number): [number, number] | null {
  for (let q = 1; q <= maxDen; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v - p / q) <= tol * Math.max(1, Math.abs(v))) return [p, q];
  }
  return null;
}

/** Writes p/q (or p, or p·sym/q) with a proper minus sign. */
function ratio(p: number, q: number, sym = ''): string {
  const sign = p < 0 ? MINUS : '';
  const a = Math.abs(p);
  const num = sym ? (a === 1 ? sym : `${a}${sym}`) : String(a);
  return q === 1 ? `${sign}${num}` : `${sign}${num}/${q}`;
}

export function nice(v: number, tol = 1e-8): Nice {
  if (!Number.isFinite(v)) return { text: String(v), exact: false };
  if (Math.abs(v) < tol) return { text: '0', exact: true };
  // Integers and short decimals as written: 2, 0.5, 1.25 (not 5/4). The tolerance is
  // capped so a large value can't round its way into looking exact.
  const abs = tol * Math.min(Math.max(1, Math.abs(v)), 100);
  for (let k = 0; k <= 3; k++) {
    const m = v * 10 ** k;
    if (Math.abs(m - Math.round(m)) <= abs * 10 ** k)
      return { text: (Math.round(m) / 10 ** k).toFixed(k).replace('-', MINUS), exact: true };
  }
  const pi = fraction(v / Math.PI, tol, 12);
  if (pi && Math.abs(pi[0]) <= 48) return { text: ratio(pi[0], pi[1], 'π'), exact: true };
  const f = fraction(v, tol, 12);
  if (f) return { text: ratio(f[0], f[1]), exact: true };
  // Simple multiples of e (2.2.2): e, 2e, e/2, −e.
  const ee = fraction(v / Math.E, tol, 4);
  if (ee && Math.abs(ee[0]) <= 12) return { text: ratio(ee[0], ee[1], 'e'), exact: true };
  return { text: approx(v), exact: false };
}

/** 3 significant figures, no exponent for ordinary sizes, proper minus sign. */
export function approx(v: number, sig = 3): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  let s: string;
  if (a >= 1e-4 && a < 1e6) {
    const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    s = String(parseFloat(a.toFixed(Math.min(digits, 12))));
  } else s = a.toPrecision(sig);
  return (v < 0 ? MINUS : '') + s;
}

/** "π/6" or "about 1.23". */
export function say(v: number, tol?: number): string {
  const n = nice(v, tol);
  return n.exact ? n.text : `about ${n.text}`;
}

/** A tick label: shortest decimal that round-trips at tick precision. */
export function tickText(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-9) return '0';
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const s = String(parseFloat(v.toFixed(Math.min(decimals + 1, 12))));
  return s.replace('-', MINUS);
}

/** About `target` evenly spaced ticks at 1, 2, 2.5, or 5 × 10^k inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 6): { values: number[]; step: number } {
  const span = hi - lo;
  if (!(span > 0)) return { values: [], step: 1 };
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target + 0.5) ?? 10 * mag;
  const values: number[] = [];
  const first = Math.ceil(lo / step - 1e-9);
  for (let k = first; k * step <= hi + step * 1e-9; k++) values.push(Math.abs(k * step) < step * 1e-9 ? 0 : k * step);
  return { values, step };
}

/**
 * A window around [lo, hi] for display: includes 0 when it is nearby (so the axis
 * shows), adds a margin, and snaps outward to the tick step so the ends are round.
 */
export function niceRange(lo: number, hi: number): [number, number] {
  if (!(hi > lo)) [lo, hi] = [lo - 1, hi + 1];
  if (lo > 0 && lo < 0.5 * (hi - lo)) lo = 0;
  if (hi < 0 && -hi < 0.5 * (hi - lo)) hi = 0;
  const pad = 0.08 * (hi - lo);
  const { step } = niceTicks(lo - pad, hi + pad, 6);
  const down = (y: number) => Math.floor(y / step - 1e-9) * step;
  const up = (y: number) => Math.ceil(y / step + 1e-9) * step;
  return [lo === 0 ? -step / 2 : down(lo - pad), hi === 0 ? step / 2 : up(hi + pad)];
}
