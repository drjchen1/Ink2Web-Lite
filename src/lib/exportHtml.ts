import type { Figure, Page } from '../types.ts';
import { CLEAR_MARK, INK_COLORS, escapeHtml, markdownToHtml, type RenderContext } from './markdown.ts';
import { MARKER_LINE, sourceUnits } from './transcript.ts';
import { placeSvg, redrawState, shownAs } from './figureRedraw.ts';
import { figureRows, rowMembers } from './figureRows.ts';

/** Renders figures and pages to HTML; builds the standalone, accessible export. */

const GREEK = 'alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega';

/** Turns stray LaTeX in alt text into plain words a screen reader can say. */
export function plainMath(text: string): string {
  let t = text.replace(/\$+/g, '');
  t = t.replace(/\\(?:color|textcolor)\s*\{[^{}]*\}/g, '');
  for (let i = 0; i < 3; i++) t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
  t = t
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'square root of $1')
    .replace(/\\(left|right|,|;|!|quad|qquad)/g, ' ')
    .replace(/\\(le|leq)\b/g, '≤')
    .replace(/\\(ge|geq)\b/g, '≥')
    .replace(/\\(ne|neq)\b/g, '≠')
    .replace(/\\infty\b/g, 'infinity')
    .replace(/\\int\b/g, 'integral')
    .replace(/\\sum\b/g, 'sum')
    .replace(/\\cdot\b|\\times\b/g, '×')
    .replace(new RegExp(`\\\\(${GREEK})\\b`, 'g'), '$1')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ');
  return t.trim();
}

