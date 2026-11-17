// Run: npm test   (Purdue GenAI Studio provider, 3.0: request/response translation)
import assert from 'node:assert/strict';
import { GenAIError, paramsB, parseSse, retryDelay, toModelInfos, toOpenAIBody } from '../src/lib/genai.ts';
import { GENAI_URL, asProvider, endpoint, pickModel } from '../src/lib/model.ts';

/* ---------------- routing ---------------- */
assert.deepEqual(endpoint({ provider: 'ollama', baseUrl: '/ollama' }), { provider: 'ollama', baseUrl: '/ollama' });
assert.deepEqual(endpoint({ provider: 'genai', baseUrl: '/ollama' }), { provider: 'genai', baseUrl: GENAI_URL });
for (const bad of [undefined, null, 'cloud', 3]) assert.equal(asProvider(bad), 'ollama', 'unknown -> local');
assert.equal(asProvider('genai'), 'genai');

/* ---------------- model list ---------------- */
assert.equal(paramsB('qwen3.8:27b'), 27);
assert.equal(paramsB('gemma4:26b-it'), 26);
assert.equal(paramsB('llama3.2-vision:11b'), 11);
assert.equal(paramsB('gpt-oss:120b'), 120);
assert.equal(paramsB('my-custom-model'), null);
const infos = toModelInfos({
  data: [
    { id: 'gpt-oss:120b' },
    { id: 'qwen3.8:27b', info: { meta: { capabilities: { vision: true } } } },
    { id: 'text-only', info: { meta: { capabilities: { vision: false } } } },
    { bogus: true },
  ],
});
assert.deepEqual(infos.map((m) => m.name), ['qwen3.8:27b', 'gpt-oss:120b', 'text-only'], 'vision first');
assert(infos.every((m) => m.hosted && !m.thinking));
assert.equal(infos[0].sizeGB > 5.5, true, 'a 27B model counts as large for the prompt hint');
assert.deepEqual(toModelInfos({}), []);
assert.deepEqual(toModelInfos(null), []);
assert.equal(pickModel(infos), 'qwen3.8:27b');
// Unknown capabilities: a model whose name says vision wins over alphabetical order.
assert.equal(pickModel(toModelInfos({ data: [{ id: 'aaa:7b' }, { id: 'qwen2.5vl:72b' }] })), 'qwen2.5vl:72b');
assert.equal(pickModel([]), '');

/* ---------------- request body ---------------- */
const jpeg = '/9j/4AAQSkZJRg';
const png = 'iVBORw0KGgo';
const body = toOpenAIBody({
  provider: 'genai',
  baseUrl: GENAI_URL,
  model: 'qwen3.8:27b',
  options: { temperature: 0, num_ctx: 8192, num_predict: 4096 },
  format: { type: 'object' },
  messages: [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U', images: [jpeg, png] },
  ],
});
assert.equal(body.model, 'qwen3.8:27b');
assert.equal(body.stream, true);
assert.equal(body.temperature, 0);
assert.equal(body.max_tokens, 4096);
assert(!('num_ctx' in body), 'num_ctx is an Ollama-only setting');
const msgs = body.messages as { role: string; content: unknown }[];
assert.deepEqual(msgs[0], { role: 'system', content: 'S' });
assert.deepEqual(msgs[1].content, [
  { type: 'text', text: 'U' },
  { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } },
  { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
]);
assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' }, strict: false } });
assert(!('response_format' in toOpenAIBody({ baseUrl: '', model: 'm', messages: [], format: { type: 'object' } }, false)), 'fallback without format');
assert.deepEqual(toOpenAIBody({ baseUrl: '', model: 'm', messages: [], format: 'json' }).response_format, { type: 'json_object' });

/* ---------------- streamed answer ---------------- */
const ev = (o: object) => `data: ${JSON.stringify(o)}`;
let r = parseSse([ev({ choices: [{ delta: { role: 'assistant' } }] }), ev({ choices: [{ delta: { content: '## Ti' } }] }), '', ': keep-alive', ev({ choices: [{ delta: { content: 'tle' } }] })]);
assert.deepEqual(r, { chunks: ['## Ti', 'tle'], done: false });
r = parseSse([ev({ choices: [{ delta: { content: 'x' } }] }), 'data: [DONE]', ev({ choices: [{ delta: { content: 'ignored' } }] })]);
assert.deepEqual(r, { chunks: ['x'], done: true });
// Reasoning from thinking models is not part of the transcription.
assert.deepEqual(parseSse([ev({ choices: [{ delta: { reasoning_content: 'hmm' } }] })]).chunks, []);
assert.throws(() => parseSse([ev({ error: { message: 'model not found' } })]), (e: unknown) => e instanceof GenAIError && /model not found/.test((e as Error).message));

/* ---------------- rate limits ---------------- */
assert.equal(retryDelay('5', 0), 5000);
assert.equal(retryDelay('600', 0), 60000, 'capped at a minute');
assert.equal(retryDelay(null, 0), 3000);
assert.equal(retryDelay(null, 2), 12000);
assert.equal(retryDelay('soon', 5), 30000);

console.log('GenAI Studio provider tests passed.');

/* ---------------- chat() against a fake server ---------------- */
import { chat } from '../src/lib/genai.ts';
const sse = (parts: string[]) =>
  new Response(new Blob([parts.map((p) => `${ev({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n']).stream(), { status: 200 });
const calls: { url: string; body: Record<string, unknown> }[] = [];
let script: (() => Response)[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
  return script.shift()!();
}) as typeof fetch;
const req = { provider: 'genai' as const, baseUrl: '/genai', model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

script = [() => sse(['## Ratio', ' test'])];
let seen = '';
assert.equal(await chat({ ...req, onToken: (_c, full) => void (seen = full) }), '## Ratio test');
assert.equal(seen, '## Ratio test');
assert.equal(calls[0].url, '/genai/api/chat/completions');

// Rate-limited once, then fine: waits (Retry-After: 0 here) and retries.
calls.length = 0;
let waited = -1;
script = [() => new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }), () => sse(['ok'])];
assert.equal(await chat({ ...req, onWait: (s) => (waited = s) }), 'ok');
assert.equal(calls.length, 2);
assert.equal(waited, 0);

// A model that rejects structured output: asked again without it.
calls.length = 0;
script = [() => new Response(JSON.stringify({ detail: 'response_format not supported' }), { status: 400 }), () => sse(['{"a":1}'])];
assert.equal(await chat({ ...req, format: { type: 'object' } }), '{"a":1}');
assert('response_format' in calls[0].body && !('response_format' in calls[1].body));

// Stop early (loop detection) returns what came so far.
script = [() => sse(['a', 'b', 'c'])];
assert.equal(await chat({ ...req, onToken: (_c, full) => full.length < 2 }), 'ab');

// A bad key gets a message that says what to do.
script = [() => new Response('{"detail":"Not authenticated"}', { status: 401 })];
await assert.rejects(chat(req), /\.env\.local/);

console.log('GenAI Studio chat tests passed.');
