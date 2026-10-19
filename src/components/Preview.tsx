import { useEffect, useRef, useState } from 'react';
import { typeset } from '../lib/mathjax.ts';

interface Props {
  html: string;
  label: string;
}

/** Renders generated HTML and typesets it. Reports MathJax parse errors. */
export function Preview({ html, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Set innerHTML directly: MathJax rewrites this subtree, so React must not reconcile it.
    el.innerHTML = html;
    let live = true;
    typeset(el)
      .then((n) => live && setErrors(n))
      .catch(() => live && setErrors(0));
    return () => {
      live = false;
    };
  }, [html]);

  return (
    <div>
      {errors > 0 && (
        <p className="warn" role="status">
          {errors} math expression{errors > 1 ? 's' : ''} failed to render (shown in red). Fix the LaTeX in “Edit
          source”.
        </p>
      )}
      <div ref={ref} className="doc" aria-label={label} role="region" tabIndex={0} />
    </div>
  );
}
