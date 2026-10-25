import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Box, Figure, Page } from '../types.ts';
import { pageHtml, wrapEndLines } from '../lib/exportHtml.ts';
import { altTextIssue, blockText, commitBlock, moveAltToNotes, pageBlocks, splitBlocks, type Block } from '../lib/editing.ts';
import { latexWarnings } from '../lib/markdown.ts';
import { cropFigure, pageLayout, snapToInk } from '../lib/images.ts';
import { defaultLayout, overlapRatio } from '../lib/layout.ts';
import { besideUnitCount, placeOne } from '../lib/placement.ts';
import { markerUnitIndex, moveMarker, nextFigureId, sourceUnits } from '../lib/transcript.ts';
import { CropCanvas } from './CropCanvas.tsx';
import { Preview } from './Preview.tsx';
import { BlockEditor } from './BlockEditor.tsx';
import { MarkupToolbar } from './MarkupToolbar.tsx';
import { FigurePanel } from './FigurePanel.tsx';

export const STATUS: Record<Page['status'], string> = {
  idle: 'Not converted',
  queued: 'Waiting',
  transcribing: 'Transcribing…',
  locating: 'Finding figures…',
  done: 'Done',
  error: 'Error',
  cancelled: 'Stopped',
};

/** Badge class for a status ("idle" shares the muted look of "queued"). */
export const statusClass = (s: Page['status']) => (s === 'idle' ? 'queued' : s);

interface Props {
  page: Page;
  index: number;
  count: number;
  liveText: string | null;
  /** A model is selected. */
  canConvert: boolean;
  /** The model is in use (a conversion or a re-read); the other kind of job waits. */
  busy: 'converting' | 'rereading' | null;
  /** Open this figure's panel (from the export checklist). `n` changes on every request. */
  focusFigure: { id: number; n: number } | null;
  onUpdate: (id: string, patch: Partial<Page>) => void;
  /** Converts this page only (now, or after the page being converted). */
  onConvert: (id: string) => void;
  /** Takes this page back out of the queue. */
  onUnqueue: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  /** Go to the previous / next page. */
  onGo: (dir: -1 | 1) => void;
  /** Re-reads a region of the original page; resolves with the proposed text. */
  onReread: (page: Page, box: Box, signal: AbortSignal) => Promise<string>;
}

/** The text block open for editing in place. */
interface Editing {
  i: number;
  block: Block;
  /** Its source when opened (to write it back even if the page shifted). */
  original: string;
  text: string;
}

