import { useEffect, useMemo, useRef, useState } from 'react';
import type { Figure, FigureShow } from '../types.ts';
import type { RedrawOutcome } from '../lib/redraw/conversation.ts';
import { placeSvg, redrawSpec } from '../lib/figureRedraw.ts';
import { escapeHtml } from '../lib/markdown.ts';
import { TEMPLATES, formatSpec } from '../lib/redraw/prompt.ts';
import { Preview } from './Preview.tsx';

interface Props {
  fig: Figure;
  /** Unique per figure on the page (element ids). */
  pid: string;
  onPatch: (patch: Partial<Figure>) => void;
  /** Asks the model for a spec. */
  onRedraw: (signal: AbortSignal) => Promise<RedrawOutcome>;
  /** Why the model can't be asked now, or '' when it can. */
  blocked: string;
}

const SHOWS: { value: FigureShow; label: string }[] = [
  { value: 'image', label: 'Image' },
  { value: 'redrawn', label: 'Redrawn' },
  { value: 'both', label: 'Both' },
];

const KIND_NAMES = { graph: 'Graph', region: 'Region between curves', phase: 'Phase plane' } as const;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Redraw from the math (2.2): the model (or the user) writes a spec, the app draws it.
 * The image stays in the document until the user picks Redrawn or Both, and a spec
 * with errors never replaces the image.
 */
