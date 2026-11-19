/**
 * Figure titles and detailed descriptions (3.2). Pure functions; the model call is in
 * pipeline.ts (describeFigure).
 *
 * A larger model gets one figure's crop and the notes around it, and answers with
 *   { "title": "...", "description": "..." }
 * The title is short, with math in $…$ (3.2.1). Its plain-words form becomes the alt
 * text (what a screen reader says); the title itself is kept on the figure and shown,
 * math rendered, in the caption bar of the Page cards export. The description is a few
 * sentences, math allowed in $…$, shown under the figure in a collapsed "Detailed
 * description" (exportHtml.ts), so screen-reader users can open it and sighted readers
 * aren't flooded.
 */

import { plainMath, rendersAsWritten } from './exportHtml.ts';

export const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['title', 'description'],
};

export const DESCRIBE_SYSTEM = 'You write alt text and descriptions of hand-drawn math figures for blind students.';

export function describePrompt(notes: string): string {
  return `The image is one hand-drawn figure from a page of math notes. Below are the notes around it; ">>> THIS FIGURE <<<" marks where the figure is.

Write two things about the drawing:
- "title": a short label for it, at most 12 words, with no final period. Say what it is and what it shows. Write its math in LaTeX inside dollar signs and everything else in plain words, for example: Shaded area under $f(x) = e^{2x}$ from $x = 0$ to $x = 1$
- "description": two to five sentences for a blind student, in this order: the kind of drawing and its axes with their labels; each curve or shape and how it behaves (increasing, oscillating, decaying, where it starts and ends); marked points, values, and labels on the drawing; dashed lines, arrows, and shaded or hatched regions. Write math in LaTeX inside dollar signs, like $f(x) = e^{2x}$. Use the notes to name things exactly (the function, the interval), but describe only what is drawn.

Do not solve, explain, or add anything that is not in the drawing. Do not repeat the sentences written next to the drawing.

Notes:
${notes}

Answer with the JSON only.`;
}

/** Math delimiters made canonical: \(…\), \[…\] and $$…$$ become $…$. */
const canonicalMath = (t: string) =>
  t
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => `$${m.trim()}$`);

/** Surrounding quotes and a final period removed, spacing tidied. */
const trimTitle = (t: string) =>
  t
    .replace(/\s+/g, ' ')
    .replace(/^["“'\s]+|["”'\s.]+$/g, '')
    .trim();

/** The title as shown in the caption bar: math in $…$, no quotes or final period. */
export function tidyTitle(t: string): string {
  return trimTitle(canonicalMath(t));
}

/** Plain words for the alt text (what a screen reader says): the title without LaTeX. */
export function plainTitle(t: string): string {
  return trimTitle(plainMath(canonicalMath(t)));
}

/** The description with math delimiters made canonical ($…$) and spacing tidied. */
export function tidyDescription(d: string): string {
  return canonicalMath(d).replace(/\s+/g, ' ').trim();
}

export interface FigureDescription {
  /** The short title with math in $…$ (shown in the caption bar); '' when there is none. */
  title: string;
  /** The title in plain words: the alt text. */
  alt: string;
  description: string;
}

/**
 * The model's answer as { title, alt, description }, or null when it isn't usable. Accepts
 * JSON in a code fence or with words around it (models without structured output).
 */
export function parseDescription(answer: string): FigureDescription | null {
  const text = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const candidates = [text.replace(/^```(?:json)?\s*|\s*```$/g, ''), text.match(/\{[\s\S]*\}/)?.[0] ?? ''];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as { title?: unknown; description?: unknown };
      const raw = typeof j.title === 'string' ? tidyTitle(j.title) : '';
      const alt = raw ? plainTitle(raw) : '';
      // Shown in the caption bar only when it has math that renders as written.
      const title = raw && rendersAsWritten(raw) ? raw : alt;
      const description = typeof j.description === 'string' ? tidyDescription(j.description) : '';
      if (alt || description) return { title, alt, description };
    } catch {
      /* try the next form */
    }
  }
  return null;
}

/**
 * What a figure pass answer changes on the figure: the alt text, the title when it has
 * math to show (else none, so an older title doesn't linger), and the description.
 */
export function describedPatch(d: FigureDescription): { alt?: string; title?: string; description?: string } {
  return {
    ...(d.alt ? { alt: d.alt, title: d.title && d.title !== d.alt ? d.title : undefined } : {}),
    ...(d.description ? { description: d.description } : {}),
  };
}
