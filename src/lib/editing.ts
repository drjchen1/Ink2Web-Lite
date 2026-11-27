import { redrawState } from './figureRedraw.ts';
import type { Figure, Page } from '../types.ts';
import type { TextLine } from './layout.ts';
import { textWeight } from './layout.ts';
import { latexWarnings, markdownToHtml, type RenderContext } from './markdown.ts';
import { figureHtml, wrapEndLines, type ExportLook } from './exportHtml.ts';
import { MARKER_LINE, sourceUnits } from './transcript.ts';
import { ROW_GAP, figureRows } from './figureRows.ts';

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
  look: ExportLook = 'classic',
): { blocks: Block[]; html: string[]; tail: string } {
  const blocks = splitBlocks(page.source, wrapEndLines(page.source, page.figures));
  const ctx: RenderContext = { lastHeading: 1 };
  // Figures side by side (2.2.3): each is its own block, shown inline at its width, so
  // a click still opens just that figure. The row's alignment shifts its first block.
  const rowOf = new Map<number, number[]>();
  for (const r of figureRows(page.source, page.figures)) for (const id of r) rowOf.set(id, r);
  const widthOf = (id: number) => Math.min(100, Math.max(15, Math.round(page.figures.find((f) => f.id === id)?.width ?? 100)));
  const figure = (id: number) => figureHtml(page.figures.find((f) => f.id === id), pageNo, rowOf.has(id), look);
  const renderOpts = {
    ctx,
    figure,
    noteStyle: look === 'cards' ? ('list' as const) : ('prose' as const),
    notebox: look === 'cards',
  };
  const described = hintId ? ` aria-describedby="${hintId}"` : '';
  const html = blocks.map((b, i) => {
    const figObj = b.fig !== undefined ? page.figures.find((f) => f.id === b.fig) : undefined;
    const isSideCard = look === 'cards' && figObj && figObj.wrap && figObj.align !== 'center' && !rowOf.has(figObj.id);
    const localOpts = isSideCard
      ? { ...renderOpts, figure: () => figureHtml({ ...figObj, wrap: false, width: 100 }, pageNo, false, 'cards') }
      : renderOpts;
    const inner = markdownToHtml(blockText(page.source, b), localOpts);
    const row = b.fig !== undefined ? rowOf.get(b.fig) : undefined;
    if (row && b.fig !== undefined) {
      const k = row.indexOf(b.fig);
      const total = row.reduce((s, id) => s + widthOf(id), 0) + ROW_GAP * (row.length - 1);
      const align = page.figures.find((f) => f.id === row[0])?.align ?? 'center';
      const lead = k ? 0 : Math.max(0, align === 'center' ? (100 - total) / 2 : align === 'right' ? 100 - total : 0);
      const style = `--w:${widthOf(b.fig)}%;margin-left:${lead}%;margin-right:${k < row.length - 1 ? ROW_GAP : 0}%`;
      const start = k ? '' : '<div class="blk-row-start"></div>';
      return `${start}<div class="blk blk-fig blk-row" data-b="${i}" tabindex="0"${described} style="${style}">${inner}</div>`;
    }
    const kind = b.fig !== undefined ? (isSideCard ? ` blk-fig blk-side blk-side-${figObj.align}` : ' blk-fig') : '';
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

export type Mark = 'math' | 'display' | 'note' | 'box' | 'callout' | 'columns' | 'vdots' | 'underline' | 'heading' | `color:${string}`;

/** Maps a keyboard shortcut (⌘/Ctrl + M, Shift+M, B, U) to a toolbar mark. */
export function shortcutMark(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Mark | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'm') return e.shiftKey ? 'display' : 'math';
  if (k === 'b') return 'box';
  if (k === 'u') return 'underline';
  return null;
}

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

  if (mark === 'callout') {
    const open = '[[box: ]]\n';
    const close = '\n[[/box]]';
    const body = sel.trim();
    if (!body) {
      const insert = `${open}${close}`;
      return { from: s, to: e, insert, selStart: s + '[[box: '.length, selEnd: s + '[[box: '.length };
    }
    return wrap(s, e, body, open, close);
  }

  if (mark === 'columns') {
    const body = sel.trim();
    const open = '[[columns]]\n';
    const close = '\n[[next]]\n\n[[/columns]]';
    if (!body) {
      const insert = `${open}${close}`;
      return { from: s, to: e, insert, selStart: s + open.length, selEnd: s + open.length };
    }
    return wrap(s, e, body, open, close);
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
  kind: 'error' | 'alt-missing' | 'alt-check' | 'figure-check' | 'redraw-error' | 'redraw-check' | 'illegible' | 'markup' | 'latex';
  /** The figure it concerns, if any. */
  figure?: number;
  /** First matching text block index on the page for source issues, if any. */
  block?: number;
  text: string;
}

<<<<<<< HEAD
export interface ReviewItem {
  pageId: string;
  pageNo: number;
  kind: PageIssue['kind'];
  text: string;
  figure?: number;
  block?: number;
}

=======
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
const VALID_TAG = /^\[\[\s*(?:FIGURE\s+\d+|CLEAR|FIGROW(?:\s+\d+)+|note(?:\s+(?:red|green|orange|purple|blue))?\s*:[\s\S]*|where\s*:[\s\S]*|scratch\s*:[\s\S]*|(?:red|green|orange|purple|blue)\s*:[\s\S]*|box(?:\s*:[^\]]*)?|\/box|columns|next|\/columns)\s*\]\]$/i;

/** Returns true when `source` contains unrecognized `[[...]]` markup or an unclosed `[[` tag outside math/code. */
export function hasBrokenMarkup(source: string): boolean {
  const plain = source
    .replace(/\$\$[\s\S]+?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    .replace(/`[^`]+`/g, ' ');
  const stripped = plain.replace(/\[\[[\s\S]*?\]\]/g, (tag) => (VALID_TAG.test(tag) ? ' ' : tag));
  return /\[\[/.test(stripped);
}

/** What still needs a look on a converted page. Empty when there's nothing to check. */
export function pageIssues(page: Pick<Page, 'source' | 'figures' | 'error'>): PageIssue[] {
  const out: PageIssue[] = [];
  if (page.error) out.push({ kind: 'error', text: page.error });
  for (const f of page.figures) {
    const wanted = (f.redraw?.show ?? 'image') !== 'image';
    const state = wanted ? redrawState(f) : null;
    if (state?.kind === 'broken')
      out.push({ kind: 'redraw-error', figure: f.id, text: `Figure ${f.id}: the redraw has errors, so the image is shown.` });
    if (state?.kind === 'ready' && f.redrawCheck)
      out.push({ kind: 'redraw-check', figure: f.id, text: `Figure ${f.id}: check that the redrawn curve matches the sketch.` });
    // Shown only as a redraw, the figure's alt text is computed from the math.
    if (f.redraw?.show === 'redrawn' && state?.kind === 'ready') {
      if (f.needsReview) out.push({ kind: 'figure-check', figure: f.id, text: `Figure ${f.id}: check the crop and position.` });
      continue;
    }
    if (!f.alt.trim()) out.push({ kind: 'alt-missing', figure: f.id, text: `Figure ${f.id} has no alt text.` });
    else if (altTextIssue(f.alt)) out.push({ kind: 'alt-check', figure: f.id, text: `Figure ${f.id}: check the alt text.` });
    if (f.needsReview) out.push({ kind: 'figure-check', figure: f.id, text: `Figure ${f.id}: check the crop and position.` });
  }
<<<<<<< HEAD
  const blocks = page.source ? splitBlocks(page.source, wrapEndLines(page.source, page.figures)) : [];
  const findBlock = (pred: (txt: string) => boolean): number | undefined => {
    const idx = blocks.findIndex((b) => b.fig === undefined && pred(blockText(page.source, b)));
    return idx >= 0 ? idx : undefined;
  };
  const illegibles = (page.source.match(/\[\s*illegible\s*\]/gi) ?? []).length;
  if (illegibles) {
    out.push({
      kind: 'illegible',
      block: findBlock((txt) => /\[\s*illegible\s*\]/i.test(txt)),
      text: `${illegibles} [illegible] spot${illegibles > 1 ? 's' : ''} to check against the original.`,
    });
  }
  if (hasBrokenMarkup(page.source)) {
    out.push({
      kind: 'markup',
      block: findBlock((txt) => hasBrokenMarkup(txt)),
      text: 'Unrecognized [[…]] markup in the text.',
    });
  }
=======
  const illegibles = (page.source.match(/\[\s*illegible\s*\]/gi) ?? []).length;
  if (illegibles) out.push({ kind: 'illegible', text: `${illegibles} [illegible] spot${illegibles > 1 ? 's' : ''} to check against the original.` });
  if (hasBrokenMarkup(page.source)) out.push({ kind: 'markup', text: 'Unrecognized [[…]] markup in the text.' });
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
  const w = latexWarnings(page.source).length;
  if (w) {
    out.push({
      kind: 'latex',
      block: findBlock((txt) => latexWarnings(txt).length > 0),
      text: `${w} LaTeX warning${w > 1 ? 's' : ''}.`,
    });
  }
  return out;
}

/** Collects granular per-figure and per-block review items across all converted pages. */
export function collectReviewItems(pages: Page[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  pages.forEach((p, idx) => {
    if (p.status !== 'done') return;
    const pageNo = idx + 1;
    for (const iss of pageIssues({ source: '', figures: p.figures, error: p.error })) {
      items.push({ pageId: p.id, pageNo, kind: iss.kind, text: iss.text, ...(iss.figure !== undefined ? { figure: iss.figure } : {}) });
    }
    const blocks = splitBlocks(p.source, wrapEndLines(p.source, p.figures));
    blocks.forEach((b, bi) => {
      if (b.fig !== undefined) return;
      const txt = blockText(p.source, b);
      if (/\[\s*illegible\s*\]/i.test(txt)) {
        items.push({ pageId: p.id, pageNo, kind: 'illegible', block: bi, text: '[illegible] spot to check against the original.' });
      }
      if (hasBrokenMarkup(txt)) {
        items.push({ pageId: p.id, pageNo, kind: 'markup', block: bi, text: 'Unrecognized [[…]] markup in this block.' });
      }
      const w = latexWarnings(txt);
      if (w.length) {
        items.push({ pageId: p.id, pageNo, kind: 'latex', block: bi, text: w[0] });
      }
    });
  });
  return items;
}

/* ---------------------------------------------------------------------------------
 * Scan spotlight band estimation, math snippet palette & block split/merge (3.5)
 * ------------------------------------------------------------------------------- */

export interface ScanBand {
  y0: number;
  y1: number;
}

/** Estimates normalized [y0, y1] vertical bands on the scan for every rendered block. */
export function estimateBlockBands(source: string, figures: Figure[], lines?: TextLine[]): ScanBand[] {
  const blocks = splitBlocks(source, wrapEndLines(source, figures));
  if (!blocks.length) return [];
  const figMap = new Map(figures.map((f) => [f.id, f]));
  const anchors: (ScanBand | null)[] = new Array(blocks.length).fill(null);

  let wrapped: Figure | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.fig !== undefined) {
      const f = figMap.get(b.fig);
      if (f) {
        anchors[i] = { y0: Math.max(0, f.box.y), y1: Math.min(1, f.box.y + f.box.h) };
        wrapped = f.wrap ? f : null;
      } else {
        wrapped = null;
      }
      continue;
    }
    if (wrapped) {
      anchors[i] = { y0: Math.max(0, wrapped.box.y), y1: Math.min(1, wrapped.box.y + wrapped.box.h) };
      if (b.clear) wrapped = null;
    }
  }

  const topEdge = lines?.length ? Math.max(0, Math.min(...lines.map((l) => l.y)) - 0.03) : 0.04;
  const botEdge = lines?.length ? Math.min(1, Math.max(...lines.map((l) => l.y)) + 0.04) : 0.96;
  const out: ScanBand[] = new Array(blocks.length);

  let i = 0;
  while (i < blocks.length) {
    if (anchors[i]) {
      out[i] = anchors[i]!;
      i++;
      continue;
    }
    let j = i;
    while (j < blocks.length && !anchors[j]) j++;
    const spanTop = i > 0 ? out[i - 1].y0 + 0.02 : topEdge;
    const nextAnchor = j < blocks.length ? anchors[j]! : null;
    const spanBot = nextAnchor ? Math.max(spanTop + 0.05, nextAnchor.y0) : Math.max(spanTop + 0.08, botEdge);
    const weights = blocks.slice(i, j).map((b) => Math.max(4, textWeight(blockText(source, b))));
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = spanTop;
    for (let k = i; k < j; k++) {
      const share = ((spanBot - spanTop) * weights[k - i]) / totalW;
      const y0 = Math.max(0, cursor - 0.015);
      const y1 = Math.min(1, Math.max(y0 + 0.05, cursor + share + 0.015));
      out[k] = { y0, y1 };
      cursor += share;
    }
    i = j;
  }
  return out;
}

export interface MathSnippet {
  id: string;
  label: string;
  template: string;
  display?: boolean;
  title: string;
}

/** One-click LaTeX snippets for the MarkupToolbar quick palette (`|` marks cursor placement). */
export const MATH_SNIPPETS: MathSnippet[] = [
  { id: 'frac', label: 'a/b', template: '\\frac{|}{}', title: 'Fraction \\frac{a}{b}' },
  { id: 'sqrt', label: '√', template: '\\sqrt{|}', title: 'Square root \\sqrt{...}' },
  { id: 'int', label: '∫', template: '\\int_{|}^{}', title: 'Integral \\int_a^b' },
  { id: 'sum', label: '∑', template: '\\sum_{|}^{}', title: 'Summation \\sum_{n=0}^{\\infty}' },
  { id: 'lim', label: 'lim', template: '\\lim_{|}', title: 'Limit \\lim_{x \\to a}' },
  { id: 'laplace', label: 'ℒ{}', template: '\\mathcal{L}\\{|\\}', title: 'Laplace transform \\mathcal{L}\\{...\\}' },
  { id: 'cases', label: 'cases', template: '\\begin{cases} |, & \\\\ , & \\end{cases}', display: true, title: 'Piecewise cases' },
  { id: 'aligned', label: 'aligned', template: '\\begin{aligned}\n| &= \\\\\n&= \n\\end{aligned}', display: true, title: 'Aligned equations' },
  { id: 'pmatrix', label: '(mat)', template: '\\begin{pmatrix} | & \\\\ & \\end{pmatrix}', display: true, title: 'Matrix' },
  { id: 'alpha', label: 'α', template: '\\alpha|', title: '\\alpha' },
  { id: 'beta', label: 'β', template: '\\beta|', title: '\\beta' },
  { id: 'delta', label: 'δ', template: '\\delta|', title: '\\delta' },
  { id: 'theta', label: 'θ', template: '\\theta|', title: '\\theta' },
  { id: 'lambda', label: 'λ', template: '\\lambda|', title: '\\lambda' },
  { id: 'omega', label: 'ω', template: '\\omega|', title: '\\omega' },
  { id: 'pi', label: 'π', template: '\\pi|', title: '\\pi' },
  { id: 'infty', label: '∞', template: '\\infty|', title: '\\infty' },
  { id: 'le', label: '≤', template: '\\le|', title: '\\le' },
  { id: 'ge', label: '≥', template: '\\ge|', title: '\\ge' },
  { id: 'to', label: '→', template: '\\to|', title: '\\to' },
];

/** Inserts a MathSnippet cleanly into `text` at [s, e), wrapping in $ or $$ if currently outside math. */
export function applySnippet(text: string, s: number, e: number, snippetId: string): Edit {
  const sn = MATH_SNIPPETS.find((x) => x.id === snippetId);
  if (!sn) return { from: s, to: e, insert: text.slice(s, e), selStart: s, selEnd: e };
  const sel = text.slice(s, e);
  let body = sn.template;
  if (sel) {
    if (body.includes('{}')) body = body.replace('|', sel).replace(/\{\}/, `{${sel}}`);
    else body = body.replace('|', sel);
    // Avoid duplicating sel if replaced via `{}` above.
    if (sn.template.includes('|') && sn.template.includes('{}') && body.includes(`${sel}`)) {
      const marker = sn.template.indexOf('|');
      body = `${sn.template.slice(0, marker)}${sel}${sn.template.slice(marker + 1)}|`;
    }
  }
  const cursorOffset = Math.max(0, body.indexOf('|'));
  const cleanBody = body.replace(/\|/g, '');
  if (isInMath(text, s)) {
    const pos = s + cursorOffset;
    return { from: s, to: e, insert: cleanBody, selStart: pos, selEnd: pos };
  }
  if (sn.display) {
    const needLead = s > 0 && text[s - 1] !== '\n' ? '\n' : '';
    const open = `${needLead}$$\n`;
    const close = '\n$$';
    const pos = s + open.length + cursorOffset;
    return { from: s, to: e, insert: `${open}${cleanBody}${close}`, selStart: pos, selEnd: pos };
  }
  const pos = s + 1 + cursorOffset;
  return { from: s, to: e, insert: `$${cleanBody}$`, selStart: pos, selEnd: pos };
}

/** Splits block text at character offset `pos` into two trimmed non-empty blocks, or returns null. */
export function splitTextAtCursor(text: string, pos: number): [string, string] | null {
  const clamped = Math.max(0, Math.min(text.length, pos));
  const left = text.slice(0, clamped).trimEnd();
  const right = text.slice(clamped).trimStart();
  if (!left.trim() || !right.trim()) return null;
  return [left, right];
}

/** Merges adjacent non-figure block `index` with block `index + 1` into one block. */
export function mergeBlockWithNext(source: string, blocks: Block[], index: number): string | null {
  const a = blocks[index];
  const b = blocks[index + 1];
  if (!a || !b || a.fig !== undefined || b.fig !== undefined) return null;
  const lines = source.split('\n');
  const merged = [...lines.slice(0, a.start), ...lines.slice(a.start, a.end + 1), ...lines.slice(b.start, b.end + 1), ...lines.slice(b.end + 1)];
  return merged.join('\n').replace(/\n{3,}/g, '\n\n');
}

export const LOUPE_W = 220;
export const LOUPE_H = 150;
export const LOUPE_ZOOM = 2.5;

/**
 * Computes exact pixel geometry for the 2.5x magnifier loupe from the displayed scan
 * container size (`containerW x containerH`), centering cursor `(px, py)` inside the lens.
 */
export function computeLoupeMetrics(
  px: number,
  py: number,
  containerW: number,
  containerH: number,
  loupeW = LOUPE_W,
  loupeH = LOUPE_H,
  zoom = LOUPE_ZOOM,
): { left: number; top: number; bgW: number; bgH: number; bgX: number; bgY: number } {
  const bgW = containerW * zoom;
  const bgH = containerH * zoom;
  const bgX = loupeW / 2 - px * bgW;
  const bgY = loupeH / 2 - py * bgH;
  const left = Math.min(Math.max(loupeW / 2, px * containerW), Math.max(loupeW / 2, containerW - loupeW / 2));
  const top = Math.min(Math.max(loupeH / 2, py * containerH), Math.max(loupeH / 2, containerH - loupeH / 2));
  return { left, top, bgW, bgH, bgX, bgY };
}
