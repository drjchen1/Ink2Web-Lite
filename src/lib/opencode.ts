import type { ModelInfo } from '../types.ts';
import { OllamaError, type ChatMessage, type ChatRequest } from './ollama.ts';

/**
 * OpenCode client (3.1): list models and run a chat through a local `opencode serve`
 * (OpenCode 2, its /api routes). The browser calls /opencode/...; the dev server forwards
 * to http://127.0.0.1:4096 and adds the password and working folder (vite.config.ts).
 * Each request: new session (every permission denied) → prompt → wait → read → delete.
 * No token stream, so onToken gets the whole answer once.
 */

export class OpenCodeError extends OllamaError {}

/**
 * OpenCode's free usage limit (3.1.1). It covers every free model at once and lasts
 * hours or days, so the app stops all model work when it sees one instead of trying
 * the next page, the figure pass, or a repair round.
 */
export class QuotaError extends OpenCodeError {}

const QUOTA_RE = /free usage|usage limit|FreeUsageLimit|subscribe to OpenCode Go|free messages|free tier/i;
export const QUOTA_MESSAGE =
  'OpenCode’s free usage limit is reached. It covers every free OpenCode model, so switching models won’t help. Conversion stopped. Switch to Purdue GenAI Studio or Ollama (Model and settings), or try OpenCode again later.';

/** An OpenCodeError, or a QuotaError when the message is OpenCode's free-limit refusal. */
const opencodeError = (msg: string) => (QUOTA_RE.test(msg) ? new QuotaError(QUOTA_MESSAGE) : new OpenCodeError(msg));

const trimSlash = (u: string) => u.replace(/\/+$/, '');

/** Every tool and action refused: the app only wants text back. */
export const DENY_ALL = [{ action: '*', resource: '*', effect: 'deny' }];

const NOT_RUNNING = 'Cannot reach OpenCode. Start it in a terminal with “opencode serve” (README › OpenCode), then click Refresh.';

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new OpenCodeError(NOT_RUNNING);
  }
  if (res.ok) {
    if ((res.headers.get('content-type') ?? '').includes('text/html'))
      throw new OpenCodeError('OpenCode answered with its web page instead of data. This app needs OpenCode 2 (opencode --version).');
    return res;
  }
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string; _tag?: string };
    detail = body.message ?? body._tag ?? '';
  } catch {
    /* body not JSON */
  }
  if (res.status === 401)
    throw new OpenCodeError(
      'OpenCode asked for its password. Start it with OPENCODE_SERVER_PASSWORD=… and put the same OPENCODE_SERVER_PASSWORD in .env.local, then restart npm run dev.',
    );
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new OpenCodeError(NOT_RUNNING);
  throw opencodeError(`OpenCode error ${res.status}${detail ? `: ${detail}` : ''}`);
}

const getJson = async (url: string, init?: RequestInit) => (await request(url, init)).json() as Promise<unknown>;

/* ---------------- models ---------------- */

interface OcModel {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  type?: string;
  status?: string;
  enabled?: boolean;
  capabilities?: { input?: string[] };
  cost?: { input?: number; output?: number }[];
}

/**
 * OpenCode's own models only (3.1.1). OpenCode also lists every provider in
 * opencode.jsonc, such as the Purdue one set up for coding; Ink2Web reaches Purdue
 * through its own GenAI Studio choice, so those are left out here.
 */
export const OPENCODE_PROVIDER = 'opencode';

