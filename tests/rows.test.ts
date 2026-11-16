// Run: npm test   (figures side by side, 2.2.3)
import assert from 'node:assert/strict';
import { besideEachOther, detectRows, figureRows, fitWidths, placeAfter, previousFigure, rowMembers } from '../src/lib/figureRows.ts';
import { buildDocument, figureHtml, pageHtml, withRows, withWrapEnds } from '../src/lib/exportHtml.ts';
import { pageBlocks } from '../src/lib/editing.ts';
import { projectFromJson, projectToJson } from '../src/lib/storage.ts';
import type { Figure, Page } from '../src/types.ts';

const fig = (id: number, over: Partial<Figure> = {}): Figure => ({
  id,
  box: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
  alt: `figure ${id}`,
  caption: '',
  src: 'data:x',
  needsReview: false,
  width: 40,
  align: 'center',
  wrap: false,
  besideLines: 0,
  ...over,
});
const page = (source: string, figures: Figure[]): Page => ({ id: 'p', label: 'x', image: new Blob(), url: '', width: 1, height: 1, status: 'done', source, figures });

/* ---------------- rows from the text ---------------- */
const src = 'intro\n\n[[FIGURE 1]]\n\n[[FIGURE 2]]\n\nbetween\n\n[[FIGURE 3]]\n[[FIGURE 4]]\n[[FIGURE 5]]\nend';
const figs = [fig(1), fig(2, { besidePrevious: true }), fig(3), fig(4, { besidePrevious: true }), fig(5, { besidePrevious: true })];
assert.deepEqual(figureRows(src, figs), [[1, 2], [3, 4, 5]]);
assert.deepEqual([...rowMembers(src, figs)], [1, 2, 3, 4, 5]);
// Text between the markers ends a row; the flag alone does nothing.
assert.deepEqual(figureRows('[[FIGURE 1]]\ntext\n[[FIGURE 2]]', [fig(1), fig(2, { besidePrevious: true })]), []);
assert.deepEqual(figureRows('text\n\n[[FIGURE 2]]', [fig(2, { besidePrevious: true })]), []);
// Adjacent markers without the flag are two separate figures.
assert.deepEqual(figureRows('[[FIGURE 1]]\n\n[[FIGURE 2]]', [fig(1), fig(2)]), []);
// A row breaks where a figure isn't flagged: 1–2 and 3–4.
assert.deepEqual(
  figureRows('[[FIGURE 1]]\n[[FIGURE 2]]\n[[FIGURE 3]]\n[[FIGURE 4]]', [fig(1), fig(2, { besidePrevious: true }), fig(3), fig(4, { besidePrevious: true })]),
  [[1, 2], [3, 4]],
);

assert.deepEqual(previousFigure(src, 2), { id: 1, adjacent: true });
assert.deepEqual(previousFigure(src, 3), { id: 2, adjacent: false });
assert.equal(previousFigure(src, 1), null);

// Joining a figure that isn't next to the other one moves its marker.
const moved = placeAfter('a\n\n[[FIGURE 1]]\n\nb\n\n[[FIGURE 2]]\n\nc', 2, 1);
assert.equal(moved, 'a\n\n[[FIGURE 1]]\n\n[[FIGURE 2]]\n\nb\n\nc');
assert.deepEqual(figureRows(moved, [fig(1), fig(2, { besidePrevious: true })]), [[1, 2]]);

assert.deepEqual(fitWidths([40, 40]), [40, 40]);
assert.deepEqual(fitWidths([60, 60]), [45, 45]);
assert.deepEqual(fitWidths([100, 50]), [60, 30]);
assert.deepEqual(fitWidths([60, 60, 60]), [30, 30, 30]);

/* ---------------- detection on the page ---------------- */
const L = { x: 0.15, y: 0.6, w: 0.3, h: 0.25 };
const R = { x: 0.6, y: 0.55, w: 0.25, h: 0.3 };
assert(besideEachOther(L, R) && besideEachOther(R, L));
assert(!besideEachOther(L, { x: 0.15, y: 0.1, w: 0.3, h: 0.2 }), 'one above the other');
assert(!besideEachOther(L, { x: 0.3, y: 0.6, w: 0.3, h: 0.25 }), 'overlapping across');
// Markers in right-to-left order (the right drawing starts higher) are put left to right.
let d = detectRows('text\n\n[[FIGURE 1]]\n\n[[FIGURE 2]]\n\nmore', [{ id: 1, box: R }, { id: 2, box: L }]);
assert.equal(d.source, 'text\n\n[[FIGURE 2]]\n\n[[FIGURE 1]]\n\nmore');
assert.deepEqual([...d.beside], [1]);
// Text between them, or drawings one above the other: no row.
assert.equal(detectRows('[[FIGURE 1]]\nx\n[[FIGURE 2]]', [{ id: 1, box: L }, { id: 2, box: R }]).beside.size, 0);
assert.equal(detectRows('[[FIGURE 1]]\n[[FIGURE 2]]', [{ id: 1, box: L }, { id: 2, box: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } }]).beside.size, 0);

/* ---------------- export ---------------- */
const two = [fig(1, { width: 45, align: 'left', wrap: true, besideLines: 1 }), fig(2, { width: 45, besidePrevious: true })];
const s2 = 'before\n\n[[FIGURE 1]]\n\n[[FIGURE 2]]\n\nafter';
assert.equal(withRows(s2, two), 'before\n\n[[FIGROW 1 2]]\n\n\nafter');
let html = pageHtml(page(s2, two), 3);
assert(
  html.includes('<div class="fig-row align-left"><figure id="fig-3-1" class="fig align-left" style="--w:45%">'),
  'one row, placed by the first figure, and no text wrapping in a row',
);
assert(html.includes('</figure><figure id="fig-3-2" class="fig align-center" style="--w:45%">'));
assert.equal((html.match(/<figure /g) ?? []).length, 2);
assert(html.indexOf('before') < html.indexOf('fig-row') && html.indexOf('fig-row') < html.indexOf('after'));
assert.equal(withWrapEnds(s2, two), s2, 'a wrapped figure in a row has no "beside" lines');
// Not a row: unchanged from 2.2.2.
assert(!pageHtml(page(s2, [fig(1), fig(2)]), 3).includes('fig-row'));
assert.equal(figureHtml(fig(1, { wrap: true, align: 'left' }), 1, true), figureHtml(fig(1, { align: 'left' }), 1));
html = buildDocument([page(s2, two)], { title: 'T', lang: 'en', pageMarkers: false });
assert(html.includes('.fig-row{display:flex') && html.includes('<div class="fig-row align-left">'));

/* ---------------- the editable preview ---------------- */
const pb = pageBlocks(page(s2, [fig(1, { width: 40 }), fig(2, { width: 40, besidePrevious: true })]), 1);
assert.deepEqual(pb.blocks.map((b) => b.fig ?? null), [null, 1, 2, null], 'each figure is still its own block');
assert(pb.html[1].startsWith('<div class="blk-row-start"></div><div class="blk blk-fig blk-row"'));
assert(pb.html[1].includes('--w:40%;margin-left:8%;margin-right:4%'), 'a centered row: (100 − 40 − 4 − 40) / 2');
assert(pb.html[2].includes('--w:40%;margin-left:0%;margin-right:0%') && !pb.html[2].includes('blk-row-start'));

/* ---------------- project files keep it ---------------- */
const back = projectFromJson(await projectToJson({ title: 'T', titleAuto: false, pageMarkers: true }, [page(s2, two)]));
assert.equal(back.pages[0].figures[1].besidePrevious, true);

console.log('Side-by-side figure tests passed.');
