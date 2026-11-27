// Run: npm test   (Wave 2 improvements: ink check, 2-column & dense band splitting, slope/line/schematic/math-alt redraw, stacked beside figures, IBP rescue, checklist & shortcuts, offline HTML & recent sessions)
import assert from 'node:assert/strict';
import { redraw } from '../src/lib/redraw/index.ts';
import { checkSpec } from '../src/lib/redraw/spec.ts';
import { checkRedrawInk } from '../src/lib/redraw/inkCheck.ts';
import { mathifyAlt } from '../src/lib/redraw/describe.ts';
import { redrawPrompt } from '../src/lib/redraw/prompt.ts';
import { analyzeLayout, buildInkMap, cropInkMap, detectTwoColumns, splitDenseBands } from '../src/lib/layout.ts';
import { cleanModelOutput, rescueScratchNotes, sourceUnits } from '../src/lib/transcript.ts';
import { composeNotes, markdownToHtml } from '../src/lib/markdown.ts';
import { buildDocument, figureHtml, finalizeOfflineHtml, pageHtml } from '../src/lib/exportHtml.ts';
import { applyEdit, applyMark, hasBrokenMarkup, pageBlocks, pageIssues, shortcutMark } from '../src/lib/editing.ts';
import { pruneRecentList } from '../src/lib/storage.ts';
import type { Figure, Page } from '../src/types.ts';

/* ---------------- Helper to paint a synthetic RGBA page ---------------- */
function blankRgba(w: number, h: number) {
  return new Uint8ClampedArray(w * h * 4).fill(248);
}
function paint(rgba: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(h, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(w, Math.round(x1)); x++) {
      const i = (y * w + x) * 4;
      rgba[i] = 20;
      rgba[i + 1] = 25;
      rgba[i + 2] = 60;
    }
  }
}

/* ---------------- Group A: Ink-vs-Redraw Sanity Check ---------------- */
{
  const W = 240;
  const H = 180;
  const rgba = blankRgba(W, H);
  // Axes at x = 24, y = 150
  paint(rgba, W, H, 22, 15, 25, 160);
  paint(rgba, W, H, 15, 148, 225, 151);
  // Sketch an increasing diagonal ramp from (0, 0) to (4, 4) -> y goes from 150 up to 20
  for (let x = 24; x <= 216; x += 2) {
    const t = (x - 24) / (216 - 24);
    const y = 150 - t * 130;
    paint(rgba, W, H, x - 1, y - 1, x + 2, y + 2);
  }
  const map = buildInkMap(rgba, W, H);
  const cropped = cropInkMap(map, { x: 0, y: 0, w: 1, h: 1 });

  const goodRedraw = redraw(
    { kind: 'graph', from: 'y = t', window: { x: [0, 4], y: [0, 4] }, axes: { x: 't', y: 'y' }, curves: [{ expr: 't' }] },
    { id: 'ok' },
  );
  assert.ok(goodRedraw.ok);
  const resOk = checkRedrawInk(cropped, goodRedraw);
  assert.equal(resOk.matches, true, `matching ramp accepted (score=${resOk.score})`);

  const badRedraw = redraw(
    { kind: 'graph', from: 'y = 4 - t', window: { x: [0, 4], y: [0, 4] }, axes: { x: 't', y: 'y' }, curves: [{ expr: '4 - t' }] },
    { id: 'bad' },
  );
  assert.ok(badRedraw.ok);
  const resBad = checkRedrawInk(cropped, badRedraw);
  assert.equal(resBad.matches, false, `flipped ramp flagged as mismatch (score=${resBad.score})`);

  // pageIssues flags redrawCheck when active
  const fig: Figure = {
    id: 1,
    box: { x: 0, y: 0, w: 0.5, h: 0.4 },
    alt: 'Ramp sketch',
    caption: '',
    src: 'data:image/png;base64,AA==',
    needsReview: false,
    width: 60,
    align: 'center',
    wrap: false,
    besideLines: 0,
    redraw: { spec: JSON.stringify({ kind: 'graph', from: 'y = t', axes: { x: 't', y: 'y' }, window: { x: [0, 4], y: [0, 4] }, curves: [{ expr: 't' }] }), show: 'both' },
    redrawCheck: true,
  };
  const issues = pageIssues({ source: '', figures: [fig] });
  assert(issues.some((i) => i.kind === 'redraw-check' && i.figure === 1), 'redraw-check issue raised');
}

