import type { AnnotationStyle } from '../types.ts';

/**
 * Prompts are deliberately short and concrete: small vision models follow a few
 * clear rules plus an example far better than long instructions.
 *
 * The model only produces Markdown + LaTeX (what VLMs are trained to emit), plus a
 * few small extensions handled by markdown.ts: <u>underlined words</u>,
 * [[red: text in another ink color]], and [[note: term | words]] for arrow and brace
 * notes. All HTML structure and accessibility markup is generated deterministically
 * in code (markdown.ts / exportHtml.ts), never by the model.
 *
 * Small models copy the example's patterns, so anything in it can leak into
 * transcriptions. The example therefore uses content unlikely to appear in real notes,
 * and the rules say to use each mark only where the author drew it.
 */

export const TRANSCRIBE_SYSTEM = `You are an exact transcriber of handwritten mathematics notes. You copy what is written; you never solve, explain, summarize, add to, or correct it.`;

const MATH_RULE = `Most important: EVERY piece of math is LaTeX inside dollar signs, even a single letter or a short formula in the middle of a sentence. Never write math as plain text.
- Inside a sentence: $u'(0) = 0$, $m$, $\\cos(7t)$
- An equation on its own line: $$u(t) = R\\cos(7t - \\delta)$$
- Several equation lines in a row: $$\\begin{aligned} ... \\\\ ... \\end{aligned}$$
- Greek letters as LaTeX: \\omega, \\delta, \\pi (not ω, δ, π). Functions and operators with a backslash: \\sin, \\cos, \\tan, \\log, \\ln, \\sqrt{...}, \\times, \\cdot.`;

const COMMON_RULES = `1. Copy everything exactly as written, top to bottom: the author's wording, spelling mistakes included. Never add a line, formula, note, box, or color that is not on the page.
2. Sentences are plain text lines, never inside $...$ or \\text{}. Titles or underlined headings: ## . Leave a blank line between separate ideas.`;

const END_RULES = `5. Underlined words: <u>words</u>. Words in a different ink color: [[red: words]] (or green, orange, purple, blue).
6. Every drawing (graph, diagram, sketch) gets its own line, without transcribing the drawing: [[FIGURE: short plain-words description]]. Text written beside a drawing goes on the lines after it.
   A circle, box, or bracket drawn around words is NOT a drawing: transcribe the words and ignore the mark.
7. Write [illegible] for anything you cannot read. Skip crossed-out work.`;

/**
 * Notes style (default). Arrows and braces are the hardest thing for a small model
 * to place inside LaTeX, but it reads the note and its target well. So the model
 * only reports them as [[note: term | words]] lines; the app writes the sentence
 * ("where ω is the frequency") in code, so the wording is always consistent.
 */
const TRANSCRIBE_NOTES = `Transcribe this page of handwritten notes into Markdown with LaTeX math.

${MATH_RULE}

Other rules:
${COMMON_RULES}
3. Arrows and braces that attach a note to part of an equation: write the equation WITHOUT the arrow or brace. Then, on the next lines, one line per arrow or brace:
   [[note: term | note]]
   "term" is the exact part of the equation the arrow or brace points at, in LaTeX. "note" is what the author wrote at the other end, copied exactly (words, or LaTeX if it is math).
   - An arrow from the word "frequency" pointing at ω: [[note: \\omega | frequency]]
   - A brace under cos(-δ) with cos(δ) written under it: [[note: \\cos(-\\delta) | \\cos(\\delta)]]
   - A note in a different ink color: [[note red: term | note]]
4. Copy these only where the author drew them: a box around a formula or result: \\boxed{...}. A column of dots for skipped steps: its own line $$\\vdots$$
${END_RULES}

Example output:
## Ratio test
Suppose $a_n > 0$ for all $n$.
$$S = \\frac{1 - q^3}{1 - q} + s_0$$
[[note: s_0 | starting value]]
[[note: \\frac{1 - q^3}{1 - q} | 1 + q + q^2]]
$$\\vdots$$
$$\\boxed{S = \\frac{1}{1 - q}}$$
the series <u>converges</u> [[red: only if $|q| < 1$]]
[[FIGURE: number line with points 0 and 1 marked]]

Output only the transcription.`;

/** Drawn style: arrows and braces are written into the equation (as in 1.6). */
const TRANSCRIBE_DRAWN = `Transcribe this page of handwritten notes into Markdown with LaTeX math.

${MATH_RULE}

Other rules:
${COMMON_RULES}
3. Copy these marks only where the author drew them, inside the math:
   - box around a formula or result: \\boxed{...}
   - brace under a term with a note: \\underbrace{term}_{\\text{note}}  (over: \\overbrace{term}^{\\text{note}})
   - arrow pointing up at a term from a note: \\underset{\\substack{\\uparrow\\\\ \\text{note}}}{term}
4. A column of dots for skipped steps: its own line $$\\vdots$$
${END_RULES}

Example output:
## Ratio test
Suppose $a_n > 0$ for all $n$ and let $q = a_{n+1}/a_n$.
$$L = \\lim_{n \\to \\infty} \\frac{a_{n+1}}{a_n}$$
$$\\underbrace{1 + q + q^2}_{\\text{three terms}} = \\underset{\\substack{\\uparrow\\\\ \\text{ratio}}}{\\frac{1 - q^3}{1 - q}}$$
$$\\vdots$$
$$\\boxed{S = \\frac{1}{1 - q}}$$
the series <u>converges</u> [[red: only if $|q| < 1$]]
[[FIGURE: number line with points 0 and 1 marked]]

Output only the transcription.`;

export function transcribePrompt(style: AnnotationStyle = 'notes'): string {
  return style === 'drawn' ? TRANSCRIBE_DRAWN : TRANSCRIBE_NOTES;
}

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
