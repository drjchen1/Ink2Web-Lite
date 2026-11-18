import type { Page } from '../types.ts';
import { pageIssues } from '../lib/editing.ts';
import type { ExportLook } from '../lib/exportHtml.ts';

interface Props {
  pages: Page[];
  /** The title will be replaced by the first heading in the notes (it's the file name). */
  titleFromHeading: boolean;
  pageMarkers: boolean;
  onPageMarkers: (on: boolean) => void;
  /** Classic (one column) or cards (3.2). */
  look: ExportLook;
  onLook: (look: ExportLook) => void;
  /** The original file's name, when it can be linked (a PDF or image), else null. */
  sourceFile: string | null;
  linkSource: boolean;
  onLinkSource: (on: boolean) => void;
  onDownload: () => void;
  /** Close the dialog and show this page (and figure). */
  onGoTo: (pageId: string, figure?: number) => void;
}

/** The export step (2.1): a checklist of what still needs a look, then Download. */
export function ExportPanel(props: Props) {
  const { pages, titleFromHeading, pageMarkers, onPageMarkers, onDownload, onGoTo } = props;
  const { look, onLook, sourceFile, linkSource, onLinkSource } = props;
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

      <h3 id="look-h">Look</h3>
      <div className="seg" role="group" aria-labelledby="look-h">
        <button type="button" aria-pressed={look === 'cards'} onClick={() => onLook('cards')}>
          Page cards
        </button>
        <button type="button" aria-pressed={look === 'classic'} onClick={() => onLook('classic')}>
          Classic
        </button>
      </div>
      <p className="hint">
        {look === 'cards'
          ? 'Each page of your notes on its own card, with a page badge, figure captions, and a “Detailed description” under each figure that has one. Prints one card per letter-size sheet.'
          : 'One continuous column of text, as in earlier versions.'}
      </p>
      <div className="checks">
        <label>
          <input type="checkbox" checked={pageMarkers} onChange={(e) => onPageMarkers(e.target.checked)} />{' '}
          {look === 'cards' ? 'Show page badges (Page 1 of 3)' : 'Mark page boundaries'}
        </label>
        {look === 'cards' && sourceFile && (
          <label>
            <input type="checkbox" checked={linkSource} onChange={(e) => onLinkSource(e.target.checked)} /> Link to the original (
            {sourceFile}) at the top. Put that file in the same folder as the HTML.
          </label>
        )}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={onDownload} disabled={!done.length}>
          Download HTML
        </button>
      </div>
    </div>
  );
}
