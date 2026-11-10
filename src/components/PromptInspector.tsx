import { useEffect, useState } from 'react';
import { BUILTIN_IDS, BUILTIN_PROMPTS, builtinOf, promptIssues, type BuiltinPromptId } from '../lib/prompts.ts';
import {
  builtinChanged,
  deletePrompt,
  findByName,
  findByText,
  savePrompt,
  setStartup,
  type PromptLibrary,
} from '../lib/promptLibrary.ts';

interface Props {
  /** The custom prompt in use, or null when the chosen built-in one is used. */
  customPrompt: string | null;
  onCustomPrompt: (prompt: string | null) => void;
  /** The chosen built-in prompt (2.1.2: everyday hardware or larger models). */
  promptSet: BuiltinPromptId;
  onPromptSet: (id: BuiltinPromptId) => void;
  /** Saved prompts (2.1.1). */
  library: PromptLibrary;
  /** Stores the library; returns false if the browser refused to save it. */
  onLibrary: (lib: PromptLibrary) => boolean;
  disabled: boolean;
}

/** Editor source ids for the built-in prompts (saved prompts use their own ids). */
const builtinKey = (id: BuiltinPromptId) => `builtin:${id}`;
const keyToBuiltin = (key: string) => BUILTIN_IDS.find((id) => builtinKey(id) === key);

/**
 * Shows the transcription prompt sent to the model and lets the user try an edited
 * version. "Use this prompt" applies the editor's text to pages converted from now on.
 * Since 2.1.1, a prompt can also be saved under a name in this browser, and one saved
 * prompt can be set to start with the app. The built-in prompts themselves never change.
 *
 * Since 2.1.2 there are two built-in prompts (chosen above, in the main settings). Either
 * can be loaded here to read or start an edit from; a saved prompt remembers which one
 * it was based on.
 */
