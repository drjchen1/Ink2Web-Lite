import type { ModelInfo } from '../types.ts';
import { OllamaError, type ChatRequest } from './ollama.ts';

/**
 * Purdue GenAI Studio client (3.0): the same two jobs as ollama.ts (list models, stream
 * a chat), over GenAI Studio's OpenAI-compatible API.
 *
 * The browser never sees the API key. Requests go to the dev server at /genai, which
 * forwards them to https://genai.rcac.purdue.edu and adds the key from GENAI_API_KEY
 * (see vite.config.ts and .env.local).
 *
 * The pipeline speaks Ollama's request shape (images as bare base64, options.num_predict,
 * format = JSON schema); this file translates it. Everything after the model's answer
 * (clean-up, figures, export) is shared, so both providers behave the same.
 */

export class GenAIError extends OllamaError {}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

/** How long to wait before retrying a rate-limited request (Retry-After, else backoff). */
export function retryDelay(retryAfter: string | null, attempt: number): number {
  const s = Number(retryAfter);
  if (retryAfter && Number.isFinite(s) && s >= 0) return Math.min(60, s) * 1000;
  return Math.min(30, 3 * 2 ** attempt) * 1000;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/** A readable message from an error response. */
async function errorText(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { detail?: unknown; error?: { message?: string } | string; message?: string };
    const d = body.detail ?? (typeof body.error === 'string' ? body.error : body.error?.message) ?? body.message;
    detail = typeof d === 'string' ? d : d ? JSON.stringify(d) : '';
  } catch {
    /* body not JSON */
  }
  if (res.status === 401 || res.status === 403)
    return 'GenAI Studio refused the API key. Put a valid key in .env.local (GENAI_API_KEY=…) and restart npm run dev.';
  if (res.status === 429) return 'GenAI Studio is rate-limiting requests. Wait a minute and try again.';
  return `GenAI Studio error ${res.status}${detail ? `: ${detail}` : ''}`;
}

/**
 * fetch with retries on rate limits (429) and brief outages (502-504). Other errors are
 * thrown with a readable message. onWait reports a pause so the app can say why.
 */
async function request(url: string, init: RequestInit, onWait?: (seconds: number) => void, tries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new GenAIError('Cannot reach GenAI Studio through the app’s server. Is npm run dev running, and are you online?');
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || (res.status >= 502 && res.status <= 504);
    if (!retryable || attempt + 1 >= tries) throw new GenAIError(await errorText(res));
    const wait = retryDelay(res.headers.get('retry-after'), attempt);
    onWait?.(Math.round(wait / 1000));
    await sleep(wait, init.signal ?? undefined);
  }
}

/** Parameter count in billions from a model id ("qwen3.8:27b" -> 27), or null. */
export function paramsB(id: string): number | null {
  const m = id.match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*b(?![a-z])/i);
  return m ? Number(m[1]) : null;
}

interface StudioModel {
  id: string;
  name?: string;
  info?: { meta?: { capabilities?: { vision?: boolean } } };
}

/** Converts GenAI Studio's model list to the app's ModelInfo (pure, for tests). */
export function toModelInfos(json: unknown): ModelInfo[] {
  const data = (json as { data?: StudioModel[] })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((m) => m && typeof m.id === 'string')
    .map((m) => {
      const p = paramsB(m.id);
      const vision = m.info?.meta?.capabilities?.vision;
      return {
        name: m.id,
        vision: typeof vision === 'boolean' ? vision : null,
        thinking: false,
        // No download size for hosted models; ~0.65 GB per billion parameters (4-bit)
        // keeps the "Larger models" prompt hint meaningful.
        sizeGB: p ? p * 0.65 : 0,
        hosted: true,
      };
    })
    .sort((a, b) => Number(b.vision === true) - Number(a.vision === true) || a.name.localeCompare(b.name));
}

export async function listModels(baseUrl: string): Promise<ModelInfo[]> {
  const res = await request(`${trimSlash(baseUrl)}/api/models`, {}, undefined, 2);
  return toModelInfos(await res.json());
}

/** MIME type of a bare base64 image (the app sends JPEG, crops may be PNG). */
const mimeOf = (b64: string) => (b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg');

/** The Ollama-shaped request as an OpenAI chat-completions body (pure, for tests). */
export function toOpenAIBody(req: ChatRequest, withFormat = true): Record<string, unknown> {
  const messages = req.messages.map((m) =>
    m.images?.length
      ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...m.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:${mimeOf(b64)};base64,${b64}` } })),
          ],
        }
      : { role: m.role, content: m.content },
  );
  const o = req.options ?? {};
  const body: Record<string, unknown> = { model: req.model, messages, stream: true };
  if (typeof o.temperature === 'number') body.temperature = o.temperature;
  if (typeof o.num_predict === 'number') body.max_tokens = o.num_predict;
  if (withFormat && req.format) {
    body.response_format =
      req.format === 'json'
        ? { type: 'json_object' }
        : { type: 'json_schema', json_schema: { name: 'answer', schema: req.format, strict: false } };
  }
  return body;
}

/** Text chunks in one block of server-sent events; done when "[DONE]" arrives (pure, for tests). */
export function parseSse(lines: string[]): { chunks: string[]; done: boolean } {
  const chunks: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return { chunks, done: true };
    let msg: { choices?: { delta?: { content?: string }; message?: { content?: string } }[]; error?: { message?: string } | string };
    try {
      msg = JSON.parse(data);
    } catch {
      continue; // keep-alive or partial line
    }
    if (msg.error) throw new GenAIError(typeof msg.error === 'string' ? msg.error : msg.error.message ?? 'GenAI Studio error');
    const c = msg.choices?.[0];
    const text = c?.delta?.content ?? c?.message?.content;
    if (text) chunks.push(text);
  }
  return { chunks, done: false };
}

/** Streams a chat completion and resolves with the full text (same contract as ollama.chat). */
export async function chat(req: ChatRequest): Promise<string> {
  const url = `${trimSlash(req.baseUrl)}/api/chat/completions`;
  const send = (withFormat: boolean) =>
    request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toOpenAIBody(req, withFormat)),
        signal: req.signal,
      },
      req.onWait,
    );
  let res: Response;
  try {
    res = await send(true);
  } catch (e) {
    // Structured output isn't supported by every hosted model: ask again without it.
    // The app's parsers already accept JSON in a code fence or with extra words.
    if (!req.format || !(e instanceof GenAIError) || !/error 400|error 422/.test(e.message)) throw e;
    res = await send(false);
  }
  if (!res.body) throw new GenAIError('GenAI Studio returned an empty response.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const nl = buffer.lastIndexOf('\n');
      if (nl < 0) continue;
      const { chunks, done: finished } = parseSse(buffer.slice(0, nl).split('\n'));
      buffer = buffer.slice(nl + 1);
      for (const chunk of chunks) {
        full += chunk;
        if (req.onToken?.(chunk, full) === false) {
          await reader.cancel();
          return full;
        }
      }
      if (finished) {
        await reader.cancel();
        return full;
      }
    }
    for (const chunk of parseSse(buffer.split('\n')).chunks) full += chunk;
  } finally {
    reader.releaseLock?.();
  }
  return full;
}
