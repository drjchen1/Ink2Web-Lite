// Run: npm test
import assert from 'node:assert/strict';
import { TRANSCRIBE_USER } from '../src/lib/prompts.ts';
import {
  BUILTIN_HASH,
  EMPTY_LIBRARY,
  builtinChanged,
  deletePrompt,
  findByName,
  findByText,
  hashText,
  parseLibrary,
  savePrompt,
  setStartup,
  startupPrompt,
} from '../src/lib/promptLibrary.ts';

let n = 0;
const id = () => `p${++n}`;

// Save a new prompt.
let { lib, saved: a } = savePrompt(EMPTY_LIBRARY, '  Qwen 3 test ', 'Prompt A $x$', 100, id);
assert.equal(a.name, 'Qwen 3 test', 'name is trimmed');
assert.equal(lib.prompts.length, 1);
assert.equal(a.builtinHash, BUILTIN_HASH);
assert.equal(EMPTY_LIBRARY.prompts.length, 0, 'library is not mutated');

// Same name (any case) updates in place and keeps the id.
const r = savePrompt(lib, 'qwen 3 TEST', 'Prompt A2', 200, id);
assert.equal(r.lib.prompts.length, 1);
assert.equal(r.saved.id, a.id);
assert.equal(r.lib.prompts[0].text, 'Prompt A2');
lib = r.lib;

// A second prompt.
const b = savePrompt(lib, 'Short', 'Prompt B', 300, id);
lib = b.lib;
assert.equal(lib.prompts.length, 2);
assert.equal(findByName(lib, 'short')?.id, b.saved.id);
assert.equal(findByText(lib, 'Prompt B')?.name, 'Short');
assert.equal(findByText(lib, null), undefined);
assert.equal(findByText(lib, TRANSCRIBE_USER), undefined);

// Bad input.
assert.throws(() => savePrompt(lib, '   ', 'x', 0), /name/);
assert.throws(() => savePrompt(lib, 'Empty', '  \n', 0), /empty/);

// Startup prompt.
assert.equal(startupPrompt(lib), null, 'built-in by default');
lib = setStartup(lib, b.saved.id);
assert.equal(startupPrompt(lib), 'Prompt B');
assert.equal(setStartup(lib, 'nope').startupId, null, 'unknown id falls back to built-in');
assert.equal(setStartup(lib, null).startupId, null);

// Deleting the startup prompt falls back to the built-in.
const afterDelete = deletePrompt(lib, b.saved.id);
assert.equal(afterDelete.prompts.length, 1);
assert.equal(afterDelete.startupId, null);
assert.equal(deletePrompt(lib, a.id).startupId, b.saved.id, 'deleting another prompt keeps the startup choice');

// Round trip through storage text, and tolerance of damaged data.
assert.deepEqual(parseLibrary(JSON.stringify(lib)), lib);
assert.deepEqual(parseLibrary(null), EMPTY_LIBRARY);
assert.deepEqual(parseLibrary('not json'), EMPTY_LIBRARY);
assert.deepEqual(parseLibrary('{"prompts":"x","startupId":5}'), EMPTY_LIBRARY);
const damaged = parseLibrary(
  JSON.stringify({ prompts: [{ id: 'k', name: 'ok', text: 'T' }, { id: 'z', name: 'blank', text: ' ' }, null, { name: 'no id', text: 'T' }], startupId: 'z' }),
);
assert.deepEqual(damaged.prompts.map((p) => p.id), ['k']);
assert.equal(damaged.startupId, null, 'startup pointing at a dropped prompt is cleared');

// Built-in change detection.
assert.equal(hashText('abc'), hashText('abc'));
assert.notEqual(hashText('abc'), hashText('abd'));
assert.equal(builtinChanged(a), false);
assert.equal(builtinChanged({ ...a, builtinHash: 'deadbeef' }), true);

console.log('Saved-prompt tests passed.');

/* 2.1.2: saved prompts remember which built-in prompt they were based on. */
import { TRANSCRIBE_LARGE } from '../src/lib/prompts.ts';
import { builtinHash } from '../src/lib/promptLibrary.ts';
assert.equal(a.base, 'everyday', 'default base');
const big = savePrompt(EMPTY_LIBRARY, 'Big', 'Prompt L $x$', 400, id, 'large').saved;
assert.equal(big.base, 'large');
assert.equal(big.builtinHash, builtinHash('large'));
assert.equal(builtinHash('large'), hashText(TRANSCRIBE_LARGE.trim()));
assert.notEqual(builtinHash('large'), BUILTIN_HASH);
assert.equal(builtinChanged(big), false, 'compared against its own base');
assert.equal(builtinChanged({ ...big, base: 'everyday' }), true);
// A prompt saved by 2.1.1 (no base) is read as based on the everyday prompt.
const old = parseLibrary(JSON.stringify({ prompts: [{ id: 'o', name: 'Old', text: 'T', savedAt: 1, builtinHash: BUILTIN_HASH }], startupId: 'o' }));
assert.equal(old.prompts[0].base, 'everyday');
assert.equal(builtinChanged(old.prompts[0]), false);
assert.equal(parseLibrary(JSON.stringify({ prompts: [{ id: 'w', name: 'W', text: 'T', base: 'galaxy' }] })).prompts[0].base, 'everyday');
assert.deepEqual(parseLibrary(JSON.stringify({ prompts: [big], startupId: null })).prompts[0], big, 'round trip keeps the base');
console.log('Saved-prompt base tests passed.');
