/**
 * Prompts are deliberately short and concrete: small vision models follow a few
 * clear rules plus an example far better than long instructions.
 *
 * The everyday prompt (TRANSCRIBE_USER, the default) is tuned for small Qwen vision
 * models (qwen2.5vl:3b and qwen3-vl:4b-instruct). Since 2.1.2 there is also a longer
 * built-in prompt for larger models (TRANSCRIBE_LARGE, below). Other vision
 * models may work but are not tested. Model quirks are handled in the clean-up code
 * (transcript.ts) rather than here, so the prompt stays short for every model.
 *
 * The model only produces Markdown + LaTeX (what VLMs are trained to emit), plus a
 * few small extensions handled by markdown.ts: <u>underlined words</u>,
 * [[red: text in another ink color]], and [[note: term | words]] for arrow and brace
 * notes. All HTML structure and accessibility markup is generated deterministically
 * in code (markdown.ts / exportHtml.ts), never by the model.
 *
 * The rule that writing beside a drawing is notes, not part of the FIGURE description,
 * is spelled out (and shown in the example) because small models otherwise copy that
 * text into the alt text.
 *
 * Small models copy the example's patterns, so anything in it can leak into
 * transcriptions. The example therefore uses content unlikely to appear in real notes,
 * and the rules say to use each mark only where the author drew it.
 */

export const TRANSCRIBE_SYSTEM = `You are an exact transcriber of handwritten mathematics notes. You copy what is written; you never solve, explain, summarize, add to, or correct it.`;

/**
 * Arrows and braces are the hardest thing for a small model to place inside LaTeX,
 * but it reads the note and its target well. So the model only reports them as
 * [[note: term | words]] lines; the app writes the sentence ("where ω is the
 * frequency") in code, so the wording is always consistent.
 */
export const TRANSCRIBE_USER = `Transcribe this page of handwritten notes into Markdown with LaTeX math.

Most important: EVERY piece of math is LaTeX inside dollar signs, even a single letter or a short formula in the middle of a sentence. Never write math as plain text.
- Inside a sentence: $u'(0) = 0$, $m$, $\\cos(7t)$
- An equation on its own line: $$u(t) = R\\cos(7t - \\delta)$$
- Several equation lines in a row: $$\\begin{aligned} ... \\\\ ... \\end{aligned}$$
- Greek letters as LaTeX: \\omega, \\delta, \\pi (not ω, δ, π). Functions and operators with a backslash: \\sin, \\cos, \\tan, \\log, \\ln, \\sqrt{...}, \\times, \\cdot.

Other rules:
1. Copy everything exactly as written, top to bottom: the author's wording, spelling mistakes included. Never add a line, formula, note, box, or color that is not on the page.
2. Sentences are plain text lines, never inside $...$ or \\text{}. Titles or underlined headings: ## . Leave a blank line between separate ideas.
3. Arrows and braces that attach a note to part of an equation: write the equation WITHOUT the arrow or brace. Then, on the next lines, one line per arrow or brace:
   [[note: term | note]]
   "term" is the exact part of the equation the arrow or brace points at, in LaTeX. "note" is what the author wrote at the other end, copied exactly (words, or LaTeX if it is math).
   - An arrow from the word "frequency" pointing at ω: [[note: \\omega | frequency]]
   - A brace under cos(-δ) with cos(δ) written under it: [[note: \\cos(-\\delta) | \\cos(\\delta)]]
   - A note in a different ink color: [[note red: term | note]]
4. Copy these only where the author drew them: a box around a formula or result: \\boxed{...}. A column of dots for skipped steps: its own line $$\\vdots$$
5. Underlined words: <u>words</u>. Words in a different ink color: [[red: words]] (or green, orange, purple, blue).
6. Every drawing (graph, diagram, sketch) gets its own line, without transcribing the drawing: [[FIGURE: short plain-words description of the drawing only]].
   Writing next to, below, or above a drawing (sentences, formulas, explanations) is NOT part of the drawing. Never put it in the FIGURE description. Transcribe it as normal notes on the lines right after the [[FIGURE: ...]] line. Only labels on the drawing itself (axis names, points like a and b) belong in the description.
   A circle, box, or bracket drawn around words is NOT a drawing: transcribe the words and ignore the mark.
7. Write [illegible] for anything you cannot read. Skip crossed-out work.

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
the distance from $0$ to $1$ is one unit

Output only the transcription.`;


