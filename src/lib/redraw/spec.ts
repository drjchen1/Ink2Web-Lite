/**
 * The redraw spec (2.2 dev): a small JSON description of a figure's mathematics.
 * The model (later) or the user (now, by hand) writes the spec; the code computes
 * and draws. This file checks untrusted JSON, dispatches on "kind", and defines the
 * "graph" kind. Shared fields: common.ts. The "region" kind: region.ts. "phase": phase.ts.
 *
 * Graph of a stated function:
 *   window   x is required; y may be left out ("auto")
 *   curves   [{ "expr": "exp(-t)*cos(3t)", "label": "y(t)", "style": "solid" },
 *             { "pieces": [{ "expr": "0", "on": [0, 2], "ends": ["closed", "open"] },
 *                          { "expr": "t-2", "on": [2, 6] }] }]
 *   impulses [{ "at": 3, "size": 1, "label": "δ(t − 3)" }]
 *   points   "on": { "curve": 1, "at": 2 } puts a dot on curve 1 at t = 2
 */
import {
  COMMON_FIELDS,
  compileExpr,
  isNum,
  isObj,
  numbersFromConstants,
  pair,
  parseCommon,
  parsePoints,
  str,
  warnUnknown,
  type Common,
  type Fill,
  type LineStyle,
  type Messages,
  type Range,
} from './common.ts';
import { checkPhase, type PhaseSpec } from './phase.ts';
import { cleanExpr } from './prompt.ts';
import { fn1 } from './expr.ts';
import { checkRegion, type RegionSpec } from './region.ts';

export interface Piece {
  expr: string;
  text: string;
  f: (x: number) => number;
  on: Range;
  ends: [Fill | null, Fill | null];
}

export interface Curve {
  /** 1-based, as the user refers to it. */
  n: number;
  label: string | null;
  style: LineStyle;
  /** One piece over the whole window for a plain expression. */
  pieces: Piece[];
  piecewise: boolean;
}

export interface Impulse {
  at: number;
  size: number;
  label: string | null;
}

export interface GraphSpec extends Common {
  kind: 'graph';
  window: { x: Range; y: Range | null };
  curves: Curve[];
  impulses: Impulse[];
}

export type Spec = GraphSpec | RegionSpec | PhaseSpec;

export interface Checked {
  spec: Spec | null;
  errors: string[];
  warnings: string[];
}

/** Checks and compiles a spec (a JSON string or an already-parsed value). */
export function checkSpec(input: unknown): Checked {
  const m: Messages = { errors: [], warnings: [] };
  const fail = (): Checked => ({ spec: null, ...m });

  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      m.errors.push(`Not valid JSON: ${(e as Error).message}`);
      return fail();
    }
  }
  if (!isObj(raw)) {
    m.errors.push('The spec must be a JSON object { … }.');
    return fail();
  }
  const obj = numbersFromConstants(raw, m) as Record<string, unknown>;
  if (m.errors.length) return fail();
  let spec: Spec | null;
  if (obj.kind === 'graph') spec = checkGraph(obj, m);
  else if (obj.kind === 'region') spec = checkRegion(obj, m);
  else if (obj.kind === 'phase') spec = checkPhase(obj, m);
  else {
    m.errors.push('kind must be "graph", "region", or "phase".');
    return fail();
  }
  return m.errors.length ? fail() : { spec, ...m };
}

const GRAPH_FIELDS = [...COMMON_FIELDS, 'curves', 'impulses'];

