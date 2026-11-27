/**
 * Loads MathJax for the in-app preview from the local npm package (works offline).
 * SVG output is used because it is a single self-contained file (no font assets).
 * Exported documents use the CDN CHTML build instead (see exportHtml.ts).
 *
 * The mathtools extension (for \mathclap under arrow and brace notes) is loaded from
 * next to the MathJax file: in dev, Vite serves it from node_modules; in a build,
 * vite.config.ts copies it to assets/input/tex/extensions/.
 */
import mathjaxUrl from 'mathjax/es5/tex-svg.js?url';
import { finalizeOfflineHtml } from './exportHtml.ts';

interface MathJaxApi {
  typesetPromise: (els?: Element[]) => Promise<void>;
  typesetClear: (els?: Element[]) => void;
  startup: { promise: Promise<void> };
}

declare global {
  interface Window {
    MathJax?: MathJaxApi | Record<string, unknown>;
  }
}

let loading: Promise<MathJaxApi> | null = null;

function load(): Promise<MathJaxApi> {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      window.MathJax = {
        loader: { load: ['[tex]/mathtools'] },
        tex: {
          packages: { '[+]': ['mathtools'] },
          inlineMath: [['\\(', '\\)']],
          displayMath: [['\\[', '\\]']],
        },
        options: { menuOptions: { settings: { assistiveMml: true } } },
        svg: { fontCache: 'global' },
        startup: { typeset: false },
      };
      const s = document.createElement('script');
      s.src = mathjaxUrl;
      s.async = true;
      s.onload = () => {
        const mj = window.MathJax as MathJaxApi;
        mj.startup.promise.then(() => resolve(mj), reject);
      };
      s.onerror = () => reject(new Error('MathJax failed to load.'));
      document.head.appendChild(s);
    });
  }
  return loading;
}

// MathJax typesetting must not overlap; chain calls.
let queue: Promise<unknown> = Promise.resolve();

/** Typesets an element; resolves with the number of math errors found. */
export function typeset(el: HTMLElement): Promise<number> {
  const job = queue.then(async () => {
    const mj = await load();
    if (!el.isConnected) return 0;
    mj.typesetClear([el]);
    await mj.typesetPromise([el]);
    return el.querySelectorAll('[data-mml-node="merror"]').length;
  });
  queue = job.catch(() => undefined);
  return job;
}

/**
 * Pre-renders every equation in an exported HTML document using the local MathJax
 * SVG build (with assistive MathML intact), returning a standalone offline file.
 */
export async function prerenderOfflineHtml(docHtml: string): Promise<string> {
  const m = docHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!m) return docHtml;
  const host = document.createElement('div');
  host.setAttribute('style', 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none');
  host.innerHTML = m[1];
  document.body.appendChild(host);
  try {
    await typeset(host);
    host.querySelectorAll('mjx-container[display="true"]').forEach((el) => {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Mathematical equation');
    });
    const mjxCss = document.getElementById('MJX-SVG-styles')?.textContent ?? '';
    const cacheSvg = document.getElementById('MJX-SVG-global-cache')?.outerHTML ?? '';
    return finalizeOfflineHtml(docHtml, host.innerHTML, mjxCss, cacheSvg);
  } finally {
    host.remove();
  }
}
