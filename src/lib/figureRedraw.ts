import type { Figure } from '../types.ts';
import { redraw, type RedrawResult } from './redraw/index.ts';

/**
 * Redrawn figures in the app and the export (2.2). The SVG is regenerated from the
 * stored spec, through a small cache (a phase plane takes up to half a second).
 *
 * The SVG is generated with the id prefix ID_PREFIX and given its real prefix when
 * placed, so two redrawn figures on a page never share element ids (clip paths and
 * arrowheads are referenced by id).
 */

const ID_PREFIX = 'rdsvg';
const CACHE_MAX = 40;
const cache = new Map<string, RedrawResult>();

/** The redraw for a spec text (cached; the most recently used entries are kept). */
export function redrawSpec(spec: string): RedrawResult {
  const hit = cache.get(spec);
  if (hit) {
    cache.delete(spec);
    cache.set(spec, hit);
    return hit;
  }
  let r: RedrawResult;
  try {
    r = redraw(spec, { id: ID_PREFIX });
  } catch (e) {
    // The engine shouldn't throw, but a figure must never break the page.
    r = { ok: false, errors: [`Couldn’t redraw: ${(e as Error).message}`], warnings: [] };
  }
  cache.set(spec, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return r;
}

/** The SVG with its element ids made unique (`prefix` like "fig-3-2"). */
export function placeSvg(svg: string, prefix: string): string {
  const safe = prefix.replace(/[^A-Za-z0-9_-]/g, '-');
  return svg.replace(new RegExp(`\\b${ID_PREFIX}-`, 'g'), `${safe}-`);
}

export type RedrawState =
  | { kind: 'none' }
  /** A spec is stored but has errors: the document shows the image. */
  | { kind: 'broken'; errors: string[] }
  | { kind: 'ready'; result: Extract<RedrawResult, { ok: true }> };

export function redrawState(fig: Pick<Figure, 'redraw'>): RedrawState {
  const spec = fig.redraw?.spec.trim();
  if (!spec) return { kind: 'none' };
  const r = redrawSpec(spec);
  return r.ok ? { kind: 'ready', result: r } : { kind: 'broken', errors: r.errors };
}

/** What the document actually shows: the user's choice, or the image when the redraw has errors. */
export function shownAs(fig: Pick<Figure, 'redraw'>): 'image' | 'redrawn' | 'both' {
  const want = fig.redraw?.show ?? 'image';
  if (want === 'image') return 'image';
  return redrawState(fig).kind === 'ready' ? want : 'image';
}