function checkGraph(raw: Record<string, unknown>, m: Messages): GraphSpec | null {
  warnUnknown(raw, GRAPH_FIELDS, m);
  const common = parseCommon(raw, m, 'x');
  const v = common.v;
  const wx = common.window.x;
  if (!wx) {
    if (!m.errors.some((e) => e.startsWith('window.x'))) m.errors.push('window.x must be [left, right] with left < right.');
    return null;
  }
  const [a, b] = wx;
  const inX = (x: number) => x >= a - 1e-12 && x <= b + 1e-12;

  /* curves */
  const curves: Curve[] = [];
  const fillOf = (e: unknown): Fill | null => (e === 'closed' || e === 'open' ? e : null);
  if (!Array.isArray(raw.curves) || !raw.curves.length) m.errors.push('curves: give at least one curve.');
  else
    raw.curves.forEach((c, i) => {
      const where = `curve ${i + 1}`;
      if (!isObj(c)) return void m.errors.push(`${where}: must be an object.`);
      const style: LineStyle = c.style === 'dashed' || c.style === 'dotted' ? c.style : 'solid';
      const label = str(c.label);
      const pieces: Piece[] = [];
      if (Array.isArray(c.pieces)) {
        c.pieces.forEach((p, j) => {
          const pw = `${where}, piece ${j + 1}`;
          if (!isObj(p)) return void m.errors.push(`${pw}: must be an object.`);
          const on = pair(p.on);
          if (!on) return void m.errors.push(`${pw}: on must be [from, to] with from < to.`);
          const ends: [Fill | null, Fill | null] = Array.isArray(p.ends) ? [fillOf(p.ends[0]), fillOf(p.ends[1])] : [null, null];
          const e = compileExpr(p.expr, v, pw, m);
          if (e) pieces.push({ expr: e.expr, text: e.text, f: e.f, on, ends });
        });
        pieces.sort((p, q) => p.on[0] - q.on[0]);
        for (let j = 1; j < pieces.length; j++)
          if (pieces[j].on[0] < pieces[j - 1].on[1] - 1e-12) m.errors.push(`${where}: pieces ${j} and ${j + 1} overlap.`);
      } else {
        const e = compileExpr(c.expr, v, where, m);
        if (e) pieces.push({ expr: e.expr, text: e.text, f: e.f, on: [a, b], ends: [null, null] });
      }
      if (pieces.length) curves.push({ n: i + 1, label, style, pieces, piecewise: Array.isArray(c.pieces) });
    });

  // An expression that gives no real values in the window is almost surely misread.
  for (const c of curves) {
    let ok = 0;
    const N = 200;
    for (let k = 0; k <= N; k++) if (Number.isFinite(valueAt(c, a + ((b - a) * k) / N))) ok++;
    if (ok === 0) m.errors.push(`curve ${c.n}: gives no real values for ${v} between ${a} and ${b}.`);
    else if (ok < N * 0.1) m.warnings.push(`curve ${c.n}: defined on only a small part of the window.`);
  }

  // The equation in "from" should be the one drawn. When it can be read as an
  // expression (y = e^{-t}\cos(2t)), check that some curve matches it.
  const fromExpr = fromAsExpr(common.from, v);
  if (fromExpr && curves.some((c) => !c.piecewise)) {
    const matches = curves.some((c) => !c.piecewise && sameFunction(fromExpr, c.pieces[0].f, a, b));
    if (!matches)
      m.warnings.push(
        `The equation in "from" doesn’t match any curve. The drawing follows each curve’s "expr"; change "expr" to change the curve.`,
      );
  }

  /* points: "on": { "curve": n, "at": x } */
  const points = parsePoints(
    raw.points,
    (ref, x, fill) => {
      const c = curves.find((q) => q.n === ref);
      if (!c) return `there is no curve ${String(ref)}.`;
      if (!inX(x)) return `${v} = ${x} is outside the window.`;
      const y = valueAt(c, x, fill);
      return Number.isFinite(y) ? [x, y] : `curve ${c.n} has no value at ${v} = ${x}.`;
    },
    m,
  );

  /* impulses */
  const impulses: Impulse[] = [];
  (Array.isArray(raw.impulses) ? raw.impulses : []).forEach((im, i) => {
    if (!isObj(im) || !isNum(im.at)) return void m.errors.push(`impulse ${i + 1}: give "at": a number.`);
    if (!inX(im.at)) m.warnings.push(`impulse ${i + 1}: ${v} = ${im.at} is outside the window.`);
    impulses.push({ at: im.at, size: isNum(im.size) && im.size !== 0 ? im.size : 1, label: str(im.label) });
  });

  return { kind: 'graph', ...common, window: { x: wx, y: common.window.y }, points, curves, impulses };
}

/**
 * The curve's value at x. Where two pieces meet, a closed dot takes the value of the
 * piece whose end is marked closed there (otherwise the right-hand piece), and an
 * open dot the piece whose end is marked open (otherwise the left-hand piece).
 */
export function valueAt(c: Curve, x: number, prefer: Fill = 'closed'): number {
  const eps = 1e-12;
  const hits = c.pieces.filter((p) => x >= p.on[0] - eps && x <= p.on[1] + eps);
  if (!hits.length) return NaN;
  if (hits.length > 1) {
    const endHere = (p: Piece, f: Fill) =>
      (Math.abs(x - p.on[0]) <= eps && p.ends[0] === f) || (Math.abs(x - p.on[1]) <= eps && p.ends[1] === f);
    const pick = hits.find((p) => endHere(p, prefer)) ?? (prefer === 'closed' ? hits[hits.length - 1] : hits[0]);
    return limitValue(pick, x);
  }
  return limitValue(hits[0], x);
}

/** f(x), or its one-sided limit at a piece end where f itself is undefined (sin(t)/t at 0). */
function limitValue(p: Piece, x: number): number {
  const y = p.f(x);
  if (Number.isFinite(y)) return y;
  const h = (p.on[1] - p.on[0]) * 1e-9;
  const inside = Math.abs(x - p.on[0]) < Math.abs(x - p.on[1]) ? x + h : x - h;
  return p.f(inside);
}

/**
 * The right-hand side of a one-equation "from" as a function, or null when it isn't a
 * simple "y = …" that the parser can read (integrals, systems, cases, spacing commands).
 */
export function fromAsExpr(from: string, v: string): ((x: number) => number) | null {
  const parts = from.split('=');
  if (parts.length !== 2 || /\\(begin|int|sum|quad|;)|,/.test(from)) return null;
  // Only "y = …" or "u(t) = …": not y'' + y = 0, x^2 + y^2 = 1, …
  if (!/^\s*[A-Za-z]\s*(\(\s*[A-Za-z]\s*\))?\s*$/.test(parts[0])) return null;
  try {
    return fn1(cleanExpr(parts[1]), v);
  } catch {
    return null;
  }
}

/** True when f and g agree at sample points where both are defined. */
function sameFunction(f: (x: number) => number, g: (x: number) => number, a: number, b: number): boolean {
  let compared = 0;
  for (let k = 0; k <= 24; k++) {
    const x = a + ((b - a) * (k + 0.37)) / 25;
    const p = f(x);
    const q = g(x);
    if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
    compared++;
    if (Math.abs(p - q) > 1e-6 * Math.max(1, Math.abs(p), Math.abs(q))) return false;
  }
  return compared > 0;
}
