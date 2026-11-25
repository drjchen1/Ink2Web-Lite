// Run: npm test   (Lesson 29 parity: symbolic redraws, jump guides, where-lists, noteboxes, grids, and cleanups)
import assert from 'node:assert/strict';
import { cleanExpr, REDRAW_SCHEMA } from '../src/lib/redraw/prompt.ts';
import { checkSpec } from '../src/lib/redraw/spec.ts';
import { redraw } from '../src/lib/redraw/index.ts';
import { cleanModelOutput, fixDisplayAlignment, fixLaplaceBraces, mergeArrowNotes } from '../src/lib/transcript.ts';
import { analyzeLayout, buildInkMap } from '../src/lib/layout.ts';
import { composeNotes, latexWarnings, markdownToHtml } from '../src/lib/markdown.ts';
import { buildDocument, pageHtml, resolveTitle } from '../src/lib/exportHtml.ts';
import { formatSpec } from '../src/lib/redraw/prompt.ts';
import type { Figure, Page } from '../src/types.ts';

/* ---------------- 1. Symbolic unit step redraw (Page 1) ---------------- */
{
  const stepSpec = {
    kind: 'graph',
    from: 'u_c(t)',
    params: [{ name: 'c', value: 2 }],
    window: { x: [0, 4], y: [-0.5, 1.5] },
    axes: { x: 't', y: 'f(t)' },
    curves: [
      {
        pieces: [
          { expr: '0', on: [0, 'c'], ends: ['closed', 'open'] },
          { expr: '1', on: ['c', 4], ends: ['closed', 'closed'] },
        ],
      },
    ],
  };
  const checked = checkSpec(stepSpec);
  assert.deepEqual(checked.errors, [], 'symbolic param c allowed in piece bounds');
  const out = redraw(stepSpec, { id: 'p1-f1' });
  assert.ok(out.ok, 'symbolic unit step redraws cleanly');
  assert(out.svg.includes('>c</text>'), 'symbolic tick label c shown on axis');
  assert(out.svg.includes('fill="#fff"') && out.svg.includes('fill="#4338ca"'), 'open and closed jump endpoint circles drawn');
  assert.equal((out.svg.match(/<circle /g) ?? []).length, 2, 'exactly two endpoint circles at t = c');
  assert(REDRAW_SCHEMA.properties.ticks && REDRAW_SCHEMA.properties.labels && REDRAW_SCHEMA.properties.params && REDRAW_SCHEMA.properties.jumpGuides);
}

/* ---------------- 2. 4-level step function + u_3(t) + jumpGuides (Page 2) ---------------- */
{
  assert.equal(cleanExpr('1 - u_3(t)'), '1 - u(t - 3)');
  assert.equal(cleanExpr('u_{\\pi}(t) * \\cos(t)'), 'u(t - pi) * cos(t)');

  const fourStep = {
    kind: 'graph',
    from: 'f(t) = 10 + u_1(t)(-30) + u_2(t)(50) + u_3(t)(-70)',
    window: { x: [0, 4], y: [-45, 35] },
    axes: { x: 't', y: 'f(t)' },
    jumpGuides: true,
    curves: [
      {
        pieces: [
          { expr: '10', on: [0, 1] },
          { expr: '-20', on: [1, 2] },
          { expr: '30', on: [2, 3] },
          { expr: '-40', on: [3, 4] },
        ],
      },
    ],
  };
  const out = redraw(fourStep, { id: 'p2-f2' });
  assert.ok(out.ok);
  assert.equal((out.svg.match(/stroke-dasharray="4 4"/g) ?? []).length, 1, 'jumpGuides group rendered');
  assert.equal((out.svg.match(/<line x1="[^"]+" y1="[^"]+" x2="[^"]+" y2="[^"]+"\/>/g) ?? []).length >= 3, true, '3 vertical transition lines');

  const u3 = checkSpec({
    kind: 'graph',
    from: 'f(t) = 1 - u_3(t)',
    axes: { x: 't', y: 'f(t)' },
    window: { x: [0, 5], y: [-0.5, 1.5] },
    curves: [{ expr: '1 - u(t - 3)' }],
  });
  assert.deepEqual(u3.errors, []);
  assert.deepEqual(u3.warnings, [], 'fromAsExpr matches cleaned u_3(t) without warning');
}