/* ---------------- Group B: Two-Column Handouts, Dense Bands, [[columns]] ---------------- */
{
  const W = 800;
  const H = 1000;
  const rgba = blankRgba(W, H);
  // Header spanning top (y = 40..95)
  for (let x = 140; x < 640; x += 40) paint(rgba, W, H, x, 50, x + 22, 65);
  for (let x = 180; x < 580; x += 35) paint(rgba, W, H, x, 75, x + 18, 90);
  // Two-column body below y = 140 leaving x = 380..420 clean
  for (let y = 150; y < 900; y += 55) {
    for (let x = 50; x < 340; x += 36) paint(rgba, W, H, x, y, x + 20, y + 12);
    for (let x = 440; x < 740; x += 36) paint(rgba, W, H, x, y, x + 20, y + 12);
  }
  const map = buildInkMap(rgba, W, H);
  const layout = analyzeLayout(map);
  const twoCol = detectTwoColumns(map, layout);
  assert(twoCol !== null, 'two-column layout detected');
  assert(twoCol.headerBox !== null && twoCol.headerBox.h < 0.2, 'header crop extracted');
  assert(twoCol.gutterX >= 0.45 && twoCol.gutterX <= 0.55, `centered gutter found (${twoCol.gutterX})`);

  // Dense single-column page (14 lines with clean horizontal gap around middle)
  const denseRgba = blankRgba(W, H);
  const ys = [40, 90, 140, 190, 240, 290, 340, 520, 580, 640, 700, 760, 820, 880];
  for (const y of ys) {
    for (let x = 80; x < 680; x += 48) paint(denseRgba, W, H, x, y, x + 26, y + 12);
  }
  const denseMap = buildInkMap(denseRgba, W, H);
  const denseLayout = analyzeLayout(denseMap);
  assert.equal(detectTwoColumns(denseMap, denseLayout), null, 'single-column page is not misclassified as two-column');
  const bands = splitDenseBands(denseLayout);
  assert(bands !== null && bands.length === 2, `dense page split into 2 bands (got ${bands?.length})`);
  assert(bands[0].h > 0.35 && bands[1].h > 0.35);

  // [[columns]] rendering + sourceUnits grouping
  const colsMd = '## Basic Laplace Transforms\n\n[[columns]]\n| $f(t)$ | $F(s)$ |\n|---|---|\n| $1$ | $\\frac{1}{s}$ |\n[[next]]\n[[box: Derivatives]]\n$$\\mathcal{L}\\{y\'\\} = sY - y(0)$$\n[[/box]]\n[[/columns]]';
  assert.equal(sourceUnits(colsMd).length, 2, '[[columns]]...[[/columns]] kept in one sourceUnit');
  const colsHtml = markdownToHtml(colsMd, { figure: () => '', notebox: true });
  assert(colsHtml.includes('<div class="side-by-side"><div class="col">'), 'columns wrapper emitted');
  assert(colsHtml.includes('</div><div class="col">'), 'column break emitted');
  assert(colsHtml.includes('class="notebox" role="region" aria-label="Derivatives"'));
}