export function RedrawSection({ fig, pid, onPatch, onRedraw, blocked }: Props) {
  const stored = fig.redraw?.spec ?? '';
  const show = fig.redraw?.show ?? 'image';
  const [draft, setDraft] = useState(stored);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [template, setTemplate] = useState<keyof typeof TEMPLATES>('graph');
  const abort = useRef<AbortController | null>(null);
  const typed = useRef(false);
  /** Closed for figures without a redraw (most of them); open once there is one. */
  const [open, setOpen] = useState(!!fig.redraw);
  useEffect(() => {
    if (fig.redraw) setOpen(true);
  }, [!!fig.redraw]);

  // Closing the panel (Done, Esc) right after typing must not lose the last edit.
  const pending = useRef({ draft, stored, fig, onPatch });
  pending.current = { draft, stored, fig, onPatch };
  useEffect(
    () => () => {
      const p = pending.current;
      if (p.fig.redraw && p.draft !== p.stored) p.onPatch({ redraw: { ...p.fig.redraw, spec: p.draft } });
    },
    [],
  );

  // A spec from the model (or Remove) replaces the editor's text.
  useEffect(() => {
    if (!typed.current) setDraft(stored);
    typed.current = false;
  }, [stored]);
  useEffect(() => () => abort.current?.abort(), []);

  // Typing is saved shortly after it stops (a redraw can take a moment to compute).
  const checked = useDebounced(draft, 350);
  useEffect(() => {
    if (checked === stored || !fig.redraw) return;
    typed.current = true;
    onPatch({ redraw: { ...fig.redraw, spec: checked } });
    // Only when the debounced text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const result = useMemo(() => (checked.trim() ? redrawSpec(checked) : null), [checked]);
  const ready = result?.ok ? result : null;
  const svg = useMemo(() => (ready ? placeSvg(ready.svg, `fp-${pid}`) : ''), [ready, pid]);
  const fromHtml = useMemo(
    () => (ready ? `<p>Redrawn from: \\(${escapeHtml(ready.spec.from)}\\)</p>` : ''),
    [ready],
  );

  const ask = async () => {
    if (stored.trim() && !window.confirm('Ask the model again? This replaces the current spec.')) return;
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setStatus('Reading the figure and the notes around it…');
    try {
      const r = await onRedraw(ac.signal);
      if (ac.signal.aborted) return;
      if (r.status === 'none') {
        setStatus('The model found no equation in the notes that this figure shows, so it can’t be redrawn. The image stays.');
        return;
      }
      if (r.status === 'unreadable') {
        setStatus('The model didn’t produce a usable spec. Try again, write one by hand, or keep the image.');
        return;
      }
      onPatch({ redraw: { spec: r.spec, show: fig.redraw?.show ?? 'image' } });
      setStatus(
        r.status === 'ok'
          ? 'Redraw ready. Compare it with the original and check the equation; choose Redrawn or Both to use it.'
          : 'The model’s spec has problems (listed below). Fix the spec, ask again, or keep the image.',
      );
    } catch (e) {
      if (!ac.signal.aborted) setStatus((e as Error).message);
    } finally {
      if (abort.current === ac) abort.current = null;
      setRunning(false);
    }
  };
  const cancel = () => {
    abort.current?.abort();
    setRunning(false);
    setStatus('Stopped.');
  };
  const startByHand = () => {
    onPatch({ redraw: { spec: formatSpec(TEMPLATES[template]), show: 'image' } });
    setStatus(`Started from a ${KIND_NAMES[template].toLowerCase()} example: replace it with this figure’s math.`);
  };
  const remove = () => {
    if (!window.confirm('Remove the redraw? The figure goes back to the image.')) return;
    onPatch({ redraw: undefined });
    setStatus('Redraw removed.');
  };

  const choice = fig.redraw && (
    <div className="redraw-choice">
      <div className="layout-row">
        <span className="layout-label" id={`rd-show-${pid}`}>
          In the document
        </span>
        <div className="seg" role="group" aria-labelledby={`rd-show-${pid}`} aria-describedby={`rd-show-help-${pid}`}>
          {SHOWS.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={show === s.value}
              disabled={s.value !== 'image' && !ready}
              onClick={() => onPatch({ redraw: { spec: draft, show: s.value } })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint" id={`rd-show-help-${pid}`}>
        {show !== 'image' && !ready
          ? 'The spec has errors, so the document shows the image until they are fixed.'
          : !ready
            ? 'Redrawn and Both become available once the spec has no errors.'
            : show === 'image'
              ? 'The document shows the image. Choose Redrawn or Both to use the redraw.'
              : show === 'redrawn'
                ? 'The document shows the redraw, with its computed alt text.'
                : 'The document shows the redraw, with the original sketch in a collapsed section below it.'}
      </p>
    </div>
  );

  return (
    <details className="fig-redraw" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        Redraw from the math
        {!fig.redraw && <span className="hint"> (optional: for a graph, region, or phase plane whose equation is in the notes)</span>}
      </summary>
      <p className="hint">
        The figure is redrawn exactly from the equation in the notes, with alt text computed from the math. The image stays
        in use until you choose otherwise.
      </p>

      <div className="actions">
        {running ? (
          <button type="button" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button type="button" onClick={ask} disabled={!!blocked} title={blocked || undefined}>
            {stored.trim() ? 'Ask the model again' : 'Redraw with the model'}
          </button>
        )}
        {!fig.redraw && (
          <>
            <label htmlFor={`rd-tpl-${pid}`} className="sr-only">
              Kind of figure
            </label>
            <select id={`rd-tpl-${pid}`} value={template} onChange={(e) => setTemplate(e.target.value as keyof typeof TEMPLATES)}>
              {Object.entries(KIND_NAMES).map(([k, name]) => (
                <option key={k} value={k}>
                  {name}
                </option>
              ))}
            </select>
            <button type="button" onClick={startByHand} disabled={running}>
              Write a spec by hand
            </button>
          </>
        )}
        {fig.redraw && (
          <button type="button" className="danger-outline" onClick={remove} disabled={running}>
            Remove redraw
          </button>
        )}
      </div>
      {blocked && !running && <p className="hint">{blocked}</p>}
      <p className="status" role="status" aria-live="polite">
        {status}
      </p>

      {fig.redraw && (
        <>
          <div className="redraw-compare">
            <figure>
              <figcaption>Original</figcaption>
              <img src={fig.src} alt="" />
            </figure>
            <figure>
              <figcaption>Redrawn</figcaption>
              {ready ? (
                // Generated by the redraw engine; every piece of text in it is escaped.
                <div className="redraw-svg" dangerouslySetInnerHTML={{ __html: svg }} />
              ) : (
                <p className="hint">{result ? 'Not drawn: the spec has errors (listed under the spec).' : 'No spec yet.'}</p>
              )}
            </figure>
          </div>

          <label htmlFor={`rd-spec-${pid}`}>Spec (JSON)</label>
          <textarea
            id={`rd-spec-${pid}`}
            className="redraw-spec"
            rows={Math.min(18, Math.max(6, draft.split('\n').length + 1))}
            spellCheck={false}
            value={draft}
            aria-describedby={`rd-spec-msgs-${pid} rd-spec-help-${pid}`}
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* Problems right under the spec, where you're looking; announced politely, not as alerts while typing. */}
          <div id={`rd-spec-msgs-${pid}`} aria-live="polite">
            {result && !result.ok && (
              <div className="warn">
                <strong>The spec has problems:</strong>
                <ul>
                  {result.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {result?.warnings.length ? (
              <div className="warn">
                <ul>
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <p id={`rd-spec-help-${pid}`} className="hint">
            Changes apply as you type; the Redrawn drawing updates when you pause. The curves come from <code>expr</code>{' '}
            (and <code>top</code>/<code>bottom</code>, <code>system</code>); <code>from</code> is only the equation as
            written in the notes. Expressions use calculator syntax: <code>exp(-t)*cos(3t)</code>, <code>u(t-2)</code>,{' '}
            <code>sqrt(x)</code>, <code>pi</code>. Number fields also take constants: <code>"pi/2"</code>,{' '}
            <code>"2pi"</code>, <code>"e"</code>. The fields are listed in Help, “Redrawing figures from the math”.
          </p>

          {ready && (
            <>
              <Preview html={fromHtml} label="The equation the redraw uses" />
              <details className="redraw-alt">
                <summary>Alt text for the redrawn figure (computed from the math)</summary>
                <p>
                  <strong>{ready.alt.short}</strong>
                </p>
                <p>{ready.alt.long}</p>
              </details>
            </>
          )}

          {choice}
        </>
      )}
    </details>
  );
}
