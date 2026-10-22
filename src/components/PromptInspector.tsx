import { useState } from 'react';
import { TRANSCRIBE_USER, isDefaultPrompt, promptIssues } from '../lib/prompts.ts';

interface Props {
  /** The temporary prompt, or null when the built-in one is used. */
  customPrompt: string | null;
  onCustomPrompt: (prompt: string | null) => void;
  disabled: boolean;
}

/**
 * Shows the transcription prompt sent to the model and lets the user try an edited
 * version. The edit lives only in memory: it applies to pages converted from now on,
 * is not saved, and ends when the app reloads.
 */
export function PromptInspector({ customPrompt, onCustomPrompt, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(customPrompt ?? TRANSCRIBE_USER);
  const [copied, setCopied] = useState('');

  const issues = promptIssues(draft);
  const changed = !isDefaultPrompt(draft);
  const applied = customPrompt !== null && draft === customPrompt;

  const use = () => onCustomPrompt(changed ? draft : null);
  const reset = () => {
    setDraft(TRANSCRIBE_USER);
    onCustomPrompt(null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied('Copied.');
    } catch {
      setCopied('Couldn’t copy; select the text and copy it instead.');
    }
    setTimeout(() => setCopied(''), 2500);
  };

  return (
    <div className="field prompt-inspector">
      <div className="prompt-head">
        <span className="prompt-title" id="prompt-h">
          Transcription prompt
        </span>
        <span className={`badge ${customPrompt !== null ? 'error' : 'done'}`}>{customPrompt !== null ? 'Custom (temporary)' : 'Default'}</span>
        <button type="button" aria-expanded={open} aria-controls="prompt-body" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide prompt' : 'Inspect or change'}
        </button>
      </div>
      <p className="hint">
        The instructions the model gets for each page. For experiments: an edited prompt applies to pages you convert
        next, isn’t saved, and ends when you reload the app. Ink2Web Lite is tuned for the default.
      </p>

      {open && (
        <div id="prompt-body">
          <label htmlFor="prompt-text" className="sr-only">
            Transcription prompt
          </label>
          <textarea
            id="prompt-text"
            className="prompt-text"
            rows={18}
            spellCheck={false}
            value={draft}
            disabled={disabled}
            aria-describedby={issues.length ? 'prompt-issues' : undefined}
            onChange={(e) => setDraft(e.target.value)}
          />
          {issues.length > 0 && (
            <div id="prompt-issues" className="warn" role="status">
              <p>
                <strong>This prompt no longer asks for formats the app relies on:</strong>
              </p>
              <ul>
                {issues.map((i) => (
                  <li key={i.need}>
                    <strong>{i.need}.</strong> {i.effect}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="actions">
            <button type="button" className="primary" onClick={use} disabled={disabled || applied || (!changed && customPrompt === null)}>
              {changed ? 'Use this prompt' : 'Use the default'}
            </button>
            <button type="button" onClick={reset} disabled={disabled || (!changed && customPrompt === null)}>
              Reset to default
            </button>
            <button type="button" onClick={copy}>
              Copy prompt
            </button>
            <span className="hint" role="status" aria-live="polite">
              {copied ||
                (applied
                  ? 'In use for the next conversions.'
                  : changed
                    ? 'Edited, not in use yet.'
                    : customPrompt !== null
                      ? 'The default text, but a custom prompt is still in use.'
                      : '')}
            </span>
          </div>
          <p className="hint">
            To keep a change for good, copy it into <code>src/lib/prompts.ts</code> (see “Tuned for Qwen” in the
            README) and run <code>npm test</code>.
          </p>
        </div>
      )}
    </div>
  );
}