/* ---------------- 3. Structured where: list vs Classic prose (Pages 1, 3, 7) ---------------- */
{
  const md = [
    '$$e^{-2s} \\frac{1}{s^2 + 1}$$',
    '[[note: e^{-2s} | u_2(t)]]',
    '[[note: \\frac{1}{s^2 + 1} | F(s)]]',
  ].join('\n');
  const cardsHtml = markdownToHtml(md, { figure: () => '', noteStyle: 'list' });
  assert(cardsHtml.includes('<p><strong>where:</strong></p>'), 'list mode emits where: header');
  assert(cardsHtml.includes('<li>\\(e^{-2s}\\): \\(u_2(t)\\)'), 'pure-math correspondence uses colon, not false =');
  assert(cardsHtml.includes('<li>\\(\\frac{1}{s^2 + 1}\\): \\(F(s)\\)'));

  const rampNotes = [
    '$$f(t) = t + u_1(t)(-t + 1) + u_2(t)(-1 + 3 - t) + u_3(t)(-3 + t)$$',
    '[[note: u_1(t) | turn on at t = 1]]',
    '[[note: (-t + 1) | something that puts f(t) at 1]]',
    '[[note: -1 | reset to 0]]',
  ].join('\n');
  const rampHtml = markdownToHtml(rampNotes, { figure: () => '', noteStyle: 'list' });
  assert.equal((rampHtml.match(/<li>/g) ?? []).length, 3, 'all three notes rendered as list items');

  // Classic prose mode still produces "where ..." sentence.
  const classicHtml = markdownToHtml('$$u = R\\cos(\\omega t)$$\n[[note: \\omega | frequency]]', { figure: () => '' });
  assert(classicHtml.includes('where \\(\\omega\\) is the frequency.'));
  assert(!composeNotes('[[note: a | b]]', 'list').includes('[[where:'));
}

/* ---------------- 4. Inline underbraces & .notebox callouts (Pages 4, 5, 6, 7) ---------------- */
{
  const p4 = cleanModelOutput(
    '$$= \\underbrace{\\lim_{a \\to \\infty} -\\frac{1}{s} e^{-sa}}_{\\to 0 \\text{ if } s > 0} + \\frac{1}{s} e^{-cs}$$',
  );
  assert(p4.includes('\\underbrace{\\lim_{a \\to \\infty} -\\frac{1}{s} e^{-sa}}_{\\to 0 \\text{ if } s > 0}'), 'convergence underbrace kept inline');
  assert(!p4.includes('[[note:'), 'not extracted into where note');

  const p5 = cleanModelOutput('$$= \\underbrace{0}_{(s > 0)} - \\frac{1}{s^2} e^{-st}\\Big|_1^\\infty$$');
  assert(p5.includes('\\underbrace{0}_{(s > 0)}'), 'domain condition underbrace kept inline');

  const boxedPage: Page = {
    id: 'p4',
    label: 'Lesson29.pdf, page 4',
    image: new Blob(),
    url: '',
    width: 100,
    height: 100,
    status: 'done',
    source: [
      '$$\\boxed{\\mathcal{L}\\{u_c(t)\\} = e^{-cs} \\cdot \\frac{1}{s}} \\qquad (s > 0)$$',
      '$$= \\boxed{u_2(t) \\cdot \\sin(t - 2)}$$',
      '[[box: Derivatives]]',
      '**Derivatives** $(Y = \\mathcal{L}\\{y\\})$',
      '$$\\mathcal{L}\\{y\'\\} = sY - y(0)$$',
      '[[/box]]',
    ].join('\n\n'),
    figures: [],
  };
  const doc = buildDocument([boxedPage], { title: 'Step Functions', lang: 'en', pageMarkers: true, look: 'cards' });
  assert.equal((doc.match(/class="notebox"/g) ?? []).length, 3, 'all boxed blocks and [[box]] render as .notebox');
  assert(doc.includes('role="region" aria-label="Highlighted formula"'));
  assert(doc.includes('role="region" aria-label="Derivatives"'));
  assert(doc.includes("el.setAttribute('role', 'group')") && doc.includes("el.setAttribute('aria-label', 'Mathematical equation')"), 'display equations get group role + label');
  assert(!doc.includes('\\boxed{'), 'outer \\boxed unwrapped inside .notebox');
}