/** Plain words, first letter capitalized, ending with a period (so screen readers pause). */
export function polishAlt(text: string): string {
  const t = plainMath(text) || 'Hand-drawn figure';
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/**
 * Content CSS shared by the export and the in-app preview: figure layout plus the
 * handwriting marks (colored notes, underlined words).
 *
 * Colored notes are also italic, so the difference from the main text never relies
 * on color alone (WCAG 1.4.1). Underlined words use a thick, offset underline in
 * the text color so they don't look like links.
 * Figure width is a CSS variable so the narrow-screen rule can override it (WCAG 1.4.10 reflow).
 */
export const FIGURE_CSS = `
figure.fig{width:var(--w,100%);max-width:100%;margin:0 auto 1rem}
figure.fig img{display:block;width:100%;height:auto;border:1px solid #d0d0d0;border-radius:4px}
figure.fig figcaption{color:#555;font-size:.95rem;margin-top:.4rem}
figure.fig.align-left{margin-left:0;margin-right:auto}
figure.fig.align-right{margin-left:auto;margin-right:0}
figure.fig.wrap.align-left{float:left;margin:.25rem 1.5rem 1rem 0}
figure.fig.wrap.align-right{float:right;margin:.25rem 0 1rem 1.5rem}
figure.fig:not(.wrap),figure.fig.wrap,h1,h2,h3,h4,h5,h6,hr,.page-break,.fig-clear{clear:both}
figure.fig.wrap~.math-display,figure.fig.wrap~.table-wrap{min-width:min(14rem,100%)}
@media (max-width:40rem){figure.fig,figure.fig.wrap.align-left,figure.fig.wrap.align-right{float:none;width:min(100%,max(calc(var(--w,100%) * 2),50%));margin:0 auto 1rem}}
.ink{font-style:italic}
${Object.entries(INK_COLORS)
  .map(([name, hex]) => `.ink-${name}{color:${hex}}`)
  .join('\n')}
figure.fig svg.redraw{display:block;width:100%;height:auto;border:1px solid #d0d0d0;border-radius:4px;background:#fff}
figure.fig details.fig-orig{margin-top:.4rem}
figure.fig details.fig-orig summary{cursor:pointer;color:#555;font-size:.95rem}
figure.fig details.fig-orig img{margin-top:.4rem}
.fig-row{display:flex;flex-wrap:wrap;align-items:flex-start;column-gap:4%;clear:both;margin:0 0 1rem}
.fig-row.align-center{justify-content:center}
.fig-row.align-right{justify-content:flex-end}
.fig-row figure.fig{flex:0 0 auto;margin:0 0 .5rem}
strong.ul{font-weight:600;text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.2em}
figure.fig details.fig-desc{margin-top:.4rem;text-align:left}
figure.fig details.fig-desc summary{cursor:pointer;font-weight:600;font-size:.9rem}
figure.fig .fig-desc-body{font-size:.95rem;line-height:1.55;margin-top:.35rem}
figure.fig .fig-desc-body p{margin:0 0 .5rem}
`;

/**
 * One figure. Shown as the cropped image, the redraw (2.2: an inline SVG whose
 * <title>/<desc> carry alt text computed from the math), or both (the redraw, then the
 * original sketch in a collapsed "Original sketch" section). A redraw whose spec has
 * errors falls back to the image.
 */
/** The look of the exported document (3.2): one column of text, or page cards. */
export type ExportLook = 'classic' | 'cards';

/** A figure's detailed description (3.2) as a collapsed section, or ''. Math in $…$ is rendered. */
export function descriptionHtml(description: string | undefined): string {
  const d = description?.trim();
  if (!d) return '';
  const body = markdownToHtml(d, { figure: () => '' });
  return `<details class="fig-desc"><summary>Detailed description</summary><div class="fig-desc-body">${body}</div></details>`;
}

export function figureHtml(fig: Figure | undefined, pageNo: number, inRow = false, look: ExportLook = 'classic'): string {
  if (!fig) return '';
  const alt = escapeHtml(polishAlt(fig.alt));
  const align = fig.align ?? 'center';
  // In a row of figures (2.2.3), text never flows beside one of them.
  const wrap = fig.wrap && align !== 'center' && !inRow ? ' wrap' : '';
  const width = Math.min(100, Math.max(15, Math.round(fig.width ?? 100)));
  const id = `fig-${pageNo}-${fig.id}`;
  const show = shownAs(fig);
  const state = redrawState(fig);
  let body = `<img src="${fig.src}" alt="${alt}">`;
  if (show !== 'image' && state.kind === 'ready') {
    body = placeSvg(state.result.svg, id);
    if (show === 'both') {
      const origAlt = escapeHtml(`Original hand-drawn sketch. ${polishAlt(fig.alt)}`);
      body += `<details class="fig-orig"><summary>Original sketch</summary><img src="${fig.src}" alt="${origAlt}"></details>`;
    }
  }
  // Caption (3.2): the visible caption, and the detailed description when there is one.
  // The cards look always shows a title; when it only repeats what a screen reader
  // already heard (the alt text), it is hidden from screen readers.
  const desc = descriptionHtml(fig.description);
  const cap = fig.caption.trim();
  let caption = '';
  if (look === 'cards') {
    const heard = show !== 'image' && state.kind === 'ready' ? state.result.alt.short : polishAlt(fig.alt);
    const title = cap || heard;
    const hide = !cap ? ' aria-hidden="true"' : '';
    caption = `<figcaption><div class="fig-title"${hide}><span class="fig-label">Figure:</span> ${escapeHtml(title)}</div>${desc}</figcaption>`;
  } else if (cap || desc) caption = `<figcaption>${cap ? escapeHtml(cap) : ''}${desc}</figcaption>`;
  return `<figure id="${id}" class="fig align-${align}${wrap}" style="--w:${width}%">${body}${caption}</figure>`;
}

/**
 * For each wrapped figure, the source line after which its wrap ends: text after
 * that point starts below the figure, as in the notes. (Shared with the editable
 * preview, which splits the page into blocks at these lines.)
 */
export function wrapEndLines(source: string, figures: Figure[]): Set<number> {
  const lines = source.split('\n');
  const units = sourceUnits(source);
  const clearAfter = new Set<number>(); // line index after which to clear
  const inRow = rowMembers(source, figures);
  units.forEach((u, i) => {
    const m = u.start === u.end ? lines[u.start].match(MARKER_LINE) : null;
    const f = m ? figures.find((x) => x.id === Number(m[1])) : undefined;
    if (!f || !f.wrap || f.align === 'center' || !(f.besideLines > 0) || inRow.has(f.id)) return;
    let n = 0;
    for (let j = i + 1; j < units.length; j++) {
      if (lines[units[j].start].match(MARKER_LINE)) break;
      if (++n === f.besideLines) {
        clearAfter.add(units[j].end);
        return;
      }
    }
  });
  return clearAfter;
}

/** The source with a [[CLEAR]] marker after each wrapped figure's "beside" lines. */
export function withWrapEnds(source: string, figures: Figure[]): string {
  const clearAfter = wrapEndLines(source, figures);
  if (!clearAfter.size) return source;
  return source
    .split('\n')
    .flatMap((l, i) => (clearAfter.has(i) ? [l, '', CLEAR_MARK, ''] : [l]))
    .join('\n');
}

/**
 * The source with each row of figures (2.2.3) as one [[FIGROW a b ...]] line in place
 * of its markers, for rendering.
 */
export function withRows(source: string, figures: Figure[]): string {
  const rows = figureRows(source, figures);
  if (!rows.length) return source;
  const first = new Map(rows.map((r) => [r[0], r]));
  const rest = new Set(rows.flatMap((r) => r.slice(1)));
  return source
    .split('\n')
    .flatMap((l) => {
      const id = Number(l.match(MARKER_LINE)?.[1]);
      if (first.has(id)) return [`[[FIGROW ${first.get(id)!.join(' ')}]]`];
      return rest.has(id) ? [] : [l];
    })
    .join('\n');
}

/** One row of figures: the first figure's alignment places the whole row. */
export function figureRowHtml(ids: number[], figures: Figure[], pageNo: number, look: ExportLook = 'classic'): string {
  const figs = ids.map((id) => figures.find((f) => f.id === id)).filter((f): f is Figure => !!f);
  if (!figs.length) return '';
  return `<div class="fig-row align-${figs[0].align ?? 'center'}">${figs.map((f) => figureHtml(f, pageNo, true, look)).join('')}</div>`;
}

export function pageHtml(page: Page, pageNo: number, ctx?: RenderContext, look: ExportLook = 'classic'): string {
  const html = markdownToHtml(withRows(withWrapEnds(page.source, page.figures), page.figures), {
    ctx,
    figure: (id) => figureHtml(page.figures.find((f) => f.id === id), pageNo, false, look),
    figureRow: (ids) => figureRowHtml(ids, page.figures, pageNo, look),
  });
  // Text wrapping beside a figure always stops at the end of its page.
  return page.figures.some((f) => f.wrap) ? `${html}\n<div class="fig-clear"></div>` : html;
}

/** True for names like "DOC101626-10162026010500", "IMG_2041", "Lesson20-1", "scan 3". */
export function looksLikeFileName(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^(doc|document|img|image|scan|scanned|pxl|dsc|photo|screenshot|file|untitled|page)[\s_\-]*[\d\s_\-.]*$/i.test(t)) return true;
  // One "word" containing digits or underscores: Lesson20-1, notes_week3, ch4.
  return !/\s/.test(t) && /[\d_]/.test(t);
}

