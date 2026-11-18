import { useEffect, useState } from 'react';
import type { ModelInfo, Provider, Settings } from '../types.ts';
import { PROVIDERS } from '../lib/model.ts';
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

  const genai = settings.provider === 'genai';
  const switchTo = (provider: Provider) => {
    if (provider === settings.provider) return;
    // Each provider keeps its own model; the list reloads for the new one.
    onChange({ provider, model: settings.lastModels[provider] ?? '' });
  };

  return (
    <div className="settings">
      <fieldset className="field provider-set" disabled={disabled}>
        <legend>Where the model runs</legend>
        <div className="seg" role="group" aria-label="Where the model runs">
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
            <button key={p} type="button" aria-pressed={settings.provider === p} onClick={() => switchTo(p)}>
              {p === 'genai' && <span aria-hidden="true">☁ </span>}
              {PROVIDERS[p].label}
            </button>
          ))}
        </div>
        {genai ? (
          <p className="warn provider-note">
            <strong>Pages are sent to Purdue GenAI Studio</strong> (Purdue-run servers; approved for public and sensitive L2
            data). Use it for your own notes, <strong>never for student work</strong> (FERPA). Your saved work and project
            files still stay in this browser.
          </p>
        ) : (
          <p className="hint">Everything stays on this computer. Nothing is uploaded.</p>
        )}
      </fieldset>

      <div className="grid">
        <div className="field">
          <label htmlFor="model">{genai ? 'GenAI Studio model' : 'Ollama vision model'}</label>
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
                  {m.name}
                  {m.hosted ? '' : ` · ${m.sizeGB.toFixed(1)} GB`}
                  {m.vision === false ? ' · no vision' : ''}
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
              <span className="error-text">
                This model can’t read images. Pick a vision model{genai ? '.' : ' (e.g. pull one with “ollama pull …”).'}
              </span>
            ) : genai ? (
              'Choose a model that reads images (for example a Qwen VL or Gemma model). Large models do best with the Larger models prompt below.'
            ) : (
              'Recommended: qwen3.5:4b-mlx on Apple Silicon, otherwise qwen3-vl:4b-instruct. On a more powerful computer, try a larger model with the Larger models prompt below.'
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
        {genai ? (
          <p className="hint">
            GenAI Studio is reached through this app’s own server, which adds your API key from <code>.env.local</code> (see
            README › GenAI Studio). The key never reaches the browser.
          </p>
        ) : (
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
        )}
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
