import type { Box, Figure } from '../types.ts';
import { MARKER_LINE, sourceUnits } from './transcript.ts';

/**
 * Figures side by side (2.2.3). Pure functions, no DOM.
 *
 * A figure with `besidePrevious` sits in one row with the figure right before it, as
 * long as their markers are next to each other in the text (only blank lines between).
 * A row is shown as one line of figures; text never flows beside a figure in a row.
 * Rows come from the text order, so moving a marker away simply ends the row.
 */

/** Space between figures in a row, in % of the text column. */
export const ROW_GAP = 4;

/** For each marker unit, its figure id; null for text units. */
function markerIds(source: string): (number | null)[] {
  const lines = source.split('\n');
  return sourceUnits(source).map((u) => {
    const m = u.start === u.end ? lines[u.start].match(MARKER_LINE) : null;
    return m ? Number(m[1]) : null;
  });
}

/** The rows on a page: groups of two or more figure ids, in text order. */
export function figureRows(source: string, figures: Pick<Figure, 'id' | 'besidePrevious'>[]): number[][] {
  const beside = new Set(figures.filter((f) => f.besidePrevious).map((f) => f.id));
  const rows: number[][] = [];
  let cur: number[] = [];
  let prevWasMarker = false;
  for (const id of markerIds(source)) {
    if (id !== null && prevWasMarker && beside.has(id) && figures.some((f) => f.id === id)) cur.push(id);
    else {
      if (cur.length > 1) rows.push(cur);
      cur = id !== null && figures.some((f) => f.id === id) ? [id] : [];
    }
    prevWasMarker = id !== null;
  }
  if (cur.length > 1) rows.push(cur);
  return rows;
}

/** Ids of every figure that is in a row. */
export function rowMembers(source: string, figures: Pick<Figure, 'id' | 'besidePrevious'>[]): Set<number> {
  return new Set(figureRows(source, figures).flat());
}

/** The figure whose marker comes last before figure id's marker (its candidate partner), and whether it is right before it. */
export function previousFigure(source: string, id: number): { id: number; adjacent: boolean } | null {
  const ids = markerIds(source);
  const at = ids.indexOf(id);
  for (let i = at - 1; i >= 0; i--) {
    const p = ids[i];
    if (p !== null) return { id: p, adjacent: i === at - 1 };
  }
  return null;
}

/**
 * Widths that fit side by side: unchanged when they already fit, otherwise scaled
 * down together (multiples of 5, at least 20%).
 */
export function fitWidths(widths: number[]): number[] {
  const room = 100 - ROW_GAP * (widths.length - 1);
  const total = widths.reduce((s, w) => s + w, 0);
  if (total <= room) return widths;
  return widths.map((w) => Math.max(20, Math.floor(((w * room) / total) / 5) * 5));
}

/** Two drawings level with each other on the page (overlapping heights) and apart across it. */
export function besideEachOther(a: Box, b: Box): boolean {
  const v = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const h = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return v >= 0.5 * Math.min(a.h, b.h) && h <= 0;
}

/**
 * Drawings that sit side by side on the page and whose markers are next to each other
 * in the text become a row: their markers are put in left-to-right order, and the ids
 * that sit beside the one before them are returned.
 */
export function detectRows(source: string, figs: { id: number; box: Box }[]): { source: string; beside: Set<number> } {
  const lines = source.split('\n');
  const units = sourceUnits(source);
  const ids = markerIds(source);
  const boxOf = (id: number) => figs.find((f) => f.id === id)?.box;
  const beside = new Set<number>();
  let i = 0;
  while (i < ids.length) {
    // A run of figures whose markers are next to each other and which are level with each other.
    let j = i + 1;
    const first = ids[i] !== null ? boxOf(ids[i]!) : undefined;
    if (first) {
      while (j < ids.length && ids[j] !== null) {
        const b = boxOf(ids[j]!);
        const a = boxOf(ids[j - 1]!);
        if (!a || !b || !besideEachOther(a, b)) break;
        j++;
      }
    }
    if (j - i > 1) {
      const group = ids.slice(i, j) as number[];
      const ordered = [...group].sort((p, q) => boxOf(p)!.x - boxOf(q)!.x);
      group.forEach((_, k) => (lines[units[i + k].start] = `[[FIGURE ${ordered[k]}]]`));
      ordered.slice(1).forEach((id) => beside.add(id));
      i = j;
    } else i++;
  }
  return { source: lines.join('\n'), beside };
}

/** Moves figure id's marker to right after figure after's marker; the rest of the text is unchanged. */
export function placeAfter(source: string, id: number, after: number): string {
  const lines = source.split('\n');
  const markerOf = (l: string) => Number(l.match(MARKER_LINE)?.[1]);
  const from = lines.findIndex((l) => markerOf(l) === id);
  if (from < 0 || !lines.some((l) => markerOf(l) === after)) return source;
  const rest = [...lines.slice(0, from), ...lines.slice(from + 1)];
  const at = rest.findIndex((l) => markerOf(l) === after);
  rest.splice(at + 1, 0, '', `[[FIGURE ${id}]]`);
  return rest.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