interface Reread {
  phase: 'select' | 'running' | 'review';
  box: Box | null;
  text: string;
  error: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * One page (2.1): the original on the left (sticky, with its tools on top) and the
 * document on the right. Text blocks and figures open in place when clicked.
 */
export const PageView = memo(function PageView(props: Props) {
  const { page, index, count, liveText, canConvert, busy, focusFigure, onUpdate, onConvert, onUnqueue, onRemove, onMove, onGo, onReread } =
    props;
  const pageNo = index + 1;
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  /** The figure whose panel is open (its crop box is editable on the image). */
  const [active, setActive] = useState<number | null>(null);
  const [focusAlt, setFocusAlt] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reread, setReread] = useState<Reread | null>(null);
  const rereadAbort = useRef<AbortController | null>(null);
  const reviewRef = useRef<HTMLTextAreaElement>(null);
  const srcRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  /** Block to focus after the preview re-renders (returning from the block editor). */
  const focusBlock = useRef<number | null>(null);
  const hintId = `edit-hint-${page.id}`;
  const headingId = `page-${page.id}-h`;
  const working = page.status === 'transcribing' || page.status === 'locating';
  const hasResult = !!page.source || page.figures.length > 0;

  // Keep the latest page in a ref so async updates never clobber newer edits.
  const latest = useRef(page);
  latest.current = page;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const source = useDebounced(page.source, 250);
  const pb = useMemo(() => pageBlocks({ source, figures: page.figures }, pageNo, hintId), [page.figures, source, pageNo, hintId]);
  // Under "Edit source" the preview isn't clickable, so it's rendered exactly like the export.
  const plainHtml = useMemo(
    () => (tab === 'edit' ? pageHtml({ ...page, source }, pageNo) : ''),
    [tab, page.figures, source, pageNo],
  );
  const warnings = useMemo(() => latexWarnings(source), [source]);
  const positions = useMemo(() => markerUnitIndex(page.source), [page.source]);
  const unitCount = useMemo(() => sourceUnits(page.source).length, [page.source]);

  // A conversion replaces the page, so close whatever is open.
  useEffect(() => {
    if (working) {
      setEditing(null);
      setActive(null);
    }
  }, [working]);

  // Re-read belongs to the open block: close it when the block closes.
  useEffect(() => {
    if (!editing) {
      rereadAbort.current?.abort();
      setReread(null);
    }
  }, [editing]);

  // Leaving the page (another page, removed, restored): keep an open edit, stop a re-read.
  useEffect(
    () => () => {
      rereadAbort.current?.abort();
      const e = editingRef.current;
      if (e && e.text !== e.original) {
        onUpdate(latest.current.id, { source: commitBlock(latest.current.source, e.block, e.original, e.text) });
      }
    },
    [],
  );

  // Return keyboard focus to the block that was just edited.
  useEffect(() => {
    const i = focusBlock.current;
    if (i === null || editing || active !== null) return;
    focusBlock.current = null;
    rootRef.current?.querySelector<HTMLElement>(`.col-text [data-b="${i}"]`)?.focus();
  }, [pb, editing, active]);

  // The proposal arrives beside the block being edited: bring it into view.
  useEffect(() => {
    if (reread?.phase !== 'review') return;
    const ta = reviewRef.current;
    ta?.scrollIntoView({ block: 'nearest' });
    ta?.focus();
  }, [reread?.phase]);

  /** Writes the open block back into the page and closes it; returns the new source. */
  const commit = (): string => {
    const cur = latest.current.source;
    if (!editing) return cur;
    const next = editing.text === editing.original ? cur : commitBlock(cur, editing.block, editing.original, editing.text);
    if (next !== cur) onUpdate(page.id, { source: next });
    setEditing(null);
    return next;
  };

  /** Opens a figure's panel (closing any open text block). */
  const selectFigure = (id: number | null, fromDocument = false) => {
    commit();
    setTab('preview');
    setActive(id);
    setFocusAlt(fromDocument);
    if (id !== null) setNote(`Figure ${id} open. Its crop box is selected on the original page.`);
  };

  // Requests from outside the page (the export checklist).
  useEffect(() => {
    if (focusFigure && page.figures.some((f) => f.id === focusFigure.id)) selectFigure(focusFigure.id, true);
  }, [focusFigure?.n]);

  /** Opens block i (of the page as currently rendered): text in the block editor, a figure in its panel. */
  const openBlock = (i: number) => {
    let src = latest.current.source;
    let target = i;
    if (editing) {
      if (i === editing.i) return;
      // Save the open block first; blocks after it may shift if it grew or shrank.
      const grew = (editing.text.trim() ? splitBlocks(editing.text).length : 0) - 1;
      src = commit();
      if (i > editing.i) target = i + grew;
    }
    const blocks = splitBlocks(src, wrapEndLines(src, latest.current.figures));
    const b = blocks[target];
    if (!b) return;
    if (b.fig !== undefined) {
      selectFigure(b.fig, true);
      return;
    }
    setActive(null);
    const text = blockText(src, b);
    setEditing({ i: target, block: b, original: text, text });
  };

  const finishEdit = () => {
    if (!editing) return;
    focusBlock.current = editing.i;
    commit();
  };

  const cancelEdit = () => {
    if (!editing) return;
    focusBlock.current = editing.i;
    setEditing(null);
  };

  const closeFigure = () => {
    const i = pb.blocks.findIndex((b) => b.fig === active);
    if (i >= 0) focusBlock.current = i;
    setActive(null);
  };

  /* ---------- re-read from image ---------- */

  const startReread = () => setReread({ phase: 'select', box: null, text: '', error: '' });
  const runReread = async () => {
    const box = reread?.box;
    if (!box) return;
    const ac = new AbortController();
    rereadAbort.current = ac;
    setReread((r) => r && { ...r, phase: 'running', error: '' });
    try {
      const text = await onReread(latest.current, box, ac.signal);
      if (ac.signal.aborted) return;
      setReread((r) =>
        r && (text ? { ...r, phase: 'review', text } : { ...r, phase: 'select', error: 'The model returned no text. Try a slightly larger box.' }),
      );
    } catch (e) {
      if (!ac.signal.aborted) setReread((r) => r && { ...r, phase: 'select', error: (e as Error).message });
    } finally {
      if (rereadAbort.current === ac) rereadAbort.current = null;
    }
  };
  const closeReread = () => {
    rereadAbort.current?.abort();
    setReread(null);
  };
  const acceptReread = () => {
    if (!reread?.text.trim()) return;
    const text = reread.text;
    setEditing((e) => (e ? { ...e, text } : e));
    closeReread();
  };

  /* ---------- page actions ---------- */

  const convert = () => {
    if (hasResult && !window.confirm(`Convert page ${pageNo} again? This replaces your edits on this page.`)) return;
    onConvert(page.id);
  };

  const remove = () => {
    if (hasResult && !window.confirm(`Remove page ${pageNo}? Its transcription and edits are removed too.`)) return;
    onRemove(page.id);
  };

  /* ---------- figures ---------- */

  const patchFigure = (id: number, patch: Partial<Figure>) =>
    onUpdate(page.id, { figures: latest.current.figures.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  // Re-crop shortly after the box stops changing.
  const cropTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const setBox = (id: number, box: Box) => {
    patchFigure(id, { box, needsReview: false });
    clearTimeout(cropTimers.current.get(id));
    cropTimers.current.set(
      id,
      setTimeout(async () => {
        const src = await cropFigure(page.image, box);
        if (latest.current.figures.find((f) => f.id === id)?.box === box) patchFigure(id, { src });
      }, 200),
    );
  };

  /** Adds the next undetected drawing on the page (or a manual box if none is found). */
  const addFigure = async () => {
    commit();
    const p = latest.current;
    const id = nextFigureId(p.figures.map((f) => f.id));
    const layout = await pageLayout(p.image);
    const found = layout.figures.find((r) => !p.figures.some((f) => overlapRatio(f.box, r) > 0.3));
    const box = found ?? { x: 0.1, y: 0.3, w: 0.8, h: 0.35 };
    const src = await cropFigure(p.image, box);
    const newSource = found ? placeOne(p.source, { id, box }, p.figures, layout.lines) : `${p.source.trimEnd()}\n\n[[FIGURE ${id}]]\n`;
    const look = defaultLayout(box, layout.lines);
    if (look.wrap) look.besideLines = besideUnitCount(newSource, { id, box }, layout.lines);
    onUpdate(p.id, {
      source: newSource,
      figures: [...p.figures, { id, box, alt: '', caption: '', src, needsReview: true, autoDetected: !!found, ...look }],
    });
    selectFigure(id);
    setNote(
      found
        ? `Found another drawing and added it as figure ${id}. Check its position in the text and write alt text.`
        : `No more drawings detected. Added figure ${id} at the end; draw its box on the page image.`,
    );
  };

  const removeFigure = (id: number) => {
    const p = latest.current;
    onUpdate(page.id, {
      figures: p.figures.filter((f) => f.id !== id),
      source: p.source.replace(new RegExp(`\\n*\\[\\[\\s*FIGURE\\s+${id}\\s*\\]\\]\\n*`, 'gi'), '\n\n'),
    });
    if (active === id) setActive(null);
    setNote(`Figure ${id} deleted.`);
  };

  const moveFigure = (id: number, dir: -1 | 1) => {
    onUpdate(page.id, { source: moveMarker(latest.current.source, id, dir) });
    setNote(`Figure ${id} moved ${dir < 0 ? 'up' : 'down'} in the text.`);
  };

  /** Moves the selected part of a figure's alt text (or all of it) into the notes right after the figure. */
  const moveToNotes = (f: Figure, ta: HTMLTextAreaElement | null) => {
    const r = moveAltToNotes(latest.current.source, f.id, f.alt, ta?.selectionStart ?? 0, ta?.selectionEnd ?? 0);
    if (!r.moved) return;
    onUpdate(page.id, {
      source: r.source,
      figures: latest.current.figures.map((x) =>
        // The moved sentence was written beside the drawing: keep it beside a wrapped figure.
        x.id === f.id ? { ...x, alt: r.alt, besideLines: x.wrap ? x.besideLines + 1 : x.besideLines } : x,
      ),
    });
    setNote(`Moved to the notes after figure ${f.id}: ${r.moved}`);
    requestAnimationFrame(() => ta?.focus());
  };

  const activeFig = page.figures.find((f) => f.id === active);
  const panel = activeFig && (
    <FigurePanel
      key={activeFig.id}
      fig={activeFig}
      pageId={page.id}
      pageNo={pageNo}
      pos={positions.get(activeFig.id)}
      unitCount={unitCount}
      focusAlt={focusAlt}
      onPatch={(patch) => patchFigure(activeFig.id, patch)}
      onMove={(dir) => moveFigure(activeFig.id, dir)}
      onSnap={async () => setBox(activeFig.id, await snapToInk(page.image, activeFig.box))}
      onInsert={() => onUpdate(page.id, { source: `${latest.current.source.trimEnd()}\n\n[[FIGURE ${activeFig.id}]]\n` })}
      onDelete={() => removeFigure(activeFig.id)}
      onMoveToNotes={(ta) => moveToNotes(activeFig, ta)}
      onClose={closeFigure}
    />
  );

  /* ---------- rendering ---------- */

  const rereadHint =
    busy === 'converting' && reread?.phase !== 'running'
      ? 'A page is converting; re-read is available when it finishes.'
      : reread?.phase === 'running'
        ? 'Reading the selected region…'
        : reread?.phase === 'review'
          ? 'Review the proposal under the block you are editing.'
          : reread?.box
            ? 'Drag again to adjust, or re-read this region.'
            : 'Drag a box around the handwriting for the block you are editing.';

  const imageTools = reread ? (
    <div className="image-tools reread-bar" role="group" aria-label="Re-read from image">
      <p className="hint" aria-live="polite">
        {rereadHint}
      </p>
      <div className="actions">
        {reread.phase !== 'review' && (
          <button
            type="button"
            className="primary"
            onClick={runReread}
            disabled={!reread.box || reread.phase === 'running' || busy === 'converting'}
          >
            {reread.phase === 'running' ? 'Reading…' : 'Re-read this region'}
          </button>
        )}
        <button type="button" onClick={closeReread}>
          {reread.phase === 'running' ? 'Stop' : 'Cancel'}
        </button>
      </div>
      {reread.error && (
        <p className="error" role="alert">
          {reread.error}
        </p>
      )}
    </div>
  ) : (
    hasResult &&
    !working && (
      <div className="image-tools" role="toolbar" aria-label={`Figures on page ${pageNo}`}>
        <span className="tools-label">Figures</span>
        {page.figures.map((f) => {
          const check = f.needsReview || !f.alt.trim() || !!altTextIssue(f.alt);
          return (
            <button
              key={f.id}
              type="button"
              className={`chip${check ? ' chip-check' : ''}`}
              aria-pressed={f.id === active}
              onClick={() => selectFigure(f.id === active ? null : f.id)}
              aria-label={`Figure ${f.id}${check ? ', needs checking' : ''}`}
            >
              {f.id}
              {check && <span aria-hidden="true"> !</span>}
            </button>
          );
        })}
        {!page.figures.length && <span className="hint">none</span>}
        <button type="button" className="chip" onClick={addFigure}>
          + Add
        </button>
      </div>
    )
  );

  /** Splits the clickable preview around whatever is open in place. */
  const figBlock = active !== null ? pb.blocks.findIndex((b) => b.fig === active) : -1;
  const splitAt = editing ? editing.i : figBlock >= 0 ? figBlock : null;
  const before = splitAt !== null ? pb.html.slice(0, splitAt).join('') : '';
  const after = splitAt !== null ? pb.html.slice(splitAt + 1).join('') + pb.tail : pb.html.join('') + pb.tail;

  const openInPlace = editing ? (
    <>
      <BlockEditor
        text={editing.text}
        onText={(text) => setEditing((e) => (e ? { ...e, text } : e))}
        onDone={finishEdit}
        onCancel={cancelEdit}
        figures={page.figures}
        pageNo={pageNo}
      />
      {!reread ? (
        <div className="reread-action">
          <button
            type="button"
            onClick={startReread}
            disabled={!canConvert || busy === 'converting'}
            title={!canConvert ? 'Choose a model first.' : busy === 'converting' ? 'Available when the conversion finishes.' : undefined}
          >
            Re-read from image…
          </button>
          <span className="hint">Have the model look again at just this part of the original page.</span>
        </div>
      ) : reread.phase === 'review' ? (
        <div className="reread-review" role="region" aria-label="Proposed replacement from the image">
          <label htmlFor={`reread-${page.id}`}>Proposed replacement (you can edit it)</label>
          <textarea
            ref={reviewRef}
            id={`reread-${page.id}`}
            rows={Math.min(12, Math.max(3, reread.text.split('\n').length + 1))}
            value={reread.text}
            spellCheck={false}
            onChange={(e) => setReread((r) => r && { ...r, text: e.target.value })}
          />
          <div className="actions">
            <button type="button" className="primary" onClick={acceptReread} disabled={!reread.text.trim()}>
              Use this
            </button>
            <button type="button" onClick={() => setReread((r) => r && { ...r, phase: 'select', text: '' })}>
              Try another box
            </button>
            <button type="button" onClick={closeReread}>
              Keep mine
            </button>
          </div>
          <p className="hint">“Use this” puts it in the editor above; press Done there to keep it.</p>
        </div>
      ) : (
        <p className="hint reread-action">Draw a box on the original page, on the left.</p>
      )}
    </>
  ) : figBlock >= 0 ? (
    panel
  ) : null;

  const action =
    page.status === 'queued' ? (
      <button type="button" onClick={() => onUnqueue(page.id)}>
        Cancel waiting
      </button>
    ) : (
      <button
        type="button"
        className={hasResult ? undefined : 'primary'}
        onClick={convert}
        disabled={working || !canConvert || busy === 'rereading'}
        title={!canConvert ? 'Choose a model first.' : busy === 'rereading' ? 'Wait for the re-read to finish.' : undefined}
      >
        {hasResult ? 'Convert again' : 'Convert this page'}
      </button>
    );

  return (
    <article className="page" aria-labelledby={headingId} ref={rootRef}>
      <header className="page-head">
        <div className="page-title">
          <h2 id={headingId}>
            Page {pageNo} <span className="of">of {count}</span>
          </h2>
          <span className="page-label">{page.label}</span>
          <span className={`badge ${statusClass(page.status)}`}>{STATUS[page.status]}</span>
        </div>
        <div className="actions page-actions">
          <button type="button" onClick={() => onGo(-1)} disabled={index === 0} aria-label="Previous page">
            ← Prev
          </button>
          <button type="button" onClick={() => onGo(1)} disabled={index === count - 1} aria-label="Next page">
            Next →
          </button>
          <span className="sep" aria-hidden="true" />
          {(hasResult || page.status === 'queued') && action}
          <button type="button" onClick={() => onMove(page.id, -1)} disabled={index === 0} aria-label={`Move page ${pageNo} earlier`} title="Move earlier">
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(page.id, 1)}
            disabled={index === count - 1}
            aria-label={`Move page ${pageNo} later`}
            title="Move later"
          >
            ↓
          </button>
          <button type="button" onClick={remove} disabled={working}>
            Remove
          </button>
        </div>
      </header>

      {page.error && (
        <p className="error page-error" role="alert">
          <span>{page.error}</span>
          {page.status === 'done' && (
            <button type="button" onClick={() => onUpdate(page.id, { error: undefined })}>
              Dismiss
            </button>
          )}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {note}
      </p>

      <div className="page-body">
        <div className="col-image">
          {imageTools}
          <CropCanvas
            src={page.url}
            alt={`Original handwritten page: ${page.label}`}
            figures={page.figures}
            active={active}
            onSelect={(id) => selectFigure(id)}
            onChange={setBox}
            selecting={reread?.phase === 'select'}
            selection={reread?.box ?? null}
            onSelection={(box) => setReread((r) => r && { ...r, box, error: '' })}
          />
        </div>

        <div className="col-text">
          {working ? (
            <div>
              <p className="hint">{page.status === 'locating' ? 'Finding and describing figures…' : 'Model output (live):'}</p>
              <pre className="live">{liveText || '…'}</pre>
            </div>
          ) : !hasResult ? (
            <div className="not-converted">
              {page.status === 'queued' ? (
                <>
                  <p>Waiting for its turn. It starts after the page being converted.</p>
                  {action}
                </>
              ) : (
                <>
                  <p>{canConvert ? 'This page isn’t converted yet.' : 'Choose a model first (Model button, top right).'}</p>
                  {action}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="doc-bar">
                <div className="seg" role="group" aria-label="View">
                  <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
                    Preview
                  </button>
                  <button
                    type="button"
                    aria-pressed={tab === 'edit'}
                    onClick={() => {
                      commit();
                      setActive(null);
                      setTab('edit');
                    }}
                  >
                    Edit source
                  </button>
                </div>
                {tab === 'preview' && (
                  <p id={hintId} className="hint edit-hint">
                    Click a paragraph, equation, or figure to edit it (or Tab to it and press Enter).
                  </p>
                )}
              </div>

              {warnings.length > 0 && (
                <ul className="warn" aria-label="LaTeX warnings">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              {tab === 'edit' ? (
                <>
                  <div className="editor">
                    <label htmlFor={`src-${page.id}`}>Transcription (Markdown with $LaTeX$; figures are [[FIGURE n]])</label>
                    <MarkupToolbar target={srcRef} onChange={(v) => onUpdate(page.id, { source: v })} label={`Markup for page ${pageNo}`} />
                    <textarea
                      ref={srcRef}
                      id={`src-${page.id}`}
                      value={page.source}
                      spellCheck={false}
                      onChange={(e) => onUpdate(page.id, { source: e.target.value })}
                    />
                  </div>
                  <Preview html={plainHtml} label={`Preview of page ${pageNo}`} />
                </>
              ) : (
                <>
                  {activeFig && figBlock < 0 && panel}
                  {splitAt !== null && splitAt > 0 && (
                    <Preview html={before} label={`Page ${pageNo}, before the part being edited`} onBlock={openBlock} />
                  )}
                  {openInPlace}
                  {(splitAt === null || splitAt < pb.html.length - 1 || pb.tail) && (
                    <Preview
                      html={after}
                      label={splitAt === null ? `Page ${pageNo}` : `Page ${pageNo}, after the part being edited`}
                      onBlock={openBlock}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
});