/** GET /api/model → the app's ModelInfo. Names are "provider/model". */
export function toModelInfos(json: unknown): ModelInfo[] {
  const list = (json as { data?: OcModel[] } | null)?.data;
  if (!Array.isArray(list)) return [];
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    const modelID = m?.modelID ?? m?.id;
    if (!m || typeof m.providerID !== 'string' || typeof modelID !== 'string') continue;
    if (m.enabled === false || m.status === 'deprecated' || (m.type && m.type !== 'chat')) continue;
    if (m.providerID !== OPENCODE_PROVIDER) continue;
    const name = `${m.providerID}/${modelID}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const inputs = m.capabilities?.input;
    const costs = Array.isArray(m.cost) ? m.cost : [];
    out.push({
      name,
      label: m.name && m.name !== modelID ? m.name : undefined,
      vision: Array.isArray(inputs) ? inputs.includes('image') : null,
      thinking: false,
      sizeGB: 8,
      hosted: true,
      free: costs.length > 0 && costs.every((c) => !c.input && !c.output),
    });
  }
  return out.sort(
    (a, b) => Number(b.vision === true) - Number(a.vision === true) || Number(!!b.free) - Number(!!a.free) || a.name.localeCompare(b.name),
  );
}

export async function listModels(baseUrl: string): Promise<ModelInfo[]> {
  return toModelInfos(await getJson(`${trimSlash(baseUrl)}/api/model`));
}

/* ---------------- one chat = one throw-away session ---------------- */

export function splitModel(name: string): { providerID: string; id: string } {
  const i = name.indexOf('/');
  if (i <= 0 || i === name.length - 1)
    throw new OpenCodeError(`“${name}” isn’t an OpenCode model name (expected provider/model). Pick a model in Model and settings.`);
  return { providerID: name.slice(0, i), id: name.slice(i + 1) };
}

const mimeOf = (b64: string) => (b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg');

function formatNote(format: unknown): string {
  if (!format) return '';
  const schema = format === 'json' ? '' : `\nIt must follow this JSON schema:\n${JSON.stringify(format)}`;
  return `\n\nAnswer with a single JSON object only: no code fence, no words before or after it.${schema}`;
}

/** OpenCode 2 has no system field: the system message leads the text. Images become inline files. */
export function toPromptBody(req: Pick<ChatRequest, 'messages' | 'format'>): { text: string; files: Record<string, unknown>[] } {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = req.messages.filter((m) => m.role !== 'system');
  const last = turns[turns.length - 1];
  const earlier = turns.slice(0, -1);
  let text = system ? `${system}\n\n---\n\n` : '';
  if (earlier.length) {
    const said = (m: ChatMessage) => `${m.role === 'assistant' ? 'Your earlier answer' : 'Earlier request'}:\n${m.content}`;
    text += `${earlier.map(said).join('\n\n')}\n\nNow:\n`;
  }
  text += (last?.content ?? '') + formatNote(req.format);
  const files = turns
    .flatMap((m) => m.images ?? [])
    .map((b64, i) => {
      const mime = mimeOf(b64);
      return { uri: `data:${mime};base64,${b64}`, source: { type: 'inline' }, name: `page-${i + 1}.${mime === 'image/png' ? 'png' : 'jpg'}` };
    });
  return { text, files };
}

interface OcMessage {
  type?: string;
  content?: { type?: string; text?: string }[];
  error?: { message?: string; type?: string };
}

/** Newest assistant answer's text (reasoning and tools left out). */
export function answerText(json: unknown): string {
  const list = (json as { data?: OcMessage[] } | null)?.data;
  const msgs = Array.isArray(list) ? list.filter((m) => m?.type === 'assistant') : [];
  const last = msgs[msgs.length - 1];
  if (!last) throw new OpenCodeError('OpenCode finished without an answer. Try again, or pick another model.');
  const text = (last.content ?? []).filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
  if (!text && last.error) throw opencodeError(last.error.message ?? last.error.type ?? 'OpenCode reported an error.');
  return text;
}

export async function chat(req: ChatRequest): Promise<string> {
  const base = trimSlash(req.baseUrl);
  const json = { 'Content-Type': 'application/json' };
  const model = splitModel(req.model);
  const prompt = JSON.stringify(toPromptBody(req));
  const created = (await getJson(`${base}/api/session`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ title: 'Ink2Web Lite', model, permissions: DENY_ALL }),
    signal: req.signal,
  })) as { data?: { id?: string } };
  const id = created.data?.id;
  if (!id) throw new OpenCodeError('OpenCode didn’t create a session.');
  const sid = encodeURIComponent(id);
  const stop = () => void fetch(`${base}/api/session/${sid}/interrupt`, { method: 'POST' }).catch(() => undefined);
  req.signal?.addEventListener('abort', stop, { once: true });
  try {
    await request(`${base}/api/session/${sid}/prompt`, { method: 'POST', headers: json, body: prompt, signal: req.signal });
    await request(`${base}/api/experimental/session/${sid}/wait`, { method: 'POST', signal: req.signal });
    const text = answerText(await getJson(`${base}/api/session/${sid}/message?type=assistant&order=asc`, { signal: req.signal }));
    req.onToken?.(text, text);
    return text;
  } finally {
    req.signal?.removeEventListener('abort', stop);
    void fetch(`${base}/api/session/${sid}`, { method: 'DELETE' }).catch(() => undefined);
  }
}