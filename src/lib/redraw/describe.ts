/**
 * Alt text for a redrawn graph (2.2 dev), generated from computed facts only, plus
 * helpers every kind uses.
 *
 *  short: one sentence for the SVG <title> (and an img alt).
 *  long:  a few sentences for <desc>: the window, each curve's behavior, the marks.
 *
 * Numbers go through say(): exact values (2, 0.5, π/6, 1/3) as they are, others as
 * "about 0.368" (inside coordinates, "≈0.368"). Lists are capped so a fast oscillation
 * doesn't produce a paragraph of numbers.
 */
import type { CurveFacts, GraphFacts } from './analyze.ts';
import type { Common } from './common.ts';
import { nice, say } from './nice.ts';
import type { Curve, GraphSpec, Piece } from './spec.ts';

const LIST_MAX = 4;

export function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** A number inside a coordinate pair or formula: "≈0.368" rather than "about 0.368". */
export const num = (v: number) => say(v).replace(/^about /, '≈');
export const pt = (x: number, y: number) => `(${num(x)}, ${num(y)})`;
const squash = (s: string) => s.replace(/[\s()]/g, '');

/** Sentences for the points and free labels written in the spec. */
export function describeMarks(spec: Common): string[] {
  const out: string[] = [];
  const ps = spec.points
    .filter((p) => !p.auto)
    .map((p) => {
      const what = `${p.fill === 'open' ? 'an open' : 'a filled'} dot at ${pt(p.x, p.y)}`;
      return p.label && squash(p.label) !== squash(pt(p.x, p.y)) ? `${what} labeled ${p.label}` : what;
    });
  if (ps.length) out.push(`Marked: ${list(ps)}.`);
  if (spec.labels.length) out.push(`Text on the figure: ${list(spec.labels.map((l) => `“${l.text}”`))}.`);
  return out;
}

/** "0 ≤ t < 2" from the piece's end marks, or "t from 0 to 2" when they aren't given. */
function pieceRange(p: Piece, v: string): string {
  const [e0, e1] = p.ends;
  if (!e0 || !e1) return `${v} from ${num(p.on[0])} to ${num(p.on[1])}`;
  return `${num(p.on[0])} ${e0 === 'closed' ? '≤' : '<'} ${v} ${e1 === 'closed' ? '≤' : '<'} ${num(p.on[1])}`;
}

/**
 * How a curve is named. Short: "u(t) = e^(−t/2)·cos(3t)" or "the piecewise function
 * g(t)". Long adds the pieces. The label is used as the left side unless it already
 * contains "=" or just repeats the rule.
 */
export function curveName(c: Curve, spec: GraphSpec, single: boolean, long: boolean): string {
  const lhs = c.label ?? (single ? spec.axes.y : null);
  const style = c.style === 'solid' ? '' : ` (${c.style})`;
  if (c.piecewise) {
    const head = `the piecewise function${lhs ? ` ${lhs}` : ''}`;
    if (!long) return head + style;
    const parts = c.pieces.map((p) => `${p.text} for ${pieceRange(p, spec.v)}`);
    return `${head}${style}, equal to ${list(parts)}`;
  }
  const rule = c.pieces[0].text;
  if (!lhs || squash(lhs) === squash(rule)) return rule + style;
  if (lhs.includes('=')) return lhs + style;
  return `${lhs} = ${rule}${style}`;
}

/** "t = π/6, π/2", "t ≈ 5.14, 8.28", or mixed "x = 0 and ≈1.89". */
function atX(values: number[], v: string): string {
  if (values.every((x) => !nice(x).exact)) return `${v} ≈ ${list(values.map((x) => nice(x).text))}`;
  return `${v} = ${list(values.map(num))}`;
}

/**
 * Ends of a constant stretch where the curve flattens smoothly (1 − cos t reaching 2
 * at π) can only be located to ~1e-6, so they get a looser exactness check.
 */
const edgeNum = (v: number) => say(v, 1e-5).replace(/^about /, '≈');

