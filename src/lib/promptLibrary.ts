import { TRANSCRIBE_USER } from './prompts.ts';

/**
 * Saved transcription prompts (2.1.1).
 *
 * Edited prompts can be saved under a name and kept in this browser (localStorage;
 * prompts are small text). One saved prompt can be marked "start with this", so it
 * is in use whenever the app opens.
 *
 * The built-in prompt is never overwritten. Saving a copy instead of replacing the
 * default means app updates that improve the built-in prompt still reach you, and
 * each saved prompt remembers which built-in it was made alongside, so the app can
 * say when the built-in has changed since.
 *
 * Everything except load/save is pure, so it is tested in node (tests/promptLibrary.test.ts).
 */

export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
  savedAt: number;
  /** Hash of the built-in prompt when this was saved (see builtinChanged). */
  builtinHash: string;
}

export interface PromptLibrary {
  prompts: SavedPrompt[];
  /** The saved prompt used when the app opens, or null for the built-in. */
  startupId: string | null;
}

export const EMPTY_LIBRARY: PromptLibrary = { prompts: [], startupId: null };

/** Short, stable hash (FNV-1a, 32-bit) used only to notice that the built-in prompt changed. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const BUILTIN_HASH = hashText(TRANSCRIBE_USER.trim());

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const findByName = (lib: PromptLibrary, name: string) => lib.prompts.find((p) => sameName(p.name, name));

/** The saved prompt whose text is exactly `text` (used to name the prompt in use), or undefined. */
export const findByText = (lib: PromptLibrary, text: string | null) =>
  text === null ? undefined : lib.prompts.find((p) => p.text === text);

/**
 * Saves `text` under `name`. A prompt with the same name (ignoring case) is updated
 * in place; otherwise a new one is added. Returns the new library and the saved prompt.
 */
export function savePrompt(
  lib: PromptLibrary,
  name: string,
  text: string,
  now: number,
  newId: () => string = () => Math.random().toString(36).slice(2, 10),
): { lib: PromptLibrary; saved: SavedPrompt } {
  const clean = name.trim();
  if (!clean) throw new Error('Give the prompt a name.');
  if (!text.trim()) throw new Error('The prompt is empty.');
  const existing = findByName(lib, clean);
  const saved: SavedPrompt = { id: existing?.id ?? newId(), name: clean, text, savedAt: now, builtinHash: BUILTIN_HASH };
  const prompts = existing ? lib.prompts.map((p) => (p.id === existing.id ? saved : p)) : [...lib.prompts, saved];
  return { lib: { ...lib, prompts }, saved };
}

export function deletePrompt(lib: PromptLibrary, id: string): PromptLibrary {
  return { prompts: lib.prompts.filter((p) => p.id !== id), startupId: lib.startupId === id ? null : lib.startupId };
}

/** Marks a saved prompt as the one to start with (null = the built-in). */
export function setStartup(lib: PromptLibrary, id: string | null): PromptLibrary {
  return { ...lib, startupId: id !== null && lib.prompts.some((p) => p.id === id) ? id : null };
}

/** The prompt text to use when the app opens: a saved prompt's text, or null for the built-in. */
export function startupPrompt(lib: PromptLibrary): string | null {
  return lib.prompts.find((p) => p.id === lib.startupId)?.text ?? null;
}

/** True when the built-in prompt has changed (an app update) since this prompt was saved. */
export const builtinChanged = (p: SavedPrompt) => p.builtinHash !== BUILTIN_HASH;

/** Reads a stored library, dropping anything malformed instead of failing. */
export function parseLibrary(json: string | null): PromptLibrary {
  if (!json) return EMPTY_LIBRARY;
  try {
    const raw = JSON.parse(json) as Partial<PromptLibrary>;
    const prompts = (Array.isArray(raw.prompts) ? raw.prompts : []).filter(
      (p): p is SavedPrompt =>
        !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.text === 'string' && !!p.text.trim(),
    );
    const startupId = typeof raw.startupId === 'string' && prompts.some((p) => p.id === raw.startupId) ? raw.startupId : null;
    return {
      prompts: prompts.map((p) => ({ ...p, savedAt: Number(p.savedAt) || 0, builtinHash: String(p.builtinHash ?? '') })),
      startupId,
    };
  } catch {
    return EMPTY_LIBRARY;
  }
}

/* ---------------- browser storage ---------------- */

const KEY = 'ink2web-lite:prompts';

export function loadLibrary(): PromptLibrary {
  try {
    return parseLibrary(localStorage.getItem(KEY));
  } catch {
    return EMPTY_LIBRARY;
  }
}

/** Returns false if the browser refused to save (private mode, storage full). */
export function storeLibrary(lib: PromptLibrary): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}
