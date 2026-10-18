/**
 * Prompts are deliberately short and concrete: small vision models follow a few
 * clear rules plus an example far better than long instructions.
 *
 * The model only produces Markdown + LaTeX (what VLMs are trained to emit).
 * All HTML structure and accessibility markup is generated deterministically
 * in code (see markdown.ts / exportHtml.ts), never by the model.
 *
 * The example deliberately uses content that is unlikely to appear in real notes
 * and contains no "note:"-style extras: small models copy the example's patterns,
 * so anything in it can leak into transcriptions.
 */

export const TRANSCRIBE_SYSTEM = `You are an exact transcriber of handwritten mathematics notes. You copy what is written; you never solve, explain, summarize, add to, or correct it.`;

export const TRANSCRIBE_USER = `Transcribe this page of handwritten notes into Markdown with LaTeX math.

Rules:
1. Copy everything exactly as written, top to bottom. Keep the author's wording, capitalization, symbols, and mistakes. Never add a line, formula, or note that is not written on the page.
2. Ordinary words and sentences are plain text lines. Never put sentences inside $...$, $$...$$, or \\text{}.
3. Math inside a sentence: $...$. An equation on its own line: $$...$$. Several equation lines in a row: $$\\begin{aligned} ... \\\\ ... \\end{aligned}$$
4. Use standard LaTeX: \\frac, \\sqrt, \\int, \\sum, \\lim, \\to, \\infty, \\cdot, \\vec, \\mathbf, \\boxed.
5. Titles or underlined headings: # or ##. Bullets: - . Numbered steps: 1. . Leave a blank line between separate ideas.
6. EVERY drawing (graph, axes, curve, diagram, sketch, picture) gets its own line where it appears. Do NOT transcribe the drawing itself:
   [[FIGURE: short plain-words description of what the drawing shows and its labels, no LaTeX]]
   A page can have several drawings; mark each one separately.
7. Text written BESIDE a drawing is NOT part of the drawing. Transcribe it as normal text on the lines right after the [[FIGURE: ...]] line.
8. Write [illegible] for anything you cannot read. Skip crossed-out work.

Example output:
## Ratio test
Suppose $a_n > 0$ for all $n$.
$$L = \\lim_{n \\to \\infty} \\frac{a_{n+1}}{a_n}$$
[[FIGURE: number line with points 0 and 1 marked]]
if L is less than 1 the series converges

Output only the transcription.`;

export function locatePrompt(descriptions: string[]): string {
  const list = descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n');
  return `This 1000x1000 image is a page of handwritten notes (white padding may be on the right or bottom).
Find each hand-drawn figure listed below. For each, give the bounding box that encloses the WHOLE drawing, including its axes, tick labels, and labels written on the drawing. Do NOT include sentences, notes, or equations written beside the drawing; box the drawing only.

Figures:
${list}

Answer in JSON: {"figures":[{"id":1,"bbox_2d":[x1,y1,x2,y2]}]}
Coordinates are pixels in this 1000x1000 image: x1,y1 = top-left corner, x2,y2 = bottom-right corner.`;
}

/** JSON schema for Ollama structured output in the locate pass. */
export const LOCATE_SCHEMA = {
  type: 'object',
  properties: {
    figures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          bbox_2d: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        },
        required: ['id', 'bbox_2d'],
      },
    },
  },
  required: ['figures'],
};

/** Alt text for a drawing found by the ink detector. */
export const DESCRIBE_USER = `This image is a hand-drawn figure cut from a page of math notes.
Describe it in one sentence for a blind student: what kind of drawing it is, what it shows, and the labels written on it.
Use plain words, no LaTeX. Output only the sentence.`;
