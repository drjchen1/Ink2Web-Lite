// Run: npm test   (3.2: figure titles and detailed descriptions; the "page cards" export)
import assert from 'node:assert/strict';
import { DESCRIBE_SCHEMA, describePrompt, parseDescription, tidyDescription, tidyTitle } from '../src/lib/describe.ts';
import { buildDocument, descriptionHtml, figureHtml } from '../src/lib/exportHtml.ts';
import { projectFromJson, projectToJson } from '../src/lib/storage.ts';
import type { Figure, Page } from '../src/types.ts';

/* ---------------- the model's answer ---------------- */
const ftc = {
  title: 'Shaded area under $f(x) = e^{2x}$ from $0$ to $1$.',
  description:
    'Coordinate graph with horizontal axis \\( x \\) and vertical axis \\( f(x) \\). The curve $f(x) = e^{2x}$ rises from $x = 0$ to $x = 1$, reaching $e^2$. The region under it is hatched.',
};
let d = parseDescription(JSON.stringify(ftc));
assert.equal(d?.title, 'Shaded area under f(x) = e^2x from 0 to 1', 'title: plain words, no final period');
assert(d?.description.startsWith('Coordinate graph with horizontal axis $x$ and vertical axis $f(x)$.'), 'math made $…$');
// In a code fence, or with words around it.
assert.equal(parseDescription('```json\n{"title": "Number line", "description": "A line."}\n```')?.title, 'Number line');
assert.equal(parseDescription('Sure! {"title": "Spring", "description": "A spring."} Hope that helps.')?.description, 'A spring.');
assert.equal(parseDescription('<think>hmm</think>{"title": "T", "description": ""}')?.title, 'T');
assert.equal(parseDescription('no json here'), null);
assert.equal(parseDescription('{"title": "", "description": ""}'), null);
assert.equal(parseDescription('{"title": 3}'), null);

assert.equal(tidyTitle('"Graph of \\sin(x) on [0, \\pi]."'), 'Graph of sin(x) on [0, pi]');
assert.equal(tidyDescription('A $$y = x^2$$  parabola \\[ y=0 \\] and\n more.'), 'A $y = x^2$ parabola $y=0$ and more.');

assert.deepEqual(DESCRIBE_SCHEMA.required, ['title', 'description']);
const prompt = describePrompt('NOTES HERE');
assert(prompt.includes('NOTES HERE') && prompt.endsWith('Answer with the JSON only.'));
assert(prompt.includes('"title"') && prompt.includes('"description"'));

/* ---------------- figures in the document ---------------- */
const fig = (over: Partial<Figure> = {}): Figure => ({
  id: 1,
  box: { x: 0, y: 0, w: 1, h: 1 },
  alt: 'shaded area under the curve',
  caption: '',
  src: 'data:x',
  needsReview: false,
  width: 60,
  align: 'center',
  wrap: false,
  besideLines: 0,
  ...over,
});
// Classic, no description: exactly as before (no figcaption).
assert.equal(figureHtml(fig(), 2), '<figure id="fig-2-1" class="fig align-center" style="--w:60%"><img src="data:x" alt="Shaded area under the curve."></figure>');
assert.equal(descriptionHtml(undefined), '');
assert.equal(descriptionHtml('   '), '');
// Classic, with a description: a collapsed section in the caption, math rendered.
let html = figureHtml(fig({ description: 'The curve $y = e^{2x}$ rises.' }), 2);
assert(html.includes('<figcaption><details class="fig-desc"><summary>Detailed description</summary><div class="fig-desc-body"><p>The curve \\(y = e^{2x}\\) rises.</p></div></details></figcaption>'));
html = figureHtml(fig({ caption: 'Figure 1', description: 'D.' }), 2);
assert(html.includes('<figcaption>Figure 1<details class="fig-desc">'));
// Cards: a visible title; when it only repeats the alt text, screen readers skip it.
html = figureHtml(fig({ description: 'D.' }), 2, false, 'cards');
assert(html.includes('<div class="fig-title" aria-hidden="true"><span class="fig-label">Figure:</span> Shaded area under the curve.</div>'));
assert(html.includes('<summary>Detailed description</summary>'));
html = figureHtml(fig({ caption: 'Area as an integral' }), 2, false, 'cards');
assert(html.includes('<div class="fig-title"><span class="fig-label">Figure:</span> Area as an integral</div>'), 'a caption is read');
assert(!html.includes('fig-desc'), 'no description, no section');
// Escaping.
assert(figureHtml(fig({ description: '<script>x</script>' }), 1).includes('&lt;script&gt;'));