/**
 * Built-in prompt for larger models (2.1.2), for computers that can run vision models
 * around 7-8B and up (e.g. qwen3-vl:8b-instruct). Same output formats as the everyday
 * prompt, so the clean-up, rendering, and export code is shared; it just asks for more:
 * multi-line alignment, cases and matrices, lists and tables, the author's exact
 * notation, look-alike characters, reading order, and fuller figure descriptions (they
 * seed the alt text). Larger models follow a longer list of rules without dropping the
 * important ones, which is the reason the everyday prompt stays short.
 *
 * The example still uses content unlikely to appear in real notes, so anything copied
 * from it is easy to spot.
 */
export const TRANSCRIBE_LARGE = `Transcribe this page of handwritten mathematics notes into Markdown with LaTeX math. The result becomes an accessible web page for students, so faithful wording, correct math, and the right reading order matter most.

Math
- EVERY piece of math is LaTeX inside dollar signs, even a single letter in the middle of a sentence: $u'(0) = 0$, $m$, $\\cos(7t)$. Never write math as plain text or as Unicode symbols: write \\omega, \\delta, \\le, \\ne, \\to, \\infty, \\cdot, \\times (not ω, δ, ≤, ≠, →, ∞, ·, ×). Functions and operators with a backslash: \\sin, \\cos, \\tan, \\log, \\ln, \\exp, \\lim, \\sqrt{...}.
- An equation on its own line: $$...$$. Several equation lines in a row (a derivation, a system): one $$\\begin{aligned} ... \\end{aligned}$$ block, with & just before the sign the lines are aligned on (usually =) and \\\\ between lines.
- Follow the structure the author wrote: \\frac{a}{b} for stacked fractions (a/b only when written on one line); \\begin{cases} ... \\end{cases} for piecewise definitions and other big left braces; \\begin{pmatrix} or \\begin{bmatrix} for matrices and column vectors (match the bracket shape); \\int_{a}^{b}, \\sum_{n=0}^{\\infty}, \\lim_{x \\to 0} with their limits.
- Keep the author's notation exactly: $y'$ stays $y'$ (not $\\frac{dy}{dx}$), $\\dot{x}$ stays $\\dot{x}$, $e^{x}$ stays $e^{x}$, vectors keep their arrows ($\\vec{v}$) or bold ($\\mathbf{v}$). Do not simplify, reorder terms, fix mistakes, or complete a step the author did not write.
- Read subscripts, superscripts, and exponents carefully ($x_n$ vs $x^n$, $e^{-2t}$), and tell look-alike characters apart from context: 1, l, and |; 0 and O; x and \\times; u, v, and \\nu; t and +; 5 and s; z and 2; a and \\alpha.
- Short words inside a displayed equation: \\text{...}, as in $$u = 0 \\quad \\text{if } t < 0$$

Text and layout
1. Copy everything exactly as written, top to bottom: the author's wording, spelling mistakes included. Never add a line, formula, note, box, or color that is not on the page.
2. Sentences are plain text lines, never inside $...$ or \\text{}. Titles or underlined headings: ## (### for a smaller heading under it). Leave a blank line between separate ideas.
3. Items the author wrote as a list: a Markdown list (1. or -), keeping the author's numbering or lettering. A grid of rows and columns drawn as a table: a Markdown pipe table.
4. Reading order: if the page has two columns, or a side note in the margin, transcribe the main column first, then the side material as its own paragraph. Words inserted with a caret (^) or written above a line go where the caret points.
5. An arrow between two lines of work that means "so" or "which gives" is not a note: start the next equation with \\Rightarrow, inside its $$...$$.
6. Copy these only where the author drew them: a box around a formula or result: \\boxed{...}. A column of dots for skipped steps: its own line $$\\vdots$$
7. Underlined words: <u>words</u>. Words in a different ink color: [[red: words]] (or green, orange, purple, blue). Math in a different ink color: \\color{red}{...} inside the math.

Arrow and brace notes
When an arrow or brace attaches a note to part of an equation, write the equation WITHOUT the arrow or brace. Then, on the lines right after it, one line per arrow or brace:
[[note: term | note]]
"term" is the exact part of the equation the arrow or brace points at, in LaTeX, written exactly as it appears in the equation. "note" is what the author wrote at the other end, copied exactly (words, or LaTeX if it is math).
- An arrow from the word "frequency" pointing at ω: [[note: \\omega | frequency]]
- A brace under cos(-δ) with cos(δ) written under it: [[note: \\cos(-\\delta) | \\cos(\\delta)]]
- A note in a different ink color: [[note red: term | note]]

Drawings
Every drawing (graph, diagram, sketch, number line, phase portrait) gets its own line, without transcribing the drawing: [[FIGURE: description]]
The description becomes the drawing's alt text for a blind student: one or two plain-words sentences on that one line, no LaTeX and no quotation marks. Say what kind of drawing it is, then what it shows: axes and their labels, the shape of each curve (increasing, oscillating, decaying), marked points, intercepts, asymptotes, shaded regions, and labels written on the drawing itself.
Writing next to, below, or above a drawing (sentences, formulas, explanations) is NOT part of the drawing. Never put it in the FIGURE description. Transcribe it as normal notes on the lines right after the [[FIGURE: ...]] line.
A circle, box, or bracket drawn around words is NOT a drawing: transcribe the words and ignore the mark.

Write [illegible] for anything you cannot read; do not guess. Skip crossed-out work.

Example output:
## Ratio test
Suppose $a_n > 0$ for all $n$.
$$\\begin{aligned} S &= \\frac{1 - q^3}{1 - q} + s_0 \\\\ &= 1 + q + q^2 + s_0 \\end{aligned}$$
[[note: s_0 | starting value]]
$$f(q) = \\begin{cases} 1, & q \\ge 0 \\\\ -1, & q < 0 \\end{cases}$$
1. <u>check</u> the limit
2. compare with [[red: a geometric series]]
$$\\vdots$$
$$\\boxed{S = \\frac{1}{1 - q}}$$
[[FIGURE: Number line from 0 to 1 with both endpoints marked by filled dots and the segment between them shaded.]]
the distance from $0$ to $1$ is one unit

Output only the transcription.`;

