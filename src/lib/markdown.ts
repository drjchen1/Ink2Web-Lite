/**
 * Small, purpose-built Markdown -> semantic HTML converter for transcribed notes.
 *
 * Why not a general Markdown library? Math must be protected *before* any Markdown
 * processing (underscores and asterisks are everywhere in LaTeX), and we want full
 * control over the accessibility of the emitted markup. This file has no DOM
 * dependencies, so it runs identically in the app preview and the exported file.
 *
 * Supported: headings, paragraphs (line breaks kept), nested - / 1. lists,
 * blockquotes, pipe tables, ---, **bold**, *italic*, `code`,
 * $inline$, $$display$$, bare \begin{align}...\end{align}, and [[FIGURE n]] markers.
 *
 * Handwriting extensions:
 *   <u>words</u>              underlined words -> <strong class="ul"> (emphasis, not a link look-alike)
 *   [[red: words]]            words in another ink color -> <span class="ink ink-red">
 *   [[note: term | words]]    arrow/brace note; consecutive ones become one sentence:
 *                             "where ω is the frequency and δ is the phase shift."
 *   [[note: words]]           a free-standing note -> <span class="ink">
 *   \color{red}{...}          inside math: named colors are mapped to accessible shades
 */

import { groupEnd } from './transcript.ts';

export interface RenderContext {
  /** Last heading level emitted (1 = document title). Shared across pages so levels never skip. */
  lastHeading: number;
}

export interface RenderOptions {
  /** Returns the HTML for a [[FIGURE n]] marker (or '' if unknown). */
  figure: (id: number) => string;
  /** Returns the HTML for a row of figures side by side (internal [[FIGROW a b]] line). */
  figureRow?: (ids: number[]) => string;
  ctx?: RenderContext;
  /** How [[note: term | words]] lines render: 'prose' ("where ...") or 'list' ("where:" + bullets). */
  noteStyle?: 'prose' | 'list';
  /** Render standalone $$\boxed{...}$$ display equations as semantic .notebox callouts. */
  notebox?: boolean;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/**
 * Ink colors the app understands, mapped to shades with at least 4.5:1 contrast on
 * white (WCAG 1.4.3). Pure red/green/orange are too light for body text.
 */
export const INK_COLORS: Record<string, string> = {
  red: '#B3261E',
  green: '#1B6E2E',
  orange: '#A84300',
  purple: '#6B2FA3',
  blue: '#1A4FB8',
};
const INK_NAMES = Object.keys(INK_COLORS).join('|');

/** Internal marker: text after this point starts below any wrapped figure. */
export const CLEAR_MARK = '[[CLEAR]]';

/* ------------------------------------------------------------------------------------
 * Arrow and brace notes -> "where ..." sentences
 * ---------------------------------------------------------------------------------- */

const NOTE_RE = new RegExp(`^\\s*\\[\\[\\s*note(?:\\s+(${INK_NAMES}))?\\s*:\\s*([\\s\\S]*?)\\s*\\]\\]\\s*$`, 'i');
const SCRATCH_RE = /^\s*\[\[\s*scratch\s*:\s*([^|\]]+?)\s*\|\s*([\s\S]+?)\s*\]\]\s*$/i;
const GREEK_NAMES = 'alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega';
const FUNC_NAMES = /^(sin|cos|tan|sec|csc|cot|log|exp|ln)$/i;
/** Single words that describe rather than name ("upward"): "x is upward", not "x is the upward". */
const DESCRIPTIVE = /^(\w+(ward|wards|ly|ing|ive|ous|able|ible|ed)|positive|negative|zero|constant|real|complex|up|down|left|right|small|large|big|fixed|unknown|known|same|different|new|old)$/i;
const TEXT_CMD = /\\(?:text|textrm|mbox|mathrm)\s*\{([^{}]*)\}/g;

export interface NoteParts {
  target: string;
  label: string;
  color?: string;
}

/** Splits a [[note ...]] line into its target and words, or null if it has no "|". */
export function parseNote(line: string): NoteParts | null {
  const m = line.match(NOTE_RE);
  if (!m) return null;
  const body = m[2];
  let i = body.indexOf(' | ');
  let len = 3;
  if (i < 0) {
    i = body.indexOf('|');
    len = 1;
  }
  if (i < 0) return null;
  return { target: body.slice(0, i).trim(), label: body.slice(i + len).trim(), color: m[1]?.toLowerCase() };
}

