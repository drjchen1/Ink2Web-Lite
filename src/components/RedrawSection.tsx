import { useEffect, useMemo, useRef, useState } from 'react';
import type { Figure, FigureShow } from '../types.ts';
import type { RedrawOutcome } from '../lib/redraw/conversation.ts';
import { placeSvg, redrawSpec } from '../lib/figureRedraw.ts';
import { escapeHtml } from '../lib/markdown.ts';
import {
  V2_TEMPLATES,
  formatSceneDsl,
  upgradeV1ToScene,
  type SceneLayer,
  type SceneSpec,
  type SpaceKind,
  type V2TemplateKey,
} from '../lib/redraw/index.ts';
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

const KIND_NAMES: Record<V2TemplateKey, string> = {
  graph: 'Graph / Piecewise',
  region: 'Region / Riemann sum',
  phase: 'Phase plane / Slope field',
  line: 's-plane / Number line',
  diagram: 'Block / Spring diagram',
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function layerSummary(layer: SceneLayer): string {
  switch (layer.kind) {
    case 'curve':
      return layer.form === 'parametric' && layer.exprY ? `${layer.expr}; ${layer.exprY}` : layer.expr;
    case 'shade':
      if (layer.roc) return layer.roc.gt !== undefined ? `Re(s) > ${layer.roc.gt}` : `Re(s) < ${layer.roc.lt ?? 0}`;
      return layer.bottom ? `${layer.top} .. ${layer.bottom}` : layer.top;
    case 'field':
      return layer.mode === 'slope' ? `y' = ${layer.exprs[0]}` : `(${layer.exprs[0]}; ${layer.exprs[1] ?? ''})`;
    case 'flow':
      return `[${layer.start[0]}, ${layer.start[1]}]`;
    case 'mark': {
      const it = layer.item;
      if (it.mark === 'point' || it.mark === 'pole' || it.mark === 'zero' || it.mark === 'projection') {
        return `[${it.at[0]}, ${it.at[1]}]${'label' in it && it.label ? ` (${it.label})` : ''}`;
      }
      if (it.mark === 'arrow') return `[${it.from[0]}, ${it.from[1]}] -> [${it.to[0]}, ${it.to[1]}]`;
      if (it.mark === 'impulse') return `t = ${it.at}`;
      if (it.mark === 'sign') return `[${it.on[0]}, ${it.on[1]}]: ${it.sign}`;
      if (it.mark === 'interval') return `[${it.on[0]}, ${it.on[1]}]`;
      return it.text;
    }
  }
}

/**
 * Redraw from the math (Clean-Slate v2): the model (or the user) writes a compact
 * Line-DSL or JSON spec, the app evaluates and renders an exact textbook SVG.
 * The cropped sketch stays available via the Image / Redrawn / Both selector.
 */
export function RedrawSection({ fig, pid, onPatch, onRedraw, blocked }: Props) {
  const stored = fig.redraw?.spec ?? '';
  const show = fig.redraw?.show ?? 'image';
  const [draft, setDraft] = useState(stored);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [template, setTemplate] = useState<V2TemplateKey>('graph');
  const [ghost, setGhost] = useState(!!fig.redrawCheck);
  const [ghostOpacity, setGhostOpacity] = useState(35);
  useEffect(() => {
    if (fig.redrawCheck) setGhost(true);
  }, [fig.redrawCheck]);
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
      if (p.fig.redraw && p.draft !== p.stored) p.onPatch({ redraw: { ...p.fig.redraw, spec: p.draft }, redrawCheck: false });
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
  const checked = useDebounced(draft, 300);
  useEffect(() => {
    if (checked === stored || !fig.redraw) return;
    typed.current = true;
    onPatch({ redraw: { ...fig.redraw, spec: checked }, redrawCheck: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const result = useMemo(() => (checked.trim() ? redrawSpec(checked) : null), [checked]);
  const ready = result?.ok ? result : null;
  const svg = useMemo(() => (ready ? placeSvg(ready.svg, `fp-${pid}`) : ''), [ready, pid]);
  const fromHtml = useMemo(() => {
    if (!ready) return '';
    const sp = ready.spec;
    const fromText = 'from' in sp ? sp.from : '';
    return fromText.trim() ? `<p>Redrawn from: \\(${escapeHtml(fromText)}\\)</p>` : '';
  }, [ready]);

  /** Structured SceneSpec for visual two-way controls (auto-upgrades valid v1 JSON on edit). */
  const visualScene = useMemo<SceneSpec | null>(() => {
    if (!ready) return null;
    if ('scene' in ready.spec) return ready.spec;
    return upgradeV1ToScene(ready.spec);
  }, [ready]);

  const isLegacyV1 = !!(ready && !('scene' in ready.spec));

  const applySceneUpdate = (next: SceneSpec) => {
    const formatted = formatSceneDsl(next);
    typed.current = false;
    setDraft(formatted);
    if (fig.redraw) onPatch({ redraw: { ...fig.redraw, spec: formatted }, redrawCheck: false });
  };

  const ask = async () => {
    if (stored.trim() && !window.confirm('Ask the model again? This replaces the current spec.')) return;
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setStatus('Analyzing sketch geometry, notes, and equations…');
    try {
      const r = await onRedraw(ac.signal);
      if (ac.signal.aborted) return;
      if (r.status === 'none') {
        setStatus('The model kept the original image (no matching equation or schematic found).');
        return;
      }
      if (r.status === 'unreadable') {
        setStatus('The model didn’t produce a usable spec. Try again, write one by hand, or keep the image.');
        return;
      }
      onPatch({
        redraw: { spec: r.spec, show: fig.redraw?.show ?? 'image' },
        redrawCheck: r.status === 'ok' && r.confidence !== 'high',
      });
      if (r.status === 'ok') {
        setStatus(
          r.confidence === 'high'
            ? 'Redraw ready (high ink match). Choose Redrawn or Both to use it.'
            : 'Redraw ready (verify curve against sketch). Choose Redrawn or Both to use it.',
        );
      } else {
        setStatus('The model’s spec has problems (listed below). Fix the spec, ask again, or keep the image.');
      }
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
    onPatch({ redraw: { spec: V2_TEMPLATES[template], show: 'image' }, redrawCheck: false });
    setStatus(`Started from a ${KIND_NAMES[template].toLowerCase()} example: customize the layers or math.`);
  };

  const remove = () => {
    if (!window.confirm('Remove the redraw? The figure goes back to the image.')) return;
    onPatch({ redraw: undefined, redrawCheck: false });
    setStatus('Redraw removed.');
  };

  const parseBoundInput = (raw: string): number | string => {
    const t = raw.trim();
    return /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : t;
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
              onClick={() => onPatch({ redraw: { spec: draft, show: s.value }, redrawCheck: false })}
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
              ? 'The document shows the cropped image. Choose Redrawn or Both to switch.'
              : show === 'redrawn'
                ? 'The document shows the redraw, with its computed alt text.'
                : 'The document shows the redraw, with the cropped sketch in a collapsed section below it.'}
      </p>
    </div>
  );

  return (
    <details className="fig-redraw" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        Redraw from the math
        {!fig.redraw && <span className="hint"> (optional: graph, region, phase plane, complex plane, or block diagram)</span>}
      </summary>
      <p className="hint">
        Redraws figures from LaTeX or Line-DSL specs with computed alt text. The cropped image is always preserved unless you
        switch to Redrawn or Both.
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
            <select id={`rd-tpl-${pid}`} value={template} onChange={(e) => setTemplate(e.target.value as V2TemplateKey)}>
              {Object.entries(KIND_NAMES).map(([k, name]) => (
                <option key={k} value={k}>
                  {name}
                </option>
              ))}
            </select>
            <button type="button" onClick={startByHand} disabled={running}>
              Start from template
            </button>
          </>
        )}
        {fig.redraw && (
          <>
            {isLegacyV1 && visualScene && (
              <button type="button" onClick={() => applySceneUpdate(visualScene)} disabled={running}>
                Upgrade to Line-DSL
              </button>
            )}
            <button type="button" className="danger-outline" onClick={remove} disabled={running}>
              Remove redraw
            </button>
          </>
        )}
      </div>
      {blocked && !running && <p className="hint">{blocked}</p>}
      <p className="status" role="status" aria-live="polite">
        {status}
      </p>

      {fig.redraw && (
        <>
          {fig.redrawCheck && show !== 'image' && ready && (
            <p className="warn" role="status">
              Automatic check suggests comparing this redraw against the sketch.{' '}
              <button type="button" className="link" onClick={() => onPatch({ redrawCheck: false })}>
                Looks right
              </button>
            </p>
          )}
          <div className="redraw-compare">
            <figure>
              <figcaption>Original</figcaption>
              <img src={fig.src} alt="" />
            </figure>
            <figure>
              <figcaption className="redraw-cap-row">
                <span>Redrawn</span>
                {ready && (
                  <label className="redraw-ghost-ctl">
                    <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />
                    <span>Overlay sketch</span>
                  </label>
                )}
              </figcaption>
              {ready ? (
                <>
                  <div className="redraw-svg-wrap">
                    <div className="redraw-svg" dangerouslySetInnerHTML={{ __html: svg }} />
                    {ghost && (
                      <img
                        className="redraw-ghost-img"
                        src={fig.src}
                        alt=""
                        aria-hidden="true"
                        style={{ opacity: ghostOpacity / 100 }}
                      />
                    )}
                  </div>
                  {ghost && (
                    <label className="redraw-ghost-slider">
                      <span>Sketch opacity ({ghostOpacity}%)</span>
                      <input
                        type="range"
                        min={15}
                        max={65}
                        step={5}
                        value={ghostOpacity}
                        aria-label="Sketch overlay opacity"
                        onChange={(e) => setGhostOpacity(Number(e.target.value))}
                      />
                    </label>
                  )}
                </>
              ) : (
                <p className="hint">{result ? 'Not drawn: fix the errors in the spec below.' : 'No spec yet.'}</p>
              )}
            </figure>
          </div>

          {visualScene && visualScene.scene === 'plot' && (
            <details className="redraw-visual" open>
              <summary>Scene &amp; layer controls</summary>
              <div className="redraw-grid">
                <label className="redraw-field">
                  <span>Equation / Title (from)</span>
                  <input
                    type="text"
                    value={visualScene.from}
                    onChange={(e) => applySceneUpdate({ ...visualScene, from: e.target.value })}
                  />
                </label>
                <label className="redraw-field">
                  <span>Coordinate space</span>
                  <select
                    value={visualScene.space ?? 'cartesian'}
                    onChange={(e) => applySceneUpdate({ ...visualScene, space: e.target.value as SpaceKind })}
                  >
                    <option value="cartesian">Cartesian (x, y)</option>
                    <option value="polar">Polar (r, θ)</option>
                    <option value="complex">Complex s-plane</option>
                    <option value="1d">1D Number line</option>
                  </select>
                </label>
                <label className="redraw-field">
                  <span>X axis &amp; window</span>
                  <div className="redraw-pair">
                    <input
                      type="text"
                      aria-label="X axis label"
                      value={visualScene.axes?.x ?? 'x'}
                      onChange={(e) =>
                        applySceneUpdate({ ...visualScene, axes: { ...visualScene.axes, x: e.target.value } })
                      }
                    />
                    <div className="redraw-pair">
                      <input
                        type="text"
                        aria-label="X min"
                        placeholder="-4"
                        value={visualScene.window?.x?.[0] ?? ''}
                        onChange={(e) => {
                          const minV = e.target.value;
                          const maxV = visualScene.window?.x?.[1] ?? 4;
                          if (!minV.trim() && !String(maxV).trim()) {
                            const { x: _omit, ...restWin } = visualScene.window ?? {};
                            applySceneUpdate({ ...visualScene, window: restWin });
                          } else {
                            applySceneUpdate({
                              ...visualScene,
                              window: { ...visualScene.window, x: [parseBoundInput(minV), maxV] },
                            });
                          }
                        }}
                      />
                      <input
                        type="text"
                        aria-label="X max"
                        placeholder="4"
                        value={visualScene.window?.x?.[1] ?? ''}
                        onChange={(e) => {
                          const maxV = e.target.value;
                          const minV = visualScene.window?.x?.[0] ?? -4;
                          if (!maxV.trim() && !String(minV).trim()) {
                            const { x: _omit, ...restWin } = visualScene.window ?? {};
                            applySceneUpdate({ ...visualScene, window: restWin });
                          } else {
                            applySceneUpdate({
                              ...visualScene,
                              window: { ...visualScene.window, x: [minV, parseBoundInput(maxV)] },
                            });
                          }
                        }}
                      />
                    </div>
                  </div>
                </label>
                {visualScene.space !== '1d' && (
                  <label className="redraw-field">
                    <span>Y axis &amp; window (blank = auto)</span>
                    <div className="redraw-pair">
                      <input
                        type="text"
                        aria-label="Y axis label"
                        value={visualScene.axes?.y ?? 'y'}
                        onChange={(e) =>
                          applySceneUpdate({ ...visualScene, axes: { ...visualScene.axes, y: e.target.value } })
                        }
                      />
                      <div className="redraw-pair">
                        <input
                          type="text"
                          aria-label="Y min"
                          placeholder="auto"
                          value={visualScene.window?.y?.[0] ?? ''}
                          onChange={(e) => {
                            const minV = e.target.value;
                            const maxV = visualScene.window?.y?.[1] ?? '';
                            if (!minV.trim() && !String(maxV).trim()) {
                              const { y: _omit, ...restWin } = visualScene.window ?? {};
                              applySceneUpdate({ ...visualScene, window: restWin });
                            } else {
                              applySceneUpdate({
                                ...visualScene,
                                window: {
                                  ...visualScene.window,
                                  y: [parseBoundInput(minV || '0'), parseBoundInput(String(maxV || '1'))],
                                },
                              });
                            }
                          }}
                        />
                        <input
                          type="text"
                          aria-label="Y max"
                          placeholder="auto"
                          value={visualScene.window?.y?.[1] ?? ''}
                          onChange={(e) => {
                            const maxV = e.target.value;
                            const minV = visualScene.window?.y?.[0] ?? '';
                            if (!maxV.trim() && !String(minV).trim()) {
                              const { y: _omit, ...restWin } = visualScene.window ?? {};
                              applySceneUpdate({ ...visualScene, window: restWin });
                            } else {
                              applySceneUpdate({
                                ...visualScene,
                                window: {
                                  ...visualScene.window,
                                  y: [parseBoundInput(String(minV || '0')), parseBoundInput(maxV || '1')],
                                },
                              });
                            }
                          }}
                        />
                      </div>
                    </div>
                  </label>
                )}
              </div>

              <div className="redraw-layers">
                {visualScene.layers.map((layer, idx) => (
                  <div className="redraw-layer-row" key={idx}>
                    <span className="redraw-layer-badge">
                      {layer.kind === 'mark' ? layer.item.mark : layer.kind}
                    </span>
                    <input
                      type="text"
                      aria-label={`Layer ${idx + 1} expression`}
                      value={layer.kind === 'curve' ? layer.expr : layerSummary(layer)}
                      readOnly={layer.kind !== 'curve' && layer.kind !== 'shade'}
                      onChange={(e) => {
                        const val = e.target.value;
                        const layers = visualScene.layers.map((item, j) => {
                          if (j !== idx) return item;
                          if (item.kind === 'curve') return { ...item, expr: val };
                          if (item.kind === 'shade') {
                            const parts = val.split('..').map((s) => s.trim());
                            return parts.length === 2
                              ? { ...item, top: parts[0], bottom: parts[1] }
                              : { ...item, top: val, bottom: undefined };
                          }
                          return item;
                        });
                        applySceneUpdate({ ...visualScene, layers });
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const layers = visualScene.layers.filter((_, j) => j !== idx);
                        if (layers.length) applySceneUpdate({ ...visualScene, layers });
                      }}
                      disabled={visualScene.layers.length <= 1}
                      title="Remove layer"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      applySceneUpdate({
                        ...visualScene,
                        layers: [...visualScene.layers, { kind: 'curve', expr: '0' }],
                      })
                    }
                  >
                    + Curve
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      applySceneUpdate({
                        ...visualScene,
                        layers: [...visualScene.layers, { kind: 'mark', item: { mark: 'point', at: [0, 0] } }],
                      })
                    }
                  >
                    + Point
                  </button>
                </div>
              </div>
            </details>
          )}

          {visualScene && visualScene.scene === 'diagram' && (
            <div className="redraw-visual">
              <label className="redraw-field">
                <span>Diagram title (from)</span>
                <input
                  type="text"
                  value={visualScene.from}
                  onChange={(e) => applySceneUpdate({ ...visualScene, from: e.target.value })}
                />
              </label>
              <p className="hint">
                {visualScene.nodes.length} node(s), {visualScene.edges.length} edge(s). Edit node/edge lines in the Spec drawer
                below.
              </p>
            </div>
          )}

          <details className="redraw-spec-drawer" open={!ready}>
            <summary>Spec (Line-DSL or JSON)</summary>
            <textarea
              id={`rd-spec-${pid}`}
              className="redraw-spec"
              aria-label="Spec (Line-DSL or JSON)"
              rows={Math.min(18, Math.max(6, draft.split('\n').length + 1))}
              spellCheck={false}
              value={draft}
              aria-describedby={`rd-spec-msgs-${pid} rd-spec-help-${pid}`}
              onChange={(e) => setDraft(e.target.value)}
            />
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
              Line-DSL accepts native LaTeX (<code>\frac{'{1}{x}'}</code>, <code>\sqrt{'{x}'}</code>,{' '}
              <code>u_c(t)</code>, <code>\begin{'{cases}'}...\end{'{cases}'}</code>), constants (<code>pi/2</code>), and
              directives like <code>curve:</code>, <code>shade:</code>, <code>field:</code>, <code>flow:</code>,{' '}
              <code>point:</code>, <code>pole:</code>, <code>roc:</code>, <code>node:</code>, <code>edge:</code>. Legacy v1 JSON
              specs also still work.
            </p>
          </details>

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
