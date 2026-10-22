import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Figure } from '../types.ts';
import { markdownToHtml } from '../lib/markdown.ts';
import { figureHtml } from '../lib/exportHtml.ts';
import { MarkupToolbar } from './MarkupToolbar.tsx';
import { Preview } from './Preview.tsx';

interface Props {
  text: string;
  onText: (text: string) => void;
  onDone: () => void;
  onCancel: () => void;
  figures: Figure[];
  pageNo: number;
}

/**
 * Edits one block of the page in place: its source, the markup toolbar, and a live
 * preview of just that block. ⌘/Ctrl+Enter finishes, Esc cancels.
 */
export function BlockEditor({ text, onText, onDone, onCancel, figures, pageNo }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [shown, setShown] = useState(text);

  // Live preview, lightly debounced so MathJax isn't re-run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setShown(text), 150);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);

  const html = useMemo(
    () => markdownToHtml(shown, { figure: (id) => figureHtml(figures.find((f) => f.id === id), pageNo) }),
    [shown, figures, pageNo],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onDone();
    }
  };

  const rows = Math.min(16, Math.max(3, text.split('\n').length + 1));
  const id = `blk-edit-${pageNo}`;

  return (
    <div className="block-editor" role="group" aria-labelledby={`${id}-label`}>
      <label id={`${id}-label`} htmlFor={id} className="block-editor-label">
        Editing this part of page {pageNo}
      </label>
      <MarkupToolbar target={ref} onChange={onText} label={`Markup for this part of page ${pageNo}`} />
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        value={text}
        spellCheck={false}
        aria-describedby={`${id}-keys`}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="block-editor-actions">
        <button type="button" className="primary" onClick={onDone}>
          Done
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <span id={`${id}-keys`} className="hint">
          ⌘/Ctrl+Enter to finish · Esc to cancel · Leave it empty to delete this part
        </span>
      </div>
      <Preview html={html} label={`Preview of the part being edited on page ${pageNo}`} />
    </div>
  );
}
