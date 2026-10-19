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
