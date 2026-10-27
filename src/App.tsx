import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Box, ModelInfo, Page, PageStatus, Settings } from './types.ts';
import { listModels } from './lib/ollama.ts';
import { ACCEPT, loadFile } from './lib/images.ts';
import { convertPage, rereadRegion } from './lib/pipeline.ts';
import { buildDocument, downloadHtml, looksLikeFileName } from './lib/exportHtml.ts';
import {
  PROJECT_EXT,
  afterFailedConversion,
  clearSession,
  loadSession,
  markWritten,
  projectFileName,
  projectFromJson,
  projectToJson,
  resetWritten,
  saveSession,
  type Session,
} from './lib/storage.ts';
import { findByText, loadLibrary, startupPrompt, storeLibrary, type PromptLibrary } from './lib/promptLibrary.ts';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { PageView } from './components/PageView.tsx';
import { PageList } from './components/PageList.tsx';
import { Dialog } from './components/Dialog.tsx';
import { ExportPanel } from './components/ExportPanel.tsx';

/* ---------------- settings ---------------- */

const SETTINGS_KEY = 'ink2web-lite:settings';
const DEFAULTS: Settings = { baseUrl: '/ollama', model: '', detail: 1344, enhance: true, locateFigures: true, numCtx: 8192 };

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

/* ---------------- pages state ---------------- */

type Action =
  | { type: 'add'; pages: Page[] }
  | { type: 'update'; id: string; patch: Partial<Page> }
  | { type: 'setStatus'; from: PageStatus[]; to: PageStatus }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; dir: -1 | 1 }
  | { type: 'clear' };

function reducer(pages: Page[], a: Action): Page[] {
  switch (a.type) {
    case 'add':
      return [...pages, ...a.pages];
    case 'update':
      return pages.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p));
    case 'setStatus':
      return pages.map((p) => (a.from.includes(p.status) ? { ...p, status: a.to, error: undefined } : p));
    case 'remove':
      return pages.filter((p) => p.id !== a.id);
    case 'move': {
      const i = pages.findIndex((p) => p.id === a.id);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= pages.length) return pages;
      const next = [...pages];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }
    case 'clear':
      return [];
  }
}

/** Pages that "Convert all" picks up: never converted, failed, or stopped. */
const CONVERTIBLE: PageStatus[] = ['idle', 'error', 'cancelled'];

