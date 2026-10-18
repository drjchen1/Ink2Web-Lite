import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ModelInfo, Page, PageStatus, Settings } from './types.ts';
import { listModels } from './lib/ollama.ts';
import { ACCEPT, loadFile } from './lib/images.ts';
import { convertPage } from './lib/pipeline.ts';
import { buildDocument, downloadHtml, looksLikeFileName } from './lib/exportHtml.ts';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { PageView } from './components/PageView.tsx';

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

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);

  const [pages, dispatch] = useReducer(reducer, []);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<{ id: string; text: string } | null>(null);
  const [status, setStatus] = useState('');
  const [loadingFiles, setLoadingFiles] = useState('');
  const [dragging, setDragging] = useState(false);

  const [title, setTitle] = useState('');
  /** True while the title is the file name (until the user types their own). */
  const [titleAuto, setTitleAuto] = useState(true);
  const [pageMarkers, setPageMarkers] = useState(true);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [settings]);
  const patchSettings = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);

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

  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        setLoadingFiles(`Reading ${file.name}…`);
        const loaded = await loadFile(file, (n, total) => setLoadingFiles(`Reading ${file.name}: page ${n} of ${total}`));
        dispatch({
          type: 'add',
          pages: loaded.map((l) => ({
            ...l,
            id: uid(),
            url: URL.createObjectURL(l.image),
            // Nothing converts until the user asks (one page or all of them).
            status: 'idle',
            source: '',
            figures: [],
          })),
        });
        setTitle((t) => t || file.name.replace(/\.[^.]+$/, ''));
      } catch (e) {
        setStatus((e as Error).message);
      }
    }
    setLoadingFiles('');
  }, []);

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
          });
          dispatch({ type: 'update', id: next.id, patch: { ...result, status: 'done' } });
          setStatus(`Page ${n} done in ${((performance.now() - started) / 1000).toFixed(0)} s.`);
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            dispatch({ type: 'update', id: next.id, patch: { status: 'cancelled' } });
            setStatus('Stopped.');
            break;
          }
          dispatch({ type: 'update', id: next.id, patch: { status: 'error', error: (e as Error).message } });
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
  const onMove = useCallback((id: string, dir: -1 | 1) => dispatch({ type: 'move', id, dir }), []);
  const onRemove = useCallback((id: string) => {
    const p = pagesRef.current.find((x) => x.id === id);
    if (p) URL.revokeObjectURL(p.url);
    dispatch({ type: 'remove', id });
  }, []);

  const clearAll = () => {
    abortRef.current?.abort();
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    dispatch({ type: 'clear' });
    setTitle('');
    setTitleAuto(true);
    setStatus('');
  };

  const done = pages.filter((p) => p.status === 'done');
  const convertible = pages.filter((p) => CONVERTIBLE.includes(p.status)).length;
  const notDone = pages.length - done.length;
  const missingAlt = done.reduce((n, p) => n + p.figures.filter((f) => !f.alt.trim()).length, 0);
  const useHeading = titleAuto || looksLikeFileName(title);

  const exportHtml = () => {
    downloadHtml(buildDocument(done, { title, titleFromFileName: titleAuto, lang: 'en', pageMarkers }), title);
    setStatus(`Downloaded ${done.length} page${done.length > 1 ? 's' : ''}.`);
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="top">
        <h1>
          Ink2Web <span>Lite</span>
        </h1>
        <p>Handwritten math → accessible HTML, on your own computer.</p>
      </header>

      <main id="main">
        <SettingsPanel
          settings={settings}
          models={models}
          modelError={modelError}
          loadingModels={loadingModels}
          disabled={running}
          onChange={patchSettings}
          onRefresh={refreshModels}
        />

        <section className="panel" aria-labelledby="upload-h">
          <h2 id="upload-h">Notes</h2>
          <div
            className={`drop${dragging ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles([...e.dataTransfer.files]);
            }}
          >
            <p>Drop PDFs or photos of handwritten notes here, paste an image, or</p>
            <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
              Choose files
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <p className="hint">PDF, PNG, JPEG, WebP. Nothing leaves your computer.</p>
          </div>

          <div className="toolbar">
            <button type="button" className="primary" onClick={convertAll} disabled={!convertible || !settings.model}>
              Convert all{convertible ? ` (${convertible} page${convertible > 1 ? 's' : ''})` : ''}
            </button>
            {running && (
              <button type="button" className="danger" onClick={stop}>
                Stop
              </button>
            )}
            <button type="button" onClick={clearAll} disabled={!pages.length || running}>
              Clear all
            </button>
          </div>
          {pages.length > 1 && !running && convertible > 0 && (
            <p className="hint">Or use the Convert button on a page to convert just that page.</p>
          )}

          <p className="status" role="status" aria-live="polite">
            {loadingFiles || status}
          </p>
        </section>

        {pages.length > 0 && (
          <section aria-labelledby="pages-h">
            <h2 id="pages-h" className="section-title">
              Pages
            </h2>
            {pages.map((p, i) => (
              <PageView
                key={p.id}
                page={p}
                index={i}
                count={pages.length}
                liveText={live?.id === p.id ? live.text : null}
                canConvert={!!settings.model}
                onUpdate={onUpdate}
                onConvert={convertOne}
                onUnqueue={unqueue}
                onRemove={onRemove}
                onMove={onMove}
              />
            ))}
          </section>
        )}

        {done.length > 0 && (
          <section className="panel" aria-labelledby="export-h">
            <h2 id="export-h">Export</h2>
            <div className="grid">
              <div className="field">
                <label htmlFor="title">Document title (becomes the page’s h1 and &lt;title&gt;)</label>
                <input
                  id="title"
                  value={title}
                  aria-describedby="title-help"
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleAuto(false);
                  }}
                />
                <p id="title-help" className="hint">
                  {useHeading
                    ? 'This is the file name, so the first heading in your notes will be used as the title. Type your own title to override it.'
                    : 'Used as written.'}
                </p>
              </div>
            </div>
            <div className="checks">
              <label>
                <input type="checkbox" checked={pageMarkers} onChange={(e) => setPageMarkers(e.target.checked)} /> Mark
                page boundaries
              </label>
            </div>
            {missingAlt > 0 && (
              <p className="warn">
                {missingAlt} figure{missingAlt > 1 ? 's are' : ' is'} missing alt text.
              </p>
            )}
            <p className="hint">
              Exports {done.length} converted page{done.length > 1 ? 's' : ''}
              {notDone > 0 ? `; ${notDone} page${notDone > 1 ? 's' : ''} not converted will be left out` : ''}.
            </p>
            <button type="button" className="primary" onClick={exportHtml}>
              Download HTML
            </button>
          </section>
        )}
      </main>
    </>
  );
}