/* ---------------------------------------------------------------------------------
 * Built-in prompt choices (2.1.2)
 * ------------------------------------------------------------------------------- */

export type BuiltinPromptId = 'everyday' | 'large';

export interface BuiltinPrompt {
  id: BuiltinPromptId;
  /** Short name for menus and badges. */
  label: string;
  /** One line under the choice. */
  hint: string;
  text: string;
}

export const BUILTIN_PROMPTS: Record<BuiltinPromptId, BuiltinPrompt> = {
  everyday: {
    id: 'everyday',
    label: 'Everyday hardware',
    hint: 'Short and concrete, for small models on an ordinary laptop (qwen3.5:4b-mlx, qwen3-vl:4b-instruct, qwen2.5vl:3b). The default.',
    text: TRANSCRIBE_USER,
  },
  large: {
    id: 'large',
    label: 'Larger models',
    hint: 'More detailed rules (alignment, cases, matrices, lists, tables, fuller figure descriptions) for models around 8B and up on a more powerful computer.',
    text: TRANSCRIBE_LARGE,
  },
};

export const BUILTIN_IDS = Object.keys(BUILTIN_PROMPTS) as BuiltinPromptId[];

/** A stored value that may be stale or damaged; anything unknown means the everyday prompt. */
export const asBuiltinId = (v: unknown): BuiltinPromptId => (v === 'large' ? 'large' : 'everyday');

