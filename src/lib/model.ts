import type { ModelInfo, Provider, Settings } from '../types.ts';
import * as ollama from './ollama.ts';
import * as genai from './genai.ts';
import * as opencode from './opencode.ts';
import type { ChatRequest } from './ollama.ts';

/**
 * One door to the model: local Ollama, Purdue GenAI Studio (3.0), or OpenCode (3.1). The pipeline only
 * says which provider; everything else (prompts, clean-up, figures) is shared.
 */

/** Where the browser sends requests: all go through the app's own server (vite.config.ts). */
export const GENAI_URL = '/genai';
export const OPENCODE_URL = '/opencode';

export const PROVIDERS: Record<Provider, { label: string; short: string }> = {
  ollama: { label: 'This computer (Ollama)', short: 'Local' },
  genai: { label: 'Purdue GenAI Studio', short: 'GenAI Studio' },
  opencode: { label: 'OpenCode', short: 'OpenCode' },
};

/** Providers that send pages off this computer. */
export const isHosted = (p: Provider) => p !== 'ollama';

export const asProvider = (v: unknown): Provider => (v === 'genai' || v === 'opencode' ? v : 'ollama');

/** The provider and URL for a settings object (spread into a chat request). */
export function endpoint(s: Pick<Settings, 'provider' | 'baseUrl'>): { provider: Provider; baseUrl: string } {
  if (s.provider === 'genai') return { provider: 'genai', baseUrl: GENAI_URL };
  if (s.provider === 'opencode') return { provider: 'opencode', baseUrl: OPENCODE_URL };
  return { provider: 'ollama', baseUrl: s.baseUrl };
}

export function listModels(s: Pick<Settings, 'provider' | 'baseUrl'>): Promise<ModelInfo[]> {
  const e = endpoint(s);
  if (e.provider === 'genai') return genai.listModels(e.baseUrl);
  if (e.provider === 'opencode') return opencode.listModels(e.baseUrl);
  return ollama.listModels(e.baseUrl);
}

export function chat(req: ChatRequest): Promise<string> {
  if (req.provider === 'genai') return genai.chat(req);
  if (req.provider === 'opencode') return opencode.chat(req);
  return ollama.chat(req);
}

/** Hosted lists don't always say which models read images; these names usually do. */
const VISION_NAME = /vl\b|vision|llava|pixtral|gemma-?[34]|qwen3\.[5-9]|qwen-?2\.5-?vl|minicpm-v|mistral-small/i;

/** The model to select when the current one isn't available. */
export function pickModel(list: ModelInfo[]): string {
  return (list.find((m) => m.vision === true) ?? list.find((m) => m.vision !== false && VISION_NAME.test(m.name)) ?? list.find((m) => m.vision !== false) ?? list[0])?.name ?? '';
}
