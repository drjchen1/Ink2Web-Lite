// Run: npm test   (OpenCode 2 provider, 3.1: model list, request, answer; 3.1.1: own models only, usage limit)
import assert from 'node:assert/strict';
import { DENY_ALL, OpenCodeError, QUOTA_MESSAGE, QuotaError, answerText, chat, listModels, splitModel, toModelInfos, toPromptBody } from '../src/lib/opencode.ts';
import { OPENCODE_URL, asProvider, endpoint, isHosted, pickModel } from '../src/lib/model.ts';

/* ---------------- routing ---------------- */
assert.deepEqual(endpoint({ provider: 'opencode', baseUrl: '/ollama' }), { provider: 'opencode', baseUrl: OPENCODE_URL });
assert.equal(asProvider('opencode'), 'opencode');
assert.equal(asProvider('genai'), 'genai', '3.0 settings still load');
assert.equal(asProvider('zen'), 'ollama');
assert(isHosted('opencode') && isHosted('genai') && !isHosted('ollama'));

/* ---------------- model list (GET /api/model) ---------------- */
const free = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }];
const caps = (input: string[]) => ({ tools: true, input, output: ['text'] });
const models = {
  location: { directory: '/Users/k/ink2web-opencode' },
  data: [
    { id: 'big-pickle', modelID: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', capabilities: caps(['text']), cost: free, status: 'active', enabled: true },
    { id: 'hy4-flash-free', modelID: 'hy4-flash-free', providerID: 'opencode', name: 'Hy4 flash Free', capabilities: caps(['text', 'image']), cost: free, status: 'active', enabled: true },
    { id: 'paid', modelID: 'paid', providerID: 'opencode', name: 'paid', capabilities: caps(['text', 'image']), cost: [{ input: 1, output: 2, cache: { read: 0, write: 0 } }], status: 'active', enabled: true },
    { id: 'gpt-oss:120b', modelID: 'gpt-oss:120b', providerID: 'purdue', name: 'gpt-oss 120B', capabilities: caps(['text']), cost: [], status: 'active', enabled: true },
    { id: 'gemma4:26b-a4b', modelID: 'gemma4:26b-a4b', providerID: 'purdue', capabilities: caps(['text', 'image']), cost: [], status: 'active', enabled: true },
    { id: 'off', modelID: 'off', providerID: 'opencode', name: 'off', capabilities: caps(['text']), cost: free, status: 'active', enabled: false },
    { id: 'old', modelID: 'old', providerID: 'opencode', name: 'old', capabilities: caps(['text']), cost: free, status: 'deprecated', enabled: true },
  ],
};
const infos = toModelInfos(models);
assert.deepEqual(
  infos.map((m) => m.name),
  ['opencode/hy4-flash-free', 'opencode/paid', 'opencode/big-pickle'],
  'vision first, then free; Purdue (reached through GenAI Studio), disabled, and deprecated left out',
);
assert.equal(infos[0].label, 'Hy4 flash Free');
assert.equal(infos[0].vision, true);
assert.equal(infos[0].free, true);
assert.equal(infos[1].free, false);
assert.equal(infos[2].vision, false, 'text-only input');
assert(infos.every((m) => m.hosted && !m.thinking));
assert.equal(pickModel(infos), 'opencode/hy4-flash-free');
assert.equal(toModelInfos({ data: [{ id: 'm', providerID: 'opencode' }] })[0].vision, null, 'unknown capabilities');
assert.equal(toModelInfos({ data: [{ id: 'm', providerID: 'opencode', name: 'm' }] })[0].label, undefined, 'no label when it repeats the id');
assert.deepEqual(toModelInfos(null), []);
assert.deepEqual(toModelInfos({ data: 'x' }), []);

/* ---------------- request ---------------- */
assert.deepEqual(splitModel('opencode/big-pickle'), { providerID: 'opencode', id: 'big-pickle' });
assert.deepEqual(splitModel('purdue/meta/llama-4:scout'), { providerID: 'purdue', id: 'meta/llama-4:scout' });
assert.throws(() => splitModel('qwen3.5:4b-mlx'), OpenCodeError);
assert.throws(() => splitModel('opencode/'), OpenCodeError);

const jpeg = '/9j/4AAQSkZJRg';
const png = 'iVBORw0KGgo';
let body = toPromptBody({ messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U', images: [jpeg] }] });
assert.equal(body.text, 'S\n\n---\n\nU', 'system leads the text (OpenCode 2 has no system field)');
assert.deepEqual(body.files, [{ uri: `data:image/jpeg;base64,${jpeg}`, source: { type: 'inline' }, name: 'page-1.jpg' }]);

// A repair round: earlier turns written out, images kept, the schema asked for in words.
body = toPromptBody({
  format: { type: 'object' },
  messages: [
    { role: 'user', content: 'Q', images: [png] },
    { role: 'assistant', content: '{"bad":1}' },
    { role: 'user', content: 'Fix it' },
  ],
});
assert.match(body.text, /^Earlier request:\nQ\n\nYour earlier answer:\n\{"bad":1\}\n\nNow:\nFix it\n\nAnswer with a single JSON object only/);
assert(body.text.includes('{"type":"object"}'));
assert.equal(body.files[0].name, 'page-1.png');

/* ---------------- answer (GET /api/session/{id}/message?type=assistant) ---------------- */
const asst = (content: unknown[], extra = {}) => ({ data: [{ id: 'msg_1', type: 'assistant', content, ...extra }], cursor: {} });
assert.equal(answerText(asst([{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: '## Ti' }, { type: 'text', text: 'tle' }])), '## Title', 'reasoning left out');
assert.equal(answerText({ data: [{ type: 'assistant', content: [{ type: 'text', text: 'old' }] }, { type: 'assistant', content: [{ type: 'text', text: 'new' }] }] }), 'new', 'newest answer');
assert.throws(() => answerText(asst([], { error: { type: 'ProviderError', message: 'model overloaded' } })), (e: unknown) => e instanceof OpenCodeError && !(e instanceof QuotaError) && /overloaded/.test((e as Error).message));
assert.throws(() => answerText({ data: [] }), /without an answer/);

/* ---------------- the free usage limit (3.1.1) ---------------- */
for (const msg of [
  'Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',
  'Free usage exceeded, subscribe to Go retrying in 50427s - attempt #1',
  'FreeUsageLimitError',
  "You've used today's free messages. They reset at 11:59 PM",
])
  assert.throws(() => answerText(asst([], { error: { message: msg } })), (e: unknown) => e instanceof QuotaError && e.message === QUOTA_MESSAGE, msg);
assert(QUOTA_MESSAGE.includes('every free OpenCode model') && QUOTA_MESSAGE.includes('Purdue GenAI Studio'));

/* ---------------- chat() against a fake OpenCode 2 server ---------------- */
const calls: { method: string; url: string; body: unknown }[] = [];
let script: Record<string, () => Response> = {};
globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? 'GET';
  calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
  const key = `${method} ${url.replace(/ses_\w+/, ':id').replace(/\?.*$/, '')}`;
  const f = script[key];
  return f ? f() : new Response(null, { status: 204 });
}) as typeof fetch;

script = {
  'POST /opencode/api/session': () => Response.json({ data: { id: 'ses_abc' } }),
  'POST /opencode/api/session/:id/prompt': () => Response.json({ data: { id: 'msg_u' } }),
  'GET /opencode/api/session/:id/message': () => Response.json(asst([{ type: 'text', text: '## Ratio test' }])),
};
let seen = '';
const req = { provider: 'opencode' as const, baseUrl: '/opencode', model: 'opencode/big-pickle', messages: [{ role: 'system' as const, content: 'S' }, { role: 'user' as const, content: 'hi', images: [jpeg] }] };
assert.equal(await chat({ ...req, onToken: (_c, full) => void (seen = full) }), '## Ratio test');
assert.equal(seen, '## Ratio test');
assert.deepEqual(
  calls.map((c) => `${c.method} ${c.url}`),
  [
    'POST /opencode/api/session',
    'POST /opencode/api/session/ses_abc/prompt',
    'POST /opencode/api/experimental/session/ses_abc/wait',
    'GET /opencode/api/session/ses_abc/message?type=assistant&order=asc',
    'DELETE /opencode/api/session/ses_abc',
  ],
  'create, prompt, wait, read, delete',
);
assert.deepEqual(calls[0].body, { title: 'Ink2Web Lite', model: { providerID: 'opencode', id: 'big-pickle' }, permissions: DENY_ALL });
assert.equal((calls[1].body as { text: string }).text, 'S\n\n---\n\nhi');

// The usage limit as an HTTP error is a QuotaError too, and the session is still deleted.
calls.length = 0;
script = {
  'POST /opencode/api/session': () => Response.json({ data: { id: 'ses_q' } }),
  'POST /opencode/api/session/:id/prompt': () => Response.json({ _tag: 'FreeUsageLimitError', message: 'Free usage limit reached.' }, { status: 429 }),
};
await assert.rejects(chat(req), QuotaError);
assert.equal(calls.at(-1)?.method, 'DELETE');

// OpenCode not running (the dev server answers 502).
script = { 'POST /opencode/api/session': () => new Response('', { status: 502 }) };
await assert.rejects(chat(req), /opencode serve/);
// No password: OpenCode 2 answers 401.
script = { 'POST /opencode/api/session': () => Response.json({ _tag: 'UnauthorizedError', message: 'Authentication required' }, { status: 401 }) };
await assert.rejects(chat(req), /OPENCODE_SERVER_PASSWORD/);
// The web page instead of data (an old path): a clear message, not a JSON parse error.
script = { 'GET /opencode/api/model': () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) };
await assert.rejects(listModels('/opencode'), /web page/);
// A bad model name fails before any session is created.
calls.length = 0;
await assert.rejects(chat({ ...req, model: 'no-slash' }), /provider\/model/);
assert.equal(calls.length, 0);

script = { 'GET /opencode/api/model': () => Response.json(models) };
assert.equal((await listModels('/opencode')).length, 3);

console.log('OpenCode provider tests passed.');
