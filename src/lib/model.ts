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

export function listModels(s: Pick<Settings, 'provider' | 'baseUrl'>, apiKey?: string): Promise<ModelInfo[]> {
  const e = endpoint(s);
  return e.provider === 'genai' ? genai.listModels(e.baseUrl, apiKey) : ollama.listModels(e.baseUrl);
}

export function chat(req: ChatRequest): Promise<string> {
  return req.provider === 'genai' ? genai.chat(req) : ollama.chat(req);
}

/** Releases the loaded Ollama model from memory (`keep_alive: 0`). Returns false for GenAI or unreachable Ollama. */
export function unloadModel(s: Pick<Settings, 'provider' | 'baseUrl' | 'model'>): Promise<boolean> {
  if (s.provider === 'genai' || !s.model) return Promise.resolve(false);
  return ollama.unloadModel(endpoint(s).baseUrl, s.model);
}

/** Hosted lists don't always say which models read images; these names usually do. */
export { VISION_NAME } from './ollama.ts';
import { VISION_NAME } from './ollama.ts';

/** LightOnOCR models expect native empty/grounding prompts rather than instruction chat prompts. */
export const isLightOnOcrModel = (model: string): boolean => /lightonocr/i.test(model);

/** Compact <=3B edge models where thinking slows down generation or causes repetition loops. */
export const isSmallEdgeModel = (model: string, sizeGB?: number): boolean =>
  /\b(?:0\.8b|1b|1\.5b|2b|3b|e2b)\b/i.test(model) || (typeof sizeGB === 'number' && sizeGB > 0 && sizeGB < 2.8);

const EVERYDAY_MODEL_PRIORITY: RegExp[] = [
  /^qwen3\.5:4b(?:-mlx)?\b/i,
  /lightonocr-?3:(?:4b|3b|latest)\b/i,
  /^ministral-3:3b\b/i,
  /^qwen3\.5:2b(?:-mlx)?\b/i,
  /^gemma4:e2b\b/i,
];

/** The model to select when the current one isn't available, preferring everyday models in priority order. */
export function pickModel(list: ModelInfo[]): string {
  for (const pat of EVERYDAY_MODEL_PRIORITY) {
    const hit = list.find((m) => m.vision !== false && pat.test(m.name));
    if (hit) return hit.name;
  }
  return (
    list.find((m) => m.vision === true) ??
    list.find((m) => m.vision !== false && VISION_NAME.test(m.name)) ??
    list.find((m) => m.vision !== false) ??
    list[0]
  )?.name ?? '';
}

export type ModelTask =
  | 'transcribe'
  | 'reread'
  | 'locate'
  | 'shortAlt'
  | 'describe'
  | 'redrawAuto'
  | 'redrawRepair'
  | 'redrawManual';

/**
 * Per-task Ollama `think` policy (`true`, `false`, or `undefined` to omit):
 * - Perceptual OCR (`transcribe`, `reread`), tiny budget (`shortAlt`), and strict JSON-schema
 *   tasks (`locate`, `describe`) disable thinking (`false`) on thinking-capable models.
 * - LightOnOCR-3 always forces `false`.
 * - <=3B edge models (`qwen3.5:2b-mlx`, `gemma4:e2b-it-qat`, `ministral-3:3b`) keep thinking `false`.
 * - >=3.5B thinking models (`qwen3.5:4b-mlx`, 8B+) keep Round 1 auto-redraw fast (`false`), and
 *   enable `think: true` on `redrawRepair` (Round 2 diagnostics) and interactive `redrawManual`.
 */
export function resolveTaskThink(
  task: ModelTask,
  opts: { model: string; supportsThinking: boolean; sizeGB?: number; provider?: Provider },
): boolean | undefined {
  if (opts.provider === 'genai') return undefined;
  if (isLightOnOcrModel(opts.model)) return false;
  if (!opts.supportsThinking) return undefined;
  if (task === 'redrawRepair' || task === 'redrawManual') {
    return !isSmallEdgeModel(opts.model, opts.sizeGB);
  }
  return false;
}
