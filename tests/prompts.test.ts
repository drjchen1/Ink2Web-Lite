// Run: npm test
import assert from 'node:assert/strict';
import { transcribePrompt, TRANSCRIBE_USER } from '../src/lib/prompts.ts';

const p = transcribePrompt();
assert.equal(p, TRANSCRIBE_USER);
// Math rule comes first; function and operator names are listed.
assert(p.indexOf('Most important') < p.indexOf('Other rules'), 'math rule first');
for (const f of ['\\sin', '\\cos', '\\tan', '\\log', '\\ln', '\\sqrt', '\\times', '\\cdot']) assert(p.includes(f), f);
// Arrows and braces are reported as notes only (1.7.2: no drawn style).
assert(p.includes('[[note: term | note]]'), 'note format');
for (const cmd of ['\\underset', '\\overset', '\\underbrace', '\\overbrace', '\\substack']) assert(!p.includes(cmd), `no ${cmd} in prompt`);
// Marks around words are not figures; boxes are for formulas only.
assert(p.includes('around words is NOT a drawing'));
assert(p.includes('box around a formula or result: \\boxed{...}'));
assert(!p.includes('[[box'));
// Still asks to keep the author's spelling.
assert(p.includes('spelling mistakes included'));
console.log('All prompt tests passed.');
