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

export interface RenderContext {
  /** Last heading level emitted (1 = document title). Shared across pages so levels never skip. */
  lastHeading: number;
}

export interface RenderOptions {
  /** Returns the HTML for a [[FIGURE n]] marker (or '' if unknown). */
  figure: (id: number) => string;
  ctx?: RenderContext;
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
const GREEK_NAMES = 'alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega';
const FUNC_NAMES = /^(sin|cos|tan|sec|csc|cot|log|exp|ln)$/i;
/** Single words that describe rather than name ("upward"): "x is upward", not "x is the upward". */
const DESCRIPTIVE = /^(\w+(ward|wards|ly|ing|ive|ous|able|ible|ed)|positive|negative|zero|constant|real|complex|up|down|left|right|small|large|big|fixed|unknown|known|same|different|new|old)$/i;

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

const stripMath = (s: string) =>
  s
    .replace(/\$/g, '')
    .replace(/\\(?:text|textrm|mbox|mathrm)\s*\{([^{}]*)\}/g, '$1')
    .trim();
const norm = (s: string) => s.replace(/\s+|\\[,;!]|\\left|\\right/g, '');

/** Is a note label math (a simplification like \cos(\delta), or a symbol) rather than words? */
function isMathLabel(label: string): boolean {
  if (/\\[a-zA-Z]|[=^_{}]/.test(label)) return true;
  const words = (label.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !FUNC_NAMES.test(w));
  return words.length === 0;
}

/** One clause of a "where" sentence, or null if the note adds nothing. */
export function noteClause({ target, label, color }: NoteParts): string | null {
  const t = stripMath(target);
  let l = stripMath(label);
  if (!t || !l || norm(t) === norm(l)) return null;
  let clause: string;
  if (isMathLabel(l)) {
    // A letter naming the term ("a", "\omega") reads "a = ωt"; a simplification reads "cos(-δ) = cos(δ)".
    clause = /^([A-Za-z]|\\[a-zA-Z]+)$/.test(l) ? `$${l} = ${t}$` : `$${t} = ${l}$`;
  } else {
    // "omega (frequency)" -> "frequency" (the symbol's name is already shown as math).
    const named = l.match(new RegExp(`^(?:${GREEK_NAMES})\\s*\\((.+)\\)$`, 'i'));
    if (named) l = named[1].trim();
    l = l.replace(/[.;:,]+$/, '');
    if (/^(the|a|an)\s/i.test(l)) clause = `$${t}$ is ${l}`;
    else if (/^(is|are|was|means|represents|gives|equals)\b/i.test(l)) clause = `$${t}$ ${l}`;
    else if (!/\s/.test(l) && DESCRIPTIVE.test(l)) clause = `$${t}$ is ${l}`;
    else clause = `$${t}$ is the ${l}`;
  }
  return color ? `[[${color}: ${clause}]]` : clause;
}

/** "a", "a and b", "a, b, and c" */
function joinClauses(c: string[]): string {
  if (c.length <= 1) return c.join('');
  if (c.length === 2) return `${c[0]} and ${c[1]}`;
  return `${c.slice(0, -1).join(', ')}, and ${c[c.length - 1]}`;
}

/**
 * Turns each run of consecutive [[note: term | words]] lines (blank lines between
 * them allowed) into one sentence, e.g. "where $R$ is the new amplitude and
 * $\delta$ is the phase shift." Notes without "|" are left for the plain note style.
 */
export function composeNotes(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
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
    const clauses = notes.map(noteClause).filter((c): c is string => !!c);
    // The sentence ends its paragraph, so the next line of the notes starts a new one.
    if (clauses.length) out.push(`[[where: where ${joinClauses(clauses)}.]]`, '');
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

/** Index just past the balanced {...} group that opens at `open` (or -1). */
function groupEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i + 1;
  }
  return -1;
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

function restoreMath(html: string, math: MathToken[]): string {
  return html.replace(PH_RE, (_, i: string) => {
    const m = math[Number(i)];
    if (!m) return '';
    if (m.tex === '\\$') return '$';
    const tex = escapeHtml(prepareTex(m.tex));
    return m.display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  });
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
  const t = content.replace(/\u0001\d+\u0002/g, ' x ').replace(/\\[a-zA-Z]+/g, ' ');
  if (!/^[\s(\[{]*([A-Za-z]\b|\d|[A-Za-z]{2,4}\s*[(^]|x\b)/.test(t)) return false;
  const words = (t.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !/^(sin|cos|tan|sec|csc|cot|log|exp)$/i.test(w));
  return words.length === 0;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FIG_RE = /^\s*\[\[\s*FIGURE\s+(\d+)\s*\]\]\s*$/i;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function markdownToHtml(md: string, opts: RenderOptions): string {
  const ctx = opts.ctx ?? { lastHeading: 1 };
  const { text, math } = protectMath(composeNotes(md.replace(/\r\n?/g, '\n')));
  const lines = text.split('\n');
  const out: string[] = [];
  let para: string[] = [];

  // List stack: indentation + type of each open list.
  const lists: { indent: number; tag: 'ul' | 'ol' }[] = [];
  let itemOpen = false;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>\n')}</p>`);
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

    const fig = line.match(FIG_RE);
    if (fig) {
      closeBlocks();
      const html = opts.figure(Number(fig[1]));
      if (html) out.push(html);
      continue;
    }

    const disp = line.match(PH_LINE);
    if (disp && math[Number(disp[1])]?.display) {
      const block = `<div class="math-display">${placeholder(Number(disp[1]))}</div>`;
      flushPara();
      // Indented under a list item: keep it inside the item; otherwise it ends the list.
      if (!(lists.length && itemOpen && /^\s+/.test(line))) closeLists();
      out.push(block);
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
      closeBlocks();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      i--;
      out.push(
        '<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table>' +
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
      out.push(`<blockquote><p>${quote.map(inline).join('<br>\n')}</p></blockquote>`);
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

  return restoreMath(out.join('\n'), math);
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