/* ---------------- the page-cards document ---------------- */
const page = (id: string, source: string, figures: Figure[] = []): Page => ({
  id,
  label: 'FTC.pdf',
  image: new Blob(),
  url: '',
  width: 1,
  height: 1,
  status: 'done',
  source,
  figures,
});
const pages = [page('a', '## Fundamental Theorem of Calculus\nIf $f$ is continuous\n\n[[FIGURE 1]]\n', [fig({ description: 'D.' })]), page('b', 'the area is $3.19$')];
let doc = buildDocument(pages, { title: 'FTC', titleFromFileName: true, lang: 'en', pageMarkers: true, look: 'cards', sourceFile: 'FTC.pdf' });
assert(doc.includes('<main id="main" class="doc-stream">'));
assert.equal((doc.match(/<section class="doc-page"/g) ?? []).length, 2, 'one card per page');
assert(doc.includes('<section class="doc-page" id="page-1" aria-label="Page 1 of 2">'));
assert(doc.includes('<span class="page-badge">Page 2 of 2</span>'));
assert.equal((doc.match(/<h1>/g) ?? []).length, 1, 'one h1');
assert(doc.includes('<h1>Fundamental Theorem of Calculus</h1>'), 'the heading becomes the title');
assert(doc.indexOf('<h1>') < doc.indexOf('id="page-2"'), 'the title is on the first card');
assert(doc.includes('href="FTC.pdf" target="_blank" rel="noopener">Open the original notes (FTC.pdf)'));
assert(doc.includes('class="fig-title"') && doc.includes('Detailed description'));
assert(doc.includes("el.setAttribute('tabindex', '0')"), 'equations can be reached with Tab');
assert(doc.includes('@page{size:letter portrait') && doc.includes('.doc-page{border:0;box-shadow:none;border-radius:0;padding:0;break-after:page}'));
assert(doc.includes('beforeprint'), 'printing opens the descriptions');
assert(doc.includes('"@type":"LearningResource"'));
assert(doc.includes("load: ['[tex]/mathtools']"), 'mathtools for notes');
// Without badges or a link.
doc = buildDocument(pages, { title: 'My Notes', lang: 'en', pageMarkers: false, look: 'cards' });
assert(!doc.includes('page-badge"') && !doc.includes('source-link"'));
assert(doc.includes('<h1>My Notes</h1>') && doc.includes('<h2>Fundamental Theorem of Calculus</h2>'), 'a typed title is kept');
// A file name with spaces is a working link.
doc = buildDocument(pages, { title: 'T', lang: 'en', pageMarkers: true, look: 'cards', sourceFile: 'Lesson 21.pdf' });
assert(doc.includes('href="Lesson%2021.pdf"'));
// Classic is unchanged by default.
doc = buildDocument(pages, { title: 'T', lang: 'en', pageMarkers: true });
assert(!doc.includes('class="doc-page"') && doc.includes('<main id="main">'));

/* ---------------- project files keep the description ---------------- */
const back = projectFromJson(await projectToJson({ title: 'T', titleAuto: false, pageMarkers: true }, [pages[0]]));
assert.equal(back.pages[0].figures[0].description, 'D.');

console.log('Figure description and page-card tests passed.');
