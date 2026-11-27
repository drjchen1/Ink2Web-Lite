import { finalizeOfflineHtml } from '../src/lib/exportHtml.ts';

/**
 * Node MathJax 3 SVG + assistive MathML pre-renderer for `cli/convert.ts --offline`.
 * Produces self-contained HTML identical in structure to the browser pre-renderer
 * in `src/lib/mathjax.ts` with zero DOM dependencies.
 */

interface LiteAdaptor {
  body: (doc: unknown) => unknown;
  tags: (node: unknown, name: string) => unknown[];
  getAttribute: (node: unknown, name: string) => string;
  setAttribute: (node: unknown, name: string, value: string) => void;
  innerHTML: (node: unknown) => string;
  outerHTML: (node: unknown) => string;
  textContent: (node: unknown) => string;
}

interface MathJaxNode {
  svgStylesheet: () => unknown;
  startup: {
    adaptor: LiteAdaptor;
    getDocument: (html: string) => { render: () => void; document: unknown };
  };
}

let mjPromise: Promise<MathJaxNode> | null = null;

function getMathJax(): Promise<MathJaxNode> {
  if (!mjPromise) {
    mjPromise = (import('mathjax') as Promise<{ default: { init: (cfg: Record<string, unknown>) => Promise<MathJaxNode> } }>).then(
      (m) =>
        m.default.init({
          loader: { load: ['input/tex', 'output/svg', '[tex]/mathtools', 'a11y/assistive-mml'] },
          tex: { packages: { '[+]': ['mathtools'] }, inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']] },
          svg: { fontCache: 'global' },
          startup: { typeset: false },
        }),
    );
  }
  return mjPromise;
}

/** Pre-renders equations in an exported Ink2Web HTML string into inline SVG + assistive MathML. */
export async function prerenderOfflineHtmlNode(docHtml: string): Promise<string> {
  const m = docHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!m) return docHtml;
  const MathJax = await getMathJax();
  const adaptor = MathJax.startup.adaptor;
  const htmlDoc = MathJax.startup.getDocument(
    `<!DOCTYPE html><html><head></head><body><main>${m[1]}</main></body></html>`,
  );
  htmlDoc.render();
  const bodyEl = adaptor.body(htmlDoc.document);
  for (const el of adaptor.tags(bodyEl, 'mjx-container')) {
    if (adaptor.getAttribute(el, 'display') === 'true') {
      adaptor.setAttribute(el, 'tabindex', '0');
      adaptor.setAttribute(el, 'role', 'group');
      adaptor.setAttribute(el, 'aria-label', 'Mathematical equation');
    }
  }
  const mainEl = adaptor.tags(bodyEl, 'main')[0];
  const renderedMain = mainEl ? adaptor.innerHTML(mainEl) : m[1];
  const cacheEl = adaptor.tags(bodyEl, 'svg').find((el) => adaptor.getAttribute(el, 'id') === 'MJX-SVG-global-cache');
  const cacheSvg = cacheEl ? adaptor.outerHTML(cacheEl) : '';
  const mjxCss = adaptor.textContent(MathJax.svgStylesheet()) ?? '';
  return finalizeOfflineHtml(docHtml, renderedMain, mjxCss, cacheSvg);
}