const stripMath = (s: string) => s.replace(/\$/g, '').replace(TEXT_CMD, '$1').trim();
const norm = (s: string) => s.replace(/\s+|\\[,;!]|\\left|\\right/g, '');

/** English words in a label (3+ letters or common 2-letter words, not LaTeX commands or function names). */
function labelWords(label: string): string[] {
  const t = label.replace(/\$/g, '').replace(TEXT_CMD, ' $1 ').replace(/\\[a-zA-Z]+/g, ' ');
  const long = (t.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !FUNC_NAMES.test(w));
  const two = t.match(/\b(?:if|to|at|in|on|is|by|or|so|up|we|do|of|as|an|no|it)\b/gi) ?? [];
  return [...long, ...two];
}

/**
 * Turns a label that mixes words and math into prose with inline math:
 * "oscillation with frequency \omega_n = \sqrt{\frac{k}{m}}"
 *   -> "oscillation with frequency $\omega_n = \sqrt{\frac{k}{m}}$"
 * Words (also inside \text{...}) stay text; everything else becomes $...$.
 */
export function labelToProse(label: string): string {
  const trimmed = label.trim();
  if (
    /\$[^$]+\$/.test(trimmed) &&
    (trimmed.match(/\$/g) ?? []).length % 2 === 0 &&
    !/\\[a-zA-Z]/.test(trimmed.replace(/\$[^$]*\$/g, ''))
  ) {
    return trimmed;
  }
  const parts: string[] = [];
  const pushText = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  };
  const pushMath = (s: string) => {
    let t = s.trim();
    if (!t) return;
    while (/^["“]/.test(t)) {
      parts.push(t[0]);
      t = t.slice(1).trim();
    }
    const trailing: string[] = [];
    while (/["”]$/.test(t)) {
      trailing.unshift(t[t.length - 1]);
      t = t.slice(0, -1).trim();
    }
    if (t) parts.push(/^[.,;:!?()]+$/.test(t) ? t : `$${t}$`);
    for (const q of trailing) parts.push(q);
  };
  const segments = label.replace(/\$/g, '').split(/(\\(?:text|textrm|mbox|mathrm)\s*\{[^{}]*\})/);
  for (const seg of segments) {
    const txt = seg.match(/^\\(?:text|textrm|mbox|mathrm)\s*\{([^{}]*)\}$/);
    if (txt) {
      pushText(txt[1]);
      continue;
    }
    // Runs of words: a 3+ letter word (or a common short word like "as") not part of a
    // LaTeX command, plus following words. A word followed by _ ^ { ( is math ("in(x)").
    const run = /(?<![\\A-Za-z])(?:[A-Za-z]{3,}|as|is|of|to|in|at|by|on|or|if|an)(?:\s+[A-Za-z]{2,}(?![A-Za-z_^{(]))*(?![A-Za-z_^{(])/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = run.exec(seg))) {
      if (m[0].split(/\s+/).every((w) => FUNC_NAMES.test(w))) continue; // "cos" alone is math
      pushMath(seg.slice(last, m.index));
      pushText(m[0]);
      last = m.index + m[0].length;
    }
    pushMath(seg.slice(last));
  }
  let out = '';
  let inQuote = false;
  let attachNext = false;
  for (const p of parts) {
    if (p === '“' || (p === '"' && !inQuote)) {
      if (p === '"') inQuote = true;
      out = out ? `${out} ${p}` : p;
      attachNext = true;
    } else if (p === '”' || (p === '"' && inQuote)) {
      if (p === '"') inQuote = false;
      out += p;
      attachNext = false;
    } else if (/^[.,;:!?)]+$/.test(p)) {
      out += p;
      attachNext = false;
    } else {
      out = attachNext || !out ? `${out}${p}` : `${out} ${p}`;
      attachNext = false;
    }
  }
  return out;
}

/**
 * One clause of a "where" sentence, or null if the note adds nothing.
 *
 * - A pure-math label is an equation: "cos(-δ) = cos(δ)", or "a = ωt" for a letter.
 * - Any label with words is a description, joined with "is", never "=":
 *   "ω is the frequency", "−0.3 is upward",
 *   "C₁cos(ωₙt) + C₂sin(ωₙt) is oscillation with frequency ωₙ = √(k/m)".
 *   "the" is added only for a short plain name ("new amplitude").
 */
export function noteClause({ target, label, color }: NoteParts): string | null {
  const t = stripMath(target);
  const raw = label.replace(/\$/g, '').trim();
  if (!t || !raw || norm(t) === norm(stripMath(raw))) return null;
  let clause: string;
  if (!labelWords(raw).length) {
    const l = stripMath(raw);
    clause = /^([A-Za-z]|\\[a-zA-Z]+)$/.test(l) ? `$${l} = ${t}$` : `$${t} = ${l}$`;
  } else {
    const plain = stripMath(raw);
    // "omega (frequency)" -> "frequency" (the symbol's name is already shown as math).
    const named = plain.match(new RegExp(`^(?:${GREEK_NAMES})\\s*\\(([^()\\\\]+)\\)$`, 'i'));
    let prose = named ? named[1].trim() : labelToProse(raw);
    prose = prose.replace(/[.;:,]+$/, '');
    const hasMath = prose.includes('$');
    const wordCount = prose.replace(/\$[^$]*\$/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    if (/^(the|a|an)\s/i.test(prose)) clause = `$${t}$ is ${prose}`;
    else if (
      /^(is|are|was|means|represents|gives|equals|corresponds|resets|turns|puts|starts|ends|becomes|goes|stays|drops|rises|shifts|delays)\b/i.test(
        prose,
      )
    )
      clause = `$${t}$ ${prose}`;
    else if (/^\?|^(we|you|it|this|that|turn|reset|break|check|use|take|find)\b/i.test(prose)) clause = `$${t}$: ${prose}`;
    else if (!hasMath && wordCount === 1 && DESCRIPTIVE.test(prose)) clause = `$${t}$ is ${prose}`;
    else if (!hasMath && wordCount <= 3) clause = `$${t}$ is the ${prose}`;
    else clause = `$${t}$ is ${prose}`;
  }
  return color ? `[[${color}: ${clause}]]` : clause;
}

/** One bullet item for the structured "where:" list style: "* $term$: explanation". */
export function noteListItem({ target, label, color }: NoteParts): string | null {
  const t = stripMath(target);
  const raw = label.replace(/\r\n?/g, ' ').trim();
  if (!t || !raw || norm(t) === norm(stripMath(raw))) return null;
  const balancedDollar =
    /\$[^$]+\$/.test(raw) &&
    (raw.match(/\$/g) ?? []).length % 2 === 0 &&
    !/\\[a-zA-Z]/.test(raw.replace(/\$[^$]*\$/g, ''));
  let body: string;
  if (balancedDollar) {
    body = raw;
  } else {
    const noDollar = raw.replace(/\$/g, '').trim();
    const plain = stripMath(noDollar);
    const named = plain.match(new RegExp(`^(?:${GREEK_NAMES})\\s*\\(([^()\\\\]+)\\)$`, 'i'));
    if (named) body = named[1].trim();
    else if (!labelWords(noDollar).length) body = `$${plain}$`;
    else body = labelToProse(noDollar);
  }
  const item = `$${t}$: ${body}`;
  return `* ${color ? `[[${color}: ${item}]]` : item}`;
}

/** "a", "a and b", "a, b, and c" */
function joinClauses(c: string[]): string {
  if (c.length <= 1) return c.join('');
  if (c.length === 2) return `${c[0]} and ${c[1]}`;
  return `${c.slice(0, -1).join(', ')}, and ${c[c.length - 1]}`;
}

/**
 * Turns each run of consecutive [[note: term | words]] lines (blank lines between
 * them allowed) into either a "where ..." sentence ('prose') or a structured
 * "**where:**" bullet list ('list'). Notes without "|" are left for the plain note style.
 */
export function composeNotes(md: string, style: 'prose' | 'list' = 'prose'): string {
  const lines = md.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const scratch = lines[i].match(SCRATCH_RE);
    if (scratch) {
      const label = scratch[1].trim();
      const rowGroups = scratch[2]
        .split(/(?<!\\);/)
        .map((r) => r.split(/(?<!\\),/).map((p) => p.trim()).filter(Boolean))
        .filter((r) => r.length > 0);
      if (rowGroups.length) {
        if (style === 'list') {
          out.push(`**where** (${label}):`, ...rowGroups.map((r) => `* ${r.map((p) => `$${p}$`).join(', ')}`), '');
        } else {
          const all = rowGroups.flat().map((p) => `$${p}$`);
          out.push(`[[where: where (${label}) ${joinClauses(all)}.]]`, '');
        }
      }
      continue;
    }
    const first = parseNote(lines[i]);
    if (!first) {
      out.push(lines[i]);
      continue;
    }
    const notes: NoteParts[] = [first];
    let j = i + 1;
    for (;;) {
      let k = j;
      while (k < lines.length && !lines[k].trim()) k++;
      const next = k < lines.length ? parseNote(lines[k]) : null;
      if (!next) break;
      notes.push(next);
      j = k + 1;
    }
    if (style === 'list') {
      const items = notes.map(noteListItem).filter((c): c is string => !!c);
      if (items.length) out.push('**where:**', ...items, '');
    } else {
      const clauses = notes.map(noteClause).filter((c): c is string => !!c);
      // The sentence ends its paragraph, so the next line of the notes starts a new one.
      if (clauses.length) out.push(`[[where: where ${joinClauses(clauses)}.]]`, '');
    }
    i = j - 1;
  }
  return out.join('\n');
}

/* ---------------------------------------------------------------------------------- */

const PH_OPEN = '\u0001';
const PH_CLOSE = '\u0002';
const placeholder = (i: number) => `${PH_OPEN}${i}${PH_CLOSE}`;
const PH_RE = /\u0001(\d+)\u0002/g;
const PH_LINE = /^\s*\u0001(\d+)\u0002\s*$/;

interface MathToken {
  tex: string;
  display: boolean;
}

/** Pulls math out of the text so Markdown rules can't touch it. */
function protectMath(md: string): { text: string; math: MathToken[] } {
  const math: MathToken[] = [];
  const add = (tex: string, display: boolean) => {
    math.push({ tex: tex.trim(), display });
    return placeholder(math.length - 1);
  };
  let t = md.replace(/\\\$/g, () => add('\\$', false));
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => add(tex, true));
  t = t.replace(
    /\\begin\{(align\*?|aligned|equation\*?|gather\*?|multline\*?|eqnarray\*?|cases|array|[pbvBV]?matrix)\}[\s\S]*?\\end\{\1\}/g,
    (env: string) => add(env, true),
  );
  // Inline: no blank line inside, must start/end with non-space.
  t = t.replace(/\$(?!\s)((?:[^$\n]|\n(?!\s*\n))+?)(?<!\s)\$/g, (_, tex: string) => add(tex, false));
  return { text: t, math };
}

function inline(s: string): string {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Handwriting extensions (after escaping, so match the escaped forms).
  t = t.replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/gi, '<strong class="ul">$1</strong>');
  t = t.replace(
    new RegExp(`\\[\\[\\s*(${INK_NAMES})\\s*:\\s*([\\s\\S]+?)\\s*\\]\\]`, 'gi'),
    (_, c: string, body: string) => `<span class="ink ink-${c.toLowerCase()}">${body}</span>`,
  );
  // \textcolor{red}{words} written outside math (math is already protected).
  t = t.replace(
    new RegExp(`\\\\textcolor\\s*\\{(${INK_NAMES})\\}\\s*\\{([^{}]+)\\}`, 'gi'),
    (_, c: string, body: string) => `<span class="ink ink-${c.toLowerCase()}">${body}</span>`,
  );
  // Notes (after colors, so colored clauses inside a "where" sentence are already spans).
  t = t.replace(/\[\[\s*(?:note|where)\s*:\s*([\s\S]+?)\s*\]\]/gi, '<span class="ink">$1</span>');
  t = t.replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__(?!\s)(.+?)(?<!\s)__/g, '<strong>$1</strong>');
  t = t.replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g, '<em>$1</em>');
  t = t.replace(/(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])/g, '<em>$1</em>');
  return t;
}