function describeCurve(f: CurveFacts, spec: GraphSpec, yWindow: [number, number], single: boolean): string {
  const v = spec.v;
  const out: string[] = [];
  const [c, d] = yWindow;
  const visible = (y: number) => y >= c && y <= d;

  const name = curveName(f.curve, spec, single, true);
  out.push(single ? `The graph shows ${name}.` : `Curve ${f.curve.n}: ${name}.`);
  if (f.start && f.end && visible(f.start[1]) && visible(f.end[1]))
    out.push(`${single ? 'The curve' : 'It'} starts at ${pt(...f.start)} and ends at ${pt(...f.end)}.`);

  // Constant stretches, unless a piece already says so.
  for (const [p, q, val] of f.constant) {
    const isPiece = f.curve.piecewise && f.curve.pieces.some((pc) => Math.abs(pc.on[0] - p) < 1e-9 && Math.abs(pc.on[1] - q) < 1e-9);
    if (!isPiece) out.push(`It stays at ${num(val)} for ${v} from ${edgeNum(p)} to ${edgeNum(q)}.`);
  }

  if (f.zeros.length > LIST_MAX)
    out.push(`It crosses zero ${f.zeros.length} times; the first three are at ${atX(f.zeros.slice(0, 3), v)}.`);
  else if (f.zeros.length) out.push(`It is zero at ${atX(f.zeros, v)}.`);

  if (f.oscillation) {
    const how = { decaying: 'decreasing', growing: 'increasing', steady: 'constant' }[f.oscillation];
    const firstMax = f.maxima[0];
    out.push(
      `It oscillates with ${how} amplitude (${f.maxima.length} local maxima and ${f.minima.length} local minima` +
        (firstMax ? `; the first maximum is at ${pt(...firstMax)}).` : ').'),
    );
  } else {
    const turns = (one: string, many: string, ps: [number, number][]) => {
      if (!ps.length) return;
      const shown = ps.slice(0, LIST_MAX).map((p) => pt(...p));
      if (ps.length > LIST_MAX) shown.push(`${ps.length - LIST_MAX} more`);
      out.push(ps.length === 1 ? `It has a ${one} at ${shown[0]}.` : `It has ${many} at ${list(shown)}.`);
    };
    turns('local maximum', 'local maxima', f.maxima);
    turns('local minimum', 'local minima', f.minima);
  }
  for (const j of f.jumps) out.push(`It jumps from ${num(j.from)} to ${num(j.to)} at ${v} = ${num(j.x)}.`);
  if (f.asymptotes.length)
    out.push(`It has ${f.asymptotes.length === 1 ? 'a vertical asymptote' : 'vertical asymptotes'} at ${atX(f.asymptotes, v)}.`);
  for (const [p, q] of f.gaps) out.push(`It is not defined for ${v} from ${num(p)} to ${num(q)}.`);
  return out.join(' ');
}

export function describeGraph(facts: GraphFacts): { short: string; long: string } {
  const { spec, yWindow } = facts;
  const v = spec.v;
  const [a, b] = spec.window.x;
  const [c, d] = yWindow;
  const single = spec.curves.length === 1;
  const names = spec.curves.map((cv) => curveName(cv, spec, single, false));

  const short = `Graph of ${list(names)} for ${v} from ${num(a)} to ${num(b)}.`;

  const parts: string[] = [
    `Horizontal axis ${spec.axes.x} from ${num(a)} to ${num(b)}; vertical axis ${spec.axes.y} from ${num(c)} to ${num(d)}.`,
  ];
  for (const f of facts.curves) parts.push(describeCurve(f, spec, yWindow, single));
  for (const m of spec.impulses)
    parts.push(
      `An impulse${m.label ? `, ${m.label},` : ''} of size ${num(Math.abs(m.size))} at ${v} = ${num(m.at)}, ` +
        `drawn as an ${m.size > 0 ? 'upward' : 'downward'} arrow.`,
    );
  parts.push(...describeMarks(spec));
  return { short, long: parts.join(' ') };
}
