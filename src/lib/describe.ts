/**
 * Figure titles and detailed descriptions (3.2). Pure functions; the model call is in
 * pipeline.ts (describeFigure).
 *
 * A larger model gets one figure's crop and the notes around it, and answers with
 *   { "title": "...", "description": "..." }
 * The title becomes the alt text (plain words, short). The description is a few
 * sentences, math allowed in $…$, shown under the figure in a collapsed "Detailed
 * description" (exportHtml.ts), so screen-reader users can open it and sighted readers
 * aren't flooded.
 */

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
- "title": a short label for it, at most 12 words, in plain words with no LaTeX and no final period. Say what it is and what it shows, for example: Shaded area under f(x) = e^(2x) from x = 0 to x = 1
- "description": two to five sentences for a blind student, in this order: the kind of drawing and its axes with their labels; each curve or shape and how it behaves (increasing, oscillating, decaying, where it starts and ends); marked points, values, and labels on the drawing; dashed lines, arrows, and shaded or hatched regions. Write math in LaTeX inside dollar signs, like $f(x) = e^{2x}$. Use the notes to name things exactly (the function, the interval), but describe only what is drawn.

Do not solve, explain, or add anything that is not in the drawing. Do not repeat the sentences written next to the drawing.

Notes:
${notes}

Answer with the JSON only.`;
}

/** Plain words for the alt text: no $…$, no LaTeX commands, no final period or quotes. */
export function tidyTitle(t: string): string {
  return t
    .replace(/\$+/g, '')
    .replace(/\\(?:left|right|,|;|!)/g, '')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/^["“'\s]+|["”'\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The description with math delimiters made canonical ($…$) and spacing tidied. */
export function tidyDescription(d: string): string {
  return d
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => `$${m.trim()}$`)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The model's answer as { title, description }, or null when it isn't usable. Accepts
 * JSON in a code fence or with words around it (models without structured output).
 */
export function parseDescription(answer: string): { title: string; description: string } | null {
  const text = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const candidates = [text.replace(/^```(?:json)?\s*|\s*```$/g, ''), text.match(/\{[\s\S]*\}/)?.[0] ?? ''];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as { title?: unknown; description?: unknown };
      const title = typeof j.title === 'string' ? tidyTitle(j.title) : '';
      const description = typeof j.description === 'string' ? tidyDescription(j.description) : '';
      if (title || description) return { title, description };
    } catch {
      /* try the next form */
    }
  }
  return null;
}