const uid = () => Math.random().toString(36).slice(2, 10);

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateOf = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Waits this long after the last change before autosaving. */
const AUTOSAVE_DELAY = 800;

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);

  const [pages, dispatch] = useReducer(reducer, []);
  const [running, setRunning] = useState(false);
  /** Re-reads in flight. The model runs one job at a time (memory on 8 GB machines). */
  const [rereading, setRereading] = useState(0);
  const [live, setLive] = useState<{ id: string; text: string } | null>(null);
  const [status, setStatus] = useState('');
  const [loadingFiles, setLoadingFiles] = useState('');
  const [dragging, setDragging] = useState(false);
  /** The page shown in the workspace (2.1: one page at a time). */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** Open a figure's panel when its page shows (from the export checklist). */
  const [focusFigure, setFocusFigure] = useState<{ pageId: string; id: number; n: number } | null>(null);

  const [title, setTitle] = useState('');
  /** True while the title is the file name (until the user types their own). */
  const [titleAuto, setTitleAuto] = useState(true);
  const [pageMarkers, setPageMarkers] = useState(true);
  /** Saved transcription prompts (Advanced settings, 2.1.1), kept in this browser. */
  const [promptLib, setPromptLib] = useState<PromptLibrary>(loadLibrary);
  /**
   * Replacement for the transcription prompt (null = built-in). Starts as the saved
   * prompt marked "use whenever the app opens", if any. Not saved with the work.
   */
  const [customPrompt, setCustomPrompt] = useState<string | null>(() => startupPrompt(promptLib));
  const updatePromptLib = useCallback((lib: PromptLibrary) => {
    setPromptLib(lib);
    return storeLibrary(lib);
  }, []);
  const promptInUse = findByText(promptLib, customPrompt);
  const customPromptRef = useRef(customPrompt);
  customPromptRef.current = customPrompt;

  /** A session saved earlier in this browser, waiting for "Restore" or "Start fresh". */
  const [offer, setOffer] = useState<Session | null>(null);
  /** Autosave runs only once any saved session has been restored or set aside. */
  const [autosaveOn, setAutosaveOn] = useState(false);
  /** "Saved in this browser at 10:42", or why saving isn't possible. */
  const [saveNote, setSaveNote] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [settings]);

  // The sidebar and the original page stick just below the top bar, whose height changes when it wraps.
  useEffect(() => {
    const el = topRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const patchSettings = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);

  /* ---------- saved work: restore offer + autosave ---------- */

  useEffect(() => {
    let mounted = true;
    loadSession()
      .then((s) => {
        if (!mounted) return;
        if (s) setOffer(s);
        else setAutosaveOn(true);
      })
      .catch(() => {
        if (!mounted) return;
        setSaveFailed(true);
        setSaveNote('This browser can’t save work automatically. Use Save (top bar) to keep a project file.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  /** Replaces the current pages with a saved session or an opened project. */
  const applySession = useCallback((s: Session) => {
    abortRef.current?.abort();
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    dispatch({ type: 'clear' });
    dispatch({ type: 'add', pages: s.pages.map((p) => ({ ...p, url: URL.createObjectURL(p.image) })) });
    setCurrentId(s.pages[0]?.id ?? null);
    setTitle(s.title);
    setTitleAuto(s.titleAuto);
    setPageMarkers(s.pageMarkers);
  }, []);

  const restore = () => {
    if (!offer) return;
    applySession(offer);
    markWritten(offer.pages.map((p) => p.id)); // their images are already stored
    setStatus(`Restored ${offer.pages.length} page${offer.pages.length > 1 ? 's' : ''}.`);
    setOffer(null);
    setAutosaveOn(true);
  };

  const startFresh = async () => {
    if (!window.confirm('Start fresh? The work saved in this browser will be deleted.')) return;
    setOffer(null);
    try {
      await clearSession();
    } catch {
      /* nothing saved, or storage unavailable */
    }
    setAutosaveOn(true);
  };

  useEffect(() => {
    if (!autosaveOn) return;
    const t = setTimeout(async () => {
      try {
        if (!pages.length) {
          await clearSession();
          setSaveNote('');
        } else {
          const at = await saveSession({ title, titleAuto, pageMarkers }, pages);
          setSaveNote(`Saved in this browser at ${timeOf(at)}.`);
        }
        setSaveFailed(false);
      } catch (e) {
        setSaveFailed(true);
        setSaveNote(`Couldn’t save in this browser (${(e as Error).message}). Use Save (top bar) to keep a project file.`);
      }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(t);
  }, [autosaveOn, pages, title, titleAuto, pageMarkers]);

  /* ---------- project files ---------- */

  const saveProject = async () => {
    try {
      const json = await projectToJson({ title, titleAuto, pageMarkers }, pagesRef.current);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: projectFileName(title) });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Saved project “${projectFileName(title)}”.`);
    } catch (e) {
      setStatus(`Couldn’t save the project: ${(e as Error).message}`);
    }
  };

  const openProject = useCallback(
    async (file: File) => {
      if (runningRef.current) {
        setStatus('Stop the conversion before opening a project.');
        return;
      }
      try {
        const s = projectFromJson(await file.text());
        if (pagesRef.current.length && !window.confirm('Replace the current pages with this project?')) return;
        applySession(s);
        resetWritten(); // its images are not in this browser's storage yet
        setOffer(null);
        setAutosaveOn(true);
        setStatus(`Opened ${file.name} (${s.pages.length} page${s.pages.length > 1 ? 's' : ''}).`);
      } catch (e) {
        setStatus(`${file.name}: ${(e as Error).message}`);
      }
    },
    [applySession],
  );

  /* ---------- models ---------- */

  const refreshModels = useCallback(async () => {
    setLoadingModels(true);
    setModelError('');
    try {
      const list = await listModels(settingsRef.current.baseUrl);
      setModels(list);
      if (!list.length) setModelError('Ollama is running but has no models. Pull a vision model first.');
      const current = settingsRef.current.model;
      if (!list.some((m) => m.name === current)) {
        patchSettings({ model: (list.find((m) => m.vision !== false) ?? list[0])?.name ?? '' });
      }
    } catch (e) {
      setModels([]);
      setModelError((e as Error).message);
    } finally {
      setLoadingModels(false);
    }
  }, [patchSettings]);

  useEffect(() => {
    const t = setTimeout(refreshModels, 300);
    return () => clearTimeout(t);
  }, [settings.baseUrl, refreshModels]);

  /* ---------- files ---------- */

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        // A saved project dropped or chosen with the notes opens as a project.
        if (/\.json$/i.test(file.name)) {
          await openProject(file);
          continue;
        }
        try {
          setLoadingFiles(`Reading ${file.name}…`);
          const loaded = await loadFile(file, (n, total) => setLoadingFiles(`Reading ${file.name}: page ${n} of ${total}`));
          const added: Page[] = loaded.map((l) => ({
            ...l,
            id: uid(),
            url: URL.createObjectURL(l.image),
            // Nothing converts until the user asks (one page or all of them).
            status: 'idle',
            source: '',
            figures: [],
          }));
          dispatch({ type: 'add', pages: added });
          // Show the first new page if nothing is showing yet.
          if (added.length) setCurrentId((c) => (c && pagesRef.current.some((p) => p.id === c) ? c : added[0].id));
          setTitle((t) => t || file.name.replace(/\.[^.]+$/, ''));
        } catch (e) {
          setStatus((e as Error).message);
        }
      }
      setLoadingFiles('');
    },
    [openProject],
  );

  // Paste screenshots / images directly.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addFiles(files.map((f, i) => new File([f], f.name || `pasted-${Date.now()}-${i}.png`, { type: f.type })));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  /* ---------- conversion queue ----------
   * Only pages with status "queued" are converted, one at a time, in page order.
   * Pages get queued by their own Convert button or by "Convert all".
   */

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    if (!pagesRef.current.some((p) => p.status === 'queued')) return;
    const s = settingsRef.current;
    if (!s.model) {
      dispatch({ type: 'setStatus', from: ['queued'], to: 'idle' });
      setStatus('Choose a model first.');
      return;
    }
    runningRef.current = true;
    setRunning(true);
    const thinking = modelsRef.current.find((m) => m.name === s.model)?.thinking ?? false;
    try {
      for (;;) {
        // pagesRef is current here: the previous page's status changed during the await below.
        const all = pagesRef.current;
        const next = all.find((p) => p.status === 'queued');
        if (!next) break;
        const n = all.indexOf(next) + 1;
        const waiting = all.filter((p) => p.status === 'queued').length - 1;
        setStatus(`Converting page ${n} of ${all.length}${waiting ? ` (${waiting} more waiting)` : ''}…`);

        const ac = new AbortController();
        abortRef.current = ac;
        dispatch({ type: 'update', id: next.id, patch: { status: 'transcribing', error: undefined } });
        setLive({ id: next.id, text: '' });
        try {
          const started = performance.now();
          const result = await convertPage(next, s, thinking, ac.signal, (p) => {
            if (p.phase === 'locating') dispatch({ type: 'update', id: next.id, patch: { status: 'locating' } });
            else setLive({ id: next.id, text: p.text ?? '' });
          }, customPromptRef.current);
          dispatch({ type: 'update', id: next.id, patch: { ...result, status: 'done' } });
          setStatus(`Page ${n} done in ${((performance.now() - started) / 1000).toFixed(0)} s.`);
        } catch (e) {
          // "Convert again" that fails or is stopped keeps the previous result and edits.
          const aborted = (e as Error).name === 'AbortError';
          const patch = afterFailedConversion(next, aborted ? null : (e as Error).message);
          dispatch({ type: 'update', id: next.id, patch });
          if (aborted) {
            setStatus(patch.status === 'done' ? `Stopped. Page ${n} keeps its previous version.` : 'Stopped.');
            break;
          }
        }
      }
    } finally {
      runningRef.current = false;
      abortRef.current = null;
      setRunning(false);
      setLive(null);
    }
    // A page may have been queued just as the loop finished; pick it up.
    setTimeout(() => {
      if (pagesRef.current.some((p) => p.status === 'queued')) void processQueue();
    }, 0);
  }, []);

  /** Queue one page (it starts now, or after the page being converted). */
  const convertOne = useCallback(
    (id: string) => {
      dispatch({ type: 'update', id, patch: { status: 'queued', error: undefined } });
      // Let the dispatch land before the queue reads pagesRef.
      setTimeout(processQueue, 0);
    },
    [processQueue],
  );

  /** Take a waiting page back out of the queue. */
  const unqueue = useCallback((id: string) => {
    const p = pagesRef.current.find((x) => x.id === id);
    if (p?.status === 'queued') dispatch({ type: 'update', id, patch: { status: p.source ? 'done' : 'idle' } });
  }, []);

  const convertAll = () => {
    dispatch({ type: 'setStatus', from: CONVERTIBLE, to: 'queued' });
    setTimeout(processQueue, 0);
  };

  /** Stops the current page and empties the queue. */
  const stop = () => {
    abortRef.current?.abort();
    pagesRef.current
      .filter((p) => p.status === 'queued')
      .forEach((p) => dispatch({ type: 'update', id: p.id, patch: { status: p.source ? 'done' : 'idle' } }));
  };

  const onUpdate = useCallback((id: string, patch: Partial<Page>) => dispatch({ type: 'update', id, patch }), []);
  /** Re-reads one region of a page with the current model (2.0). Changes nothing by itself. */
  const onReread = useCallback((page: Page, box: Box, signal: AbortSignal) => {
    const s = settingsRef.current;
    if (!s.model) return Promise.reject(new Error('Choose a model first.'));
    if (runningRef.current) return Promise.reject(new Error('Wait for the conversion to finish, then re-read.'));
    const thinking = modelsRef.current.find((m) => m.name === s.model)?.thinking ?? false;
    setRereading((n) => n + 1);
    return rereadRegion(page, box, s, thinking, signal).finally(() => setRereading((n) => n - 1));
  }, []);
  const onMove = useCallback((id: string, dir: -1 | 1) => dispatch({ type: 'move', id, dir }), []);
  const onRemove = useCallback((id: string) => {
    const all = pagesRef.current;
    const i = all.findIndex((x) => x.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(all[i].url);
    // Show the next page (or the previous one, if this was the last).
    setCurrentId((c) => (c === id ? (all[i + 1] ?? all[i - 1])?.id ?? null : c));
    dispatch({ type: 'remove', id });
  }, []);

  const clearAll = () => {
    if (
      pagesRef.current.some((p) => p.status === 'done') &&
      !window.confirm('Clear all pages? Your converted pages and edits are removed, including the copy saved in this browser.')
    )
      return;
    abortRef.current?.abort();
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    dispatch({ type: 'clear' });
    setCurrentId(null);
    setTitle('');
    setTitleAuto(true);
    setStatus('');
  };

  const done = pages.filter((p) => p.status === 'done');
  const convertible = pages.filter((p) => CONVERTIBLE.includes(p.status)).length;
  const useHeading = titleAuto || looksLikeFileName(title);
  const current = pages.find((p) => p.id === currentId) ?? pages[0] ?? null;
  const currentIndex = current ? pages.indexOf(current) : -1;
  const model = models.find((m) => m.name === settings.model);
  const modelProblem = !!modelError || !settings.model || model?.vision === false;

  const onGo = useCallback((dir: -1 | 1) => {
    setCurrentId((c) => {
      const all = pagesRef.current;
      const i = Math.max(0, all.findIndex((p) => p.id === c));
      return all[Math.min(all.length - 1, Math.max(0, i + dir))]?.id ?? c;
    });
  }, []);

  // A new page starts at the top of the workspace.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [current?.id]);

  const exportHtml = () => {
    downloadHtml(buildDocument(done, { title, titleFromFileName: titleAuto, lang: 'en', pageMarkers }), title);
    setStatus(`Downloaded ${done.length} page${done.length > 1 ? 's' : ''}.`);
    setExportOpen(false);
  };

  const goTo = (pageId: string, figure?: number) => {
    setExportOpen(false);
    setCurrentId(pageId);
    if (figure !== undefined) setFocusFigure({ pageId, id: figure, n: Date.now() });
  };

  const offerDone = offer ? offer.pages.filter((p) => p.status === 'done').length : 0;

  const chooseFiles = () => fileInput.current?.click();
  const chooseProject = () => projectInput.current?.click();

  return (
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <input
        ref={fileInput}
        type="file"
        accept={`${ACCEPT},${PROJECT_EXT},.json`}
        multiple
        hidden
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept={`${PROJECT_EXT},.json,application/json`}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openProject(f);
          e.target.value = '';
        }}
      />

      <header className="top" ref={topRef}>
        <div className="brand">
          Ink2Web <span>Lite</span>
        </div>
        <div className="title-field">
          <label htmlFor="title" className="sr-only">
            Document title
          </label>
          <input
            id="title"
            value={title}
            placeholder="Document title"
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleAuto(false);
            }}
          />
          {saveNote && (
            <span className={`save-note${saveFailed ? ' failed' : ''}`} title={saveNote}>
              {saveFailed ? 'Not saved' : saveNote.replace(/^Saved in this browser at /, 'Saved ').replace(/\.$/, '')}
            </span>
          )}
        </div>
        <div className="top-actions">
          <button type="button" onClick={chooseProject} disabled={running}>
            Open
          </button>
          <button type="button" onClick={saveProject} disabled={!pages.length}>
            Save
          </button>
          <button
            type="button"
            className={`model-button${modelProblem ? ' problem' : ''}`}
            onClick={() => setSettingsOpen(true)}
            aria-haspopup="dialog"
          >
            <span className="sr-only">Model and settings: </span>
            {modelProblem ? '⚠ ' : ''}
            {settings.model || (loadingModels ? 'Loading models…' : 'Choose a model')}
          </button>
          <button type="button" className="primary" onClick={() => setExportOpen(true)} disabled={!pages.length} aria-haspopup="dialog">
            Export
          </button>
        </div>
      </header>

      {saveFailed && saveNote && (
        <p className="banner warn" role="alert">
          {saveNote}
        </p>
      )}
      {customPrompt !== null && (
        <p className="banner warn custom-prompt-banner" role="status">
          {promptInUse ? (
            <>
              <strong>Custom prompt in use: “{promptInUse.name}”.</strong> Pages you convert now use this saved prompt
              {promptInUse.id === promptLib.startupId ? ', which is set to start with the app' : ''}.
            </>
          ) : (
            <>
              <strong>Custom prompt in use.</strong> Pages you convert now use your edited prompt. It isn’t saved and ends when you
              reload the app.
            </>
          )}{' '}
          <button type="button" onClick={() => setCustomPrompt(null)} disabled={running}>
            Use the default prompt
          </button>
        </p>
      )}
      {offer && (
        <section className="banner restore" aria-labelledby="restore-h">
          <h2 id="restore-h">Continue where you left off?</h2>
          <p>
            Work saved in this browser on {dateOf(offer.savedAt)}: <strong>{offer.title || 'Untitled'}</strong>, {offer.pages.length} page
            {offer.pages.length > 1 ? 's' : ''} ({offerDone} converted).
          </p>
          <div className="actions">
            <button type="button" className="primary" onClick={restore}>
              Restore
            </button>
            <button type="button" onClick={startFresh}>
              Start fresh
            </button>
          </div>
          <p className="hint">Autosave is paused until you choose, so the saved work isn’t overwritten.</p>
        </section>
      )}

      <div className={`layout${pages.length ? '' : ' empty'}`}>
        {pages.length > 0 && (
          <nav className="sidebar" aria-label="Pages and conversion">
            <div className="sidebar-actions">
              <button type="button" onClick={chooseFiles}>
                + Add pages
              </button>
              {running ? (
                <button type="button" className="danger" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  onClick={convertAll}
                  disabled={!convertible || !settings.model || rereading > 0}
                  title={rereading > 0 ? 'Wait for the re-read to finish.' : undefined}
                >
                  Convert all{convertible ? ` (${convertible})` : ''}
                </button>
              )}
            </div>
            <p className="status" role="status" aria-live="polite">
              {loadingFiles || status}
            </p>
            <PageList pages={pages} currentId={current?.id ?? null} onSelect={setCurrentId} />
            <button type="button" className="clear-all" onClick={clearAll} disabled={running}>
              Clear all pages
            </button>
          </nav>
        )}

        <main id="main" tabIndex={-1}>
          {current ? (
            <PageView
              key={current.id}
              page={current}
              index={currentIndex}
              count={pages.length}
              liveText={live?.id === current.id ? live.text : null}
              canConvert={!!settings.model}
              busy={running ? 'converting' : rereading > 0 ? 'rereading' : null}
              focusFigure={focusFigure?.pageId === current.id ? { id: focusFigure.id, n: focusFigure.n } : null}
              onUpdate={onUpdate}
              onConvert={convertOne}
              onUnqueue={unqueue}
              onRemove={onRemove}
              onMove={onMove}
              onGo={onGo}
              onReread={onReread}
            />
          ) : (
            <section className="welcome" aria-labelledby="welcome-h">
              <h1 id="welcome-h">Handwritten math → accessible HTML</h1>
              <p className="lead">Everything runs on your own computer. Nothing leaves it.</p>
              <div className="drop">
                <p>Drop PDFs or photos of handwritten notes anywhere in this window, paste an image, or</p>
                <div className="actions center">
                  <button type="button" className="primary" onClick={chooseFiles}>
                    Choose files
                  </button>
                  <button type="button" onClick={chooseProject}>
                    Open a saved project
                  </button>
                </div>
                <p className="hint">PDF, PNG, JPEG, WebP, or an {PROJECT_EXT} project.</p>
              </div>
              <ol className="steps">
                <li>
                  <strong>Add your notes.</strong> Each page appears in the list on the left.
                </li>
                <li>
                  <strong>Convert</strong> one page, or all of them. The model reads one page at a time.
                </li>
                <li>
                  <strong>Review</strong> each page beside its original: click anything to fix it, or have the model re-read just that spot.
                </li>
                <li>
                  <strong>Export</strong> one accessible HTML file. Your work is saved in this browser as you go.
                </li>
              </ol>
              {modelProblem && (
                <p className="warn">
                  {modelError || (settings.model ? 'The selected model can’t read images.' : 'No model selected yet.')}{' '}
                  <button type="button" className="link" onClick={() => setSettingsOpen(true)}>
                    Open model settings
                  </button>
                </p>
              )}
              <p className="status" role="status" aria-live="polite">
                {loadingFiles || status}
              </p>
            </section>
          )}
        </main>
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p>Drop to add pages</p>
        </div>
      )}

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Model and settings" id="settings" wide>
        <SettingsPanel
          settings={settings}
          models={models}
          modelError={modelError}
          loadingModels={loadingModels}
          disabled={running}
          onChange={patchSettings}
          onRefresh={refreshModels}
          customPrompt={customPrompt}
          onCustomPrompt={setCustomPrompt}
          promptLibrary={promptLib}
          onPromptLibrary={updatePromptLib}
        />
      </Dialog>

      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title="Export" id="export">
        <ExportPanel
          pages={pages}
          titleFromHeading={useHeading}
          pageMarkers={pageMarkers}
          onPageMarkers={setPageMarkers}
          onDownload={exportHtml}
          onGoTo={goTo}
        />
      </Dialog>
    </div>
  );
}