/**
 * Chooses the document title. If the title came from the file name (or looks like
 * one) and the first page starts with a heading, that heading becomes the <h1> and
 * is removed from the page so it isn't repeated.
 */
export function resolveTitle(pages: Page[], title: string, fromFileName = false): { title: string; pages: Page[] } {
  if (!(fromFileName || looksLikeFileName(title)) || !pages.length) return { title, pages };
  const first = pages[0];
  const m = first.source.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*(?:\n|$)/);
  if (!m) return { title, pages };
  const heading = m[1].replace(/\*\*|__/g, '').trim();
  return { title: heading, pages: [{ ...first, source: first.source.slice(m[0].length) }, ...pages.slice(1)] };
}

export interface ExportOptions {
  title: string;
  /** The title is the file name (not typed by the user). */
  titleFromFileName?: boolean;
  lang: string;
  pageMarkers: boolean;
  /** 'classic' (one column, the default) or 'cards' (3.2: each page on its own card). */
  look?: ExportLook;
  /** File name of the original notes, linked from the top of the document (3.2). */
  sourceFile?: string;
}

const CSS = `
:root{--fg:#1b1b1b;--muted:#555;--accent:#0b4f8a;--rule:#d0d0d0;--bg:#fff}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:1.125rem/1.65 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:48rem;margin:0 auto;padding:2rem 1.25rem 4rem}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:2rem 0 .75rem}
h1{font-size:2rem;margin-top:0}
p,ul,ol,blockquote,.math-display,.table-wrap{margin:0 0 1rem}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.skip-link{position:absolute;left:-999px;top:0;background:var(--fg);color:#fff;padding:.5rem 1rem;z-index:10}
.skip-link:focus{left:.5rem;top:.5rem}
.math-display{overflow-x:auto;overflow-y:hidden;padding:.25rem 0}
mjx-container[display="true"]{overflow-x:auto;overflow-y:hidden;max-width:100%}
blockquote{border-left:4px solid var(--rule);padding-left:1rem;color:var(--muted)}
hr{border:0;border-top:1px solid var(--rule);margin:2rem 0}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse}
th,td{border:1px solid var(--rule);padding:.35rem .6rem;text-align:left}
th{background:#f3f3f3}
.page-break{display:flex;align-items:center;gap:.75rem;color:var(--muted);font-size:.9rem;margin:2.5rem 0 1.5rem}
.page-break::before,.page-break::after{content:"";flex:1;border-top:1px dashed var(--rule)}
${FIGURE_CSS}
@media print{.skip-link,.page-break{display:none}main{max-width:none;padding:0}figure.fig{break-inside:avoid}}
`;

