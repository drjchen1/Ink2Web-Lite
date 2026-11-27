import type { ModelInfo } from '../types.ts';

/** Hosted or older Ollama lists don't always report capabilities; these names usually read images. */
export const VISION_NAME =
  /vl\b|vision|llava|pixtral|gemma-?[34]|qwen3\.[5-9]|qwen-?2\.5-?vl|lightonocr|ministral-?3|minicpm-v|mistral-small|internvl|moondream|bakllava|cogvlm|glm-?4v|deepseek-vl|(?:llama|phi|granite)[^\s]*vision/i;

/** Minimal Ollama REST client: list models, stream a chat, request JSON. */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Base64 images WITHOUT the data: prefix (Ollama's format). */
  images?: string[];
}

export interface ChatRequest {
  /** Which server answers (3.0). Missing means Ollama. */
  provider?: 'ollama' | 'genai';
  baseUrl: string;
  /** Optional Bearer API key for direct GenAI Studio requests (used by CLI). */
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  /** Ollama model options (temperature, num_ctx, num_predict, ...). */
  options?: Record<string, unknown>;
  /** "json" or a JSON schema for structured output. */
  format?: unknown;
  /** Explicit Ollama `think` override (true / false); takes precedence over `disableThinking`. */
  think?: boolean;
  /** Legacy shorthand: send think:false when `think` is unset. */
  disableThinking?: boolean;
  signal?: AbortSignal;
  /** Called with each streamed text chunk. Return false to stop early. */
  onToken?: (chunk: string, full: string) => boolean | void;
  /** GenAI Studio only: called when a rate-limited request waits before retrying. */
  onWait?: (seconds: number) => void;
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
        vision: caps ? caps.includes('vision') : VISION_NAME.test(m.name) ? true : null,
        thinking: caps
          ? caps.includes('thinking')
          : /\b(?:qwen3\.5|gemma-?4|lightonocr-?3|deepseek-r1|qwq)\b/i.test(m.name),
        sizeGB: m.size / 1e9,
      };
    }),
  );
  // Vision models first, then alphabetical.
  return infos.sort(
    (a, b) => Number(b.vision === true) - Number(a.vision === true) || a.name.localeCompare(b.name),
  );
}

/** Detects repeating tail loops inside reasoning traces when thinking is enabled. */
function isLoopingThinking(text: string): boolean {
  const tail = text.slice(-900);
  for (let p = 10; p <= 180; p++) {
    const unit = tail.slice(-p);
    if (!unit.trim()) continue;
    let count = 1;
    while (count < 8 && (count + 1) * p <= tail.length && tail.slice(-(count + 1) * p, -count * p) === unit) count++;
    if (count >= 6) return true;
  }
  return false;
}

/** Streams a chat completion and resolves with the full text. */
export async function chat(req: ChatRequest): Promise<string> {
  const thinkVal = req.think !== undefined ? req.think : req.disableThinking ? false : undefined;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    keep_alive: '15m',
    options: req.options ?? {},
  };
  if (req.format) body.format = req.format;
  if (thinkVal !== undefined) body.think = thinkVal;

  const url = `${trimSlash(req.baseUrl)}/api/chat`;
  const send = () =>
    request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });

  let res: Response;
  try {
    res = await send();
  } catch (e) {
    if (
      body.think !== undefined &&
      e instanceof OllamaError &&
      /(?:does not support thinking|unknown field.*think|\b400\b.*think)/i.test(e.message)
    ) {
      delete body.think;
      res = await send();
    } else {
      throw e;
    }
  }
  if (!res.body) throw new OllamaError('Ollama returned an empty response.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let thinkingText = '';

  const handleLine = (line: string): boolean => {
    if (!line.trim()) return true;
    const msg = JSON.parse(line) as { message?: { content?: string; thinking?: string }; error?: string; done?: boolean };
    if (msg.error) throw new OllamaError(msg.error);
    const thinkChunk = msg.message?.thinking ?? '';
    if (thinkChunk) {
      thinkingText += thinkChunk;
      if (thinkVal === true && thinkingText.length > 800 && isLoopingThinking(thinkingText)) return false;
    }
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

/** Asks Ollama to evict `model` from GPU/system RAM immediately (`keep_alive: 0`). Never throws. */
export async function unloadModel(baseUrl: string, model: string): Promise<boolean> {
  if (!model.trim()) return false;
  try {
    const res = await fetch(`${trimSlash(baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', keep_alive: 0 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
