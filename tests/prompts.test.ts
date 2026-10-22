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
