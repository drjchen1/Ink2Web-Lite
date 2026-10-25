import type { Page } from '../types.ts';
import { pageIssues } from '../lib/editing.ts';

interface Props {
  pages: Page[];
  /** The title will be replaced by the first heading in the notes (it's the file name). */
  titleFromHeading: boolean;
  pageMarkers: boolean;
  onPageMarkers: (on: boolean) => void;
  onDownload: () => void;
  /** Close the dialog and show this page (and figure). */
  onGoTo: (pageId: string, figure?: number) => void;
}

/** The export step (2.1): a checklist of what still needs a look, then Download. */
export function ExportPanel({ pages, titleFromHeading, pageMarkers, onPageMarkers, onDownload, onGoTo }: Props) {
  const done = pages.filter((p) => p.status === 'done');
  const notDone = pages.length - done.length;
  const items = done.flatMap((p) => pageIssues(p).map((issue) => ({ page: p, n: pages.indexOf(p) + 1, issue })));
  const missingAlt = items.filter((i) => i.issue.kind === 'alt-missing').length;

  return (
    <div className="export">
      <p>
        {done.length
          ? `Exports ${done.length} converted page${done.length > 1 ? 's' : ''} as one HTML file.`
          : 'No page is converted yet, so there is nothing to export.'}
        {notDone > 0 && ` ${notDone} page${notDone > 1 ? 's' : ''} not converted will be left out.`}
      </p>
      <p className="hint">
        {titleFromHeading
          ? 'The title is still the file name, so the first heading in your notes becomes the document title. Type a title at the top to use your own.'
          : 'The title at the top becomes the document title and its main heading.'}
      </p>

      <h3>Before you export</h3>
      {items.length ? (
        <ul className="checklist">
          {items.map(({ page, n, issue }, k) => (
            <li key={k}>
              <button type="button" className="link" onClick={() => onGoTo(page.id, issue.figure)}>
                Page {n}
              </button>
              :{' '}
              {issue.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ok-text">{done.length ? 'Nothing flagged. Still worth a final read against the originals.' : '—'}</p>
      )}
      {missingAlt > 0 && (
        <p className="warn">
          {missingAlt} figure{missingAlt > 1 ? 's have' : ' has'} no alt text. Screen-reader users will only hear “Hand-drawn figure.”
        </p>
      )}

      <div className="checks">
        <label>
          <input type="checkbox" checked={pageMarkers} onChange={(e) => onPageMarkers(e.target.checked)} /> Mark page boundaries
        </label>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={onDownload} disabled={!done.length}>
          Download HTML
        </button>
      </div>
    </div>
  );
}
