// Run: npm test
import assert from 'node:assert/strict';
import { transcribePrompt } from '../src/lib/prompts.ts';

for (const style of ['notes', 'drawn'] as const) {
  const p = transcribePrompt(style);
  // Math rule comes first; function and operator names include the 1.7.1 additions.
  assert(p.indexOf('Most important') < p.indexOf('Other rules'), `${style}: math rule first`);
  for (const f of ['\\sin', '\\cos', '\\tan', '\\log', '\\ln', '\\sqrt', '\\times', '\\cdot']) assert(p.includes(f), `${style}: ${f}`);
  // Marks around words are not figures (1.7.1).
  assert(p.includes('around words is NOT a drawing'), `${style}: annotation rule`);
  // Boxes are for formulas; no boxed-words form exists.
  assert(p.includes('box around a formula or result: \\boxed{...}'), `${style}: box rule`);
  assert(!p.includes('[[box'), `${style}: no boxed-words syntax`);
  // Still asks to keep the author's spelling.
  assert(p.includes('spelling mistakes included'), `${style}: spelling rule`);
}
assert(transcribePrompt('notes').includes('[[note: term | note]]'));
assert(transcribePrompt('drawn').includes('\\underset{\\substack'));
assert.equal(transcribePrompt(), transcribePrompt('notes'), 'notes is the default');
console.log('All prompt tests passed.');
