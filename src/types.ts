import type { BuiltinPromptId } from './lib/prompts.ts';

/** A rectangle in normalized page coordinates (0..1, origin top-left). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FigureAlign = 'left' | 'center' | 'right';

/** What the document shows for a figure (2.2): the cropped image, the redraw, or both. */
export type FigureShow = 'image' | 'redrawn' | 'both';

/**
 * A figure recreated from its mathematics (2.2). Only the spec is stored; the SVG and
 * its alt text are regenerated from it (lib/figureRedraw.ts), so a spec with errors
 * simply falls back to the image.
 */
export interface FigureRedraw {
  /** The redraw spec as Line-DSL or JSON text (see docs/REDRAW.md). Kept as typed, errors and all. */
  spec: string;
  /** 'image' until the user chooses otherwise. */
  show: FigureShow;
}

export interface Figure {
  /** Matches the [[FIGURE n]] marker in the page source. Unique within a page. */
  id: number;
  box: Box;
  /** Alt text (required for WCAG 1.1.1). Seeded from the model's description. */
  alt: string;
  /**
   * A longer description (3.2): a few sentences, math in $…$, shown under the figure in a
   * collapsed "Detailed description". Written by the larger-model figure pass or by hand.
   */
  description?: string;
  /**
   * The short title from the figure pass (3.2.1), math in $…$. Its plain-words form is
   * the alt text; the title itself is shown, math rendered, in the Page cards caption bar.
   * Ignored once the alt text no longer matches it (the user rewrote the alt text).
   */
  title?: string;
  /** Optional visible caption, math in $…$. */
  caption: string;
  /** PNG/JPEG data URL of the cropped region (regenerated when the box changes). */
  src: string;
  /** True when the crop or description is a guess and should be checked. */
  needsReview: boolean;
  /** Found by the ink detector rather than marked by the model. */
  autoDetected?: boolean;
  /** Display width as a percentage of the text column (20-100). */
  width: number;
  /** Horizontal placement in the exported document. */
  align: FigureAlign;
  /** Let the following text flow beside the figure (only for left/right). */
  wrap: boolean;
  /** With wrap: how many following lines sit beside the figure; later text starts below it. */
  besideLines: number;
  /**
   * Sits side by side with the figure right before it in the text (2.2.3). Only takes
   * effect while the two markers are next to each other (see lib/figureRows.ts).
   */
  besidePrevious?: boolean;
  /** Redrawn from the math (2.2), if the user has asked for it. */
  redraw?: FigureRedraw;
  /** True when automatic ink comparison says the redrawn curve should be checked against the sketch. */
  redrawCheck?: boolean;
}

/**
 * idle        - added but not converted (nothing runs until the user asks)
 * queued      - waiting its turn in the conversion queue
 * transcribing / locating - being converted now
 * done / error / cancelled - finished, failed, or stopped
 */
export type PageStatus = 'idle' | 'queued' | 'transcribing' | 'locating' | 'done' | 'error' | 'cancelled';

export interface Page {
  id: string;
  /** Human label, e.g. "lecture3.pdf, page 2". */
  label: string;
  /** Full-resolution page image (PNG) used for figure crops. */
  image: Blob;
  /** Object URL for <img> display. */
  url: string;
  width: number;
  height: number;
  status: PageStatus;
  /** Markdown + LaTeX transcription with [[FIGURE n]] markers. User-editable. */
  source: string;
  figures: Figure[];
  error?: string;
}

/**
 * How the clean-up step treats arrows and braces the model writes inside an equation.
 * The app always uses 'notes' (moved out into "where ..." sentences); 'drawn' (left in
 * the equation) is kept only for the clean-up helpers and their tests.
 */
export type AnnotationStyle = 'notes' | 'drawn';

/** Where the model runs (3.0): on this computer, or on Purdue's GenAI Studio. */
export type Provider = 'ollama' | 'genai';

export interface Settings {
  /** Where the model runs (3.0). 'ollama' is the default and keeps everything local. */
  provider: Provider;
  /** The model last chosen for each provider, so switching back restores it. */
  lastModels: Partial<Record<Provider, string>>;
  /** Ollama base URL. "/ollama" uses the Vite proxy. */
  baseUrl: string;
  model: string;
  /** Long side (px) of the image sent to the model. */
  detail: number;
  /** Contrast stretch (colors kept) before sending to the model. */
  enhance: boolean;
  /** Ask the model for figure positions when its figure list disagrees with the ink detector. */
  locateFigures: boolean;
  /** Context window passed to Ollama (must hold image tokens + output). */
  numCtx: number;
  /**
   * Which built-in transcription prompt to use (2.1.2): 'everyday' (short, for small
   * models; the default) or 'large' (more detailed, for larger models). A custom
   * prompt from Advanced settings takes precedence while it is in use.
   */
  promptSet: BuiltinPromptId;
  /**
   * With the Larger models prompt (3.2): after a page converts, ask the model for each
   * figure's short title (the alt text) and detailed description. One request per figure.
   */
  describeFigures: boolean;
  /** Automatically attempt mathematical SVG redraw during page conversion. */
  autoRedraw: boolean;
  /** Split dense small-model pages into horizontal bands or two-column handouts before reading. */
  splitDensePages: boolean;
}

export interface ModelInfo {
  name: string;
  /** null when the Ollama version doesn't report capabilities. */
  vision: boolean | null;
  thinking: boolean;
  /** Download size; for hosted models an estimate from the parameter count (0 if unknown). */
  sizeGB: number;
  /** Runs on GenAI Studio rather than this computer (3.0). */
  hosted?: boolean;
}
