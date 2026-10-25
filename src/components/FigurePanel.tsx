import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Figure, FigureAlign } from '../types.ts';
import { altTextIssue } from '../lib/editing.ts';
import { figureHtml } from '../lib/exportHtml.ts';
import { Preview } from './Preview.tsx';

interface Props {
  fig: Figure;
  pageId: string;
  pageNo: number;
  /** Unit index of the figure's marker in the text (undefined: not placed). */
  pos: number | undefined;
  unitCount: number;
  /** Put the cursor in the alt text when the panel opens (opened from the document). */
  focusAlt: boolean;
  onPatch: (patch: Partial<Figure>) => void;
  onMove: (dir: -1 | 1) => void;
  onSnap: () => void;
  onInsert: () => void;
  onDelete: () => void;
  /** Moves the selected part of the alt text (all of it with no selection) into the notes. */
  onMoveToNotes: (ta: HTMLTextAreaElement | null) => void;
  onClose: () => void;
}

const ALIGNS: { value: FigureAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

/**
 * Everything about one figure (2.1): alt text, caption, layout, crop. Opens in place
 * of the figure in the document, like the block editor does for text.
 */
export function FigurePanel(props: Props) {
  const { fig: f, pageId, pageNo, pos, unitCount, focusAlt, onPatch, onMove, onSnap, onInsert, onDelete, onMoveToNotes, onClose } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const altRef = useRef<HTMLTextAreaElement>(null);
  const pid = `${pageId}-${f.id}`;
  const canWrap = f.align !== 'center';
  const altIssue = altTextIssue(f.alt);

  // Opened from the page image or the figure list, the panel may be off screen.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'nearest' });
    if (focusAlt) altRef.current?.focus();
    // Only when a different figure opens.
  }, [f.id]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div ref={rootRef} className="fig-panel" role="group" aria-labelledby={`fp-h-${pid}`} onKeyDown={onKeyDown}>
      <div className="fig-panel-head">
        <h3 id={`fp-h-${pid}`}>Figure {f.id}</h3>
        {f.autoDetected && <span className="badge queued">Found by detector</span>}
        {f.needsReview && <span className="badge error">Check crop</span>}
        {altIssue && <span className="badge error">Check alt text</span>}
        {pos === undefined && <span className="badge queued">Not placed in text</span>}
        <button type="button" className="primary push" onClick={onClose}>
          Done
        </button>
      </div>

      <div className="fig-panel-body">
        <div className="fig-fields">
          <label htmlFor={`alt-${pid}`}>Alt text (describe what the figure shows)</label>
          <textarea
            ref={altRef}
            id={`alt-${pid}`}
            rows={3}
            value={f.alt}
            aria-invalid={!f.alt.trim()}
            aria-describedby={altIssue ? `altissue-${pid}` : undefined}
            onChange={(e) => onPatch({ alt: e.target.value })}
          />
          {altIssue && (
            <p id={`altissue-${pid}`} className="warn alt-issue">
              This alt text may include writing from next to the drawing. {altIssue} Select that part and click{' '}
              <strong>Move to notes</strong>.
            </p>
          )}
          <div className="actions alt-actions">
            <button
              type="button"
              // Keep the selection in the alt text box when clicking.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onMoveToNotes(altRef.current)}
              disabled={!f.alt.trim()}
              title="Move the selected alt text (or all of it, if nothing is selected) into the notes after this figure"
            >
              Move to notes
            </button>
          </div>
          <label htmlFor={`cap-${pid}`}>Caption (optional, visible)</label>
          <input id={`cap-${pid}`} value={f.caption} onChange={(e) => onPatch({ caption: e.target.value })} />
        </div>

        <fieldset className="fig-layout">
          <legend>Layout in the document</legend>
          <div className="layout-row">
            <span className="layout-label" id={`pos-${pid}`}>
              Position
            </span>
            {pos === undefined ? (
              <button type="button" onClick={onInsert}>
                Insert in text
              </button>
            ) : (
              <div className="actions" role="group" aria-labelledby={`pos-${pid}`}>
                <button type="button" disabled={pos === 0} onClick={() => onMove(-1)} aria-label={`Move figure ${f.id} up one line in the text`}>
                  ↑ Up
                </button>
                <button
                  type="button"
                  disabled={pos >= unitCount - 1}
                  onClick={() => onMove(1)}
                  aria-label={`Move figure ${f.id} down one line in the text`}
                >
                  ↓ Down
                </button>
              </div>
            )}
          </div>
          <div className="layout-row">
            <span className="layout-label" id={`al-${pid}`}>
              Align
            </span>
            <div className="seg" role="group" aria-labelledby={`al-${pid}`}>
              {ALIGNS.map((a) => (
                <button key={a.value} type="button" aria-pressed={f.align === a.value} onClick={() => onPatch({ align: a.value })}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="layout-row">
            <label className="layout-label" htmlFor={`w-${pid}`}>
              Width
            </label>
            <input
              id={`w-${pid}`}
              type="range"
              min={20}
              max={100}
              step={5}
              value={f.width}
              aria-valuetext={`${f.width}% of the text width`}
              onChange={(e) => onPatch({ width: Number(e.target.value) })}
            />
            <output htmlFor={`w-${pid}`}>{f.width}%</output>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={f.wrap && canWrap}
              disabled={!canWrap}
              onChange={(e) => onPatch({ wrap: e.target.checked, besideLines: Math.max(1, f.besideLines || 1) })}
            />{' '}
            Put text beside the figure
            {!canWrap && <span className="hint"> (choose Left or Right first)</span>}
          </label>
          {f.wrap && canWrap && (
            <div className="layout-row">
              <label className="layout-label" htmlFor={`bl-${pid}`}>
                Lines beside it
              </label>
              <input
                id={`bl-${pid}`}
                className="narrow"
                type="number"
                min={1}
                max={50}
                value={f.besideLines || 1}
                aria-describedby={`blh-${pid}`}
                onChange={(e) => onPatch({ besideLines: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
              />
              <span className="hint" id={`blh-${pid}`}>
                Text after these lines starts below the figure.
              </span>
            </div>
          )}
        </fieldset>
      </div>

      <p className="hint">
        <strong>Crop:</strong> on the original page, drag the blue box, drag a corner, or draw a new box. With the
        keyboard, Tab to the box: arrow keys move it, Shift+arrows resize it.
      </p>
      <div className="actions">
        <button type="button" onClick={onSnap}>
          Snap crop to ink
        </button>
        <button type="button" className="danger-outline" onClick={onDelete}>
          Delete figure
        </button>
      </div>

      <div className="fig-panel-preview">
        <p className="hint">In the document:</p>
        <Preview html={figureHtml(f, pageNo)} label={`Figure ${f.id} as it appears in the document`} />
      </div>
    </div>
  );
}