/** The built-in prompt whose text is `prompt` (ignoring surrounding whitespace), if any. */
export function builtinOf(prompt: string): BuiltinPromptId | undefined {
  const t = prompt.trim();
  return BUILTIN_IDS.find((id) => BUILTIN_PROMPTS[id].text.trim() === t);
}

/**
 * Below this download size (GB) a model counts as small, above LARGE_MODEL_GB as large;
 * in between, either prompt is reasonable. Only used for a hint, never to switch.
 * (qwen3-vl:4b-instruct is about 3.3 GB, qwen3-vl:8b-instruct about 6.2 GB.)
 */
export const SMALL_MODEL_GB = 4.5;
export const LARGE_MODEL_GB = 5.5;

/** A suggestion when the chosen built-in prompt doesn't fit the model's size, or ''. */
export function promptSizeHint(id: BuiltinPromptId, sizeGB: number | undefined): string {
  if (!sizeGB) return '';
  if (id === 'everyday' && sizeGB >= LARGE_MODEL_GB)
    return 'This model is on the larger side; the Larger models prompt may get more out of it.';
  if (id === 'large' && sizeGB < SMALL_MODEL_GB)
    return 'This is a small model; it usually does better with the shorter Everyday hardware prompt.';
  return '';
}

/** Focused second-pass prompt for a user-selected region (2.0). */
export const REREAD_USER = `Transcribe only the handwriting visible in this cropped image into Markdown with LaTeX math.
Copy exactly what is visible. Do not solve, explain, correct, complete, or infer anything outside the crop.
Every piece of math must be LaTeX inside dollar signs. Use $...$ inside a sentence and $$...$$ for an equation on its own line.
Preserve line breaks and wording. Write [illegible] for anything you cannot read. Skip crossed-out work.
Do not create a FIGURE description. If the crop includes part of a drawing, transcribe only the writing that the user could use to replace the selected text block.
Output only the transcription.`;

/** A built-in transcription prompt (kept as a function so callers don't depend on the constants). */
export function transcribePrompt(id: BuiltinPromptId = 'everyday'): string {
  return BUILTIN_PROMPTS[id].text;
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

/* ---------------------------------------------------------------------------------
 * Custom prompt (1.9.5): checks that an edited prompt still asks for the formats
 * the clean-up code depends on.
 * ------------------------------------------------------------------------------- */

export interface PromptIssue {
  /** What the clean-up step needs. */
  need: string;
  /** What breaks without it. */
  effect: string;
}

/**
 * Warnings for an edited transcription prompt. Each one names a format that the
 * clean-up and rendering code relies on but the prompt no longer mentions.
 */
export function promptIssues(prompt: string): PromptIssue[] {
  const p = prompt;
  const issues: PromptIssue[] = [];
  if (!p.trim()) return [{ need: 'a prompt', effect: 'The model gets no instructions at all.' }];
  if (!/\[\[\s*FIGURE\s*:/i.test(p))
    issues.push({ need: '[[FIGURE: …]] lines for drawings', effect: 'Figures the model sees won’t be described or matched; only the ink detector will find them.' });
  if (!/\[\[\s*note\b[^\]]*\|/i.test(p))
    issues.push({ need: '[[note: term | words]] lines for arrow and brace notes', effect: 'Notes won’t become “where…” sentences.' });
  if (!/\$[^$\s][^$]*\$/.test(p))
    issues.push({ need: 'math in $…$ and $$…$$', effect: 'Math may come back as plain text, which renders poorly and isn’t read as math by screen readers.' });
  return issues;
}

/** True when `prompt` is the everyday built-in prompt (ignoring surrounding whitespace). */
export const isDefaultPrompt = (prompt: string) => builtinOf(prompt) === 'everyday';

/** True when `prompt` is one of the built-in prompts. */
export const isBuiltinPrompt = (prompt: string) => builtinOf(prompt) !== undefined;