/** Maps named colors inside LaTeX to the accessible shades used for text. */
export function accessibleTexColors(tex: string): string {
  return tex.replace(
    new RegExp(`\\\\(color|textcolor)\\s*\\{\\s*(${INK_NAMES})\\s*\\}`, 'gi'),
    (_, cmd: string, c: string) => `\\${cmd}{${INK_COLORS[c.toLowerCase()]}}`,
  );
}

/**
 * Handwritten notes hang a note under or over a term without pushing the
 * neighboring symbols apart. In LaTeX a wide label widens the term, so text labels
 * of arrow notes (\underset/\overset) and brace notes (\underbrace/\overbrace) are
 * wrapped in \mathclap (zero width, centered; needs the mathtools extension, which
 * the export and the preview load). Math-only labels like \cos(\delta) are left as is.
 */
export function clapTextLabels(tex: string): string {
  const wrap = (label: string) =>
    /\\text\s*\{/.test(label) && !/^\s*\\mathclap\b/.test(label) ? `\\mathclap{${label}}` : label;
  let out = '';
  let i = 0;
  const cmd = /\\(underset|overset|underbrace|overbrace)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = cmd.exec(tex))) {
    const open = m.index + m[0].length - 1;
    const end = groupEnd(tex, open);
    if (end < 0) break;
    if (m[1] === 'underset' || m[1] === 'overset') {
      // \underset{LABEL}{term}: the first group is the label.
      out += tex.slice(i, open) + `{${wrap(tex.slice(open + 1, end - 1))}}`;
      i = end;
    } else {
      // \underbrace{term}_{LABEL} / \overbrace{term}^{LABEL}
      const after = tex.slice(end).match(/^\s*[_^]\s*\{/);
      if (!after) continue;
      const lOpen = end + after[0].length - 1;
      const lEnd = groupEnd(tex, lOpen);
      if (lEnd < 0) break;
      out += tex.slice(i, lOpen) + `{${wrap(tex.slice(lOpen + 1, lEnd - 1))}}`;
      i = lEnd;
    }
    cmd.lastIndex = i;
  }
  return out + tex.slice(i);
}