/* ---------------- 5. Side-by-side 2-column grid & redrawn card captions (Pages 1, 2, 5) ---------------- */
{
  const stepSpec = formatSpec({
    kind: 'graph',
    from: 'u_c(t)',
    params: [{ name: 'c', value: 2 }],
    window: { x: [0, 4], y: [-0.5, 1.5] },
    axes: { x: 't', y: 'f(t)' },
    curves: [
      {
        pieces: [
          { expr: '0', on: [0, 'c'], ends: ['closed', 'open'] },
          { expr: '1', on: ['c', 4], ends: ['closed', 'closed'] },
        ],
      },
    ],
  });
  const figRight: Figure = {
    id: 1,
    box: { x: 0.6, y: 0.65, w: 0.3, h: 0.25 },
    alt: 'Graph of unit step function',
    caption: '',
    src: 'data:image/png;base64,AA==',
    needsReview: false,
    width: 40,
    align: 'right',
    wrap: true,
    besideLines: 1,
    redraw: { spec: stepSpec, show: 'redrawn' },
  };
  const pageRight: Page = {
    id: 'p1',
    label: 'Lesson29.pdf, page 1',
    image: new Blob(),
    url: '',
    width: 100,
    height: 100,
    status: 'done',
    source: "let's define the <u>unit step function</u>\n\n[[FIGURE 1]]\n\n$$u_c(t) = \\begin{cases} 0 & t < c \\\\ 1 & t \\ge c \\end{cases}$$",
    figures: [figRight],
  };
  const htmlRight = pageHtml(pageRight, 1, undefined, 'cards');
  assert(htmlRight.includes('<div class="side-by-side"><div class="side-text">'), 'equation before figure when align=right');
  assert(htmlRight.indexOf('u_c(t) = \\begin{cases}') < htmlRight.indexOf('<figure id="fig-1-1"'));
  assert(htmlRight.includes('Graph of \\(u_c(t)\\)'), 'redrawn card caption renders math from spec.from');
  assert(htmlRight.includes('<summary>Detailed description</summary>'), 'redrawn card shows collapsible detailed description');

  const figLeft: Figure = { ...figRight, align: 'left' };
  const htmlLeft = pageHtml({ ...pageRight, figures: [figLeft] }, 1, undefined, 'cards');
  assert(htmlLeft.indexOf('<figure id="fig-1-1"') < htmlLeft.indexOf('<div class="side-text">'), 'figure before text when align=left');
}

