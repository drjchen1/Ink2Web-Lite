import type { ModelInfo, Provider, Settings } from '../types.ts';
import * as ollama from './ollama.ts';
import * as genai from './genai.ts';
import type { ChatRequest } from './ollama.ts';

/**
 * One door to the model (3.0): local Ollama or Purdue GenAI Studio. The pipeline only
 * says which provider; everything else (prompts, clean-up, figures) is shared.
 */

/** Where the browser sends requests: both go through the app's own server (vite.config.ts). */
export const GENAI_URL = '/genai';

export const PROVIDERS: Record<Provider, { label: string; short: string }> = {
  ollama: { label: 'This computer (Ollama)', short: 'Local' },
  genai: { label: 'Purdue GenAI Studio', short: 'GenAI Studio' },
};

export const asProvider = (v: unknown): Provider => (v === 'genai' ? 'genai' : 'ollama');

/** The provider and URL for a settings object (spread into a chat request). */
export function endpoint(s: Pick<Settings, 'provider' | 'baseUrl'>): { provider: Provider; baseUrl: string } {
  return s.provider === 'genai' ? { provider: 'genai', baseUrl: GENAI_URL } : { provider: 'ollama', baseUrl: s.baseUrl };
}

export function listModels(s: Pick<Settings, 'provider' | 'baseUrl'>): Promise<ModelInfo[]> {
  const e = endpoint(s);
  return e.provider === 'genai' ? genai.listModels(e.baseUrl) : ollama.listModels(e.baseUrl);
}

export function chat(req: ChatRequest): Promise<string> {
  return req.provider === 'genai' ? genai.chat(req) : ollama.chat(req);
}

/** Hosted lists don't always say which models read images; these names usually do. */
const VISION_NAME = /vl\b|vision|llava|pixtral|gemma-?[34]|qwen3\.[5-9]|qwen-?2\.5-?vl|minicpm-v|mistral-small/i;

/** The model to select when the current one isn't available. */
export function pickModel(list: ModelInfo[]): string {
  return (list.find((m) => m.vision === true) ?? list.find((m) => m.vision !== false && VISION_NAME.test(m.name)) ?? list.find((m) => m.vision !== false) ?? list[0])?.name ?? '';
}
