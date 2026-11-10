import { useEffect, useState } from 'react';
import type { ModelInfo, Settings } from '../types.ts';
import { PromptInspector } from './PromptInspector.tsx';
import type { PromptLibrary } from '../lib/promptLibrary.ts';
import { BUILTIN_IDS, BUILTIN_PROMPTS, promptSizeHint } from '../lib/prompts.ts';

interface Props {
  settings: Settings;
  models: ModelInfo[];
  modelError: string;
  loadingModels: boolean;
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onRefresh: () => void;
  /** Custom transcription prompt in use (null = the built-in one chosen in settings.promptSet). */
  customPrompt: string | null;
  onCustomPrompt: (prompt: string | null) => void;
  /** Saved prompts; onPromptLibrary returns false if the browser refused to store them. */
  promptLibrary: PromptLibrary;
  onPromptLibrary: (lib: PromptLibrary) => boolean;
}

const DETAIL = [
  { value: 1024, label: 'Fast (1024 px)' },
  { value: 1344, label: 'Balanced (1344 px)' },
  { value: 1792, label: 'High detail (1792 px)' },
];

export function SettingsPanel({
  settings,
  models,
  modelError,
  loadingModels,
  disabled,
  onChange,
  onRefresh,
  customPrompt,
  onCustomPrompt,
  promptLibrary,
  onPromptLibrary,
}: Props) {
  const selected = models.find((m) => m.name === settings.model);
  // Typed freely, applied when the field loses focus (so typing "16384" isn't clamped at "1").
  const [ctxDraft, setCtxDraft] = useState(String(settings.numCtx));
  useEffect(() => setCtxDraft(String(settings.numCtx)), [settings.numCtx]);
  const applyCtx = () => {
    const n = Math.max(4096, Math.round(Number(ctxDraft) || 8192));
    setCtxDraft(String(n));
    if (n !== settings.numCtx) onChange({ numCtx: n });
  };

  return (
    <div className="settings">
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
              'Tuned for qwen3-vl:4b-instruct and qwen2.5vl:3b. On a more powerful computer, try a larger model with the Larger models prompt below.'
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
      </div>

      <fieldset className="field prompt-set" disabled={disabled} aria-describedby="prompt-set-help">
        <legend>Transcription prompt</legend>
        {BUILTIN_IDS.map((id) => (
          <label key={id} className="prompt-choice">
            <input
              type="radio"
              name="prompt-set"
              value={id}
              checked={settings.promptSet === id}
              onChange={() => onChange({ promptSet: id })}
            />{' '}
            <span>
              <strong>{BUILTIN_PROMPTS[id].label}</strong>
              {id === 'everyday' ? ' (default)' : ''}
              <span className="hint">{BUILTIN_PROMPTS[id].hint}</span>
            </span>
          </label>
        ))}
        <p id="prompt-set-help" className="hint" role="status">
          {customPrompt !== null
            ? 'A custom prompt is in use (Advanced › Transcription prompt); this choice applies once you switch back to the built-in prompt.'
            : promptSizeHint(settings.promptSet, selected?.sizeGB) ||
              'Applies to pages you convert next. Converted pages keep their text until you convert them again.'}
        </p>
      </fieldset>

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
              value={ctxDraft}
              disabled={disabled}
              onChange={(e) => setCtxDraft(e.target.value)}
              onBlur={applyCtx}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyCtx();
              }}
            />
            <p className="hint">Must fit the image plus the transcription. 8192 is enough for most pages; 4096 saves memory on 8 GB Macs.</p>
          </div>
        </div>
        <PromptInspector
          customPrompt={customPrompt}
          onCustomPrompt={onCustomPrompt}
          promptSet={settings.promptSet}
          onPromptSet={(promptSet) => onChange({ promptSet })}
          library={promptLibrary}
          onLibrary={onPromptLibrary}
          disabled={disabled}
        />
      </details>
    </div>
  );
}
