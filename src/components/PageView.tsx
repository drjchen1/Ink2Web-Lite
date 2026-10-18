import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Box, Figure, FigureAlign, Page } from '../types.ts';
import { pageHtml } from '../lib/exportHtml.ts';
import { latexWarnings } from '../lib/markdown.ts';
import { cropFigure, pageLayout, snapToInk } from '../lib/images.ts';
import { defaultLayout, overlapRatio } from '../lib/layout.ts';
import { besideUnitCount, placeOne } from '../lib/placement.ts';
import { markerUnitIndex, moveMarker, nextFigureId, sourceUnits } from '../lib/transcript.ts';
import { CropCanvas } from './CropCanvas.tsx';
import { Preview } from './Preview.tsx';

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

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const PageView = memo(function PageView(props: Props) {
  const { page, index, count, liveText, canConvert, onUpdate, onConvert, onUnqueue, onRemove, onMove } = props;
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [active, setActive] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const headingId = `page-${page.id}-h`;
  const working = page.status === 'transcribing' || page.status === 'locating';
  const hasResult = !!page.source || page.figures.length > 0;

  // Keep the latest page in a ref so async updates never clobber newer edits.
  const latest = useRef(page);
  latest.current = page;

  const source = useDebounced(page.source, 250);
  const html = useMemo(() => pageHtml({ ...page, source }, index + 1), [page.figures, source, index]);
  const warnings = useMemo(() => latexWarnings(source), [source]);
  const positions = useMemo(() => markerUnitIndex(page.source), [page.source]);
  const unitCount = useMemo(() => sourceUnits(page.source).length, [page.source]);

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
    <article className="page" aria-labelledby={headingId}>
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
          />
          {page.figures.length > 0 && (
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
                <button type="button" aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>
                  Edit source
                </button>
              </div>

              {tab === 'edit' && (
                <div className="editor">
                  <label htmlFor={`src-${page.id}`}>Transcription (Markdown with $LaTeX$; figures are [[FIGURE n]])</label>
                  <textarea
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

              <Preview html={html} label={`Preview of page ${index + 1}`} />
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
                return (
                  <div key={f.id} className={`fig${f.id === active ? ' on' : ''}`}>
                    <div className="fig-thumb">{f.src ? <img src={f.src} alt="" /> : <span>…</span>}</div>
                    <div className="fig-fields">
                      <div className="fig-title">
                        <strong>Figure {f.id}</strong>
                        {f.autoDetected && <span className="badge queued">Found by detector</span>}
                        {f.needsReview && <span className="badge error">Check</span>}
                        {pos === undefined && <span className="badge queued">Not placed in text</span>}
                      </div>

                      <label htmlFor={`alt-${pid}`}>Alt text (describe what the figure shows)</label>
                      <textarea
                        id={`alt-${pid}`}
                        rows={2}
                        value={f.alt}
                        aria-invalid={!f.alt.trim()}
                        onChange={(e) => patchFigure(f.id, { alt: e.target.value })}
                      />
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
