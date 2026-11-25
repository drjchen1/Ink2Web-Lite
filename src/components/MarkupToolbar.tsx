import type { RefObject } from 'react';
import { applyEdit, applyMark, type Mark } from '../lib/editing.ts';

interface Props {
  /** The textarea the marks apply to. */
  target: RefObject<HTMLTextAreaElement | null>;
  /** Fallback when the browser can't insert text natively (receives the whole new value). */
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Markup for page 2". */
  label: string;
}

const BUTTONS: { mark: Mark; text: string; title: string }[] = [
  { mark: 'math', text: '$x$', title: 'Inline math (⌘/Ctrl+M): wrap the selection in $…$' },
  { mark: 'display', text: '$$', title: 'Equation on its own line (⌘/Ctrl+Shift+M): $$…$$' },
  { mark: 'note', text: 'Note', title: 'Arrow or brace note: select the term first, then type what the note says' },
  { mark: 'box', text: 'Box', title: 'Box around a formula or result (⌘/Ctrl+B)' },
  { mark: 'callout', text: 'Callout', title: 'Highlighted callout card ([[box: Title]]…[[/box]])' },
  { mark: 'columns', text: 'Columns', title: 'Two side-by-side columns ([[columns]]…[[next]]…[[/columns]])' },
  { mark: 'vdots', text: '⋮', title: 'Skipped steps (vertical dots) on the next line' },
  { mark: 'underline', text: 'U', title: 'Underline (⌘/Ctrl+U)' },
  { mark: 'heading', text: 'H', title: 'Heading (toggle)' },
];

const COLORS = ['red', 'green', 'blue', 'orange', 'purple'];

/** Applies `mark` to `ta` via execCommand so native Undo keeps working. */
export function applyMarkToTextarea(ta: HTMLTextAreaElement, mark: Mark, onChange: (value: string) => void) {
  const ed = applyMark(ta.value, ta.selectionStart, ta.selectionEnd, mark);
  ta.focus();
  ta.setSelectionRange(ed.from, ed.to);
  let ok = false;
  try {
    ok = ed.insert ? document.execCommand('insertText', false, ed.insert) : document.execCommand('delete');
  } catch {
    ok = false;
  }
  if (!ok) onChange(applyEdit(ta.value, ed));
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(ed.selStart, ed.selEnd);
  });
}

/**
 * Buttons that insert Ink2Web's markup around the selection. Edits go through the
 * browser's own text insertion where possible, so ⌘Z / Ctrl+Z still undoes them.
 */
export function MarkupToolbar({ target, onChange, label }: Props) {
  const apply = (mark: Mark) => {
    if (target.current) applyMarkToTextarea(target.current, mark, onChange);
  };

  return (
    <div className="markup" role="toolbar" aria-label={label}>
      {BUTTONS.map((b) => (
        <button
          key={b.mark}
          type="button"
          title={b.title}
          aria-label={b.title}
          className={`mk mk-${b.mark}`}
          // Keep focus (and the selection) in the textarea when clicking.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(b.mark)}
        >
          {b.text}
        </button>
      ))}
      <label className="mk-color">
        <span className="sr-only">Color</span>
        <select
          value=""
          title="Text in a different ink color"
          onChange={(e) => {
            if (e.target.value) apply(`color:${e.target.value}`);
          }}
        >
          <option value="">Color…</option>
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
