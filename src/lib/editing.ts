import type { Page } from '../types.ts';
import { latexWarnings, markdownToHtml, type RenderContext } from './markdown.ts';
import { figureHtml, wrapEndLines } from './exportHtml.ts';
import { MARKER_LINE, sourceUnits } from './transcript.ts';

/**
 * Click-to-edit support (pure functions, no DOM):
 *  - the page source is split into blocks (paragraphs, equations with their notes,
 *    figures) that the preview shows separately, so a click can open just that block;
 *  - the markup toolbar's marks are computed as text edits on a textarea;
 *  - text can be moved from a figure's alt text into the notes after it.
 */

/* ---------------------------------------------------------------------------------
 * Blocks
 * ------------------------------------------------------------------------------- */

export interface Block {
  /** First and last source line of the block (inclusive). */
  start: number;
  end: number;
  /** Set for a figure-marker block: the figure id. */
  fig?: number;
  /** A wrapped figure's "beside" text ends after this block. */
  clear: boolean;
}

/**
 * Splits the source into blocks: runs of lines separated by blank lines. A multi-line
 * $$...$$ or \begin..\end stays in one block, a figure marker is always its own block,
 * and a block also ends where a wrapped figure's text stops (`clearAfter`).
 */
export function splitBlocks(source: string, clearAfter: Set<number> = new Set()): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const u of sourceUnits(source)) {
    const m = u.start === u.end ? lines[u.start].match(MARKER_LINE) : null;
    const gap = cur ? u.start > cur.end + 1 : true;
    if (m) {
      if (cur) blocks.push(cur);
      blocks.push({ start: u.start, end: u.end, fig: Number(m[1]), clear: false });
      cur = null;
      continue;
    }
    if (!cur || gap) {
      if (cur) blocks.push(cur);
      cur = { start: u.start, end: u.end, clear: false };
    } else cur.end = u.end;
    if (clearAfter.has(u.end)) {
      cur.clear = true;
      blocks.push(cur);
      cur = null;
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

export const blockText = (source: string, b: Block) => source.split('\n').slice(b.start, b.end + 1).join('\n');

/** Replaces a block's lines with new text. Empty text removes the block. */
export function replaceBlock(source: string, b: Block, text: string): string {
  const lines = source.split('\n');
  const insert = text.replace(/\s+$/, '');
  const out = [...lines.slice(0, b.start), ...(insert.trim() ? insert.split('\n') : []), ...lines.slice(b.end + 1)];
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

/**
 * Writes an edited block back into the current source. If the page changed while
 * the block was open (e.g. a figure was moved), the block is found by its original
 * text instead of its line numbers.
 */
export function commitBlock(current: string, block: Block, original: string, text: string): string {
  if (blockText(current, block) === original) return replaceBlock(current, block, text);
  const k = current.indexOf(original);
  if (k >= 0) return (current.slice(0, k) + text.replace(/\s+$/, '') + current.slice(k + original.length)).replace(/\n{3,}/g, '\n\n');
  // The original text is gone; keep the edit rather than lose it.
  return text.trim() ? `${current.replace(/\s+$/, '')}\n\n${text.replace(/\s+$/, '')}` : current;
}

/**
 * The page rendered block by block, for the editable preview. Each block is a
 * focusable element carrying its index; together they look like pageHtml().
 * Blocks keep their content as their accessible name; a shared hint, referenced
 * by aria-describedby, says how to edit.
 */
export function pageBlocks(
  page: Pick<Page, 'source' | 'figures'>,
  pageNo: number,
  hintId = '',
): { blocks: Block[]; html: string[]; tail: string } {
  const blocks = splitBlocks(page.source, wrapEndLines(page.source, page.figures));
  const ctx: RenderContext = { lastHeading: 1 };
  const figure = (id: number) => figureHtml(page.figures.find((f) => f.id === id), pageNo);
  const described = hintId ? ` aria-describedby="${hintId}"` : '';
  const html = blocks.map((b, i) => {
    const inner = markdownToHtml(blockText(page.source, b), { ctx, figure });
    const kind = b.fig !== undefined ? ' blk-fig' : '';
    return `<div class="blk${kind}" data-b="${i}" tabindex="0"${described}>${inner}</div>${b.clear ? '<div class="fig-clear"></div>' : ''}`;
  });
  const tail = page.figures.some((f) => f.wrap) ? '<div class="fig-clear"></div>' : '';
  return { blocks, html, tail };
}

/* ---------------------------------------------------------------------------------
 * Alt text that looks like it holds notes (1.9.4)
 * ------------------------------------------------------------------------------- */

/**
 * Small models sometimes copy the writing next to a drawing into its alt text.
 * Returns a short reason when the alt text looks like that, or null.
 * (A hint only: the user decides.)
 */
export function altTextIssue(alt: string): string | null {
  const t = alt.trim();
  if (!t) return null;
  if (/\$[^$]+\$|\\(?:frac|int|sum|sqrt|cdot|omega|delta|alpha|theta|pi|lambda)\b|\\[()[\]]/.test(t))
    return 'It contains math, which usually belongs in the notes.';
  if (/\b(?:written|shown|noted)\s+(?:beside|next\s+to|below|above|under|near)\b|\b(?:beside|next\s+to)\s+(?:it|the\s+(?:graph|figure|drawing|diagram|plot|sketch))\b/i.test(t))
    return 'It mentions writing beside the drawing.';
  if (/\b(?:with|and)\s+(?:(?:the|a|an)\s+)?(?:handwritten\s+)?(?:text|note|sentence|caption|annotation)\b/i.test(t))
    return 'It mentions text or a note, which usually belongs in the notes.';
  if (/["“][^"”]{25,}["”]/.test(t)) return 'It quotes a long piece of text.';
  return null;
}

/** Tidies alt text after a piece was cut out of it. */
export function tidyAlt(alt: string): string {
  const intro = /\s*,?\s*(?:with|and)\s+(?:(?:the|a|an)\s+)?(?:handwritten\s+)?(?:text|note|sentence|caption|annotation)\s*(?:reading|saying|:)?\s*$/i;
  const place = /\s*(?:is\s+)?(?:written|shown|noted)?\s*(?:beside|next\s+to|below|above|under|near)\s+(?:it|the\s+(?:graph|figure|drawing|diagram|plot|sketch))\s*$/i;
  let t = alt.replace(/["“]\s*["”]/g, '');
  // Leftovers like "..., with text written beside it": strip until nothing changes.
  for (let prev = ''; prev !== t; ) {
    prev = t;
    t = t.replace(/[\s,;]+$/g, '').replace(place, '').replace(intro, '');
  }
  return t
    .replace(/\s+([,.;])/g, '$1')
    .replace(/^[\s,;]+|[\s,;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Moves text out of a figure's alt text into the notes right after the figure.
 * `start`/`end` select the part of the alt text to move (the whole alt text when
 * they are equal). Returns the new alt text and source.
 */
export function moveAltToNotes(
  source: string,
  figId: number,
  alt: string,
  start: number,
  end: number,
): { alt: string; source: string; moved: string } {
  const [s, e] = start === end ? [0, alt.length] : [Math.min(start, end), Math.max(start, end)];
  const moved = alt
    .slice(s, e)
    .trim()
    .replace(/^["“\s]+|["”\s]+$/g, '')
    .replace(/\s*(?:is\s+)?(?:written|shown|noted)\s*(?:beside|next\s+to|below|above|under|near)\s+(?:it|the\s+\w+)\s*$/i, '')
    .replace(/^["“\s]+|["”\s]+$/g, '')
    .trim();
  const rest = tidyAlt(alt.slice(0, s) + alt.slice(e));
  if (!moved) return { alt, source, moved: '' };
  const lines = source.split('\n');
  const at = lines.findIndex((l) => Number(l.match(MARKER_LINE)?.[1]) === figId);
  let out: string;
  if (at < 0) out = `${source.replace(/\s+$/, '')}\n\n${moved}`;
  else {
    // Right after the figure, as the first of its "beside" lines.
    const next = lines.slice(at + 1).findIndex((l) => l.trim());
    const insertAt = next < 0 ? lines.length : at + 1 + next;
    lines.splice(insertAt, 0, moved);
    if (insertAt === at + 1) lines.splice(at + 1, 0, '');
    out = lines.join('\n');
  }
  return { alt: rest, source: out.replace(/\n{3,}/g, '\n\n'), moved };
}

/* ---------------------------------------------------------------------------------
 * Markup toolbar
 * ------------------------------------------------------------------------------- */

export type Mark = 'math' | 'display' | 'note' | 'box' | 'vdots' | 'underline' | 'heading' | `color:${string}`;

/** A text edit: replace [from, to) with `insert`, then select [selStart, selEnd). */
export interface Edit {
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

/** True when position `pos` is inside $...$ or $$...$$. */
export function isInMath(text: string, pos: number): boolean {
  let inline = false;
  let display = false;
  for (let i = 0; i < pos && i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c !== '$') continue;
    if (text[i + 1] === '$' && !inline) {
      display = !display;
      i++;
    } else if (!display) inline = !inline;
  }
  return inline || display;
}

const lineStart = (t: string, p: number) => t.lastIndexOf('\n', p - 1) + 1;
const lineEnd = (t: string, p: number) => {
  const i = t.indexOf('\n', p);
  return i < 0 ? t.length : i;
};

/** Wraps [s, e) with before/after; the wrapped text stays selected (or the cursor sits inside). */
function wrap(s: number, e: number, sel: string, before: string, after: string): Edit {
  return { from: s, to: e, insert: before + sel + after, selStart: s + before.length, selEnd: s + before.length + sel.length };
}

/** Where a new line after the cursor's line goes (after a display equation that spans lines). */
function afterBlockLine(text: string, pos: number): number {
  let end = lineEnd(text, pos);
  if (isInMath(text, pos)) {
    const close = text.indexOf('$$', pos);
    if (close >= 0) end = lineEnd(text, close);
  }
  return end;
}

/** Computes the edit for a toolbar mark on the selection [s, e) of `text`. */
export function applyMark(text: string, s: number, e: number, mark: Mark): Edit {
  const sel = text.slice(s, e);
  const math = isInMath(text, s);

  if (mark === 'math') return wrap(s, e, sel, '$', '$');

  if (mark === 'display') {
    if (sel) {
      const ls = lineStart(text, s);
      const le = lineEnd(text, e);
      const whole = s === ls && e === le;
      const inner = sel.replace(/\$/g, '').trim();
      const before = whole ? '$$' : '\n$$';
      return { from: s, to: e, insert: `${before}${inner}$$${whole ? '' : '\n'}`, selStart: s + before.length, selEnd: s + before.length + inner.length };
    }
    const ls = lineStart(text, s);
    const le = lineEnd(text, s);
    const line = text.slice(ls, le);
    if (!line.trim()) return wrap(s, e, '', '$$', '$$');
    const inner = line.replace(/\$/g, '').trim();
    return { from: ls, to: le, insert: `$$${inner}$$`, selStart: ls + 2, selEnd: ls + 2 + inner.length };
  }

  if (mark === 'box') {
    if (math) return wrap(s, e, sel, '\\boxed{', '}');
    const d = sel.match(/^\$\$([\s\S]*)\$\$$/);
    if (d) return wrap(s, e, d[1], '$$\\boxed{', '}$$');
    const i = sel.match(/^\$([\s\S]*)\$$/);
    if (i) return wrap(s, e, i[1], '$\\boxed{', '}$');
    return wrap(s, e, sel, '$$\\boxed{', '}$$');
  }

  if (mark === 'underline') return math ? wrap(s, e, sel, '\\underline{', '}') : wrap(s, e, sel, '<u>', '</u>');

  if (mark.startsWith('color:')) {
    const c = mark.slice(6);
    return math ? wrap(s, e, sel, `\\color{${c}}{`, '}') : wrap(s, e, sel, `[[${c}: `, ']]');
  }

  if (mark === 'note') {
    const term = sel.replace(/\$/g, '').trim();
    const at = afterBlockLine(text, e);
    const insert = `\n[[note: ${term} | ]]`;
    const cursor = term ? at + insert.length - 2 : at + '\n[[note: '.length;
    return { from: at, to: at, insert, selStart: cursor, selEnd: cursor };
  }

  if (mark === 'vdots') {
    const at = afterBlockLine(text, e);
    const insert = '\n$$\\vdots$$';
    return { from: at, to: at, insert, selStart: at + insert.length, selEnd: at + insert.length };
  }

  // heading: toggle "## " at the start of the line
  const ls = lineStart(text, s);
  const m = text.slice(ls).match(/^#{1,6}\s+/);
  if (m) return { from: ls, to: ls + m[0].length, insert: '', selStart: Math.max(ls, s - m[0].length), selEnd: Math.max(ls, e - m[0].length) };
  return { from: ls, to: ls, insert: '## ', selStart: s + 3, selEnd: e + 3 };
}

/** Applies an edit to a string (for tests and as a fallback when the browser can't insert text). */
export function applyEdit(text: string, ed: Edit): string {
  return text.slice(0, ed.from) + ed.insert + text.slice(ed.to);
}

/* ---------------------------------------------------------------------------------
 * Things to check on a page (2.1): page list counts and the export checklist
 * ------------------------------------------------------------------------------- */

export interface PageIssue {
  kind: 'error' | 'alt-missing' | 'alt-check' | 'figure-check' | 'latex';
  /** The figure it concerns, if any. */
  figure?: number;
  text: string;
}

/** What still needs a look on a converted page. Empty when there's nothing to check. */
export function pageIssues(page: Pick<Page, 'source' | 'figures' | 'error'>): PageIssue[] {
  const out: PageIssue[] = [];
  if (page.error) out.push({ kind: 'error', text: page.error });
  for (const f of page.figures) {
    if (!f.alt.trim()) out.push({ kind: 'alt-missing', figure: f.id, text: `Figure ${f.id} has no alt text.` });
    else if (altTextIssue(f.alt)) out.push({ kind: 'alt-check', figure: f.id, text: `Figure ${f.id}: check the alt text.` });
    if (f.needsReview) out.push({ kind: 'figure-check', figure: f.id, text: `Figure ${f.id}: check the crop and position.` });
  }
  const w = latexWarnings(page.source).length;
  if (w) out.push({ kind: 'latex', text: `${w} LaTeX warning${w > 1 ? 's' : ''}.` });
  return out;
}
