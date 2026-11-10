// Run: npm test   (redraw in the app, 2.2: the model's answer, the export, the checklist, project files)
import assert from 'node:assert/strict';
import { REDRAW_SCHEMA, TEMPLATES, cleanExpr, formatSpec, notesAround, redrawPrompt, repairPrompt, tidyModelSpec } from '../src/lib/redraw/prompt.ts';
import { checkSpec } from '../src/lib/redraw/spec.ts';
import { EXAMPLES } from '../src/lib/redraw/examples.ts';
import { placeSvg, redrawSpec, redrawState, shownAs } from '../src/lib/figureRedraw.ts';
import { figureHtml, pageHtml } from '../src/lib/exportHtml.ts';
import { pageIssues } from '../src/lib/editing.ts';
import { projectFromJson, projectToJson } from '../src/lib/storage.ts';
import type { Figure, Page } from '../src/types.ts';

/* ---------------- the notes the model sees ---------------- */
const src = ['# Lesson 9', 'The logistic equation', "$$y' = y(1 - y)$$", '[[FIGURE 1]]', 'and then', '[[FIGURE 2]]', 'end'].join('\n');
let n = notesAround(src, 1);
assert(n.includes(">>> THIS FIGURE <<<") && n.includes('[another figure]') && n.includes("y' = y(1 - y)"));
assert(!n.includes('[[FIGURE'), 'no raw markers');
n = notesAround(src, 2);
assert(n.indexOf('[another figure]') < n.indexOf('>>> THIS FIGURE <<<'));
// Long notes: an excerpt, mostly before the figure, marked with ellipses.
const long = [...Array.from({ length: 200 }, (_, i) => `line ${i} of the notes before`), '[[FIGURE 3]]', ...Array.from({ length: 200 }, (_, i) => `after ${i}`)].join('\n');
n = notesAround(long, 3, 600);
assert(n.length <= 610 && n.startsWith('…') && n.endsWith('…'));
assert(n.includes('line 199 of the notes before') && n.includes('after 0'));
const before = n.split('>>> THIS FIGURE <<<')[0].length;
const after = n.split('>>> THIS FIGURE <<<')[1].length;
assert(before > after, 'mostly before the figure');
assert(notesAround('no markers here', 5).includes('no markers here'), 'a figure not placed in the text still gets the notes');

/* ---------------- the prompt and schema ---------------- */
const prompt = redrawPrompt('NOTES HERE');
assert(prompt.includes('NOTES HERE') && prompt.endsWith('Answer with the JSON only.'));
// Every example in the prompt is itself a valid spec (escaping included).
for (const m of prompt.matchAll(/^\{"kind": "(graph|region|phase)".*\}$/gm)) {
  const r = checkSpec(m[0]);
  assert.deepEqual(r.errors, [], `prompt example: ${m[0]}`);
}
assert.equal([...prompt.matchAll(/^\{"kind": "(graph|region|phase)".*\}$/gm)].length, 3);
assert.deepEqual(REDRAW_SCHEMA.required, ['kind', 'from']);
assert(repairPrompt(['window.x is missing']).includes('- window.x is missing'));
for (const t of Object.values(TEMPLATES)) assert.deepEqual(checkSpec(t).errors, [], 'templates are valid');

