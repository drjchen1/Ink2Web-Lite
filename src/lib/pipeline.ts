import type { Box, Figure, Page, Settings } from '../types.ts';
import { chat } from './ollama.ts';
import { cropBase64, cropFigure, modelImage, pageLayout, regionImage, snapToInk, squareImage } from './images.ts';
import { DESCRIBE_USER, LOCATE_SCHEMA, REREAD_USER, TRANSCRIBE_SYSTEM, locatePrompt, transcribePrompt } from './prompts.ts';
import { defaultLayout, matchFigures } from './layout.ts';
import { besideUnitCount, placeByPosition, renumber, type Placed } from './placement.ts';
import { cleanModelOutput, cleanReread, extractFigures, isLooping, parseBoxes, removeMarkers, trimRepetition } from './transcript.ts';

export interface PageProgress {
  phase: 'transcribing' | 'locating';
  /** Raw streamed text so far (transcription phase). */
  text?: string;
}

/** Fallback when a figure can't be located: a centered band the user can adjust. */
const FALLBACK_BOX: Box = { x: 0.1, y: 0.3, w: 0.8, h: 0.35 };

interface Draft {
  id: number;
  box: Box;
  alt: string;
  needsReview: boolean;
  autoDetected: boolean;
  /** Position comes from the page (detector) rather than the model's marker. */
  placed: boolean;
}

/**
 * Converts one page:
 *  1. transcribe to Markdown+LaTeX with [[FIGURE: ...]] markers (model), while
 *     detecting drawings and text lines from the ink in parallel (no model);
 *  2. pair the model's figures with detected drawings (asking the model for boxes
 *     only when the two lists disagree);
 *  3. describe drawings the model didn't mention (model, one short call each);
 *  4. put every detected figure's marker where the drawing sits on the page,
 *     number figures in reading order, crop, and pick a default layout.
 */
export async function convertPage(
  page: Page,
  settings: Settings,
  thinking: boolean,
  signal: AbortSignal,
  onProgress: (p: PageProgress) => void,
  /** A temporary replacement for the transcription prompt (Advanced settings), or null. */
  customPrompt: string | null = null,
): Promise<{ source: string; figures: Figure[] }> {
  const base = { baseUrl: settings.baseUrl, model: settings.model, disableThinking: thinking, signal };
  const layoutPromise = pageLayout(page.image);

  let looped = false;
  let checkedAt = 0;
  const raw = await chat({
    ...base,
    options: { temperature: 0, num_ctx: settings.numCtx, num_predict: 4096 },
    messages: [
      { role: 'system', content: TRANSCRIBE_SYSTEM },
      {
        role: 'user',
        content: customPrompt ?? transcribePrompt(),
        images: [await modelImage(page.image, settings.detail, settings.enhance)],
      },
    ],
    onToken: (_, full) => {
      onProgress({ phase: 'transcribing', text: full });
      // Abort the stream early if the model starts repeating itself.
      if (full.length - checkedAt >= 80) {
        checkedAt = full.length;
        if (isLooping(full)) {
          looped = true;
          return false;
        }
      }
    },
  });

  // Arrows and braces the model still draws inside an equation become notes here.
  const text = cleanModelOutput(looped ? trimRepetition(raw) : raw);
  let { source, descriptions } = extractFigures(text);
  const layout = await layoutPromise;
  const regions = layout.figures;
  if (!descriptions.length && !regions.length) return { source, figures: [] };

  onProgress({ phase: 'locating' });

  let modelBoxes: (Box | null)[] | undefined;
  if (descriptions.length && descriptions.length !== regions.length && settings.locateFigures) {
    try {
      const answer = await chat({
        ...base,
        options: { temperature: 0, num_ctx: settings.numCtx, num_predict: 400 },
        format: LOCATE_SCHEMA,
        messages: [{ role: 'user', content: locatePrompt(descriptions), images: [await squareImage(page.image)] }],
      });
      modelBoxes = parseBoxes(answer, descriptions.length, page.width, page.height);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }

  const { assigned, extra } = matchFigures(descriptions.length, regions, modelBoxes);
  const drafts: Draft[] = [];
  const dropped: number[] = [];

  descriptions.forEach((alt, i) => {
    const id = i + 1;
    const r = assigned[i];
    if (r >= 0) drafts.push({ id, box: regions[r], alt, needsReview: false, autoDetected: false, placed: true });
    else if (extra.length) dropped.push(id); // the detector found it; it gets described directly below
    else
      drafts.push({
        id,
        box: modelBoxes?.[i] ?? FALLBACK_BOX,
        alt,
        needsReview: true,
        autoDetected: false,
        placed: false,
      });
  });
  for (const d of drafts) if (!d.placed && d.box !== FALLBACK_BOX) d.box = await snapToInk(page.image, d.box);
  source = removeMarkers(source, dropped);

  let nextId = descriptions.length + 1;
  for (const j of extra) {
    let alt = '';
    try {
      alt = (
        await chat({
          ...base,
          options: { temperature: 0, num_ctx: 4096, num_predict: 120 },
          messages: [{ role: 'user', content: DESCRIBE_USER, images: [await cropBase64(page.image, regions[j])] }],
        })
      )
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
    drafts.push({ id: nextId++, box: regions[j], alt, needsReview: true, autoDetected: true, placed: true });
  }

  // Detected figures go where they are on the page; model-only figures keep the model's spot.
  const toPlace: Placed[] = drafts.filter((d) => d.placed);
  const keep: Placed[] = drafts.filter((d) => !d.placed);
  source = placeByPosition(source, toPlace, keep, layout.lines);
  const { source: numbered, map } = renumber(source);

  const figures: Figure[] = [];
  for (const d of drafts) {
    const id = map.get(d.id);
    if (id === undefined) continue;
    const look = defaultLayout(d.box, layout.lines);
    if (look.wrap) look.besideLines = besideUnitCount(numbered, { id, box: d.box }, layout.lines);
    figures.push({
      id,
      box: d.box,
      alt: d.alt,
      caption: '',
      src: await cropFigure(page.image, d.box),
      needsReview: d.needsReview,
      autoDetected: d.autoDetected,
      ...look,
    });
  }
  return { source: numbered, figures: figures.sort((a, b) => a.id - b.id) };
}

/**
 * Re-transcribes one user-selected region (2.0). Returns a proposal only; nothing
 * on the page changes until the user accepts it and presses Done.
 */
export async function rereadRegion(
  page: Page,
  box: Box,
  settings: Settings,
  thinking: boolean,
  signal: AbortSignal,
): Promise<string> {
  let looped = false;
  let checkedAt = 0;
  const raw = await chat({
    baseUrl: settings.baseUrl,
    model: settings.model,
    disableThinking: thinking,
    signal,
    options: { temperature: 0, num_ctx: Math.min(settings.numCtx, 4096), num_predict: 1200 },
    messages: [
      { role: 'system', content: TRANSCRIBE_SYSTEM },
      { role: 'user', content: REREAD_USER, images: [await regionImage(page.image, box, settings.enhance)] },
    ],
    onToken: (_, full) => {
      if (full.length - checkedAt >= 80) {
        checkedAt = full.length;
        if (isLooping(full)) {
          looped = true;
          return false;
        }
      }
    },
  });
  return cleanReread(looped ? trimRepetition(raw) : raw);
}
