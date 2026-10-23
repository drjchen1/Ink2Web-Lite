import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Box, Figure, FigureAlign, Page } from '../types.ts';
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

interface Props {
  page: Page;
  index: number;
  count: number;
  liveText: string | null;
  /** A model is selected. */
  canConvert: boolean;
  onUpdate: (id: string, patch: Partial<Page>) => void;
  /** Converts this page only (now, or after the page being converted). */
  onConvert: (id: string) => void;
  /** Takes this page back out of the queue. */
  onUnqueue: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  /** Re-reads a region of the original page; resolves with the proposed text. */
  onReread: (page: Page, box: Box, signal: AbortSignal) => Promise<string>;
}

const STATUS: Record<Page['status'], string> = {
  idle: 'Not converted',
  queued: 'Waiting',
  transcribing: 'Transcribing…',
  locating: 'Finding figures…',
  done: 'Done',
  error: 'Error',
  cancelled: 'Stopped',
};

const ALIGNS: { value: FigureAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

/** The block open for editing in place. */
interface Editing {
  i: number;
  block: Block;
  /** Its source when opened (to write it back even if the page shifted). */
  original: string;
  text: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Reread {
  phase: 'select' | 'running' | 'review';
  box: Box | null;
  text: string;
  error: string;
}

export const PageView = memo(function PageView(props: Props) {
  const { page, index, count, liveText, canConvert, onUpdate, onConvert, onUnqueue, onRemove, onMove, onReread } = props;
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [active, setActive] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  /** Re-read from image (2.0): null when closed. */
  const [reread, setReread] = useState<Reread | null>(null);
  const rereadAbort = useRef<AbortController | null>(null);
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

  const source = useDebounced(page.source, 250);
  const pb = useMemo(() => pageBlocks({ source, figures: page.figures }, index + 1, hintId), [page.figures, source, index, hintId]);
  // Under "Edit source" the preview isn't clickable, so it's rendered exactly like the export.
  const plainHtml = useMemo(
    () => (tab === 'edit' ? pageHtml({ ...page, source }, index + 1) : ''),
    [tab, page.figures, source, index],
  );
  const warnings = useMemo(() => latexWarnings(source), [source]);
  const positions = useMemo(() => markerUnitIndex(page.source), [page.source]);
  const unitCount = useMemo(() => sourceUnits(page.source).length, [page.source]);

  // A conversion replaces the page, so close any open block.
  useEffect(() => {
    if (working) setEditing(null);
  }, [working]);

  // Re-read belongs to the open block: close it when the block closes.
  useEffect(() => {
    if (!editing) {
      rereadAbort.current?.abort();
      setReread(null);
    }
  }, [editing]);

  // Return keyboard focus to the block that was just edited.
  useEffect(() => {
    const i = focusBlock.current;
    if (i === null || editing) return;
    focusBlock.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-b="${i}"]`)?.focus();
  }, [pb, editing]);

  /** Writes the open block back into the page and closes it; returns the new source. */
  const commit = (): string => {
    const cur = latest.current.source;
    if (!editing) return cur;
    const next = editing.text === editing.original ? cur : commitBlock(cur, editing.block, editing.original, editing.text);
    if (next !== cur) onUpdate(page.id, { source: next });
    setEditing(null);
    return next;
  };

  /** Opens block i (of the page as currently rendered) for editing, or a figure's card. */
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
      setActive(b.fig);
      document.getElementById(`alt-${page.id}-${b.fig}`)?.focus();
      setNote(`Figure ${b.fig} selected. Edit its alt text and layout below.`);
      return;
    }
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

  /**
   * Moves the selected part of a figure's alt text (or all of it, with no selection)
   * into the notes right after the figure (1.9.4).
   */
  const moveToNotes = (f: Figure) => {
    commit();
    const ta = document.getElementById(`alt-${page.id}-${f.id}`) as HTMLTextAreaElement | null;
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

  const startReread = () => {
    setActive(null);
    setReread({ phase: 'select', box: null, text: '', error: '' });
  };
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

  const convert = () => {
    if (hasResult && !window.confirm(`Convert page ${index + 1} again? This replaces your edits on this page.`)) return;
    onConvert(page.id);
  };

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
    const p = latest.current;
    const id = nextFigureId(p.figures.map((f) => f.id));
    const layout = await pageLayout(p.image);
    const found = layout.figures.find((r) => !p.figures.some((f) => overlapRatio(f.box, r) > 0.3));
    const box = found ?? { x: 0.1, y: 0.3, w: 0.8, h: 0.35 };
    const src = await cropFigure(p.image, box);
    const newSource = found
      ? placeOne(p.source, { id, box }, p.figures, layout.lines)
      : `${p.source.trimEnd()}\n\n[[FIGURE ${id}]]\n`;
    const look = defaultLayout(box, layout.lines);
    if (look.wrap) look.besideLines = besideUnitCount(newSource, { id, box }, layout.lines);
    onUpdate(p.id, {
      source: newSource,
      figures: [...p.figures, { id, box, alt: '', caption: '', src, needsReview: true, autoDetected: !!found, ...look }],
    });
    setActive(id);
    setNote(
      found
        ? `Found another drawing and added it as figure ${id}. Check its position in the text and write alt text.`
        : `No more drawings detected. Added figure ${id} at the end; draw its box on the page image.`,
    );
  };

  const removeFigure = (id: number) => {
    onUpdate(page.id, {
      figures: page.figures.filter((f) => f.id !== id),
      source: page.source.replace(new RegExp(`\\n*\\[\\[\\s*FIGURE\\s+${id}\\s*\\]\\]\\n*`, 'gi'), '\n\n'),
    });
    if (active === id) setActive(null);
  };

  const moveFigure = (id: number, dir: -1 | 1) => {
    onUpdate(page.id, { source: moveMarker(latest.current.source, id, dir) });
    setNote(`Figure ${id} moved ${dir < 0 ? 'up' : 'down'} in the text.`);
  };

  /** The page's main action: Convert / Convert again / Cancel (when waiting). */
  const action =
    page.status === 'queued' ? (
      <button type="button" onClick={() => onUnqueue(page.id)} aria-label={`Cancel converting page ${index + 1}`}>
        Cancel
      </button>
    ) : (
      <button
        type="button"
        className={page.status === 'idle' ? 'primary' : undefined}
        onClick={convert}
        disabled={working || !canConvert}
        aria-label={`${hasResult ? 'Convert again' : 'Convert'}: page ${index + 1}`}
      >
        {hasResult ? 'Convert again' : 'Convert'}
      </button>
    );

  return (
    <article className="page" aria-labelledby={headingId} ref={rootRef}>
      <header className="page-head">
        <h3 id={headingId}>
          {index + 1}. {page.label}
        </h3>
        <span className={`badge ${page.status === 'idle' ? 'queued' : page.status}`}>{STATUS[page.status]}</span>
        <div className="actions">
          <button type="button" onClick={() => onMove(page.id, -1)} disabled={index === 0} aria-label={`Move page ${index + 1} up`}>
            ↑
          </button>
          <button type="button" onClick={() => onMove(page.id, 1)} disabled={index === count - 1} aria-label={`Move page ${index + 1} down`}>
            ↓
          </button>
          {action}
          <button type="button" onClick={() => onRemove(page.id)} disabled={working}>
            Remove
          </button>
        </div>
      </header>

      {page.error && (
        <p className="error" role="alert">
          {page.error}
        </p>
      )}

      <div className="page-body">
        <div className="col-image">
          <CropCanvas
            src={page.url}
            alt={`Original handwritten page: ${page.label}`}
            figures={page.figures}
            active={active}
            onSelect={setActive}
            onChange={setBox}
            selecting={reread?.phase === 'select'}
            selection={reread?.box ?? null}
            onSelection={(box) => setReread((r) => r && { ...r, box, error: '' })}
          />
          {reread && (
            <div className="reread-controls" role="group" aria-label="Re-read from image">
              <p className="hint">
                {reread.phase === 'running'
                  ? 'Reading the selected region…'
                  : reread.phase === 'review'
                    ? 'Review the proposal beside the block you are editing.'
                    : reread.box
                      ? 'Adjust by drawing again, or re-read this region.'
                      : 'Drag a box around the handwriting for the block you are editing.'}
              </p>
              <div className="actions">
                {reread.phase !== 'review' && (
                  <button type="button" className="primary" onClick={runReread} disabled={!reread.box || reread.phase === 'running'}>
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
          )}
          {!reread && page.figures.length > 0 && (
            <p className="hint">Select a figure, then drag its box, drag a corner, or draw a new box.</p>
          )}
        </div>

        <div className="col-text">
          {working ? (
            <div>
              <p className="hint">{page.status === 'locating' ? 'Finding and describing figures…' : 'Model output (live):'}</p>
              <pre className="live">{liveText || '…'}</pre>
            </div>
          ) : !hasResult ? (
            <p className="hint">
              {page.status === 'queued'
                ? 'Waiting for its turn. It will start after the page being converted.'
                : canConvert
                  ? 'Not converted yet. Click Convert to convert just this page.'
                  : 'Not converted yet. Choose a model first.'}
            </p>
          ) : (
            <>
              <div className="seg" role="group" aria-label="View">
                <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
                  Preview
                </button>
                <button
                  type="button"
                  aria-pressed={tab === 'edit'}
                  onClick={() => {
                    commit();
                    setTab('edit');
                  }}
                >
                  Edit source
                </button>
              </div>

              {tab === 'edit' && (
                <div className="editor">
                  <label htmlFor={`src-${page.id}`}>Transcription (Markdown with $LaTeX$; figures are [[FIGURE n]])</label>
                  <MarkupToolbar
                    target={srcRef}
                    onChange={(v) => onUpdate(page.id, { source: v })}
                    label={`Markup for page ${index + 1}`}
                  />
                  <textarea
                    ref={srcRef}
                    id={`src-${page.id}`}
                    value={page.source}
                    spellCheck={false}
                    onChange={(e) => onUpdate(page.id, { source: e.target.value })}
                  />
                </div>
              )}

              {warnings.length > 0 && (
                <ul className="warn" aria-label="LaTeX warnings">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              {tab === 'preview' ? (
                <>
                  <p id={hintId} className="hint edit-hint">
                    Click a paragraph, equation, or figure to edit it (or Tab to it and press Enter).
                  </p>
                  {editing ? (
                    <>
                      {editing.i > 0 && (
                        <Preview
                          html={pb.html.slice(0, editing.i).join('')}
                          label={`Preview of page ${index + 1}, before the part being edited`}
                          onBlock={openBlock}
                        />
                      )}
                      <BlockEditor
                        text={editing.text}
                        onText={(text) => setEditing((e) => (e ? { ...e, text } : e))}
                        onDone={finishEdit}
                        onCancel={cancelEdit}
                        figures={page.figures}
                        pageNo={index + 1}
                      />
                      {!reread ? (
                        <div className="reread-action">
                          <button type="button" onClick={startReread} disabled={!canConvert} title={canConvert ? undefined : 'Choose a model first.'}>
                            Re-read from image…
                          </button>
                          <span className="hint">Have the model look again at just this part of the original page.</span>
                        </div>
                      ) : reread.phase === 'review' ? (
                        <div className="reread-review" role="region" aria-label="Proposed replacement from the image">
                          <label htmlFor={`reread-${page.id}`}>Proposed replacement (you can edit it)</label>
                          <textarea
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
                      ) : null}
                      {editing.i < pb.html.length - 1 && (
                        <Preview
                          html={pb.html.slice(editing.i + 1).join('') + pb.tail}
                          label={`Preview of page ${index + 1}, after the part being edited`}
                          onBlock={openBlock}
                        />
                      )}
                    </>
                  ) : (
                    <Preview html={pb.html.join('') + pb.tail} label={`Preview of page ${index + 1}`} onBlock={openBlock} />
                  )}
                </>
              ) : (
                <Preview html={plainHtml} label={`Preview of page ${index + 1}`} />
              )}
            </>
          )}

          {!working && hasResult && (
            <section className="figures" aria-label={`Figures on page ${index + 1}`}>
              <h4>Figures</h4>
              <p className="sr-only" role="status" aria-live="polite">
                {note}
              </p>
              {page.figures.map((f) => {
                const pos = positions.get(f.id);
                const pid = `${page.id}-${f.id}`;
                const canWrap = f.align !== 'center';
                const altIssue = altTextIssue(f.alt);
                return (
                  <div key={f.id} className={`fig${f.id === active ? ' on' : ''}`}>
                    <div className="fig-thumb">{f.src ? <img src={f.src} alt="" /> : <span>…</span>}</div>
                    <div className="fig-fields">
                      <div className="fig-title">
                        <strong>Figure {f.id}</strong>
                        {f.autoDetected && <span className="badge queued">Found by detector</span>}
                        {f.needsReview && <span className="badge error">Check</span>}
                        {altIssue && <span className="badge error">Check alt text</span>}
                        {pos === undefined && <span className="badge queued">Not placed in text</span>}
                      </div>

                      <label htmlFor={`alt-${pid}`}>Alt text (describe what the figure shows)</label>
                      <textarea
                        id={`alt-${pid}`}
                        rows={2}
                        value={f.alt}
                        aria-invalid={!f.alt.trim()}
                        aria-describedby={altIssue ? `altissue-${pid}` : undefined}
                        onChange={(e) => patchFigure(f.id, { alt: e.target.value })}
                      />
                      {altIssue && (
                        <p id={`altissue-${pid}`} className="warn alt-issue">
                          This alt text may include writing from next to the drawing. {altIssue} Select that part and
                          click <strong>Move to notes</strong>.
                        </p>
                      )}
                      <div className="actions alt-actions">
                        <button
                          type="button"
                          // Keep the selection in the alt text box when clicking.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => moveToNotes(f)}
                          disabled={!f.alt.trim()}
                          title="Move the selected alt text (or all of it, if nothing is selected) into the notes after this figure"
                        >
                          Move to notes
                        </button>
                      </div>
                      <label htmlFor={`cap-${pid}`}>Caption (optional, visible)</label>
                      <input
                        id={`cap-${pid}`}
                        value={f.caption}
                        onChange={(e) => patchFigure(f.id, { caption: e.target.value })}
                      />

                      <fieldset className="fig-layout">
                        <legend>Layout in the document</legend>
                        <div className="layout-row">
                          <span className="layout-label" id={`pos-${pid}`}>
                            Position
                          </span>
                          <div className="actions" role="group" aria-labelledby={`pos-${pid}`}>
                            <button
                              type="button"
                              disabled={pos === undefined || pos === 0}
                              onClick={() => moveFigure(f.id, -1)}
                              aria-label={`Move figure ${f.id} up one line in the text`}
                            >
                              ↑ Up
                            </button>
                            <button
                              type="button"
                              disabled={pos === undefined || pos >= unitCount - 1}
                              onClick={() => moveFigure(f.id, 1)}
                              aria-label={`Move figure ${f.id} down one line in the text`}
                            >
                              ↓ Down
                            </button>
                          </div>
                        </div>
                        <div className="layout-row">
                          <span className="layout-label" id={`al-${pid}`}>
                            Align
                          </span>
                          <div className="seg" role="group" aria-labelledby={`al-${pid}`}>
                            {ALIGNS.map((a) => (
                              <button
                                key={a.value}
                                type="button"
                                aria-pressed={f.align === a.value}
                                onClick={() => patchFigure(f.id, { align: a.value })}
                              >
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
                            onChange={(e) => patchFigure(f.id, { width: Number(e.target.value) })}
                          />
                          <output htmlFor={`w-${pid}`}>{f.width}%</output>
                        </div>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={f.wrap && canWrap}
                            disabled={!canWrap}
                            onChange={(e) =>
                              patchFigure(f.id, { wrap: e.target.checked, besideLines: Math.max(1, f.besideLines || 1) })
                            }
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
                              onChange={(e) =>
                                patchFigure(f.id, { besideLines: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })
                              }
                            />
                            <span className="hint" id={`blh-${pid}`}>
                              Text after these lines starts below the figure.
                            </span>
                          </div>
                        )}
                      </fieldset>

                      <div className="actions">
                        <button type="button" aria-pressed={f.id === active} onClick={() => setActive(f.id === active ? null : f.id)}>
                          {f.id === active ? 'Done adjusting' : 'Adjust crop'}
                        </button>
                        <button type="button" onClick={async () => setBox(f.id, await snapToInk(page.image, f.box))}>
                          Snap to ink
                        </button>
                        {pos === undefined && (
                          <button
                            type="button"
                            onClick={() => onUpdate(page.id, { source: `${page.source.trimEnd()}\n\n[[FIGURE ${f.id}]]\n` })}
                          >
                            Insert in text
                          </button>
                        )}
                        <button type="button" onClick={() => removeFigure(f.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={addFigure}>
                + Add figure
              </button>
            </section>
          )}
        </div>
      </div>
    </article>
  );
});