/* ---------------- tidying the model's answer ---------------- */
assert.equal(tidyModelSpec('{"kind": "none", "from": ""}'), 'none');
assert.equal(tidyModelSpec('not json'), null);
assert.equal(tidyModelSpec('[1, 2]'), null);
// Empty and unrelated fields are dropped; ranges are put in order.
let t = tidyModelSpec(
  JSON.stringify({
    kind: 'graph',
    from: 'y = x^2',
    window: { x: [2, -2], y: [1, 1] },
    curves: [{ expr: 'y = x^2', label: '', style: 'solid' }],
    top: '',
    system: { x: '', y: '' },
    trajectories: [],
    points: [],
  }),
) as Record<string, unknown>;
assert.deepEqual(t, { kind: 'graph', from: 'y = x^2', window: { x: [-2, 2] }, curves: [{ expr: 'x^2', style: 'solid' }] });
assert.deepEqual(checkSpec(t).errors, []);
// In a fenced block.
assert.equal((tidyModelSpec('```json\n{"kind": "region", "from": "A", "top": "x"}\n```') as Record<string, unknown>).top, 'x');
// LaTeX in expressions.
assert.equal(cleanExpr('f(x) = \\frac{1}{x}'), '(1)/(x)');
assert.equal(cleanExpr('\\sin{x} \\cdot e^{-x}'), 'sin(x) * e^(-x)');
assert.equal(cleanExpr('$x^2$'), 'x^2');
// Phase: keyed x, y with the author's letters on the axes.
t = tidyModelSpec(JSON.stringify({ kind: 'phase', from: "u'' + 4u = 0", system: { x: 'y', y: '-4*x' }, axes: { x: 'u', y: 'v' } })) as Record<string, unknown>;
assert.deepEqual(t.vars, ['x', 'y']);
let c = checkSpec(t);
assert(c.spec?.kind === 'phase' && c.spec.text[1] === '−4u', 'shown in the author’s letters');
// …or written in the author's letters anyway: rekeyed.
t = tidyModelSpec(JSON.stringify({ kind: 'phase', from: "u'' + 4u = 0", system: { x: 'v', y: '-4*u' }, axes: { x: 'u', y: 'v' } })) as Record<string, unknown>;
assert.deepEqual(t.system, { u: 'v', v: '-4*u' });
assert.equal(t.vars, undefined);
c = checkSpec(t);
assert.deepEqual(c.errors, []);
// A piecewise curve keeps its pieces and drops a stray expr.
t = tidyModelSpec(JSON.stringify({ kind: 'graph', from: 'g', window: { x: [0, 4] }, curves: [{ expr: '', pieces: [{ expr: 'y = 0', on: [0, 2] }, { expr: '1', on: [2, 4] }] }] })) as Record<string, unknown>;
assert.deepEqual((t.curves as { pieces: { expr: string }[] }[])[0].pieces.map((p) => p.expr), ['0', '1']);

