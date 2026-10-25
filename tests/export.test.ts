// Run: npm test
import assert from 'node:assert/strict';
import { buildDocument, figureHtml, looksLikeFileName, plainMath, polishAlt, withWrapEnds } from '../src/lib/exportHtml.ts';
import type { Figure, Page } from '../src/types.ts';

for (const t of ['DOC101626-10162026010500', 'IMG_2041', 'scan 3', 'Document', 'Lesson20-1', 'notes_week3', ''])
  assert(looksLikeFileName(t), t);
for (const t of ['MA 30300 Lecture 12', 'Fundamental Theorem of Calculus', 'Calculus']) assert(!looksLikeFileName(t), t);

assert.equal(polishAlt('graph of y = f(x) with shaded area'), 'Graph of y = f(x) with shaded area.');
assert.equal(polishAlt('Done already.'), 'Done already.');
assert.equal(polishAlt('  '), 'Hand-drawn figure.');
assert.equal(
  polishAlt('Graph of $f(x) = \\sin(x)$ with shaded area from $0$ to $\\frac{\\pi}{2}$.'),
  'Graph of f(x) = sin(x) with shaded area from 0 to pi/2.',
);
assert.equal(plainMath('$a \\leq x \\leq b$'), 'a ≤ x ≤ b');

const page = (source: string, figures: Figure[] = []): Page => ({ id: 'a', label: 'x', image: new Blob(), url: '', width: 1, height: 1, status: 'done', source, figures });
const fig = (p: Partial<Figure>): Figure => ({ id: 1, box: { x: 0, y: 0, w: 1, h: 1 }, alt: 'a graph', caption: '', src: 'data:x', needsReview: false, width: 40, align: 'left', wrap: true, besideLines: 1, ...p });
const opts = { lang: 'en', pageMarkers: true };

let html = buildDocument([page('## Fundamental Theorem of Calculus\nIf $f$ is continuous')], { title: 'DOC101626-10162026010500', ...opts });
assert(html.includes('<title>Fundamental Theorem of Calculus</title>'));
assert(html.includes('<h1>Fundamental Theorem of Calculus</h1>'));
assert(!html.includes('<h2>Fundamental'), 'heading not duplicated');
assert(html.includes("load: ['[tex]/mathtools']"), 'export loads mathtools for \\mathclap');

html = buildDocument([page('## Mechanical Vibrations\ntext')], { title: 'Lesson20-1', ...opts });
assert(html.includes('<h1>Mechanical Vibrations</h1>'), 'Lesson20-1 treated as a file name');
html = buildDocument([page('## Mechanical Vibrations\ntext')], { title: 'Week Seven', titleFromFileName: true, ...opts });
assert(html.includes('<h1>Mechanical Vibrations</h1>'), 'any untouched file-name title yields to the heading');
html = buildDocument([page('## Section\ntext')], { title: 'My Notes', ...opts });
assert(html.includes('<h1>My Notes</h1>') && html.includes('<h2>Section</h2>'), 'typed title kept');
html = buildDocument([page('no heading here')], { title: 'IMG_2041', ...opts });
assert(html.includes('<h1>IMG_2041</h1>'), 'fallback when no heading');
html = buildDocument([page('# The $\\epsilon$-$\\delta$ definition\nbody')], { title: 'scan', ...opts });
assert(html.includes('<h1>The \\(\\epsilon\\)-\\(\\delta\\) definition</h1>') && html.includes('<title>The \\epsilon-\\delta definition</title>'));

/* figure layout */
assert.equal(
  figureHtml(fig({}), 2),
  '<figure id="fig-2-1" class="fig align-left wrap" style="--w:40%"><img src="data:x" alt="A graph."></figure>',
);
assert(figureHtml(fig({ align: 'center', wrap: true }), 1).includes('class="fig align-center"'), 'no wrap when centered');
assert(figureHtml(fig({ width: 500 }), 1).includes('--w:100%'), 'width clamped');

// Wrap ends after the lines beside the figure; a multi-line equation counts as one line.
const src = 'intro\n\n[[FIGURE 1]]\n\nbeside one\n$$\na = b\n$$\nbelow\n[[FIGURE 2]]\nnext';
assert.equal(withWrapEnds(src, [fig({ besideLines: 2 })]), 'intro\n\n[[FIGURE 1]]\n\nbeside one\n$$\na = b\n$$\n\n[[CLEAR]]\n\nbelow\n[[FIGURE 2]]\nnext');
assert.equal(withWrapEnds(src, [fig({ besideLines: 9 })]), src, 'never runs past the next figure');
html = buildDocument([page(src, [fig({ besideLines: 1 })])], { title: 'T', lang: 'en', pageMarkers: false });
assert(/beside one<\/p>\n<div class="fig-clear"><\/div>/.test(html), 'clear right after the beside line');
assert(html.includes('figure.fig.wrap.align-left{float:left') && html.includes('@media (max-width:40rem)'), 'layout + reflow CSS');
assert(html.includes('.ink-red{color:#B3261E}') && html.includes('strong.ul{'), 'handwriting-mark CSS');

console.log('All export tests passed.');

/* ---------------- file names (2.0.1) ---------------- */
{
  const { fileSlug } = await import('../src/lib/exportHtml.ts');
  const { projectFileName } = await import('../src/lib/storage.ts');
  assert.equal(fileSlug('Lecture 3: Springs & Dampers'), 'lecture-3-springs-dampers');
  assert.equal(fileSlug('   '), 'notes');
  assert.equal(projectFileName('Lecture 3: Springs'), 'lecture-3-springs.ink2web.json', 'project and HTML use the same name');
  console.log('File name tests passed.');
}
