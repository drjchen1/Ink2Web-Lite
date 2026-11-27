import type { Box, Figure, Page, Settings } from '../types.ts';
import type { ChatMessage } from './ollama.ts';
import { chat, endpoint, isLightOnOcrModel, resolveTaskThink } from './model.ts';
import { notesAround } from './redraw/prompt.ts';
import type { RedrawOutcome } from './redraw/conversation.ts';
import { checkRedrawInk } from './redraw/inkCheck.ts';
import { redrawSpec } from './figureRedraw.ts';
import { DESCRIBE_SCHEMA, DESCRIBE_SYSTEM, describePrompt, describedPatch, parseDescription, type FigureDescription } from './describe.ts';
import { extractEquationMenu } from './redraw/v2/eqMenu.ts';
import { analyzeSketch } from './redraw/v2/sketchCv.ts';
import { REDRAW_V2_SYSTEM, buildRedrawV2Prompt, runRedrawV2Conversation } from './redraw/v2/converseV2.ts';

export type { RedrawOutcome };
import { browserRaster } from './images.ts';
import type { RasterBackend } from './raster.ts';
import { DESCRIBE_USER, LOCATE_SCHEMA, REREAD_USER, TRANSCRIBE_SYSTEM, locatePrompt, transcribePrompt } from './prompts.ts';
import { analyzeLayout, defaultLayout, detectTwoColumns, matchFigures, splitDenseBands } from './layout.ts';
import { besideUnitCount, placeByPosition, renumber, type Placed } from './placement.ts';
import { detectRows, figureRows, fitWidths } from './figureRows.ts';
import { cleanLightOnOcrOutput, cleanModelOutput, cleanReread, extractFigures, isLooping, parseBoxes, removeMarkers, stripThinkingTraces, trimRepetition } from './transcript.ts';

export interface PageProgress {
  phase: 'transcribing' | 'locating';
  /** Raw streamed text so far (transcription phase). */
  text?: string;
  /** Optional sub-step detail during locating/redrawing. */
  detail?: string;
}

export interface PipelineEnv {
  raster?: RasterBackend;
  apiKey?: string;
  genaiUrl?: string;
}

