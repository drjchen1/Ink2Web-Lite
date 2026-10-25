import { memo, useEffect, useState } from 'react';
import type { Page } from '../types.ts';
import { thumbnail } from '../lib/images.ts';
import { pageIssues } from '../lib/editing.ts';
import { STATUS, statusClass } from './PageView.tsx';

interface Props {
  pages: Page[];
  currentId: string | null;
  onSelect: (id: string) => void;
}

function Thumb({ image }: { image: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    thumbnail(image)
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [image]);
  return <div className="thumb">{url ? <img src={url} alt="" /> : null}</div>;
}

/** The pages of the document (2.1): thumbnail, status, and how many things to check. */
export const PageList = memo(function PageList({ pages, currentId, onSelect }: Props) {
  return (
    <ol className="page-list" aria-label="Pages">
      {pages.map((p, i) => {
        const issues = p.status === 'done' ? pageIssues(p).length : 0;
        const current = p.id === currentId;
        const status = STATUS[p.status];
        return (
          <li key={p.id}>
            <button
              type="button"
              className={`page-item${current ? ' current' : ''}`}
              aria-current={current ? 'page' : undefined}
              onClick={() => onSelect(p.id)}
              title={p.label}
              aria-label={`Page ${i + 1}, ${status}${issues ? `, ${issues} to check` : ''}`}
            >
              <Thumb image={p.image} />
              <span className="page-item-text" aria-hidden="true">
                <span className="page-item-no">{i + 1}</span>
                <span className={`dot ${statusClass(p.status)}`} />
                <span className="page-item-status">{status}</span>
                {issues > 0 && <span className="page-item-issues">{issues} to check</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
});
