import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { typeset } from '../lib/mathjax.ts';

interface Props {
  html: string;
  label: string;
  /** Called with a block's index when the user clicks it or presses Enter on it. */
  onBlock?: (index: number) => void;
}

/** Renders generated HTML and typesets it. Reports MathJax parse errors. */
export function Preview({ html, label, onBlock }: Props) {
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

  const blockOf = (t: EventTarget) => {
    const b = (t as HTMLElement).closest?.<HTMLElement>('[data-b]');
    return b && ref.current?.contains(b) ? Number(b.dataset.b) : null;
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onBlock) return;
    // Selecting text to copy it shouldn't open the editor.
    if (window.getSelection()?.toString()) return;
    const i = blockOf(e.target);
    if (i !== null) onBlock(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onBlock || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (!(e.target as HTMLElement).matches('[data-b]')) return;
    e.preventDefault();
    const i = blockOf(e.target);
    if (i !== null) onBlock(i);
  };

  return (
    <div>
      {errors > 0 && (
        <p className="warn" role="status">
          {errors} math expression{errors > 1 ? 's' : ''} failed to render (shown in red).{' '}
          {onBlock ? 'Click it to fix the LaTeX.' : 'Fix the LaTeX in the source.'}
        </p>
      )}
      <div
        ref={ref}
        className={`doc${onBlock ? ' editable' : ''}`}
        aria-label={label}
        role="region"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