export function PromptInspector({ customPrompt, onCustomPrompt, promptSet, onPromptSet, library, onLibrary, disabled }: Props) {
  const inUse = findByText(library, customPrompt);
  const [open, setOpen] = useState(false);
  /** Where the editor's text came from: a built-in key or a saved prompt's id. */
  const [sourceId, setSourceId] = useState(inUse?.id ?? builtinKey(promptSet));
  const [draft, setDraft] = useState(customPrompt ?? BUILTIN_PROMPTS[promptSet].text);
  const [name, setName] = useState(inUse?.name ?? '');
  const [note, setNote] = useState('');

  const source = library.prompts.find((p) => p.id === sourceId);
  /** The built-in prompt the editor's text is based on. */
  const base: BuiltinPromptId = source?.base ?? keyToBuiltin(sourceId) ?? promptSet;
  const sourceText = source?.text ?? BUILTIN_PROMPTS[base].text;
  const issues = promptIssues(draft);
  /** The built-in prompt the editor holds, unedited, if any. */
  const draftBuiltin = builtinOf(draft);
  const applied = customPrompt !== null ? draft === customPrompt : draftBuiltin === promptSet;
  const chosen = BUILTIN_PROMPTS[promptSet];
  const target = findByName(library, name);

  // Choosing the other built-in prompt (in the main settings) while the editor shows an
  // unedited built-in prompt shows the newly chosen one.
  useEffect(() => {
    if (customPrompt === null && keyToBuiltin(sourceId) && builtinOf(draft)) {
      setSourceId(builtinKey(promptSet));
      setDraft(BUILTIN_PROMPTS[promptSet].text);
    }
  }, [promptSet]); // only when the choice changes
  const canSave = !disabled && !!name.trim() && !!draft.trim() && !(target && target.text === draft);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(''), 3000);
  };
  const store = (lib: PromptLibrary, ok: string) =>
    flash(onLibrary(lib) ? ok : 'This browser didn’t allow saving (private window or storage full). Use Copy prompt to keep it.');

  /** An unedited built-in prompt becomes the chosen built-in; anything else is a custom prompt. */
  const use = () => {
    if (draftBuiltin) {
      onPromptSet(draftBuiltin);
      onCustomPrompt(null);
    } else onCustomPrompt(draft);
  };
  const reset = () => {
    setDraft(chosen.text);
    setSourceId(builtinKey(promptSet));
    setName('');
    onCustomPrompt(null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      flash('Copied.');
    } catch {
      flash('Couldn’t copy; select the text and copy it instead.');
    }
  };

  const load = (id: string) => {
    if (draft !== sourceText && !window.confirm('Discard your edits to the prompt in the editor?')) return;
    const p = library.prompts.find((q) => q.id === id);
    const b = keyToBuiltin(id) ?? promptSet;
    setSourceId(p?.id ?? builtinKey(b));
    setDraft(p?.text ?? BUILTIN_PROMPTS[b].text);
    setName(p?.name ?? '');
  };

  const save = () => {
    const old = findByName(library, name);
    if (old && !window.confirm(`Replace the saved prompt “${old.name}” with the text in the editor?`)) return;
    try {
      const { lib, saved } = savePrompt(library, name, draft, Date.now(), undefined, base);
      store(lib, old ? `Updated “${saved.name}”.` : `Saved “${saved.name}”.`);
      setSourceId(saved.id);
      setName(saved.name);
      // Updating the prompt that's in use keeps it in use, with the new text.
      if (old && customPrompt === old.text) onCustomPrompt(draft);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const remove = () => {
    if (!source || !window.confirm(`Delete the saved prompt “${source.name}”?`)) return;
    store(deletePrompt(library, source.id), `Deleted “${source.name}”.${customPrompt === source.text ? ' It stays in use until you switch or reload.' : ''}`);
    setSourceId(builtinKey(source.base));
  };

  const toggleStartup = (on: boolean) => {
    if (!source) return;
    store(
      setStartup(library, on ? source.id : null),
      on ? `“${source.name}” will be in use when the app opens.` : 'The chosen built-in prompt will be in use when the app opens.',
    );
  };

  const badge = customPrompt === null ? `Built-in: ${chosen.label}` : inUse ? `Saved: ${inUse.name}` : 'Custom (unsaved)';

  return (
    <div className="field prompt-inspector">
      <div className="prompt-head">
        <span className="prompt-title" id="prompt-h">
          Transcription prompt
        </span>
        <span className={`badge ${customPrompt !== null ? 'error' : 'done'}`}>{badge}</span>
        <button type="button" aria-expanded={open} aria-controls="prompt-body" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide prompt' : 'Inspect or change'}
        </button>
      </div>
      <p className="hint">
        The instructions the model gets for each page. An edited prompt applies to pages you convert next and replaces the
        built-in choice above while it’s in use. Save it under a name to keep it in this browser. The built-in prompts never
        change.
      </p>

      {open && (
        <div id="prompt-body">
          <div className="row prompt-source">
            <label htmlFor="prompt-source">Prompt</label>
            <select id="prompt-source" value={sourceId} disabled={disabled} onChange={(e) => load(e.target.value)}>
              {BUILTIN_IDS.map((id) => (
                <option key={id} value={builtinKey(id)}>
                  Built-in: {BUILTIN_PROMPTS[id].label}
                  {id === 'everyday' ? ' (default)' : ''}
                </option>
              ))}
              {library.prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === library.startupId ? ' (starts with the app)' : ''}
                </option>
              ))}
            </select>
            {source && (
              <button type="button" onClick={remove} disabled={disabled}>
                Delete
              </button>
            )}
          </div>
          {source && (
            <label className="prompt-startup">
              <input
                type="checkbox"
                checked={library.startupId === source.id}
                disabled={disabled}
                onChange={(e) => toggleStartup(e.target.checked)}
              />{' '}
              Use “{source.name}” whenever the app opens
            </label>
          )}
          {source && builtinChanged(source) && (
            <p className="hint">
              The built-in {BUILTIN_PROMPTS[source.base].label} prompt has been updated since “{source.name}” was saved. Compare
              them (select Built-in: {BUILTIN_PROMPTS[source.base].label}) in case the update fixes something your version also
              changes.
            </p>
          )}

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
            <button type="button" className="primary" onClick={use} disabled={disabled || applied || !draft.trim()}>
              {draftBuiltin ? `Use the built-in ${BUILTIN_PROMPTS[draftBuiltin].label} prompt` : 'Use this prompt'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={disabled || (customPrompt === null && draft === chosen.text && sourceId === builtinKey(promptSet))}
            >
              Reset to built-in
            </button>
            <button type="button" onClick={copy}>
              Copy prompt
            </button>
          </div>

          <div className="row prompt-save">
            <label htmlFor="prompt-name">Save as</label>
            <input
              id="prompt-name"
              value={name}
              placeholder="Name, e.g. Qwen 3 test"
              maxLength={60}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) save();
              }}
            />
            <button type="button" onClick={save} disabled={!canSave}>
              {target ? `Update “${target.name}”` : 'Save'}
            </button>
          </div>

          <p className="hint" role="status" aria-live="polite">
            {note ||
              (applied
                ? 'In use for the next conversions.'
                : draftBuiltin
                  ? `The built-in ${BUILTIN_PROMPTS[draftBuiltin].label} prompt, not in use.`
                  : 'Edited, not in use yet.')}
          </p>
          <p className="hint">
            Saved prompts stay in this browser only. To share one or make it part of the app, use <code>Copy prompt</code>, paste it
            into <code>src/lib/prompts.ts</code>, and run <code>npm test</code>.
          </p>
        </div>
      )}
    </div>
  );
}