export function buildDocument(inputPages: Page[], opts: ExportOptions): string {
  if (opts.look === 'cards') return buildCardsDocument(inputPages, opts);
  const resolved = resolveTitle(inputPages, opts.title, opts.titleFromFileName);
  const pages = resolved.pages;
  const ctx: RenderContext = { lastHeading: 1 };
  const body = pages
    .map((p, i) => {
      const marker =
        opts.pageMarkers && pages.length > 1
          ? `<div class="page-break" role="doc-pagebreak" id="page-${i + 1}" aria-label="Page ${i + 1}"><span aria-hidden="true">Page ${i + 1}</span></div>\n`
          : '';
      return marker + pageHtml(p, i + 1, ctx);
    })
    .join('\n');

  // Title may contain inline math, e.g. "# The $\epsilon$-$\delta$ definition".
  const titleHtml = markdownToHtml(`# ${resolved.title.trim() || 'Notes'}`, { figure: () => '' }).replace(
    /^<h2>|<\/h2>$/g,
    '',
  );
  const title = escapeHtml((resolved.title.trim() || 'Notes').replace(/\$/g, ''));
  return `<!DOCTYPE html>
<html lang="${escapeHtml(opts.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Ink2Web Lite">
<title>${title}</title>
<script>
window.MathJax = {
  loader: { load: ['[tex]/mathtools'] },
  tex: { packages: { '[+]': ['mathtools'] }, inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] },
  options: { menuOptions: { settings: { assistiveMml: true } } }
};
</script>
<script defer id="MathJax-script" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<style>${CSS}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<main id="main">
<h1>${titleHtml}</h1>
${body}
</main>
</body>
</html>
`;
}

/** A safe file name from the document title: "Lecture 3: Springs" -> "lecture-3-springs". */
export function fileSlug(title: string): string {
  return (title.trim() || 'notes').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'notes';
}

