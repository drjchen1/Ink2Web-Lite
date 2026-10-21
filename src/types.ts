/** A rectangle in normalized page coordinates (0..1, origin top-left). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FigureAlign = 'left' | 'center' | 'right';

export interface Figure {
  /** Matches the [[FIGURE n]] marker in the page source. Unique within a page. */
  id: number;
  box: Box;
  /** Alt text (required for WCAG 1.1.1). Seeded from the model's description. */
  alt: string;
  /** Optional visible caption. */
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

export interface Settings {
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
}

export interface ModelInfo {
  name: string;
  /** null when the Ollama version doesn't report capabilities. */
  vision: boolean | null;
  thinking: boolean;
  sizeGB: number;
}
