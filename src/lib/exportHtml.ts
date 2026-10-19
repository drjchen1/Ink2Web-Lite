import type { Figure, Page } from '../types.ts';
import { CLEAR_MARK, INK_COLORS, escapeHtml, markdownToHtml, type RenderContext } from './markdown.ts';
import { MARKER_LINE, sourceUnits } from './transcript.ts';

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
strong.ul{font-weight:600;text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.2em}
`;

export function figureHtml(fig: Figure | undefined, pageNo: number): string {
  if (!fig) return '';
  const alt = escapeHtml(polishAlt(fig.alt));
  const caption = fig.caption.trim() ? `<figcaption>${escapeHtml(fig.caption.trim())}</figcaption>` : '';
  const align = fig.align ?? 'center';
  const wrap = fig.wrap && align !== 'center' ? ' wrap' : '';
  const width = Math.min(100, Math.max(15, Math.round(fig.width ?? 100)));
  return `<figure id="fig-${pageNo}-${fig.id}" class="fig align-${align}${wrap}" style="--w:${width}%"><img src="${fig.src}" alt="${alt}">${caption}</figure>`;
}

/**
 * For each wrapped figure, ends the wrap after its "beside" lines: text after
 * that point starts below the figure, as in the notes.
 */
export function withWrapEnds(source: string, figures: Figure[]): string {
  const lines = source.split('\n');
  const units = sourceUnits(source);
  const clearAfter = new Set<number>(); // line index after which to clear
  units.forEach((u, i) => {
    const m = u.start === u.end ? lines[u.start].match(MARKER_LINE) : null;
    const f = m ? figures.find((x) => x.id === Number(m[1])) : undefined;
    if (!f || !f.wrap || f.align === 'center' || !(f.besideLines > 0)) return;
    let n = 0;
    for (let j = i + 1; j < units.length; j++) {
      if (lines[units[j].start].match(MARKER_LINE)) break;
      if (++n === f.besideLines) {
        clearAfter.add(units[j].end);
        return;
      }
    }
  });
  if (!clearAfter.size) return source;
  return lines.flatMap((l, i) => (clearAfter.has(i) ? [l, '', CLEAR_MARK, ''] : [l])).join('\n');
}

export function pageHtml(page: Page, pageNo: number, ctx?: RenderContext): string {
  const html = markdownToHtml(withWrapEnds(page.source, page.figures), {
    ctx,
    figure: (id) => figureHtml(page.figures.find((f) => f.id === id), pageNo),
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

export function downloadHtml(html: string, title: string) {
  const name = (title.trim() || 'notes').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'notes';
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.html` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
