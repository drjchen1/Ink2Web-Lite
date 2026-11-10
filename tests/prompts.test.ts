// Run: npm test
import assert from 'node:assert/strict';
import { transcribePrompt, TRANSCRIBE_USER } from '../src/lib/prompts.ts';

const p = transcribePrompt();
assert.equal(p, TRANSCRIBE_USER);
assert(p.indexOf('Most important') < p.indexOf('Other rules'), 'math rule first');
for (const f of ['\\sin', '\\cos', '\\tan', '\\log', '\\ln', '\\sqrt', '\\times', '\\cdot']) assert(p.includes(f), f);
assert(p.includes('[[note: term | note]]'), 'note format');
for (const cmd of ['\\underset', '\\overset', '\\underbrace', '\\overbrace', '\\substack']) assert(!p.includes(cmd), `no ${cmd} in prompt`);
assert(p.includes('around words is NOT a drawing'));
assert(p.includes('box around a formula or result: \\boxed{...}'));
assert(!p.includes('[[box'));
assert(p.includes('spelling mistakes included'));
// 1.9.3: writing beside a drawing is notes, never part of the FIGURE description.
assert(p.includes('Never put it in the FIGURE description'));
assert(p.includes('normal notes on the lines right after the [[FIGURE: ...]] line'));
assert(/\[\[FIGURE: [^\]]+\]\]\nthe distance from \$0\$ to \$1\$ is one unit/.test(p), 'example: notes after the figure');
console.log('All prompt tests passed.');

/* 1.9.5: format check for an edited prompt (Advanced › Transcription prompt). */
import { isDefaultPrompt, promptIssues } from '../src/lib/prompts.ts';
assert.deepEqual(promptIssues(TRANSCRIBE_USER), [], 'the default prompt has everything the app needs');
assert(isDefaultPrompt(TRANSCRIBE_USER) && isDefaultPrompt(`\n${TRANSCRIBE_USER}  `));
assert(!isDefaultPrompt(TRANSCRIBE_USER + ' Be careful.'));
const needs = (s: string) => promptIssues(s).map((i) => i.need);
assert.deepEqual(needs(''), ['a prompt']);
assert.deepEqual(needs('Transcribe this page.'), [
  '[[FIGURE: …]] lines for drawings',
  '[[note: term | words]] lines for arrow and brace notes',
  'math in $…$ and $$…$$',
]);
// Removing one format is reported on its own.
assert.deepEqual(needs(TRANSCRIBE_USER.replace(/\[\[note[^\]]*\]\]/g, '')), ['[[note: term | words]] lines for arrow and brace notes']);
assert.deepEqual(needs(TRANSCRIBE_USER.replace(/\[\[FIGURE:[^\]]*\]\]/g, '')), ['[[FIGURE: …]] lines for drawings']);
// Rewording the rest is fine as long as the formats stay.
assert.deepEqual(needs('Copy the page. Math as $x$. Drawings: [[FIGURE: description]]. Notes: [[note: term | words]].'), []);
console.log('Prompt format-check tests passed.');

/* 2.1.2: a second built-in prompt for larger models. */
import {
  BUILTIN_IDS,
  BUILTIN_PROMPTS,
  TRANSCRIBE_LARGE,
  asBuiltinId,
  builtinOf,
  isBuiltinPrompt,
  promptSizeHint,
} from '../src/lib/prompts.ts';
import { cleanModelOutput, extractFigures } from '../src/lib/transcript.ts';
import { latexWarnings, markdownToHtml } from '../src/lib/markdown.ts';

assert.deepEqual(BUILTIN_IDS, ['everyday', 'large']);
assert.equal(transcribePrompt('everyday'), TRANSCRIBE_USER, 'everyday is the 2.1.1 prompt, unchanged');
assert.equal(transcribePrompt('large'), TRANSCRIBE_LARGE);
assert.equal(BUILTIN_PROMPTS.large.text, TRANSCRIBE_LARGE);
assert.deepEqual(promptIssues(TRANSCRIBE_LARGE), [], 'the larger-model prompt asks for every format the app needs');
assert.equal(builtinOf(` ${TRANSCRIBE_LARGE}\n`), 'large');
assert.equal(builtinOf(TRANSCRIBE_USER), 'everyday');
assert.equal(builtinOf(TRANSCRIBE_LARGE + ' x'), undefined);
assert(isBuiltinPrompt(TRANSCRIBE_LARGE) && !isDefaultPrompt(TRANSCRIBE_LARGE), 'large is built-in but not the default');
assert.equal(asBuiltinId('large'), 'large');
for (const bad of [undefined, null, 'huge', 3, '']) assert.equal(asBuiltinId(bad), 'everyday', `stored ${String(bad)} -> everyday`);

const L = TRANSCRIBE_LARGE;
assert(L.indexOf('EVERY piece of math') < L.indexOf('Text and layout'), 'math rule first');
for (const f of ['\\sin', '\\cos', '\\tan', '\\log', '\\ln', '\\sqrt', '\\times', '\\cdot']) assert(L.includes(f), f);
assert(L.includes('[[note: term | note]]'), 'note format');
// The same formats as the everyday prompt, so one clean-up serves both.
for (const cmd of ['\\underset', '\\overset', '\\underbrace', '\\overbrace', '\\substack']) assert(!L.includes(cmd), `no ${cmd}`);
assert(L.includes('Never put it in the FIGURE description'));
assert(L.includes('around words is NOT a drawing'));
assert(L.includes('spelling mistakes included'));
assert(!L.includes('[[box'));
assert(/\[\[FIGURE: [^\]]+\]\]\nthe distance from \$0\$ to \$1\$ is one unit/.test(L), 'example: notes after the figure');

// The example, treated as model output, survives clean-up and renders without warnings.
const example = L.split('Example output:\n')[1].split('\n\nOutput only')[0];
const { source: exSource, descriptions: exFigs } = extractFigures(cleanModelOutput(example));
assert.deepEqual(latexWarnings(exSource), []);
assert.equal(exFigs.length, 1);
assert(!/[$\\]/.test(exFigs[0]), 'figure description is plain words');
const html = markdownToHtml(exSource, { figure: (id) => `<figure data-id="${id}"></figure>` });
assert(html.includes('<ol>') && html.includes('\\begin{cases}') && html.includes('\\begin{aligned}'));
assert(html.includes('where \\(s_0\\) is the starting value.'), 'note becomes a where-sentence');

// Size hint: a suggestion only when the choice and model size clearly disagree.
assert.equal(promptSizeHint('everyday', 3.3), '');
assert.equal(promptSizeHint('large', 6.2), '');
assert.match(promptSizeHint('everyday', 6.2), /Larger models/);
assert.match(promptSizeHint('large', 3.2), /Everyday hardware/);
assert.equal(promptSizeHint('large', 5.0), '', 'in between: no hint');
assert.equal(promptSizeHint('large', undefined), '');
console.log('Larger-model prompt tests passed.');