/* ---------------- 6. Transcript, Markdown, Table & Layout cleanups ---------------- */
{
  // Page 6 arrow implication must not swallow "in general,"
  const p6 = mergeArrowNotes('so, we <u>don\'t</u> transform the function attached to $u_c(t)$ as is\n→ transform what it is shifted to origin\n\nin general,');
  assert(p6.includes('$\\to$ transform what it is shifted to origin'), p6);
  assert(!p6.includes('[[note:'), 'implication arrow not turned into note');

  // Even without blank line before "in general,"
  const arrowThenIntro = mergeArrowNotes('↑\nnew amplitude\nin general,\n$$x = 1$$');
  assert(arrowThenIntro.includes('[[note: ↑ new amplitude]]\nin general,'), arrowThenIntro);

  // Laplace braces & \mathscr{L}
  assert.equal(fixLaplaceBraces('$\\mathscr{L}{u_c(t)}$ and $$\\mathcal{L}^{-1}{e^{-2s}\\frac{1}{s^2+1}}$$'), '$\\mathcal{L}\\{u_c(t)\\}$ and $$\\mathcal{L}^{-1}\\{e^{-2s}\\frac{1}{s^2+1}\\}$$');
  assert.equal(fixLaplaceBraces('$\\mathcal{L}\\{y\'\\}$'), '$\\mathcal{L}\\{y\'\\}$', 'already escaped stays untouched');

  // Consecutive display alignment & bare &
  const p8 = fixDisplayAlignment('$$F(s) = \\int_0^\\infty f(t) e^{-st}\\,dt$$\n$$F(s-c) = \\int_0^\\infty f(t) e^{-(s-c)t}\\,dt$$\n$$= \\int_0^\\infty [f(t) e^{ct}] e^{-st}\\,dt$$\n$$= \\mathcal{L}\\{e^{ct} f(t)\\}$$');
  assert(p8.includes('\\begin{aligned}') && p8.includes('F(s-c) &=') && p8.includes('\\\\\n&= \\int_0^\\infty'), p8);
  assert.deepEqual(latexWarnings(p8), []);
  const bareAmp = fixDisplayAlignment('$$a &= b \\\\ &= c$$');
  assert(bareAmp.includes('\\begin{aligned}') && bareAmp.includes('a &= b'), bareAmp);

  // Multi-line colored span
  const multiColor = markdownToHtml('[[red: BUT we need $u_2(t) f(t - 2)$\nin $t$ world]]', { figure: () => '' });
  assert(multiColor.includes('<span class="ink ink-red">BUT we need \\(u_2(t) f(t - 2)\\)<br>\nin \\(t\\) world</span>'), multiColor);

  // Underlined title extraction
  const res = resolveTitle([{ id: '1', label: 'Lesson29.pdf, page 1', image: new Blob(), url: '', width: 1, height: 1, status: 'done', source: '<u>Step Functions</u>\n\nlast time:', figures: [] }], 'Lesson29', true);
  assert.equal(res.title, 'Step Functions');
  assert.equal(res.pages[0].source.trim(), 'last time:');

  // Pipe table caption + \dfrac inside cells
  const tbl = markdownToHtml('**Elementary Laplace Transforms**\n| $f(t)$ | $F(s)$ |\n|---|---|\n| $t^n$ | $\\frac{n!}{s^{n+1}}$ |', { figure: () => '' });
  assert(tbl.includes('<caption>Elementary Laplace Transforms</caption>'), tbl);
  assert(tbl.includes('aria-label="Elementary Laplace Transforms"'), tbl);
  assert(tbl.includes('\\dfrac{n!}{s^{n+1}}'), tbl);

  // Boxed equation frame is NOT detected as a figure, while real graph IS detected
  const W = 800, H = 600;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(245);
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const i = (y * W + x) * 4;
        rgba[i] = 20; rgba[i + 1] = 30; rgba[i + 2] = 110;
      }
  };
  // Handwriting words (12px tall) to establish unit
  for (let x = 100; x < 500; x += 46) for (let s = x; s < x + 32; s += 6) ink(s, 30, s + 2, 42);
  // Hand-drawn box around a formula (width 260, height 75, hollow interior with small formula text)
  ink(120, 100, 380, 104); ink(120, 171, 380, 175);
  ink(120, 100, 124, 175); ink(376, 100, 380, 175);
  for (let x = 150; x < 340; x += 28) ink(x, 130, x + 10, 142);
  // Real graph (axes + curve, open on top-right)
  ink(150, 260, 154, 460); ink(150, 456, 420, 460);
  for (let x = 160; x < 400; x += 3) ink(x, 450 - (x - 160) * 0.7, x + 3, 453 - (x - 160) * 0.7);

  const L = analyzeLayout(buildInkMap(rgba, W, H));
  assert.equal(L.figures.length, 1, `expected only the graph, not the boxed formula (got ${L.figures.length})`);
  assert(L.figures[0].y * H > 200, 'detected figure is the graph');
}

console.log('Lesson 29 parity tests passed.');
