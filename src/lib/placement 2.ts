import type { Box } from '../types.ts';
import { besideLines, insertionIndex, textWeight, type TextLine } from './layout.ts';
import { MARKER_LINE, insertMarkerAt, removeMarkers, sourceUnits } from './transcript.ts';

/**
 * Pure helpers that decide where figure markers go in the transcription.
 * (No DOM, no model: unit-tested in tests/layout.test.ts.)
 */

export interface Placed {
  id: number;
  box: Box;
}

/** Text units of the source with their weights, and markers with their figure's y. */
function placementUnits(source: string, yOf: (id: number) => number | undefined) {
  const lines = source.split('\n');
  return sourceUnits(source).map((u) => {
    const text = lines.slice(u.start, u.end + 1).join('\n');
    const m = u.start === u.end ? lines[u.start].match(MARKER_LINE) : null;
    const y = m ? yOf(Number(m[1])) : undefined;
    return m ? { markerY: y ?? null, weight: 0 } : { markerY: null, weight: textWeight(text) };
  });
}

/** Inserts one figure's marker where its drawing sits on the page. */
export function placeOne(source: string, fig: Placed, others: Placed[], lines: TextLine[]): string {
  const yOf = (id: number) => others.find((f) => f.id === id)?.box.y;
  return insertMarkerAt(source, fig.id, insertionIndex(fig.box, lines, placementUnits(source, yOf)));
}

/**
 * Places the markers for the given figures by their position on the page,
 * replacing wherever the model put them. Figures not in `figs` keep their markers.
 */
export function placeByPosition(source: string, figs: Placed[], keep: Placed[], lines: TextLine[]): string {
  let out = removeMarkers(source, figs.map((f) => f.id));
  const placed: Placed[] = [...keep];
  for (const f of [...figs].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    out = placeOne(out, f, placed, lines);
    placed.push(f);
  }
  return out;
}

/**
 * Renumbers figures 1..n in the order their markers appear, rewriting the markers.
 * Returns the new source and a map old id -> new id.
 */
export function renumber(source: string): { source: string; map: Map<number, number> } {
  const map = new Map<number, number>();
  for (const m of source.matchAll(/\[\[\s*FIGURE\s+(\d+)\s*\]\]/gi)) {
    const id = Number(m[1]);
    if (!map.has(id)) map.set(id, map.size + 1);
  }
  const out = source.replace(/\[\[\s*FIGURE\s+(\d+)\s*\]\]/gi, (_, id: string) => `[[FIGURE ${map.get(Number(id))}]]`);
  return { source: out, map };
}

/**
 * How many transcription lines follow figure `id` beside it. Matches the amount of
 * handwriting beside the figure to the amount of transcribed text after its marker,
 * so it stays right when the model merged or split the handwritten lines.
 */
export function besideUnitCount(source: string, fig: Placed, lines: TextLine[]): number {
  const beside = besideLines(fig.box, lines).lines;
  if (!beside.length) return 0;
  const width = (l: TextLine) => l.x1 - l.x0;
  const lineTotal = lines.reduce((n, l) => n + width(l), 0);
  const all = source.split('\n');
  const units = sourceUnits(source).map((u) => all.slice(u.start, u.end + 1).join('\n'));
  const textUnits = units.filter((u) => !MARKER_LINE.test(u));
  const textTotal = textUnits.reduce((n, u) => n + textWeight(u), 0);
  if (!lineTotal || !textTotal) return beside.length;
  const expected = (beside.reduce((n, l) => n + width(l), 0) / lineTotal) * textTotal;

  const start = units.findIndex((u) => Number(u.match(MARKER_LINE)?.[1]) === fig.id);
  if (start < 0) return beside.length;
  let acc = 0;
  let best = 1;
  let bestErr = Infinity;
  for (let i = start + 1, n = 0; i < units.length && !MARKER_LINE.test(units[i]); i++) {
    acc += textWeight(units[i]);
    n++;
    const err = Math.abs(acc - expected);
    if (err < bestErr) {
      bestErr = err;
      best = n;
    }
  }
  return best;
}
