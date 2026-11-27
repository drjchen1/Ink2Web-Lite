import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Figure } from '../types.ts';
import { markdownToHtml } from '../lib/markdown.ts';
import { shortcutMark, splitTextAtCursor } from '../lib/editing.ts';
import { figureHtml, type ExportLook } from '../lib/exportHtml.ts';
import { MarkupToolbar, applyMarkToTextarea } from './MarkupToolbar.tsx';
import { Preview } from './Preview.tsx';

interface Props {
  text: string;
  onText: (text: string) => void;
  onDone: () => void;
  onCancel: () => void;
  onSplit?: (left: string, right: string) => void;
  onMergeNext?: () => void;
  figures: Figure[];
  pageNo: number;
  look?: ExportLook;
}

/**
 * Edits one block of the page in place: its source, the markup toolbar, and a live
 * preview of just that block. ⌘/Ctrl+Enter finishes, Esc cancels.
 */
export function BlockEditor({ text, onText, onDone, onCancel, onSplit, onMergeNext, figures, pageNo, look = 'classic' }: Props) {
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
    () =>
      markdownToHtml(shown, {
        figure: (id) => figureHtml(figures.find((f) => f.id === id), pageNo, false, look),
        noteStyle: look === 'cards' ? 'list' : 'prose',
        notebox: look === 'cards',
      }),
    [shown, figures, pageNo, look],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onDone();
      return;
    }
    const mk = shortcutMark(e);
    if (mk && ref.current) {
      e.preventDefault();
      applyMarkToTextarea(ref.current, mk, onText);
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
        {onSplit && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const ta = ref.current;
              const parts = splitTextAtCursor(text, ta ? ta.selectionStart : Math.floor(text.length / 2));
              if (parts) onSplit(parts[0], parts[1]);
            }}
            title="Split this block into two separate blocks at the cursor"
          >
            Split at cursor
          </button>
        )}
        {onMergeNext && (
          <button type="button" onClick={onMergeNext} title="Join this block with the next text block">
            Merge next
          </button>
        )}
        <span id={`${id}-keys`} className="hint">
          ⌘/Ctrl+Enter done · ⌘/Ctrl+M/$ math · ⌘/Ctrl+B box · ⌘/Ctrl+U underline · Esc cancel
        </span>
      </div>
      <Preview html={html} label={`Preview of the part being edited on page ${pageNo}`} />
    </div>
  );
}