/* ---------------- formatting ---------------- */
for (const e of EXAMPLES) {
  const text = formatSpec(e.spec);
  assert.deepEqual(JSON.parse(text), e.spec, `${e.name}: formatting keeps the spec`);
  // Only a single long string (a LaTeX "from") may run past the width.
  assert(text.split('\n').every((l) => l.length <= 100 || /^\s*"\w+": "[^"]*",?$/.test(l)), `${e.name}: lines stay short`);
}
assert.equal(formatSpec({ a: [1, 2], b: { c: 'd' } }), '{ "a": [1, 2], "b": { "c": "d" } }');

/* ---------------- the document ---------------- */
const graphSpec = formatSpec(EXAMPLES[0].spec);
const fig = (over: Partial<Figure> = {}): Figure => ({
  id: 2,
  box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
  alt: 'sketch of a decaying oscillation',
  caption: '',
  src: 'data:image/png;base64,AAAA',
  needsReview: false,
  width: 60,
  align: 'center',
  wrap: false,
  besideLines: 0,
  ...over,
});
// No redraw, or "image": the cropped image, as before.
assert.equal(figureHtml(fig(), 3), figureHtml(fig({ redraw: { spec: graphSpec, show: 'image' } }), 3));
assert(figureHtml(fig(), 3).includes('<img src="data:image/png;base64,AAAA" alt="Sketch of a decaying oscillation.">'));
// "redrawn": the SVG with ids unique to this figure, and no image.
let html = figureHtml(fig({ redraw: { spec: graphSpec, show: 'redrawn' } }), 3);
assert(html.startsWith('<figure id="fig-3-2"') && html.includes('<svg') && !html.includes('<img'));
assert(html.includes('aria-labelledby="fig-3-2-title fig-3-2-desc"') && html.includes('url(#fig-3-2-clip)'));
assert(!html.includes('rdsvg'), 'no placeholder ids left');
assert(html.includes('<title id="fig-3-2-title">Graph of u(t) = e^(−t/2)·cos(3t)'), 'computed alt text');
// "both": the SVG, then the original in a collapsed section with its own alt text.
html = figureHtml(fig({ redraw: { spec: graphSpec, show: 'both' }, caption: 'Figure 2' }), 3);
assert(/<svg[\s\S]*<\/svg><details class="fig-orig"><summary>Original sketch<\/summary><img src="data:image\/png;base64,AAAA" alt="Original hand-drawn sketch\. Sketch of a decaying oscillation\."><\/details><figcaption>Figure 2<\/figcaption><\/figure>$/.test(html));
// A spec with errors falls back to the image.
const broken = fig({ redraw: { spec: '{"kind": "graph", "from": "y"}', show: 'redrawn' } });
assert.equal(shownAs(broken), 'image');
assert.equal(redrawState(broken).kind, 'broken');
assert(figureHtml(broken, 3).includes('<img') && !figureHtml(broken, 3).includes('<svg'));
assert.equal(shownAs(fig({ redraw: { spec: '{oops', show: 'both' } })), 'image');
// Two redrawn figures on a page never share ids.
const page = (figures: Figure[]): Page => ({
  id: 'p1',
  label: 'x',
  image: new Blob([new Uint8Array([1])], { type: 'image/png' }),
  url: '',
  width: 10,
  height: 10,
  status: 'done',
  source: 'text\n\n[[FIGURE 1]]\n\nmore\n\n[[FIGURE 2]]\n',
  figures,
});
const regionSpec = formatSpec(EXAMPLES[6].spec);
html = pageHtml(page([fig({ id: 1, redraw: { spec: regionSpec, show: 'redrawn' } }), fig({ redraw: { spec: graphSpec, show: 'redrawn' } })]), 1);
const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, 'unique ids on the page');
for (const m of html.matchAll(/url\(#([^)]+)\)/g)) assert(ids.includes(m[1]), `reference ${m[1]} resolves`);
// The cache returns the same result for the same spec; placeSvg only touches ids.
assert.equal(redrawSpec(graphSpec), redrawSpec(graphSpec));
assert.equal(placeSvg('<g id="rdsvg-clip"><text>rdsvgx</text></g>', 'a b'), '<g id="a-b-clip"><text>rdsvgx</text></g>');

/* ---------------- the checklist ---------------- */
const kinds = (f: Figure) => pageIssues({ source: '', figures: [f] }).map((i) => i.kind);
assert.deepEqual(kinds(fig({ alt: '' })), ['alt-missing']);
// Shown only as a redraw, the computed alt text is used: no alt text needed.
assert.deepEqual(kinds(fig({ alt: '', redraw: { spec: graphSpec, show: 'redrawn' } })), []);
// "both" still shows the image, which needs alt text.
assert.deepEqual(kinds(fig({ alt: '', redraw: { spec: graphSpec, show: 'both' } })), ['alt-missing']);
// A broken redraw that was chosen is reported (and the image's alt text still matters).
assert.deepEqual(kinds(fig({ alt: '', redraw: { spec: '{}', show: 'redrawn' } })), ['redraw-error', 'alt-missing']);
// A broken spec that isn't in use is not a problem.
assert.deepEqual(kinds(fig({ redraw: { spec: '{}', show: 'image' } })), []);
assert.deepEqual(kinds(fig({ needsReview: true, redraw: { spec: graphSpec, show: 'redrawn' } })), ['figure-check']);

/* ---------------- project files keep the redraw ---------------- */
const withRedraw = page([fig({ redraw: { spec: graphSpec, show: 'both' } })]);
const back = projectFromJson(await projectToJson({ title: 'T', titleAuto: false, pageMarkers: true }, [withRedraw]));
assert.deepEqual(back.pages[0].figures[0].redraw, { spec: graphSpec, show: 'both' });

console.log('Redraw-in-the-app tests passed.');

/* ---------------- the question-and-repair loop ---------------- */
import { specConversation } from '../src/lib/redraw/conversation.ts';
import type { ChatMessage } from '../src/lib/ollama.ts';
const script = (answers: string[]) => {
  const seen: ChatMessage[][] = [];
  const ask = async (m: ChatMessage[]) => {
    seen.push([...m]);
    return answers[seen.length - 1] ?? '';
  };
  return { ask, seen };
};
const first: ChatMessage[] = [{ role: 'user', content: 'Q' }];
const good = JSON.stringify({ kind: 'graph', from: 'y = x^2', window: { x: [-2, 2] }, curves: [{ expr: 'x^2' }] });
const bad = JSON.stringify({ kind: 'graph', from: 'y = x^2', curves: [{ expr: 'x^2' }] }); // no window
// Right the first time: one call.
let sc = script([good]);
let out = await specConversation(sc.ask, first);
assert.deepEqual([out.status, sc.seen.length], ['ok', 1]);
assert.deepEqual(JSON.parse(out.spec), JSON.parse(good));
// Wrong, then repaired: the problems are sent back.
sc = script([bad, good]);
out = await specConversation(sc.ask, first);
assert.deepEqual([out.status, sc.seen.length], ['ok', 2]);
const repairMsg = sc.seen[1][sc.seen[1].length - 1];
assert(repairMsg.role === 'user' && repairMsg.content.includes('window.x'), 'the errors go back to the model');
assert.equal(sc.seen[1][sc.seen[1].length - 2].content, bad, 'with its own answer before them');
assert.equal(first.length, 1, 'the caller’s messages are not changed');
// Still wrong: the spec with errors is returned so the user can fix it.
sc = script([bad, bad]);
out = await specConversation(sc.ask, first);
assert.equal(out.status, 'errors');
assert(out.errors.some((e) => e.includes('window.x')) && out.spec.includes('"x^2"'));
// A repair that makes things worse doesn't replace the better answer.
const worse = JSON.stringify({ kind: 'graph', from: '', curves: [{ expr: 'sin x' }] });
sc = script([bad, worse]);
out = await specConversation(sc.ask, first);
assert.deepEqual(JSON.parse(out.spec), JSON.parse(bad));
// Not JSON, then fine.
sc = script(['I think it is a parabola.', good]);
out = await specConversation(sc.ask, first);
assert.equal(out.status, 'ok');
assert(sc.seen[1].at(-1)!.content.includes('not valid JSON'));
// No equation: stops at once.
sc = script(['{"kind": "none", "from": ""}']);
out = await specConversation(sc.ask, first);
assert.deepEqual([out.status, sc.seen.length], ['none', 1]);
// Never JSON.
sc = script(['nope', 'still nope']);
out = await specConversation(sc.ask, first);
assert.equal(out.status, 'unreadable');

console.log('Redraw conversation tests passed.');

/* "from" and the drawn curve (2.2.1): editing only "from" doesn't change the drawing, so say so. */
const fromWarn = (spec: object) => {
  const r = checkSpec(spec);
  assert.deepEqual(r.errors, [], 'the fixture itself is valid');
  return r.warnings.some((w) => w.includes('doesn’t match any curve'));
};
const g0 = { kind: 'graph', from: 'y = e^{-t}\\cos(2t)', window: { x: [0, 6] }, axes: { x: 't' }, curves: [{ expr: 'exp(-t)*cos(2t)' }] };
assert(!fromWarn(g0), 'matching');
assert(fromWarn({ ...g0, from: 'y = e^{-t}\\cos(3t)' }), 'from edited, expr not');
assert(fromWarn({ ...g0, curves: [{ expr: 'exp(-t)*cos(3t)' }] }), 'expr edited, from not');
assert(!fromWarn({ ...g0, from: 'y = \\frac{1}{2}t^2', curves: [{ expr: 't^2/2' }] }));
assert(!fromWarn({ ...g0, from: 'u(t) = e^{-t}\\cos(2t)' }), 'a function name on the left');
assert(!fromWarn({ ...g0, from: "y'' + y = 0" }), 'a differential equation is not checked');
assert(!fromWarn({ ...g0, from: 'y = \\ln x, \\quad y = x - 1' }), 'two equations are not checked');
for (const e of EXAMPLES) assert(!fromWarn(e.spec), `${e.name}: no false alarm`);
for (const t of Object.values(TEMPLATES)) assert(!fromWarn(t), 'templates: no false alarm');
console.log('From-versus-curve tests passed.');

/* Constants in number fields (2.2.2). */
import { constantValue } from '../src/lib/redraw/common.ts';
import { redraw } from '../src/lib/redraw/index.ts';
assert.equal(constantValue('pi'), Math.PI);
assert.equal(constantValue('π/2'), Math.PI / 2);
assert.equal(constantValue('-2pi'), -2 * Math.PI);
assert.equal(constantValue('3pi/4'), (3 * Math.PI) / 4);
assert.equal(constantValue('e'), Math.E);
assert.equal(constantValue('sqrt(2)'), Math.SQRT2);
assert.equal(constantValue(' 1.5 '), 1.5);
for (const bad of ['x', 'pie', '', 'sqrt(-1)', '1/0']) assert.equal(constantValue(bad), null, bad);

const ok = (spec: object) => {
  const r = redraw(spec, { id: 'c' });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r;
};
// Region from 0 to π: the alt text says π, not 3.14.
let rr = ok({ kind: 'region', from: '\\int_0^\\pi \\sin x\\,dx', top: 'sin(x)', between: [0, 'pi'], area: true });
assert.match(rr.alt.long, /for x from 0 to π\./);
assert.match(rr.alt.long, /The shaded area is 2\./);
// Window, ticks (labeled automatically), points, slices, impulses, trajectories.
rr = ok({
  kind: 'graph',
  from: 'y = \\sin x',
  window: { x: ['-2pi', '2pi'], y: [-1.5, 1.5] },
  ticks: { x: ['-pi', 'pi', { at: '2pi', label: 'two pi' }] },
  curves: [{ expr: 'sin(x)' }],
  points: [{ on: { curve: 1, at: 'pi/2' }, label: 'top' }],
  impulses: [{ at: 'e', size: 'pi/4' }],
});
assert.match(rr.alt.long, /Horizontal axis x from −2π to 2π/);
assert.match(rr.alt.long, /a filled dot at \(π\/2, 1\) labeled top/);
assert.match(rr.alt.long, /of size π\/4 at x = e/);
assert(rr.svg.includes('>−π</text>') && rr.svg.includes('>π</text>') && rr.svg.includes('>two pi</text>'), 'tick labels');
rr = ok({ kind: 'phase', from: "θ' = ω", axes: { x: 'θ', y: 'ω' }, vars: ['x', 'y'], system: { x: 'y', y: '-sin(x)' }, window: { x: ['-pi', 'pi'], y: [-2, 2] }, trajectories: [{ start: ['pi/2', 0] }], A: undefined });
assert.match(rr.alt.long, /through \(π\/2, 0\)/);
rr = ok({ kind: 'phase', from: 'x', A: [['-1', 'pi'], [0, '-e']], window: { x: [-1, 1], y: [-1, 1] } });
assert.match(rr.alt.long, /eigenvalues −e and −1/);
// Text fields are never converted; the words "auto" and "intersections" stay words.
assert(checkSpec({ kind: 'region', from: 'pi', top: 'pi', between: 'intersections', bottom: 'x^2' }).spec);
assert(checkSpec({ kind: 'graph', from: 'y', window: { x: [0, 'pi'], y: 'auto' }, axes: { x: 'x', y: 'pi' }, curves: [{ expr: 'pi', label: 'pi' }] }).spec);
// A word that isn't a constant gets a clear message with where it is.
assert.match(checkSpec({ kind: 'region', from: 'A', top: 'x', between: [0, 'pie'] }).errors.join(), /between\[1\]: “pie” isn’t a number\. Use a number or a constant such as pi\/2, 2pi, or e\./);
assert.match(checkSpec({ kind: 'graph', from: 'y', window: { x: ['x', 1] }, curves: [{ expr: 'x' }] }).errors.join(), /window\.x\[0\]: “x” isn’t a number/);
console.log('Constant tests passed.');
