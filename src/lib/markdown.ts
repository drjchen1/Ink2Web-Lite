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
  t = t.replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__(?!\s)(.+?)(?<!\s)__/g, '<strong>$1</strong>');
  t = t.replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g, '<em>$1</em>');
  t = t.replace(/(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])/g, '<em>$1</em>');
  return t;
}

function restoreMath(html: string, math: MathToken[]): string {
  return html.replace(PH_RE, (_, i: string) => {
    const m = math[Number(i)];
    if (!m) return '';
    if (m.tex === '\\$') return '$';
    return m.display ? `\\[${escapeHtml(m.tex)}\\]` : `\\(${escapeHtml(m.tex)}\\)`;
  });
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FIG_RE = /^\s*\[\[\s*FIGURE\s+(\d+)\s*\]\]\s*$/i;
/** Internal marker: text after this point starts below any wrapped figure. */
export const CLEAR_MARK = '[[CLEAR]]';
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function markdownToHtml(md: string, opts: RenderOptions): string {
  const ctx = opts.ctx ?? { lastHeading: 1 };
  const { text, math } = protectMath(md.replace(/\r\n?/g, '\n'));
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
    if (li) {
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
