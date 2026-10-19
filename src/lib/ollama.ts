import type { ModelInfo } from '../types.ts';

/** Minimal Ollama REST client: list models, stream a chat, request JSON. */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Base64 images WITHOUT the data: prefix (Ollama's format). */
  images?: string[];
}

export interface ChatRequest {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  /** Ollama model options (temperature, num_ctx, num_predict, ...). */
  options?: Record<string, unknown>;
  /** "json" or a JSON schema for structured output. */
  format?: unknown;
  /** Send think:false for thinking-capable models (much faster). */
  disableThinking?: boolean;
  signal?: AbortSignal;
  /** Called with each streamed text chunk. Return false to stop early. */
  onToken?: (chunk: string, full: string) => boolean | void;
}

export class OllamaError extends Error {}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new OllamaError(
      `Cannot reach Ollama at ${url.replace(/\/api\/.*$/, '')}. Is Ollama running? (Try "ollama serve".)`,
    );
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* body not JSON */
    }
    throw new OllamaError(`Ollama error ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

/** Lists installed models, marking which ones accept images. */
export async function listModels(baseUrl: string): Promise<ModelInfo[]> {
  const base = trimSlash(baseUrl);
  const tags = (await (await request(`${base}/api/tags`)).json()) as {
    models?: { name: string; size: number }[];
  };
  const models = tags.models ?? [];
  const infos = await Promise.all(
    models.map(async (m): Promise<ModelInfo> => {
      let caps: string[] | null = null;
      try {
        const show = (await (
          await request(`${base}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m.name }),
          })
        ).json()) as { capabilities?: string[] };
        caps = show.capabilities ?? null;
      } catch {
        /* older Ollama: capabilities unknown */
      }
      return {
        name: m.name,
        vision: caps ? caps.includes('vision') : null,
        thinking: caps ? caps.includes('thinking') : false,
        sizeGB: m.size / 1e9,
      };
    }),
  );
  // Vision models first, then alphabetical.
  return infos.sort(
    (a, b) => Number(b.vision === true) - Number(a.vision === true) || a.name.localeCompare(b.name),
  );
}

/** Streams a chat completion and resolves with the full text. */
export async function chat(req: ChatRequest): Promise<string> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    keep_alive: '15m',
    options: req.options ?? {},
  };
  if (req.format) body.format = req.format;
  if (req.disableThinking) body.think = false;

  const res = await request(`${trimSlash(req.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.body) throw new OllamaError('Ollama returned an empty response.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const handleLine = (line: string): boolean => {
    if (!line.trim()) return true;
    const msg = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean };
    if (msg.error) throw new OllamaError(msg.error);
    const chunk = msg.message?.content ?? '';
    if (chunk) {
      full += chunk;
      if (req.onToken?.(chunk, full) === false) return false;
    }
    return !msg.done;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!handleLine(line)) {
          await reader.cancel();
          return full;
        }
      }
    }
    handleLine(buffer);
  } finally {
    reader.releaseLock?.();
  }
  return full;
}
