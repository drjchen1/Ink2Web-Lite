// Run: npm test  (Node 22.6+; uses built-in TypeScript type stripping)
import assert from 'node:assert/strict';
import { markdownToHtml, latexWarnings } from '../src/lib/markdown.ts';
import { cleanModelOutput, extractFigures, isLooping, trimRepetition, parseBoxes, unwrapTextMath } from '../src/lib/transcript.ts';

const raw = "Here is the transcription:\n```markdown\n## Variation of Parameters\nGiven $y'' + p(t)y' + q(t)y = g(t)$, guess $y_p = u_1 y_1 + u_2 y_2$.\n\\[ W = y_1 y_2' - y_1' y_2 \\]\n- *note*: $u_1' = -\\frac{y_2 g}{W}$\n- second_item with x_1 and **bold**\n  1. nested step\n$$\\begin{aligned} a &= b \\\\[4pt] c &< d \\end{aligned}$$\n[[FIGURE: graph of y = e^{-t} cos t, decaying oscillation]]\nCost is \\$5 and 3 < 4 & done\n| t | y |\n|---|---|\n| 0 | $1$ |\n#### Deep heading\n```";
const clean = cleanModelOutput(raw);
const { source, descriptions } = extractFigures(clean);
const html = markdownToHtml(source, { figure: (id) => `<figure data-id="${id}"></figure>` });

assert(!clean.includes('```') && !clean.startsWith('Here'));
assert(clean.includes('$$ W = y_1'), 'normalize \\[');
assert(clean.includes('\\\\[4pt]'), 'keeps \\\\[4pt]');
assert.equal(descriptions.length, 1);
assert(html.includes('<h2>Variation of Parameters</h2>'));
assert(html.includes('<h3>Deep heading</h3>'), 'heading level clamped');
assert(html.includes("\\(y'' + p(t)y' + q(t)y = g(t)\\)"));
assert(html.includes('second_item with x_1'), 'underscores in words untouched');
assert(html.includes('<em>note</em>') && html.includes('<strong>bold</strong>'));
assert(html.includes('<ol>') && html.includes('nested step'));
assert(html.includes('c &amp;&lt; d'), 'math escaped');
assert(html.includes('Cost is $5 and 3 &lt; 4 &amp; done'));
assert(html.includes('<figure data-id="1">'));
assert(html.includes('<th scope="col">t</th>') && html.includes('\\(1\\)'));
assert((html.match(/<li>/g) || []).length === (html.match(/<\/li>/g) || []).length, 'balanced li');
assert(html.includes('<div class="math-display">\\[\\begin{aligned}'), 'display math after list is not a <p>');

/* ---- prose wrapped in math (seen on Lesson20-1) ---- */
const prose = `take a spring
$$\\begin{aligned}
&\\text{leaving it there, it will have a natural length} \\\\
&\\text{due to the weight, the spring lengthens by } L \\\\
&\\text{pull it down a bit and let go}
\\end{aligned}$$
$$\\begin{aligned} y &= \\int_0^1 x\\,dx \\\\ &= \\tfrac12 \\text{ by symmetry} \\end{aligned}$$
$\\text{only words}$ and $x^2$`;
const un = unwrapTextMath(prose);
assert(un.includes('\nleaving it there, it will have a natural length\n'), 'text rows become lines');
assert(un.includes('due to the weight, the spring lengthens by $L$'), 'math inside a text row stays math');
assert(!/\$\$\\begin\{aligned\}\s*&\\text/.test(un), 'prose block removed');
assert(un.includes('\\tfrac12 \\text{ by symmetry}'), 'real equations untouched');
assert(un.includes('only words and $x^2$'), 'inline text-only math unwrapped');

const ctx = { lastHeading: 1 };
assert(markdownToHtml('### a', { figure: () => '', ctx }).includes('<h2>'));
assert(markdownToHtml('#### b', { figure: () => '', ctx }).includes('<h3>'));
assert(markdownToHtml('# c', { figure: () => '', ctx }).includes('<h2>'));
assert(markdownToHtml('a\n\n[[CLEAR]]\n\nb', { figure: () => '' }).includes('<p>a</p>\n<div class="fig-clear"></div>\n<p>b</p>'));

assert.deepEqual(latexWarnings('$\\frac{a}{b}$'), []);
assert(latexWarnings('$\\frac{a}{b$').length === 1);
assert(latexWarnings('$$\\left( x $$').some((w) => w.includes('left')));

const loop = 'Start text. ' + 'x = 1 + 1\n'.repeat(60);
assert(isLooping(loop), 'detect loop');
assert(!isLooping('Normal varied text about calculus and limits. ' + 'abcdefghij'.split('').join(' ').repeat(3) + ' More different words here to fill it out over four hundred characters total for testing purposes, honestly. And more varied text so that nothing repeats exactly in a periodic way at the end of the string. The end is here now.'));
const trimmed = trimRepetition(loop);
assert(trimmed.endsWith('x = 1 + 1') && trimmed.length < 40, 'trim: ' + JSON.stringify(trimmed));

const b = parseBoxes('{"figures":[{"id":1,"bbox_2d":[100,200,500,600]}]}', 1, 1000, 1400);
assert(Math.abs(b[0]!.x - 0.14) < 0.001 && Math.abs(b[0]!.y - 0.2) < 1e-9 && Math.abs(b[0]!.w - 0.56) < 0.001);
const loose = parseBoxes('Sure! figure 1: [10, 20, 300, 400] and figure 2 [ 400,500,900,950 ]', 2, 1000, 1000);
assert(loose[0] && loose[1] && loose[1]!.x === 0.4);
assert.deepEqual(parseBoxes('garbage', 1, 100, 100), [null]);
const swapped = parseBoxes('{"figures":[{"id":2,"bbox_2d":[0.5,0.5,0.1,0.1]},{"id":1,"bbox_2d":[0,0,0.3,0.3]}]}', 2, 1000, 1000);
assert(swapped[0]!.w === 0.3 && swapped[1]!.x === 0.1, 'id mapping + fractions + swapped corners');
console.log('All logic tests passed.');
