// Run: npm test   (Guided touch-up UX: block review queue, scan spotlight bands, page undo/redo history, math palette & block split/merge)
import assert from 'node:assert/strict';
import {
  LOUPE_H,
  LOUPE_W,
  LOUPE_ZOOM,
  applyEdit,
  applySnippet,
  collectReviewItems,
  computeLoupeMetrics,
  estimateBlockBands,
  mergeBlockWithNext,
  pageIssues,
  splitBlocks,
  splitTextAtCursor,
} from '../src/lib/editing.ts';
import { EMPTY_HISTORY, pushHistory, redoHistory, undoHistory } from '../src/lib/history.ts';
import type { Figure, Page } from '../src/types.ts';

const mkFig = (id: number, y: number, h = 0.25, extra: Partial<Figure> = {}): Figure => ({
  id,
  box: { x: 0.15, y, w: 0.6, h },
  alt: `Figure ${id}`,
  caption: '',
  src: 'data:image/png;base64,x',
  needsReview: false,
  width: 60,
  align: 'center',
  wrap: false,
  besideLines: 0,
  ...extra,
});

/* ---------------- 1. Block-aware pageIssues & collectReviewItems ---------------- */
{
  const pages: Page[] = [
    {
      id: 'p1',
      label: 'p1.pdf',
      image: new Blob([]),
      url: '',
      width: 800,
      height: 1000,
      status: 'done',
      source: 'Intro paragraph\n\nHere is [illegible] text\n\n[[FIGURE 1]]\n\n$$\\frac{1}{2$$',
      figures: [mkFig(1, 0.45, 0.2, { redraw: { spec: 'from: f(x)\naxes: x, y\ncurve: x^2', show: 'both' }, redrawCheck: true })],
    },
  ];

  const pi = pageIssues(pages[0]);
  assert.equal(pi.find((x) => x.kind === 'illegible')?.block, 1);
  assert.equal(pi.find((x) => x.kind === 'latex')?.block, 3);

  const items = collectReviewItems(pages);
  assert.deepEqual(
    items.map((x) => [x.kind, x.figure ?? null, x.block ?? null]),
    [
      ['redraw-check', 1, null],
      ['illegible', null, 1],
      ['latex', null, 3],
    ],
  );
}

/* ---------------- 2. Scan spotlight band estimation ---------------- */
{
  const source = [
    '## Section Title',
    '',
    '[[FIGURE 1]]',
    '',
    'Text right beside the figure',
    '',
    'Concluding equation $$x = 1$$',
  ].join('\n');
  const figures = [mkFig(1, 0.28, 0.22, { wrap: true, align: 'left', besideLines: 1 })];
  const bands = estimateBlockBands(source, figures, [
    { y: 0.08, x0: 0.1, x1: 0.7 },
    { y: 0.82, x0: 0.1, x1: 0.8 },
  ]);
  assert.equal(bands.length, 4);
  assert(bands[0].y0 < bands[1].y0, 'intro block sits above figure 1');
  assert.deepEqual(bands[1], { y0: 0.28, y1: 0.5 }, 'figure block anchors to exact crop');
  assert.deepEqual(bands[2], { y0: 0.28, y1: 0.5 }, 'beside text shares wrapped figure vertical band');
  assert(bands[3].y0 >= 0.28 && bands[3].y1 <= 1, 'concluding block sits after figure and stays in [0, 1]');
}

/* ---------------- 3. Page-wide Undo / Redo history ---------------- */
{
  const s0 = { source: 'alpha', figures: [mkFig(1, 0.2)] };
  const s1 = { source: 'beta', figures: [mkFig(1, 0.2)] };
  const s2 = { source: 'beta', figures: [mkFig(1, 0.3)] };

  let h = EMPTY_HISTORY;
  h = pushHistory(h, s0, s0); // no-op should not record
  assert.equal(h.past.length, 0);

  h = pushHistory(h, s0, s1);
  h = pushHistory(h, s1, s2);
  assert.equal(h.past.length, 2);

  const u1 = undoHistory(h, s2)!;
  assert.equal(u1.snapshot.source, 'beta');
  assert.equal(u1.snapshot.figures[0].box.y, 0.2);

  const u2 = undoHistory(u1.history, u1.snapshot)!;
  assert.equal(u2.snapshot.source, 'alpha');

  const r1 = redoHistory(u2.history, u2.snapshot)!;
  assert.equal(r1.snapshot.source, 'beta');
}

/* ---------------- 4. Math quick-palette snippets & block split/merge ---------------- */
{
  const outOutside = applySnippet('Area ', 5, 5, 'frac');
  assert.equal(applyEdit('Area ', outOutside), 'Area $\\frac{}{}$');
  assert.equal(outOutside.selStart, 'Area $\\frac{'.length);

  const inside = applySnippet('$y = $', 5, 5, 'sqrt');
  assert.equal(applyEdit('$y = $', inside), '$y = \\sqrt{}$');
  assert.equal(inside.selStart, '$y = \\sqrt{'.length);

  const disp = applySnippet('Define', 6, 6, 'cases');
  assert.equal(applyEdit('Define', disp), 'Define\n$$\n\\begin{cases} , & \\\\ , & \\end{cases}\n$$');

  assert.deepEqual(splitTextAtCursor('first line\nsecond line', 10), ['first line', 'second line']);
  assert.equal(splitTextAtCursor('singleword', 0), null);

  const mSrc = 'para one\n\npara two\n\n[[FIGURE 1]]';
  const mBlocks = splitBlocks(mSrc);
  assert.equal(mergeBlockWithNext(mSrc, mBlocks, 0), 'para one\npara two\n\n[[FIGURE 1]]');
  assert.equal(mergeBlockWithNext(mSrc, mBlocks, 1), null, 'cannot merge text block with a figure');
}

/* ---------------- 5. 2.5x Loupe pixel magnification alignment ---------------- */
{
  const m = computeLoupeMetrics(0.4, 0.3, 600, 800);
  assert.equal(m.bgW, 600 * LOUPE_ZOOM);
  assert.equal(m.bgH, 800 * LOUPE_ZOOM);
  assert.equal(m.bgX + 0.4 * m.bgW, LOUPE_W / 2, 'cursor X aligns with center of loupe');
  assert.equal(m.bgY + 0.3 * m.bgH, LOUPE_H / 2, 'cursor Y aligns with center of loupe');
}

console.log('Review and touch-up tests passed.');
