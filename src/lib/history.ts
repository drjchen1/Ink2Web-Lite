import type { Figure } from '../types.ts';

/** Bounded per-page undo/redo snapshot stack for the in-app touch-up workspace. */
export interface PageSnapshot {
  source: string;
  figures: Figure[];
}

export interface HistoryState {
  past: PageSnapshot[];
  future: PageSnapshot[];
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

export function snapshotsEqual(a: PageSnapshot, b: PageSnapshot): boolean {
  return a.source === b.source && JSON.stringify(a.figures) === JSON.stringify(b.figures);
}

/** Pushes `prev` onto the undo stack when it differs from `next` (clears `future`). */
export function pushHistory(h: HistoryState, prev: PageSnapshot, next: PageSnapshot, limit = 30): HistoryState {
  if (snapshotsEqual(prev, next)) return h;
  const past = [...h.past, prev];
  if (past.length > limit) past.shift();
  return { past, future: [] };
}

/** Pops the latest snapshot from `past` and pushes `current` onto `future`. */
export function undoHistory(
  h: HistoryState,
  current: PageSnapshot,
): { history: HistoryState; snapshot: PageSnapshot } | null {
  if (!h.past.length) return null;
  const snapshot = h.past[h.past.length - 1];
  return {
    history: { past: h.past.slice(0, -1), future: [current, ...h.future].slice(0, 30) },
    snapshot,
  };
}

/** Re-applies the earliest snapshot from `future` and pushes `current` onto `past`. */
export function redoHistory(
  h: HistoryState,
  current: PageSnapshot,
): { history: HistoryState; snapshot: PageSnapshot } | null {
  if (!h.future.length) return null;
  const [snapshot, ...rest] = h.future;
  return {
    history: { past: [...h.past, current], future: rest },
    snapshot,
  };
}