/* ---------------- Group C: Schematic Curves, MathJax Alt, "slope", "line" ---------------- */
{
  // Page 6 schematic f(t) vs f(t - c)
  const p6Spec = {
    kind: 'graph',
    from: 'f(t - c)',
    schematic: true,
    params: [{ name: 'c', value: 2 }],
    window: { x: [0, 5], y: [-0.2, 2] },
    axes: { x: 't', y: 'y' },
    curves: [
      { expr: 'f(t)', style: 'dashed', label: 'f(t)' },
      { expr: 'f(t - c)', style: 'solid', label: 'f(t - c)' },
    ],
  };
  const checkedP6 = checkSpec(p6Spec);
  assert.deepEqual(checkedP6.errors, []);
  assert.deepEqual(checkedP6.warnings, [], 'no from-vs-curve warning on schematic graphs');
  const resP6 = redraw(p6Spec, { id: 'p6' });
  assert.ok(resP6.ok);
  assert(resP6.alt.markdown.includes('$(0, 0)$') || resP6.alt.markdown.includes('$t$'), 'MathJax alt.markdown formats coordinates/vars');

  // Slope field (1D non-autonomous ODE + isocline)
  const sl = redraw(
    {
      kind: 'slope',
      from: "y' = t - y",
      slope: 't - y',
      window: { x: [-3, 3], y: [-3, 3] },
      show: ['field', 'isoclines'],
      solutions: [{ start: [0, 1] }],
    },
    { id: 'sl1' },
  );
  assert.ok(sl.ok && sl.facts.kind === 'slope');
  assert.match(sl.alt.short, /Slope field for y′ = t − y/);
  assert.match(sl.alt.long, /zero-isocline \(y′ = 0, dashed\) is y = t\./);
  assert.match(sl.alt.long, /solution curve through \(0, 1\)/);
  assert(sl.svg.includes('<title id="sl1-title">') && sl.svg.includes('<desc id="sl1-desc">'));
  assert(sl.svg.includes('y′ = 0'), 'zero-isocline labeled on slope field');

  // Number line / derivative sign chart
  const ln1 = redraw(
    {
      kind: 'line',
      from: "f'(x) = (x + 2)(x - 1)",
      signs: [{ on: ['-inf', -2], sign: '+' }, { on: [-2, 1], sign: '-' }, { on: [1, 'inf'], sign: '+' }],
      intervals: [{ on: [-2, 1], ends: ['open', 'open'], label: 'decreasing' }],
    },
    { id: 'ln1' },
  );
  assert.ok(ln1.ok && ln1.facts.kind === 'line');
  assert.match(ln1.alt.short, /Sign chart for x/);
  assert.match(ln1.alt.long, /positive on \(−∞, −2\), negative on \(−2, 1\), and positive on \(1, ∞\)/);
  const openLn1 = (ln1.svg.match(/<(?!\/)[a-zA-Z]+(?:\s[^>]*)?(?<!\/)>/g) ?? []).length;
  const closeLn1 = (ln1.svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
  assert.equal(openLn1, closeLn1, '1D line SVG tags balanced');

  // 2D complex s-plane pole-zero plot with ROC
  const sp = redraw(
    {
      kind: 'line',
      from: 'F(s) = \\frac{s + 1}{(s + 2)^2 + 4}',
      zeros: [[-1, 0]],
      poles: [[-2, 2], [-2, -2]],
      roc: { gt: -2 },
    },
    { id: 'sp1' },
  );
  assert.ok(sp.ok && sp.facts.kind === 'line');
  assert.match(sp.alt.long, /Poles \(marked ×\) at \(−2, 2\) and \(−2, −2\)/);
  assert.match(sp.alt.long, /Shaded region of convergence: Re\(s\) > −2\./);
  const openSp = (sp.svg.match(/<(?!\/)[a-zA-Z]+(?:\s[^>]*)?(?<!\/)>/g) ?? []).length;
  const closeSp = (sp.svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
  assert.equal(openSp, closeSp, 's-plane SVG tags balanced');

  // Prompt examples for slope and line validate with 0 errors
  const prText = redrawPrompt('NOTES');
  for (const m of prText.matchAll(/^\{"kind": "(slope|line)".*\}$/gm)) {
    assert.deepEqual(checkSpec(m[0]).errors, [], `prompt example valid: ${m[0]}`);
  }

  // Cards Detailed description uses alt.markdown with MathJax delimiters
  const cardFigHtml = figureHtml(
    {
      id: 1,
      box: { x: 0, y: 0, w: 0.5, h: 0.4 },
      alt: 'slope field',
      caption: '',
      src: 'data:image/png;base64,AA==',
      needsReview: false,
      width: 60,
      align: 'center',
      wrap: false,
      besideLines: 0,
      redraw: {
        spec: JSON.stringify({ kind: 'slope', from: "y' = t - y", slope: 't - y', window: { x: [-3, 3], y: [-3, 3] }, show: ['field', 'isoclines'] }),
        show: 'redrawn',
      },
    },
    1,
    false,
    'cards',
  );
  assert(cardFigHtml.includes('Slope field for \\(y\' = t - y\\)'), cardFigHtml);
  assert(cardFigHtml.includes('\\(y = t\\)'), cardFigHtml);
  assert(typeof mathifyAlt('Horizontal axis t from −3 to 3; vertical axis y from −3 to 3.') === 'string');
}

/* ---------------- Group D: Page 5 Stacked Side Figures & Integration-by-Parts Rescue ---------------- */
{
  const fig1: Figure = {
    id: 1,
    box: { x: 0.05, y: 0.22, w: 0.36, h: 0.30 },
    alt: 'Delayed ramp y = u_1(t)(t - 1)',
    caption: '',
    src: 'data:image/png;base64,AA==',
    needsReview: false,
    width: 45,
    align: 'left',
    wrap: true,
    besideLines: 1,
  };
  const fig2: Figure = {
    id: 2,
    box: { x: 0.52, y: 0.32, w: 0.36, h: 0.25 },
    alt: 'Comparison of y = t and delayed y = t - 1',
    caption: '',
    src: 'data:image/png;base64,BB==',
    needsReview: false,
    width: 45,
    align: 'right',
    wrap: false,
    besideLines: 0,
  };
  const p5: Page = {
    id: 'p5',
    label: 'Lesson29.pdf, page 5',
    image: new Blob(),
    url: '',
    width: 100,
    height: 100,
    status: 'done',
    source: [
      '[[FIGURE 1]]',
      '',
      'think of it as a delay of <u>the same shape</u> that would have happened at $t = 0$',
      '',
      '[[FIGURE 2]]',
      '',
      '$$\\mathcal{L}\\{u_1(t)(t - 1)\\} = \\int_1^\\infty (t - 1)e^{-st}\\,dt$$',
    ].join('\n'),
    figures: [fig1, fig2],
  };
  const html5 = pageHtml(p5, 5, undefined, 'cards');
  assert(html5.includes('<div class="side-by-side">'), 'Page 5 renders 2-column grid');
  const sideIdx = html5.indexOf('<div class="side-text">');
  assert(sideIdx > 0 && html5.indexOf('fig-5-2') > sideIdx, 'Figure 2 is stacked inside .side-text right column beside Figure 1');
  assert(html5.indexOf('fig-5-1') < sideIdx, 'Figure 1 sits in left column before .side-text');

  // Margin IBP rescue
  const jammed = cleanModelOutput(
    '$$\\int_1^\\infty (t - 1)e^{-st}\\,dt \\qquad \\begin{array}{ll} u = t - 1 & dv = e^{-st}\\,dt \\\\ du = dt & v = -\\frac{1}{s}e^{-st} \\end{array}$$',
  );
  assert(jammed.includes('[[scratch: integration by parts |'), jammed);
  const ibpHtml = markdownToHtml(jammed, { figure: () => '', noteStyle: 'list' });
  assert(ibpHtml.includes('<strong>where</strong> (integration by parts):'), ibpHtml);
  assert(ibpHtml.includes('\\(u = t - 1\\), \\(dv = e^{-st}\\,dt\\)'), ibpHtml);
  assert(ibpHtml.includes('\\(du = dt\\), \\(v = -\\frac{1}{s}e^{-st}\\)'), ibpHtml);

  const standaloneIbp = rescueScratchNotes('$$u = t - 1, \\quad dv = e^{-st}dt$$\n$$du = dt, \\quad v = -\\frac{1}{s}e^{-st}$$');
  assert(standaloneIbp.startsWith('[[scratch: integration by parts |'));
  assert(composeNotes(standaloneIbp, 'prose').includes('[[where: where (integration by parts)'));
}

/* ---------------- Group E: Checklist, Side Preview, Shortcuts, Offline HTML, Storage ---------------- */
{
  const issues = pageIssues({
    source: 'Line with [illegible] and another [illegible] plus [[bogus: x]] inside text',
    figures: [],
  });
  assert(issues.some((i) => i.kind === 'illegible' && i.text.startsWith('2 [illegible]')));
  assert(issues.some((i) => i.kind === 'markup'));
  assert.equal(hasBrokenMarkup('[[red: valid]] and `[[literal]]` and $[[x]]$'), false);
  assert.equal(hasBrokenMarkup('[[box: Derivatives]]\nhello\n[[/box]]'), false);
  assert.equal(hasBrokenMarkup('[[columns]]\na\n[[next]]\nb\n[[/columns]]'), false);

  // Toolbar marks & shortcuts
  const cal = applyMark('important formula', 0, 17, 'callout');
  assert.equal(applyEdit('important formula', cal), '[[box: ]]\nimportant formula\n[[/box]]');
  const cols = applyMark('left col', 0, 8, 'columns');
  assert.equal(applyEdit('left col', cols), '[[columns]]\nleft col\n[[next]]\n\n[[/columns]]');
  assert.equal(shortcutMark({ key: 'm', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), 'math');
  assert.equal(shortcutMark({ key: 'M', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }), 'display');
  assert.equal(shortcutMark({ key: 'b', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), 'box');
  assert.equal(shortcutMark({ key: 'u', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }), 'underline');

  // Side-by-side click-to-edit preview classes in cards look (classic unchanged)
  const sidePage = {
    source: '[[FIGURE 1]]\n\nbeside',
    figures: [{ id: 1, box: { x: 0, y: 0, w: 0.4, h: 0.3 }, alt: 'plot', caption: '', src: 'x', needsReview: false, width: 45, align: 'left' as const, wrap: true, besideLines: 1 }],
  };
  const pbCards = pageBlocks(sidePage, 1, 'h', 'cards');
  assert(pbCards.html[0].includes('blk-side-left'), 'cards preview uses side-by-side float class');
  assert(!pageBlocks(sidePage, 1, 'h', 'classic').html[0].includes('blk-side'), 'classic preview untouched');

  // Offline HTML finalization strips CDN script & keeps cache + styles
  const onlineDoc = buildDocument(
    [{ id: '1', label: 'p1', image: new Blob(), url: '', width: 10, height: 10, status: 'done', source: '$$x^2$$', figures: [] }],
    { title: 'Test', lang: 'en', pageMarkers: true, look: 'cards' },
  );
  assert(onlineDoc.includes('cdn.jsdelivr.net/npm/mathjax'));
  const offline = finalizeOfflineHtml(onlineDoc, '<section>rendered</section>', 'mjx-container{display:block}', '<svg id="MJX-SVG-global-cache"></svg>');
  assert(!offline.includes('cdn.jsdelivr.net'), 'CDN script stripped for offline viewing');
  assert(offline.includes('<style id="MJX-SVG-styles">mjx-container{display:block}</style>'));
  assert(offline.includes('<div hidden aria-hidden="true"><svg id="MJX-SVG-global-cache"></svg></div>'));
  assert(offline.includes('<section>rendered</section>'));
  assert(offline.includes('beforeprint'), 'print description handler kept');

  // Recent sessions pruning/deduping
  const recent = pruneRecentList(
    [
      { id: 'a', savedAt: 10 },
      { id: 'b', savedAt: 50 },
      { id: 'a', savedAt: 60 },
      { id: 'c', savedAt: 20 },
      { id: 'd', savedAt: 30 },
      { id: 'e', savedAt: 40 },
      { id: 'f', savedAt: 70 },
    ],
    5,
  );
  assert.deepEqual(recent.map((r) => [r.id, r.savedAt]), [['f', 70], ['a', 60], ['b', 50], ['e', 40], ['d', 30]]);
}

console.log('Wave 2 tests passed.');
