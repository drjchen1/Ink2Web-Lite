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