/** All LaTeX adjustments applied before rendering. */
export const prepareTex = (tex: string) => clapTextLabels(accessibleTexColors(tex));

function restoreMath(html: string, math: MathToken[], tableMath?: Set<number>): string {
  return html.replace(PH_RE, (_, i: string) => {
    const idx = Number(i);
    const m = math[idx];
    if (!m) return '';
    if (m.tex === '\\$') return '$';
    const raw = tableMath?.has(idx) ? m.tex.replace(/(?<![\\^_])\\frac\s*\{/g, '\\dfrac{') : m.tex;
    const tex = escapeHtml(prepareTex(raw));
    return m.display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  });
}

/** Unwraps standalone `\boxed{...}` (plus optional leading `=` or trailing `(s > 0)`) for `.notebox`. */
function unwrapBoxedDisplay(tex: string): string | null {
  const m = tex.match(/^\s*(=\s*)?\\boxed\s*\{/);
  if (!m) return null;
  const open = m[0].length - 1;
  const end = groupEnd(tex, open);
  if (end < 0) return null;
  const inner = tex.slice(open + 1, end - 1).trim();
  const rest = tex.slice(end).trim();
  const restClean = rest.replace(/\\(?:quad|qquad|,|;)\b/g, '').trim();
  if (restClean && !/^\([^()]{1,40}\)$/.test(restClean)) return null;
  const prefix = m[1] ? `${m[1].trim()} ` : '';
  return `${prefix}${inner}${rest ? ` ${rest}` : ''}`;
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** "- sin(δ)" or "- 3x + 1": a minus sign starting an expression, not a bullet point. */
function looksLikeMath(content: string): boolean {
  if (content.includes(':')) return false;
  const t = content.replace(/\u0001\d+\u0002/g, ' x ').replace(/\\[a-zA-Z]+/g, ' ');
  if (!/^[\s(\[{]*([A-Za-z]\b|\d|[A-Za-z]{2,4}\s*[(^]|x\b)/.test(t)) return false;
  const words = (t.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !/^(sin|cos|tan|sec|csc|cot|log|exp)$/i.test(w));
  return words.length === 0;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FIG_RE = /^\s*\[\[\s*FIGURE\s+(\d+)\s*\]\]\s*$/i;
/** Internal: figures side by side, [[FIGROW 1 2]] (written by exportHtml.withRows). */
const FIGROW_RE = /^\s*\[\[FIGROW((?:\s+\d+)+)\s*\]\]\s*$/;
const BOX_START_RE = /^\s*\[\[\s*box(?:\s*:\s*([^\]]*))?\s*\]\]\s*$/i;
const BOX_END_RE = /^\s*\[\[\s*\/box\s*\]\]\s*$/i;
const COLS_START_RE = /^\s*\[\[\s*columns\s*\]\]\s*$/i;
const COLS_NEXT_RE = /^\s*\[\[\s*next\s*\]\]\s*$/i;
const COLS_END_RE = /^\s*\[\[\s*\/columns\s*\]\]\s*$/i;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * One line of text with inline marks and $…$ math (3.2.1), without a surrounding <p>:
 * figure titles and captions. Line breaks become spaces; display math is shown inline.
 */
export function inlineMarkdown(md: string): string {
  const { text, math } = protectMath(md.replace(/\s*\n\s*/g, ' ').trim());
  return restoreMath(inline(text), math.map((m) => ({ ...m, display: false })));
}

export function markdownToHtml(md: string, opts: RenderOptions): string {
  const ctx = opts.ctx ?? { lastHeading: 1 };
  const { text, math } = protectMath(composeNotes(md.replace(/\r\n?/g, '\n'), opts.noteStyle ?? 'prose'));
  const lines = text.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const tableMath = new Set<number>();
  let boxDepth = 0;
  let colDepth = 0;

  // List stack: indentation + type of each open list.
  const lists: { indent: number; tag: 'ul' | 'ol' }[] = [];
  let itemOpen = false;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>\n')}</p>`);
    para = [];
  };
  const closeLists = (toDepth = 0) => {
    while (lists.length > toDepth) {
      if (itemOpen) out.push('</li>');
      out.push(`</${lists.pop()!.tag}>`);
      itemOpen = lists.length > 0;
    }
  };
  const closeBlocks = () => {
    flushPara();
    closeLists();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) {
      flushPara();
      // A blank line ends a list unless the next non-blank line continues it.
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (!next || !LIST_RE.test(next)) closeLists();
      continue;
    }

    if (line.trim() === CLEAR_MARK) {
      closeBlocks();
      out.push('<div class="fig-clear"></div>');
      continue;
    }

    const boxStart = line.match(BOX_START_RE);
    if (boxStart) {
      closeBlocks();
      boxDepth++;
      out.push(`<div class="notebox" role="region" aria-label="${escapeHtml(boxStart[1]?.trim() || 'Highlighted note')}">`);
      continue;
    }
    if (BOX_END_RE.test(line)) {
      closeBlocks();
      if (boxDepth > 0) {
        out.push('</div>');
        boxDepth--;
      }
      continue;
    }

    if (COLS_START_RE.test(line)) {
      closeBlocks();
      colDepth++;
      out.push('<div class="side-by-side"><div class="col">');
      continue;
    }
    if (COLS_NEXT_RE.test(line)) {
      closeBlocks();
      if (colDepth > 0) out.push('</div><div class="col">');
      continue;
    }
    if (COLS_END_RE.test(line)) {
      closeBlocks();
      if (colDepth > 0) {
        out.push('</div></div>');
        colDepth--;
      }
      continue;
    }

    const row = line.match(FIGROW_RE);
    if (row) {
      closeBlocks();
      const ids = row[1].trim().split(/\s+/).map(Number);
      const html = opts.figureRow ? opts.figureRow(ids) : ids.map(opts.figure).filter(Boolean).join('\n');
      if (html) out.push(html);
      continue;
    }
    const fig = line.match(FIG_RE);
    if (fig) {
      closeBlocks();
      const html = opts.figure(Number(fig[1]));
      if (html) out.push(html);
      continue;
    }

    const disp = line.match(PH_LINE);
    if (disp && math[Number(disp[1])]?.display) {
      const idx = Number(disp[1]);
      const unwrapped = opts.notebox ? unwrapBoxedDisplay(math[idx].tex) : null;
      if (unwrapped !== null) math[idx].tex = unwrapped;
      const block = `<div class="math-display">${placeholder(idx)}</div>`;
      flushPara();
      // Indented under a list item: keep it inside the item; otherwise it ends the list.
      if (!(lists.length && itemOpen && /^\s+/.test(line))) closeLists();
      out.push(unwrapped !== null ? `<div class="notebox" role="region" aria-label="Highlighted formula">${block}</div>` : block);
      continue;
    }

    const h = line.match(HEADING_RE);
    if (h) {
      closeBlocks();
      // "#" maps to h2 (h1 is the document title); never skip a level going down.
      const level = Math.min(h[1].length + 1, ctx.lastHeading + 1, 6);
      ctx.lastHeading = level;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    if (HR_RE.test(line)) {
      closeBlocks();
      out.push('<hr>');
      continue;
    }

    if (line.trim().startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      let caption = '';
      if (para.length === 1) {
        const capMatch = para[0].trim().match(/^(?:\*\*(.+?)\*\*|caption:\s*(.+))$/i);
        if (capMatch) {
          caption = (capMatch[1] ?? capMatch[2]).trim();
          para = [];
        }
      }
      closeBlocks();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      i--;
      for (const cell of [...head, ...rows.flat()]) {
        for (const m of cell.matchAll(PH_RE)) tableMath.add(Number(m[1]));
      }
      const label = caption ? caption.replace(PH_RE, ' ').replace(/\s+/g, ' ').trim() || 'Table' : 'Table';
      out.push(
        `<div class="table-wrap" role="region" aria-label="${escapeHtml(label)}" tabindex="0"><table>` +
          (caption ? `<caption>${inline(caption)}</caption>` : '') +
          `<thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>` +
          '</table></div>',
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      closeBlocks();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote><p>${inline(quote.join('\n')).replace(/\n/g, '<br>\n')}</p></blockquote>`);
      continue;
    }

    const li = line.match(LIST_RE);
    if (li && !(li[2] === '-' && looksLikeMath(li[3]))) {
      flushPara();
      const indent = li[1].replace(/\t/g, '    ').length;
      const tag: 'ul' | 'ol' = /\d/.test(li[2]) ? 'ol' : 'ul';
      while (lists.length && indent < lists[lists.length - 1].indent) closeLists(lists.length - 1);
      const top = lists[lists.length - 1];
      if (!top || indent > top.indent) {
        const start = tag === 'ol' ? parseInt(li[2], 10) : 1;
        out.push(tag === 'ol' && start !== 1 ? `<ol start="${start}">` : `<${tag}>`);
        lists.push({ indent, tag });
      } else {
        if (itemOpen) out.push('</li>');
        if (top.tag !== tag) {
          out.push(`</${top.tag}>`, `<${tag}>`);
          top.tag = tag;
        }
      }
      out.push(`<li>${inline(li[3])}`);
      itemOpen = true;
      continue;
    }

    if (lists.length && itemOpen && /^\s+/.test(line)) {
      out.push(`<br>\n${inline(line.trim())}`);
      continue;
    }

    closeLists();
    para.push(line.trim());
  }
  closeBlocks();
  while (boxDepth-- > 0) out.push('</div>');
  while (colDepth-- > 0) out.push('</div></div>');

  return restoreMath(out.join('\n'), math, tableMath);
}

/** Quick structural check of LaTeX that small models commonly get wrong. */
export function latexWarnings(md: string): string[] {
  const { math } = protectMath(md);
  const warnings: string[] = [];
  math.forEach((m) => {
    if (m.tex === '\\$') return;
    let depth = 0;
    for (let i = 0; i < m.tex.length; i++) {
      const c = m.tex[i];
      if (c === '\\') i++;
      else if (c === '{') depth++;
      else if (c === '}' && --depth < 0) break;
    }
    const begins = (m.tex.match(/\\begin\{/g) ?? []).length;
    const ends = (m.tex.match(/\\end\{/g) ?? []).length;
    const lefts = (m.tex.match(/\\left(?![a-zA-Z])/g) ?? []).length;
    const rights = (m.tex.match(/\\right(?![a-zA-Z])/g) ?? []).length;
    const short = m.tex.length > 40 ? `${m.tex.slice(0, 40)}…` : m.tex;
    if (depth !== 0) warnings.push(`Unbalanced braces in: ${short}`);
    if (begins !== ends) warnings.push(`Unmatched \\begin/\\end in: ${short}`);
    if (lefts !== rights) warnings.push(`Unmatched \\left/\\right in: ${short}`);
  });
  const stray = protectMath(md).text.match(/\$/g);
  if (stray) warnings.push('A "$" delimiter is unmatched; some math may show as plain text.');
  return warnings;
}