export function downloadHtml(html: string, title: string) {
  const name = fileSlug(title);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.html` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------------------------
 * The "cards" look (3.2): each page of the notes on its own card, a page badge, a
 * figure caption with a collapsible detailed description, focusable equations, and
 * print styles that put each page of the notes on its own letter-size sheet.
 * ------------------------------------------------------------------------------- */

const CARDS_CSS = `
:root{--bg:#f1f5f9;--card:#fff;--ink:#0f172a;--ink-2:#334155;--muted:#475569;--line:#e2e8f0;--line-2:#cbd5e1;--accent:#4338ca;--soft:#f8fafc}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:clamp(1rem,.95rem + .35vw,1.125rem)/1.75 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;padding:clamp(1rem,.75rem + 1.5vw,2.5rem) clamp(.5rem,.25rem + 1vw,1.5rem);-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.skip-link{position:absolute;left:-999px;top:0;background:var(--ink);color:#fff;padding:.5rem 1rem;z-index:10}
.skip-link:focus{left:.5rem;top:.5rem}
.doc-stream{max-width:52rem;margin:0 auto;display:flex;flex-direction:column;gap:2.5rem}
.doc-page{background:var(--card);border:1px solid var(--line);border-radius:clamp(.75rem,.5rem + 1vw,1.25rem);padding:clamp(1.25rem,1rem + 2.5vw,3.25rem);box-shadow:0 4px 20px -2px rgba(0,0,0,.05),0 2px 6px -1px rgba(0,0,0,.03);display:flow-root}
.page-bar{border-bottom:1px solid var(--line);padding-bottom:.75rem;margin-bottom:2rem}
.page-badge{display:inline-block;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--bg);padding:.25rem .65rem;border-radius:9999px;border:1px solid var(--line)}
.doc-header{border-bottom:2px solid var(--line);padding-bottom:1.5rem;margin-bottom:2rem}
.source-link{margin:.75rem 0 0;font-size:.95rem;font-weight:600}
.source-link a{text-underline-offset:3px}
h1,h2,h3,h4,h5,h6{color:#020617;font-weight:800;line-height:1.3;letter-spacing:-.02em;margin:2rem 0 1rem}
h1{font-size:2.25rem;margin:0}
h2{font-size:1.625rem;border-bottom:1px solid var(--line);padding-bottom:.5rem;margin-top:2.5rem}
h3{font-size:1.25rem}
p,ul,ol,blockquote,.table-wrap{margin:1.25rem 0}
li{margin-bottom:.5rem}
.math-display{margin:1.75rem 0;overflow-x:auto;overflow-y:hidden}
mjx-container[display="true"]{max-width:100%;overflow-x:auto;overflow-y:hidden;padding:.5rem;border-radius:.5rem}
mjx-container[display="true"]:focus-visible{background:var(--bg)}
blockquote{border-left:4px solid var(--accent);background:var(--soft);padding:1rem 1.5rem;border-radius:0 .75rem .75rem 0;color:var(--ink)}
hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
.table-wrap{overflow-x:auto;border:1px solid var(--line-2);border-radius:.75rem}
table{width:100%;border-collapse:collapse}
th,td{padding:.6rem .9rem;border-bottom:1px solid var(--line);text-align:left}
th{background:var(--soft)}
${FIGURE_CSS}
figure.fig{border:1px solid var(--line);border-radius:1rem;overflow:hidden;background:#fff;margin:2rem auto}
figure.fig img,figure.fig svg.redraw{border:0;border-radius:0}
figure.fig figcaption{margin:0;padding:.875rem 1.25rem;background:var(--soft);border-top:1px solid var(--line);color:var(--ink-2);font-size:.9rem}
figure.fig .fig-title{font-weight:700;color:var(--ink)}
figure.fig .fig-label{color:var(--muted);font-weight:600;margin-right:.25rem}
figure.fig details.fig-desc summary{color:var(--accent);font-size:.85rem}
figure.fig .fig-desc-body{background:#fff;border:1px solid var(--line);border-radius:.5rem;padding:.75rem 1rem;color:var(--ink)}
figure.fig.wrap.align-left{margin:.25rem 1.5rem 1rem 0}
figure.fig.wrap.align-right{margin:.25rem 0 1rem 1.5rem}
.fig-row figure.fig{margin:0 0 .5rem}
@media (max-width:40rem){.doc-stream{gap:1.5rem}.page-bar{margin-bottom:1.25rem}.doc-header{margin-bottom:1.5rem;padding-bottom:1rem}}
@media print{
@page{size:letter portrait;margin:1.5cm 1.5cm 2cm}
html,body{background:#fff!important;padding:0!important;font-size:10.5pt;line-height:1.5}
.skip-link,.no-print{display:none!important}
.doc-stream{display:block;max-width:none}
.doc-page{border:0;box-shadow:none;border-radius:0;padding:0;break-after:page}
.doc-page:last-child{break-after:auto}
.page-badge{border:0;background:none;padding:0}
h1,h2,h3,h4{break-after:avoid}
h1{font-size:18pt}h2{font-size:13.5pt}h3{font-size:11.5pt}
figure.fig,table,blockquote,.math-display{break-inside:avoid}
figure.fig figcaption{background:#fff}
details.fig-desc summary{display:none}
}
`;

/** The display name of a source file for the link at the top (just the file name). */
const sourceName = (f: string) => f.split(/[\\/]/).pop() ?? f;

export function buildCardsDocument(inputPages: Page[], opts: ExportOptions): string {
  const resolved = resolveTitle(inputPages, opts.title, opts.titleFromFileName);
  const pages = resolved.pages;
  const ctx: RenderContext = { lastHeading: 1 };
  const titleText = resolved.title.trim() || 'Notes';
  const titleHtml = markdownToHtml(`# ${titleText}`, { figure: () => '' }).replace(/^<h2>|<\/h2>$/g, '');
  const title = escapeHtml(titleText.replace(/\$/g, ''));
  const file = opts.sourceFile?.trim();
  const link = file
    ? `<p class="source-link no-print"><a href="${escapeHtml(encodeURI(sourceName(file)))}" target="_blank" rel="noopener">Open the original notes (${escapeHtml(sourceName(file))})<span class="sr-only"> (opens in a new tab)</span></a></p>`
    : '';
  const n = pages.length;
  const body = pages
    .map((p, i) => {
      const badge = opts.pageMarkers ? `<div class="page-bar" aria-hidden="true"><span class="page-badge">Page ${i + 1} of ${n}</span></div>\n` : '';
      const header = i === 0 ? `<header class="doc-header"><h1>${titleHtml}</h1>${link}</header>\n` : '';
      return `<section class="doc-page" id="page-${i + 1}" aria-label="Page ${i + 1} of ${n}">\n${badge}${header}${pageHtml(p, i + 1, ctx, 'cards')}\n</section>`;
    })
    .join('\n');
  const meta = { '@context': 'https://schema.org', '@type': 'LearningResource', name: titleText.replace(/\$/g, ''), inLanguage: opts.lang || 'en' };
  return `<!DOCTYPE html>
<html lang="${escapeHtml(opts.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Ink2Web Lite">
<meta name="description" content="${title}: accessible notes with math and figure descriptions">
<title>${title}</title>
<script type="application/ld+json">${JSON.stringify(meta).replace(/</g, '\\u003c')}</script>
<script>
window.MathJax = {
  loader: { load: ['[tex]/mathtools'] },
  tex: { packages: { '[+]': ['mathtools'] }, inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] },
  options: { menuOptions: { settings: { assistiveMml: true } } },
  startup: {
    pageReady: function () {
      return MathJax.startup.defaultPageReady().then(function () {
        // Equations on their own line can be reached with Tab and scrolled when wide.
        document.querySelectorAll('mjx-container[display="true"]').forEach(function (el) {
          el.setAttribute('tabindex', '0');
        });
      });
    }
  }
};
// Printing shows every detailed description.
addEventListener('beforeprint', function () {
  document.querySelectorAll('details.fig-desc:not([open])').forEach(function (d) { d.setAttribute('open', ''); d.dataset.printOpened = '1'; });
});
addEventListener('afterprint', function () {
  document.querySelectorAll('details[data-print-opened]').forEach(function (d) { d.removeAttribute('open'); delete d.dataset.printOpened; });
});
</script>
<script defer id="MathJax-script" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<style>${CARDS_CSS}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<main id="main" class="doc-stream">
${body}
</main>
</body>
</html>
`;
}
