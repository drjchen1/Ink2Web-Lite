import type { AnnotationStyle, ModelInfo, Settings } from '../types.ts';

interface Props {
  settings: Settings;
  models: ModelInfo[];
  modelError: string;
  loadingModels: boolean;
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onRefresh: () => void;
}

const DETAIL = [
  { value: 1024, label: 'Fast (1024 px)' },
  { value: 1344, label: 'Balanced (1344 px)' },
  { value: 1792, label: 'High detail (1792 px)' },
];

const ANNOTATIONS: { value: AnnotationStyle; label: string }[] = [
  { value: 'notes', label: 'As notes after the equation (“where ω is the frequency”)' },
  { value: 'drawn', label: 'As drawn in the equation (arrows and braces)' },
];

export function SettingsPanel({ settings, models, modelError, loadingModels, disabled, onChange, onRefresh }: Props) {
  const selected = models.find((m) => m.name === settings.model);

  return (
    <section className="panel" aria-labelledby="settings-h">
      <h2 id="settings-h">Model</h2>
      <div className="grid">
        <div className="field">
          <label htmlFor="model">Ollama vision model</label>
          <div className="row">
            <select
              id="model"
              value={settings.model}
              disabled={disabled || !models.length}
              onChange={(e) => onChange({ model: e.target.value })}
              aria-describedby="model-help"
            >
              {!models.length && <option value="">{loadingModels ? 'Loading…' : 'No models found'}</option>}
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} · {m.sizeGB.toFixed(1)} GB{m.vision === false ? ' · no vision' : ''}
                </option>
              ))}
            </select>
            <button type="button" onClick={onRefresh} disabled={disabled || loadingModels}>
              Refresh
            </button>
          </div>
          <p id="model-help" className="hint">
            {modelError ? (
              <span className="error-text" role="alert">
                {modelError}
              </span>
            ) : selected?.vision === false ? (
              <span className="error-text">This model can’t read images. Pick a vision model (e.g. pull one with “ollama pull …”).</span>
            ) : (
              'Any installed vision-language model works. Use “instruct” builds; larger models are more accurate but slower.'
            )}
          </p>
        </div>

        <div className="field">
          <label htmlFor="detail">Image detail</label>
          <select
            id="detail"
            value={settings.detail}
            disabled={disabled}
            onChange={(e) => onChange({ detail: Number(e.target.value) })}
          >
            {DETAIL.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <p className="hint">Higher detail reads small handwriting, brace notes, and labels better but takes longer.</p>
        </div>

        <div className="field">
          <label htmlFor="annotations">Arrow and brace notes</label>
          <select
            id="annotations"
            value={settings.annotations ?? 'notes'}
            disabled={disabled}
            onChange={(e) => onChange({ annotations: e.target.value as AnnotationStyle })}
            aria-describedby="annotations-help"
          >
            {ANNOTATIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p id="annotations-help" className="hint">
            Notes are more reliable with small models and read better aloud. Applies to pages converted from now on.
          </p>
        </div>
      </div>

      <div className="checks">
        <label>
          <input
            type="checkbox"
            checked={settings.enhance}
            disabled={disabled}
            onChange={(e) => onChange({ enhance: e.target.checked })}
          />{' '}
          Boost contrast before reading (helps pencil and phone photos; ink colors are kept)
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.locateFigures}
            disabled={disabled}
            onChange={(e) => onChange({ locateFigures: e.target.checked })}
          />{' '}
          Ask the model where figures are when its list and the detected drawings disagree
        </label>
      </div>

      <details>
        <summary>Advanced</summary>
        <div className="grid">
          <div className="field">
            <label htmlFor="base">Ollama URL</label>
            <input
              id="base"
              value={settings.baseUrl}
              disabled={disabled}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
              aria-describedby="base-help"
            />
            <p id="base-help" className="hint">
              “/ollama” uses the dev-server proxy (recommended). A direct URL needs OLLAMA_ORIGINS set.
            </p>
          </div>
          <div className="field">
            <label htmlFor="ctx">Context window (num_ctx)</label>
            <input
              id="ctx"
              type="number"
              min={4096}
              step={1024}
              value={settings.numCtx}
              disabled={disabled}
              onChange={(e) => onChange({ numCtx: Math.max(4096, Number(e.target.value) || 8192) })}
            />
            <p className="hint">Must fit the image plus the transcription. 8192 is enough for most pages; 4096 saves memory on 8 GB Macs.</p>
          </div>
        </div>
      </details>
    </section>
  );
}