const epOf = (settings: Settings, env?: PipelineEnv) =>
  settings.provider === 'genai' && env?.genaiUrl ? { provider: 'genai' as const, baseUrl: env.genaiUrl } : endpoint(settings);

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
  /**
   * The transcription prompt: the chosen built-in one (everyday or larger models) or a
   * custom prompt from Advanced settings. The caller decides which.
   */
  prompt: string = transcribePrompt(),
  env?: PipelineEnv,
): Promise<{ source: string; figures: Figure[] }> {
  const raster = env?.raster ?? browserRaster;
  const ep = epOf(settings, env);
  const lightOn = isLightOnOcrModel(settings.model);
  const base = {
    ...ep,
    ...(env?.apiKey ? { apiKey: env.apiKey } : {}),
    model: settings.model,
    think: resolveTaskThink('transcribe', { model: settings.model, supportsThinking: thinking, provider: settings.provider }),
    signal,
  };
  const ink = await raster.pageInkMap(page.image);
  const layout = analyzeLayout(ink);

  const askTranscribe = async (imgBase64: string, prefix = '', mode: 'full' | 'crop' = 'full') => {
    let looped = false;
    let checkedAt = 0;
    const messages: ChatMessage[] = lightOn
      ? [{ role: 'user', content: mode === 'full' ? 'grounding' : '', images: [imgBase64] }]
      : [
          { role: 'system', content: TRANSCRIBE_SYSTEM },
          { role: 'user', content: prompt, images: [imgBase64] },
        ];
    const raw = await chat({
      ...base,
      options: { temperature: lightOn ? 0.1 : 0, num_ctx: settings.numCtx, num_predict: 4096 },
      messages,
      onToken: (_, full) => {
        const shown = lightOn ? cleanLightOnOcrOutput(full).text : full;
        onProgress({ phase: 'transcribing', text: prefix ? `${prefix}\n\n${shown}` : shown });
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
    return looped ? trimRepetition(raw) : raw;
  };

  let text = '';
  let groundedBoxes: Box[] = [];
  const twoCol = settings.splitDensePages !== false ? detectTwoColumns(ink, layout) : null;
  const bands = !twoCol && settings.splitDensePages !== false && settings.promptSet === 'everyday' ? splitDenseBands(layout) : null;

  if (twoCol) {
    const headerRaw = twoCol.headerBox ? await askTranscribe(await raster.regionImage(page.image, twoCol.headerBox, settings.enhance), '', 'crop') : '';
    const leftRaw = await askTranscribe(await raster.regionImage(page.image, twoCol.leftBox, settings.enhance), headerRaw, 'crop');
    const rightRaw = await askTranscribe(await raster.regionImage(page.image, twoCol.rightBox, settings.enhance), [headerRaw, leftRaw].filter(Boolean).join('\n\n'), 'crop');
    const stripOcr = (raw: string) => (lightOn ? cleanLightOnOcrOutput(raw).text : raw);
    const parts = [
      headerRaw ? cleanModelOutput(stripOcr(headerRaw)) : '',
      '[[columns]]',
      cleanModelOutput(stripOcr(leftRaw)),
      '[[next]]',
      cleanModelOutput(stripOcr(rightRaw)),
      '[[/columns]]',
    ].filter(Boolean);
    text = parts.join('\n\n');
  } else if (bands) {
    const rawParts: string[] = [];
    for (const band of bands) {
      rawParts.push(await askTranscribe(await raster.regionImage(page.image, band, settings.enhance), rawParts.join('\n\n'), 'crop'));
    }
    const joined = rawParts.map((r) => (lightOn ? cleanLightOnOcrOutput(r).text : r)).join('\n\n');
    text = cleanModelOutput(joined);
  } else {
    const raw = await askTranscribe(await raster.modelImage(page.image, settings.detail, settings.enhance), '', 'full');
    if (lightOn) {
      const parsedOcr = cleanLightOnOcrOutput(raw);
      groundedBoxes = parsedOcr.boxes;
      text = cleanModelOutput(parsedOcr.text);
    } else {
      text = cleanModelOutput(raw);
    }
  }

  let { source, descriptions } = extractFigures(text);
  const regions = layout.figures;
  if (!descriptions.length && !regions.length) return { source, figures: [] };

  onProgress({ phase: 'locating' });

  let modelBoxes: (Box | null)[] | undefined;
  if (lightOn && groundedBoxes.length === descriptions.length && groundedBoxes.length > 0) {
    modelBoxes = groundedBoxes;
  } else if (descriptions.length && descriptions.length !== regions.length && settings.locateFigures && !isLightOnOcrModel(settings.model)) {
    try {
      const answer = await chat({
        ...base,
        think: resolveTaskThink('locate', { model: settings.model, supportsThinking: thinking, provider: settings.provider }),
        options: { temperature: 0, num_ctx: settings.numCtx, num_predict: 400 },
        format: LOCATE_SCHEMA,
        messages: [{ role: 'user', content: locatePrompt(descriptions), images: [await raster.squareImage(page.image)] }],
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
  for (const d of drafts) if (!d.placed && d.box !== FALLBACK_BOX) d.box = await raster.snapToInk(page.image, d.box);
  source = removeMarkers(source, dropped);

  // Larger models (3.2): every figure gets the full figure pass below, so a drawing the
  // detector found waits for it instead of first getting a one-sentence description.
  const describePass = settings.promptSet === 'large' && settings.describeFigures && !isLightOnOcrModel(settings.model);
  const autoRedraw = settings.autoRedraw !== false && !isLightOnOcrModel(settings.model);
  /** One sentence for a drawing the model didn't mention ('' if the model fails or OCR-only model). */
  const shortAlt = async (box: Box): Promise<string> => {
    if (isLightOnOcrModel(settings.model)) return 'Hand-drawn figure';
    try {
      const ans = await chat({
        ...base,
        think: resolveTaskThink('shortAlt', { model: settings.model, supportsThinking: thinking, provider: settings.provider }),
        options: { temperature: 0, num_ctx: settings.numCtx, num_predict: 120 },
        messages: [{ role: 'user', content: DESCRIBE_USER, images: [await raster.cropBase64(page.image, box)] }],
      });
      return stripThinkingTraces(ans)
        .replace(/^alt\s*text\s*:\s*/i, '')
        .replace(/^["“'\s]+|["”'\s]+$/g, '')
        .trim();
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      return '';
    }
  };

  let nextId = descriptions.length + 1;
  for (const j of extra) {
    const alt = describePass || autoRedraw ? '' : await shortAlt(regions[j]);
    drafts.push({ id: nextId++, box: regions[j], alt, needsReview: true, autoDetected: true, placed: true });
  }

  // Detected figures go where they are on the page; model-only figures keep the model's spot.
  const toPlace: Placed[] = drafts.filter((d) => d.placed);
  const keep: Placed[] = drafts.filter((d) => !d.placed);
  source = placeByPosition(source, toPlace, keep, layout.lines);
  // Detected drawings level with each other on the page sit side by side (2.2.3).
  const rowsFound = detectRows(source, toPlace);
  source = rowsFound.source;
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
      src: await raster.cropFigure(page.image, d.box),
      needsReview: d.needsReview,
      autoDetected: d.autoDetected,
      ...look,
      ...(rowsFound.beside.has(d.id) ? { besidePrevious: true } : {}),
    });
  }
  for (const row of figureRows(numbered, figures)) {
    const members = row.map((id) => figures.find((f) => f.id === id)!);
    const widths = fitWidths(members.map((f) => f.width));
    members.forEach((f, i) => Object.assign(f, { width: widths[i], wrap: false, besideLines: 0, align: 'center' as const }));
  }
  // Larger models (3.2): a short title (its plain form is the alt text) and a detailed description per figure.
  if (describePass) {
    for (const f of figures) {
      try {
        const d = await describeFigure(page.image, numbered, f, settings, thinking, signal, env);
        if (d) Object.assign(f, describedPatch(d));
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        // Keep the transcription's description; the user can ask again from the figure panel.
      }
    }
  }
  // Auto-redraw (3.2.2): attempt clean SVG redraw from the notes for mathematical figures.
  if (autoRedraw) {
    const tempPage = { ...page, source: numbered };
    for (const f of figures) {
      onProgress({ phase: 'locating', detail: `redraw ${f.id}/${figures.length}` });
      try {
        const r = await redrawFigure(tempPage, f, settings, thinking, signal, false, env);
        if (r.status === 'ok') {
          if (r.confidence === 'high') {
            f.redraw = { spec: r.spec, show: 'redrawn' };
          } else if (r.confidence === 'medium') {
            f.redraw = { spec: r.spec, show: 'both' };
            f.redrawCheck = true;
          } else if (r.confidence === 'low') {
            f.redraw = { spec: r.spec, show: 'image' };
            f.redrawCheck = true;
          } else {
            const parsed = redrawSpec(r.spec);
            if (parsed.ok) {
              const check = checkRedrawInk(await raster.figureInkMap(page.image, f.box), parsed);
              f.redraw = { spec: r.spec, show: check.matches ? 'redrawn' : 'both' };
              if (!check.matches) f.redrawCheck = true;
            } else {
              f.redraw = { spec: r.spec, show: 'redrawn' };
            }
          }
        } else if (r.status === 'errors') f.redraw = { spec: r.spec, show: 'image' };
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
      }
    }
  }
  // A detected drawing neither redrawn nor described still gets a one-sentence alt text.
  for (const f of figures) {
    if (!f.alt.trim() && f.redraw?.show !== 'redrawn') f.alt = await shortAlt(f.box);
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
  env?: PipelineEnv,
): Promise<string> {
  const raster = env?.raster ?? browserRaster;
  let looped = false;
  let checkedAt = 0;
  const lightOn = isLightOnOcrModel(settings.model);
  const cropImg = await raster.regionImage(page.image, box, settings.enhance);
  const messages: ChatMessage[] = lightOn
    ? [{ role: 'user', content: '', images: [cropImg] }]
    : [
        { role: 'system', content: TRANSCRIBE_SYSTEM },
        { role: 'user', content: REREAD_USER, images: [cropImg] },
      ];
  const raw = await chat({
    ...epOf(settings, env),
    ...(env?.apiKey ? { apiKey: env.apiKey } : {}),
    model: settings.model,
    think: resolveTaskThink('reread', { model: settings.model, supportsThinking: thinking, provider: settings.provider }),
    signal,
    options: { temperature: lightOn ? 0.1 : 0, num_ctx: settings.numCtx, num_predict: 1200 },
    messages,
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
  const text = looped ? trimRepetition(raw) : raw;
  return cleanReread(lightOn ? cleanLightOnOcrOutput(text).text : text);
}

/* ---------------------------------------------------------------------------------
 * Redraw from the math (2.2)
 * ------------------------------------------------------------------------------- */

/**
 * Asks the model to describe a figure's mathematics as a redraw spec, from the crop
 * and the notes around the figure. A spec that fails the checks goes back to the
 * model once, with the problems listed. Returns a proposal; nothing changes on the
 * page until the user chooses to show the redraw.
 */
export async function redrawFigure(
  page: Page,
  fig: Figure,
  settings: Settings,
  thinking: boolean,
  signal: AbortSignal,
  interactive = false,
  env?: PipelineEnv,
): Promise<RedrawOutcome> {
  if (isLightOnOcrModel(settings.model)) {
    return {
      status: 'unreadable',
      spec: '',
      errors: [
        'LightOnOCR-3 is a dedicated page-OCR model and cannot write redraw specs. Switch temporarily to qwen3.5:4b-mlx or ministral-3:3b to redraw this figure.',
      ],
      confidence: 'low',
    };
  }
  const raster = env?.raster ?? browserRaster;
  const notes = notesAround(page.source, fig.id);
  const eqMenu = extractEquationMenu(notes);
  const ink = await raster.figureInkMap(page.image, fig.box);
  const profile = analyzeSketch(ink);
  const prompt = buildRedrawV2Prompt(notes, eqMenu, profile);
  const messages: ChatMessage[] = [
    { role: 'system', content: REDRAW_V2_SYSTEM },
    {
      role: 'user',
      content: prompt,
      images: [await raster.regionImage(page.image, fig.box, settings.enhance)],
    },
  ];
  return runRedrawV2Conversation(
    (msgs, round) => {
      const think = resolveTaskThink(
        interactive ? 'redrawManual' : round === 0 ? 'redrawAuto' : 'redrawRepair',
        { model: settings.model, supportsThinking: thinking, provider: settings.provider },
      );
      return chat({
        ...epOf(settings, env),
        ...(env?.apiKey ? { apiKey: env.apiKey } : {}),
        model: settings.model,
        think,
        signal,
        options: {
          temperature: 0,
          num_ctx: settings.numCtx,
          num_predict: think === true ? Math.min(2200, Math.max(1400, settings.numCtx - 1500)) : 900,
        },
        messages: msgs,
      });
    },
    messages,
    { eqMenu, ink, profile },
  );
}

/* ---------------------------------------------------------------------------------
 * Figure title and detailed description (3.2)
 * ------------------------------------------------------------------------------- */

/**
 * Asks the model for one figure's short title (alt text) and detailed description, from
 * its crop and the notes around it. Returns null when the answer isn't usable.
 */
export async function describeFigure(
  image: Blob,
  source: string,
  fig: Pick<Figure, 'id' | 'box'>,
  settings: Settings,
  thinking: boolean,
  signal: AbortSignal,
  env?: PipelineEnv,
): Promise<FigureDescription | null> {
  if (isLightOnOcrModel(settings.model)) return null;
  const raster = env?.raster ?? browserRaster;
  const answer = await chat({
    ...epOf(settings, env),
    ...(env?.apiKey ? { apiKey: env.apiKey } : {}),
    model: settings.model,
    think: resolveTaskThink('describe', { model: settings.model, supportsThinking: thinking, provider: settings.provider }),
    signal,
    format: DESCRIBE_SCHEMA,
    options: { temperature: 0, num_ctx: settings.numCtx, num_predict: 700 },
    messages: [
      { role: 'system', content: DESCRIBE_SYSTEM },
      { role: 'user', content: describePrompt(notesAround(source, fig.id)), images: [await raster.regionImage(image, fig.box, settings.enhance)] },
    ],
  });
  return parseDescription(answer);
}
