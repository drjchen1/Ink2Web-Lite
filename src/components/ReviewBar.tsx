import type { FigureShow } from '../types.ts';
import type { ReviewItem } from '../lib/editing.ts';

interface Props {
  items: ReviewItem[];
  index: number;
  onIndex: (next: number) => void;
  onOpen: (item: ReviewItem) => void;
  onResolveRedraw?: (item: ReviewItem, action: 'ok' | FigureShow) => void;
}

/**
 * Guided "Inbox-Zero" Review Queue bar shown across converted pages when anything
 * needs a quick human check (illegible spots, LaTeX warnings, crops, or redraws).
 */
export function ReviewBar({ items, index, onIndex, onOpen, onResolveRedraw }: Props) {
  if (!items.length) return null;
  const i = Math.max(0, Math.min(items.length - 1, index));
  const cur = items[i];
  const canStep = items.length > 1;

  return (
    <div className="review-bar" role="region" aria-label="Review queue">
      <span className="review-count">
        {items.length} item{items.length === 1 ? '' : 's'} to check
      </span>
      <span className="review-pos" aria-hidden="true">
        ({i + 1}/{items.length})
      </span>
      <button type="button" className="link review-msg" onClick={() => onOpen(cur)}>
        <strong>Page {cur.pageNo}:</strong> {cur.text}
      </button>
      <div className="actions review-actions">
        {cur.kind === 'redraw-check' && cur.figure !== undefined && onResolveRedraw && (
          <>
            <button type="button" className="chip" onClick={() => onResolveRedraw(cur, 'ok')}>
              Looks right
            </button>
            <button type="button" className="chip" onClick={() => onResolveRedraw(cur, 'image')}>
              Keep image
            </button>
            <button type="button" className="chip" onClick={() => onResolveRedraw(cur, 'both')}>
              Show both
            </button>
          </>
        )}
        <button type="button" onClick={() => onOpen(cur)}>
          Open
        </button>
        <button
          type="button"
          disabled={!canStep}
          onClick={() => onIndex((i - 1 + items.length) % items.length)}
          title="Previous flagged item (Alt+[)"
          aria-label="Previous flagged item"
        >
          ←
        </button>
        <button
          type="button"
          disabled={!canStep}
          onClick={() => onIndex((i + 1) % items.length)}
          title="Next flagged item (Alt+])"
          aria-label="Next flagged item"
        >
          →
        </button>
      </div>
    </div>
  );
}
