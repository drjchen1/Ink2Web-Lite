import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Box, Figure, Page } from '../types.ts';
import { pageHtml, wrapEndLines, type ExportLook } from '../lib/exportHtml.ts';
<<<<<<< HEAD
import {
  blockText,
  commitBlock,
  estimateBlockBands,
  mergeBlockWithNext,
  moveAltToNotes,
  pageBlocks,
  pageIssues,
  shortcutMark,
  splitBlocks,
  type Block,
} from '../lib/editing.ts';
=======
import { blockText, pageIssues, commitBlock, moveAltToNotes, pageBlocks, shortcutMark, splitBlocks, type Block } from '../lib/editing.ts';
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
import { latexWarnings } from '../lib/markdown.ts';
import { cropFigure, pageLayout, snapToInk } from '../lib/images.ts';
import { defaultLayout, overlapRatio, type TextLine } from '../lib/layout.ts';
import { EMPTY_HISTORY, pushHistory, redoHistory, snapshotsEqual, undoHistory, type HistoryState, type PageSnapshot } from '../lib/history.ts';
import { besideUnitCount, placeOne } from '../lib/placement.ts';
import { markerUnitIndex, moveMarker, nextFigureId, sourceUnits } from '../lib/transcript.ts';
import { figureRows, fitWidths, placeAfter, previousFigure } from '../lib/figureRows.ts';
import { CropCanvas } from './CropCanvas.tsx';
import { Preview } from './Preview.tsx';
import { BlockEditor } from './BlockEditor.tsx';
import { MarkupToolbar, applyMarkToTextarea } from './MarkupToolbar.tsx';
import { FigurePanel } from './FigurePanel.tsx';
import type { RedrawOutcome } from '../lib/redraw/conversation.ts';
import type { FigureDescription } from '../lib/describe.ts';

export const STATUS: Record<Page['status'], string> = {
  idle: 'Not converted',
  queued: 'Waiting',
  transcribing: 'Transcribing…',
  locating: 'Finding figures…',
  done: 'Done',
  error: 'Error',
  cancelled: 'Stopped',
};

/** Badge class for a status ("idle" shares the muted look of "queued"). */
export const statusClass = (s: Page['status']) => (s === 'idle' ? 'queued' : s);

interface Props {
  page: Page;
  index: number;
  count: number;
  liveText: string | null;
  /** A model is selected. */
  canConvert: boolean;
  /** The model is in use (a conversion or a re-read); the other kind of job waits. */
  busy: 'converting' | 'rereading' | null;
  /** Open this figure's panel (from the export checklist or Review bar). `n` changes on every request. */
  focusFigure: { id: number; n: number } | null;
<<<<<<< HEAD
  /** Open this text block editor (from the export checklist or Review bar). `n` changes on every request. */
  focusBlockRequest?: { id: number; n: number } | null;
=======
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
  look?: ExportLook;
  onUpdate: (id: string, patch: Partial<Page>) => void;
  /** Converts this page only (now, or after the page being converted). */
  onConvert: (id: string) => void;
  /** Takes this page back out of the queue. */
  onUnqueue: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  /** Go to the previous / next page. */
  onGo: (dir: -1 | 1) => void;
  /** Re-reads a region of the original page; resolves with the proposed text. */
  onReread: (page: Page, box: Box, signal: AbortSignal) => Promise<string>;
  /** Asks the model for a figure's redraw spec (2.2); resolves with a proposal. */
  onRedraw: (page: Page, fig: Figure, signal: AbortSignal) => Promise<RedrawOutcome>;
  /** Asks the model for a figure's title and detailed description (3.2). */
  onDescribe: (page: Page, fig: Figure, signal: AbortSignal) => Promise<FigureDescription | null>;
}

/** The text block open for editing in place. */
interface Editing {
  i: number;
  block: Block;
  /** Its source when opened (to write it back even if the page shifted). */
  original: string;
  text: string;
}

interface Reread {
  phase: 'select' | 'running' | 'review';
  box: Box | null;
  text: string;
  error: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * One page (2.1): the original on the left (sticky, with its tools on top) and the
 * document on the right. Text blocks and figures open in place when clicked.
 */
export const PageView = memo(function PageView(props: Props) {
<<<<<<< HEAD
  const {
    page,
    index,
    count,
    liveText,
    canConvert,
    busy,
    focusFigure,
    focusBlockRequest,
    look = 'classic',
    onUpdate,
    onConvert,
    onUnqueue,
    onRemove,
    onMove,
    onGo,
    onReread,
    onRedraw,
    onDescribe,
  } = props;
=======
  const { page, index, count, liveText, canConvert, busy, focusFigure, look = 'classic', onUpdate, onConvert, onUnqueue, onRemove, onMove, onGo, onReread, onRedraw, onDescribe } =
    props;
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
  const pageNo = index + 1;
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  /** The figure whose panel is open (its crop box is editable on the image). */
  const [active, setActive] = useState<number | null>(null);
  const [focusAlt, setFocusAlt] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reread, setReread] = useState<Reread | null>(null);
  const [hoverBlock, setHoverBlock] = useState<number | null>(null);
  const [loupe, setLoupe] = useState(false);
  const [scanLines, setScanLines] = useState<TextLine[]>([]);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const historyRef = useRef(history);
  historyRef.current = history;
  const pendingBase = useRef<PageSnapshot | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rereadAbort = useRef<AbortController | null>(null);
  const reviewRef = useRef<HTMLTextAreaElement>(null);
  const srcRef = useRef<HTMLTextAreaElement>(null);
  const imgColRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  /** Block to focus after the preview re-renders (returning from the block editor). */
  const focusBlock = useRef<number | null>(null);
  const hintId = `edit-hint-${page.id}`;
  const headingId = `page-${page.id}-h`;
  const working = page.status === 'transcribing' || page.status === 'locating';
  const hasResult = !!page.source || page.figures.length > 0;

  // Keep the latest page in a ref so async updates never clobber newer edits.
  const latest = useRef(page);
  latest.current = page;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const source = useDebounced(page.source, 250);
  const pb = useMemo(() => pageBlocks({ source, figures: page.figures }, pageNo, hintId, look), [page.figures, source, pageNo, hintId, look]);
<<<<<<< HEAD
  const bands = useMemo(() => estimateBlockBands(source, page.figures, scanLines), [source, page.figures, scanLines]);
  const spotlightIdx = editing ? editing.i : hoverBlock;
  const spotlight = spotlightIdx !== null ? (bands[spotlightIdx] ?? null) : null;
=======
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
  // Under "Edit source" the preview isn't clickable, so it's rendered exactly like the export.
  const plainHtml = useMemo(
    () => (tab === 'edit' ? pageHtml({ ...page, source }, pageNo, undefined, look) : ''),
    [tab, page.figures, source, pageNo, look],
  );
  const warnings = useMemo(() => latexWarnings(source), [source]);
  const positions = useMemo(() => markerUnitIndex(page.source), [page.source]);
  const unitCount = useMemo(() => sourceUnits(page.source).length, [page.source]);
  /** Figures with something to check (same rules as the export checklist). */
  const figureChecks = useMemo(
    () => new Set(pageIssues({ source: '', figures: page.figures }).flatMap((i) => (i.figure === undefined ? [] : [i.figure]))),
    [page.figures],
  );

  // Extract ink line Y positions once per page blob to anchor scan spotlight bands.
  useEffect(() => {
    let live = true;
    pageLayout(page.image)
      .then((l) => live && setScanLines(l.lines))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [page.image]);

  // Auto-scroll the sticky original scan to match the currently opened block.
  useEffect(() => {
    if (!editing || !imgColRef.current) return;
    const band = bands[editing.i];
    if (!band) return;
    const col = imgColRef.current;
    const img = col.querySelector<HTMLElement>('.crop img');
    if (!img || !img.offsetHeight) return;
    const midY = ((band.y0 + band.y1) / 2) * img.offsetHeight + img.offsetTop;
    const targetScroll = Math.max(0, midY - col.clientHeight * 0.42);
    col.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, [editing?.i]);

  /** Applies a user-visible page update while recording a bounded Undo/Redo snapshot. */
  const applyPageEdit = (patch: Partial<Page>, coalesceMs = 0) => {
    const prevSnap: PageSnapshot = { source: latest.current.source, figures: latest.current.figures };
    const nextSnap: PageSnapshot = {
      source: patch.source ?? prevSnap.source,
      figures: patch.figures ?? prevSnap.figures,
    };
    if (!snapshotsEqual(prevSnap, nextSnap)) {
      if (coalesceMs > 0) {
        if (!pendingBase.current) pendingBase.current = prevSnap;
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        pendingTimer.current = setTimeout(() => {
          const base = pendingBase.current;
          pendingBase.current = null;
          pendingTimer.current = null;
          if (base) {
            const curSnap: PageSnapshot = { source: latest.current.source, figures: latest.current.figures };
            setHistory((h) => pushHistory(h, base, curSnap));
          }
        }, coalesceMs);
      } else {
        if (pendingTimer.current) {
          clearTimeout(pendingTimer.current);
          pendingTimer.current = null;
        }
        const base = pendingBase.current ?? prevSnap;
        pendingBase.current = null;
        setHistory((h) => pushHistory(h, base, nextSnap));
      }
    }
    onUpdate(page.id, patch);
  };

  const undo = () => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    pendingBase.current = null;
    const cur: PageSnapshot = { source: latest.current.source, figures: latest.current.figures };
    const res = undoHistory(historyRef.current, cur);
    if (!res) return;
    setHistory(res.history);
    setEditing(null);
    onUpdate(page.id, { source: res.snapshot.source, figures: res.snapshot.figures });
    setNote('Undid last change on this page.');
  };

  const redo = () => {
    const cur: PageSnapshot = { source: latest.current.source, figures: latest.current.figures };
    const res = redoHistory(historyRef.current, cur);
    if (!res) return;
    setHistory(res.history);
    setEditing(null);
    onUpdate(page.id, { source: res.snapshot.source, figures: res.snapshot.figures });
    setNote('Redid change on this page.');
  };

  // Page-wide Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z when focus isn't inside a native text field.
  useEffect(() => {
    const onWinKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        if (historyRef.current.past.length) {
          e.preventDefault();
          undo();
        }
      } else if ((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)) {
        if (historyRef.current.future.length) {
          e.preventDefault();
          redo();
        }
      }
    };
    window.addEventListener('keydown', onWinKey);
    return () => window.removeEventListener('keydown', onWinKey);
  }, []);

  // A conversion replaces the page, so close whatever is open and clear per-page undo history.
  useEffect(() => {
    if (working) {
      setEditing(null);
      setActive(null);
      setHistory(EMPTY_HISTORY);
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
      pendingBase.current = null;
    }
  }, [working]);

  // Re-read belongs to the open block: close it when the block closes.
  useEffect(() => {
    if (!editing) {
      rereadAbort.current?.abort();
      setReread(null);
    }
  }, [editing]);

  // Leaving the page (another page, removed, restored): keep an open edit, stop a re-read.
  useEffect(
    () => () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      rereadAbort.current?.abort();
      const e = editingRef.current;
      if (e && e.text !== e.original) {
        onUpdate(latest.current.id, { source: commitBlock(latest.current.source, e.block, e.original, e.text) });
      }
    },
    [],
  );

  // Return keyboard focus to the block that was just edited.
  useEffect(() => {
    const i = focusBlock.current;
    if (i === null || editing || active !== null) return;
    focusBlock.current = null;
    rootRef.current?.querySelector<HTMLElement>(`.col-text [data-b="${i}"]`)?.focus();
  }, [pb, editing, active]);

  // The proposal arrives beside the block being edited: bring it into view.
  useEffect(() => {
    if (reread?.phase !== 'review') return;
    const ta = reviewRef.current;
    ta?.scrollIntoView({ block: 'nearest' });
    ta?.focus();
  }, [reread?.phase]);

  /** Writes the open block back into the page and closes it; returns the new source. */
  const commit = (): string => {
    const cur = latest.current.source;
    if (!editing) return cur;
    const next = editing.text === editing.original ? cur : commitBlock(cur, editing.block, editing.original, editing.text);
    if (next !== cur) applyPageEdit({ source: next });
    setEditing(null);
    return next;
  };

  /** Opens a figure's panel (closing any open text block). */
  const selectFigure = (id: number | null, fromDocument = false) => {
    commit();
    setTab('preview');
    setActive(id);
    setFocusAlt(fromDocument);
    if (id !== null) setNote(`Figure ${id} open. Its crop box is selected on the original page.`);
  };

  // Requests from outside the page (the export checklist or Review bar).
  useEffect(() => {
    if (focusFigure && page.figures.some((f) => f.id === focusFigure.id)) selectFigure(focusFigure.id, true);
  }, [focusFigure?.n]);

  useEffect(() => {
    if (focusBlockRequest) {
      setTab('preview');
      openBlock(focusBlockRequest.id);
    }
  }, [focusBlockRequest?.n]);

  /** Opens block i (of the page as currently rendered): text in the block editor, a figure in its panel. */
  const openBlock = (i: number) => {
    let src = latest.current.source;
    let target = i;
    if (editing) {
      if (i === editing.i) return;
      // Save the open block first; blocks after it may shift if it grew or shrank.
      const grew = (editing.text.trim() ? splitBlocks(editing.text).length : 0) - 1;
      src = commit();
      if (i > editing.i) target = i + grew;
    }
    const blocks = splitBlocks(src, wrapEndLines(src, latest.current.figures));
    const b = blocks[target];
    if (!b) return;
    if (b.fig !== undefined) {
      selectFigure(b.fig, true);
      return;
    }
    setActive(null);
    const text = blockText(src, b);
    setEditing({ i: target, block: b, original: text, text });
  };

  const finishEdit = () => {
    if (!editing) return;
    focusBlock.current = editing.i;
    commit();
  };

  const cancelEdit = () => {
    if (!editing) return;
    focusBlock.current = editing.i;
    setEditing(null);
  };

  const closeFigure = () => {
    const i = pb.blocks.findIndex((b) => b.fig === active);
    if (i >= 0) focusBlock.current = i;
    setActive(null);
  };

  /* ---------- re-read from image ---------- */

  const startReread = () => setReread({ phase: 'select', box: null, text: '', error: '' });
  const runReread = async () => {
    const box = reread?.box;
    if (!box) return;
    const ac = new AbortController();
    rereadAbort.current = ac;
    setReread((r) => r && { ...r, phase: 'running', error: '' });
    try {
      const text = await onReread(latest.current, box, ac.signal);
      if (ac.signal.aborted) return;
      setReread((r) =>
        r && (text ? { ...r, phase: 'review', text } : { ...r, phase: 'select', error: 'The model returned no text. Try a slightly larger box.' }),
      );
    } catch (e) {
      if (!ac.signal.aborted) setReread((r) => r && { ...r, phase: 'select', error: (e as Error).message });
    } finally {
      if (rereadAbort.current === ac) rereadAbort.current = null;
    }
  };
  const closeReread = () => {
    rereadAbort.current?.abort();
    setReread(null);
  };
  const acceptReread = () => {
    if (!reread?.text.trim()) return;
    const text = reread.text;
    setEditing((e) => (e ? { ...e, text } : e));
    closeReread();
  };

  /* ---------- page actions ---------- */

  const convert = () => {
    if (hasResult && !window.confirm(`Convert page ${pageNo} again? This replaces your edits on this page.`)) return;
    onConvert(page.id);
  };

  const remove = () => {
    if (hasResult && !window.confirm(`Remove page ${pageNo}? Its transcription and edits are removed too.`)) return;
    onRemove(page.id);
  };

  /* ---------- figures ---------- */

  const patchFigure = (id: number, patch: Partial<Figure>, coalesceMs = 0) =>
    applyPageEdit({ figures: latest.current.figures.map((f) => (f.id === id ? { ...f, ...patch } : f)) }, coalesceMs);

  // Re-crop shortly after the box stops changing.
  const cropTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const setBox = (id: number, box: Box) => {
    patchFigure(id, { box, needsReview: false }, 350);
    clearTimeout(cropTimers.current.get(id));
    cropTimers.current.set(
      id,
      setTimeout(async () => {
        const src = await cropFigure(page.image, box);
        if (latest.current.figures.find((f) => f.id === id)?.box === box) {
          onUpdate(page.id, { figures: latest.current.figures.map((f) => (f.id === id ? { ...f, src } : f)) });
        }
      }, 200),
    );
  };

  /** Adds the next undetected drawing on the page (or a manual box if none is found). */
  const addFigure = async () => {
    commit();
    const p = latest.current;
    const id = nextFigureId(p.figures.map((f) => f.id));
    const layout = await pageLayout(p.image);
    const found = layout.figures.find((r) => !p.figures.some((f) => overlapRatio(f.box, r) > 0.3));
    const box = found ?? { x: 0.1, y: 0.3, w: 0.8, h: 0.35 };
    const src = await cropFigure(p.image, box);
    const newSource = found ? placeOne(p.source, { id, box }, p.figures, layout.lines) : `${p.source.trimEnd()}\n\n[[FIGURE ${id}]]\n`;
    const look = defaultLayout(box, layout.lines);
    if (look.wrap) look.besideLines = besideUnitCount(newSource, { id, box }, layout.lines);
    applyPageEdit({
      source: newSource,
      figures: [...p.figures, { id, box, alt: '', caption: '', src, needsReview: true, autoDetected: !!found, ...look }],
    });
    selectFigure(id);
    setNote(
      found
        ? `Found another drawing and added it as figure ${id}. Check its position in the text and write alt text.`
        : `No more drawings detected. Added figure ${id} at the end; draw its box on the page image.`,
    );
  };

  const removeFigure = (id: number) => {
    const p = latest.current;
    // The figure after it in a row no longer has its partner; don't let it join another one.
    const row = figureRows(p.source, p.figures).find((r) => r.includes(id));
    const after = row && row.indexOf(id) + 1 < row.length ? row[row.indexOf(id) + 1] : null;
    applyPageEdit({
      figures: p.figures.filter((f) => f.id !== id).map((f) => (f.id === after ? { ...f, besidePrevious: false } : f)),
      source: p.source.replace(new RegExp(`\\n*\\[\\[\\s*FIGURE\\s+${id}\\s*\\]\\]\\n*`, 'gi'), '\n\n').trim(),
    });
    if (active === id) setActive(null);
    setNote(`Figure ${id} deleted.`);
  };

  const moveFigure = (id: number, dir: -1 | 1) => {
    const p = latest.current;
    // Moving a figure takes it out of its row (and ends the row for the figure beside it).
    const row = figureRows(p.source, p.figures).find((r) => r.includes(id));
    const leave = new Set([id]);
    if (row && row.indexOf(id) + 1 < row.length) leave.add(row[row.indexOf(id) + 1]);
    applyPageEdit({
      source: moveMarker(p.source, id, dir),
      figures: p.figures.map((f) => (leave.has(f.id) && f.besidePrevious ? { ...f, besidePrevious: false } : f)),
    });
    setNote(`Figure ${id} moved ${dir < 0 ? 'up' : 'down'} in the text.`);
  };

  /**
   * Puts a figure side by side with the figure before it (2.2.3), moving its marker
   * right after that figure's if needed, or takes it out of the row.
   */
  const setBeside = (id: number, on: boolean) => {
    const p = latest.current;
    const prev = previousFigure(p.source, id);
    if (!on || !prev) {
      patchFigure(id, { besidePrevious: false });
      setNote(`Figure ${id} is no longer beside another figure.`);
      return;
    }
    const source = prev.adjacent ? p.source : placeAfter(p.source, id, prev.id);
    const figs = p.figures.map((f) => (f.id === id ? { ...f, besidePrevious: true } : f));
    const row = figureRows(source, figs).find((r) => r.includes(id)) ?? [prev.id, id];
    const widths = fitWidths(row.map((r) => figs.find((f) => f.id === r)?.width ?? 50));
    applyPageEdit({
      source,
      figures: figs.map((f) => (row.includes(f.id) ? { ...f, width: widths[row.indexOf(f.id)], wrap: false } : f)),
    });
    setNote(
      prev.adjacent
        ? `Figure ${id} now sits beside figure ${prev.id}.`
        : `Figure ${id} moved right after figure ${prev.id} in the text and now sits beside it.`,
    );
  };

  /** Moves the selected part of a figure's alt text (or all of it) into the notes right after the figure. */
  const moveToNotes = (f: Figure, ta: HTMLTextAreaElement | null) => {
    const r = moveAltToNotes(latest.current.source, f.id, f.alt, ta?.selectionStart ?? 0, ta?.selectionEnd ?? 0);
    if (!r.moved) return;
    applyPageEdit({
      source: r.source,
      figures: latest.current.figures.map((x) =>
        // The moved sentence was written beside the drawing: keep it beside a wrapped figure.
        x.id === f.id ? { ...x, alt: r.alt, besideLines: x.wrap ? x.besideLines + 1 : x.besideLines } : x,
      ),
    });
    setNote(`Moved to the notes after figure ${f.id}: ${r.moved}`);
    requestAnimationFrame(() => ta?.focus());
  };

  const activeFig = page.figures.find((f) => f.id === active);
  const rows = useMemo(() => figureRows(page.source, page.figures), [page.source, page.figures]);
  const activeRow = activeFig ? rows.find((r) => r.includes(activeFig.id)) : undefined;
  const panel = activeFig && (
    <FigurePanel
      key={activeFig.id}
      fig={activeFig}
      pageId={page.id}
      pageNo={pageNo}
      pos={positions.get(activeFig.id)}
      unitCount={unitCount}
      focusAlt={focusAlt}
      onPatch={(patch) => patchFigure(activeFig.id, patch, 350)}
      onMove={(dir) => moveFigure(activeFig.id, dir)}
      prevFigure={previousFigure(page.source, activeFig.id)}
      row={activeRow ?? null}
      onBeside={(on) => setBeside(activeFig.id, on)}
      onSnap={async () => setBox(activeFig.id, await snapToInk(page.image, activeFig.box))}
      onInsert={() => applyPageEdit({ source: `${latest.current.source.trimEnd()}\n\n[[FIGURE ${activeFig.id}]]\n` })}
      onDelete={() => removeFigure(activeFig.id)}
      onMoveToNotes={(ta) => moveToNotes(activeFig, ta)}
      onRedraw={(signal) => {
        const p = latest.current;
        const f = p.figures.find((x) => x.id === activeFig.id) ?? activeFig;
        return onRedraw(p, f, signal);
      }}
      onDescribe={(signal) => {
        const p = latest.current;
        const f = p.figures.find((x) => x.id === activeFig.id) ?? activeFig;
        return onDescribe(p, f, signal);
      }}
      redrawBlocked={
        !canConvert
          ? 'Choose a model first (Model and settings).'
          : busy === 'converting'
            ? 'The model is converting pages; try again when it finishes.'
            : ''
      }
      onClose={closeFigure}
      look={look}
    />
  );

  /* ---------- rendering ---------- */

  const rereadHint =
    busy === 'converting' && reread?.phase !== 'running'
      ? 'A page is converting; re-read is available when it finishes.'
      : reread?.phase === 'running'
        ? 'Reading the selected region…'
        : reread?.phase === 'review'
          ? 'Review the proposal under the block you are editing.'
          : reread?.box
            ? 'Drag again to adjust, or re-read this region.'
            : 'Drag a box around the handwriting for the block you are editing.';

  const imageTools = reread ? (
    <div className="image-tools reread-bar" role="group" aria-label="Re-read from image">
      <p className="hint" aria-live="polite">
        {rereadHint}
      </p>
      <div className="actions">
        {reread.phase !== 'review' && (
          <button
            type="button"
            className="primary"
            onClick={runReread}
            disabled={!reread.box || reread.phase === 'running' || busy === 'converting'}
          >
            {reread.phase === 'running' ? 'Reading…' : 'Re-read this region'}
          </button>
        )}
        <button type="button" onClick={closeReread}>
          {reread.phase === 'running' ? 'Stop' : 'Cancel'}
        </button>
      </div>
      {reread.error && (
        <p className="error" role="alert">
          {reread.error}
        </p>
      )}
    </div>
  ) : (
    hasResult &&
    !working && (
      <div className="image-tools" role="toolbar" aria-label={`Figures on page ${pageNo}`}>
        <span className="tools-label">Figures</span>
        {page.figures.map((f) => {
          const check = figureChecks.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              className={`chip${check ? ' chip-check' : ''}`}
              aria-pressed={f.id === active}
              onClick={() => selectFigure(f.id === active ? null : f.id)}
              aria-label={`Figure ${f.id}${check ? ', needs checking' : ''}`}
            >
              {f.id}
              {check && <span aria-hidden="true"> !</span>}
            </button>
          );
        })}
        {!page.figures.length && <span className="hint">none</span>}
        <button type="button" className="chip" onClick={addFigure}>
          + Add
        </button>
        <button
          type="button"
          className="chip loupe-toggle"
          aria-pressed={loupe}
          onClick={() => setLoupe((l) => !l)}
          title="Magnify handwriting under cursor (2.2×), or hold Alt while pointing"
        >
          Loupe
        </button>
      </div>
    )
  );

  /** Splits the clickable preview around whatever is open in place. */
  const figBlock = active !== null ? pb.blocks.findIndex((b) => b.fig === active) : -1;
  const splitAt = editing ? editing.i : figBlock >= 0 ? figBlock : null;
  const before = splitAt !== null ? pb.html.slice(0, splitAt).join('') : '';
  const after = splitAt !== null ? pb.html.slice(splitAt + 1).join('') + pb.tail : pb.html.join('') + pb.tail;
  const canMergeNext = editing ? editing.i + 1 < pb.blocks.length && pb.blocks[editing.i + 1].fig === undefined : false;

  const openInPlace = editing ? (
    <>
      <BlockEditor
        text={editing.text}
        onText={(text) => setEditing((e) => (e ? { ...e, text } : e))}
        onDone={finishEdit}
        onCancel={cancelEdit}
        onSplit={(left, right) => {
          const next = commitBlock(latest.current.source, editing.block, editing.original, `${left}\n\n${right}`);
          applyPageEdit({ source: next });
          setEditing(null);
          setNote('Split block into two separate parts.');
        }}
        onMergeNext={
          canMergeNext
            ? () => {
                const cur =
                  editing.text === editing.original
                    ? latest.current.source
                    : commitBlock(latest.current.source, editing.block, editing.original, editing.text);
                const blocks = splitBlocks(cur, wrapEndLines(cur, latest.current.figures));
                const merged = mergeBlockWithNext(cur, blocks, editing.i);
                if (merged !== null) {
                  applyPageEdit({ source: merged });
                  setEditing(null);
                  setNote('Merged with the next block.');
                }
              }
            : undefined
        }
        figures={page.figures}
        pageNo={pageNo}
        look={look}
      />
      {!reread ? (
        <div className="reread-action">
          <button
            type="button"
            onClick={startReread}
            disabled={!canConvert || busy === 'converting'}
            title={!canConvert ? 'Choose a model first.' : busy === 'converting' ? 'Available when the conversion finishes.' : undefined}
          >
            Re-read from image…
          </button>
          <span className="hint">Have the model look again at just this part of the original page.</span>
        </div>
      ) : reread.phase === 'review' ? (
        <div className="reread-review" role="region" aria-label="Proposed replacement from the image">
          <label htmlFor={`reread-${page.id}`}>Proposed replacement (you can edit it)</label>
          <textarea
            ref={reviewRef}
            id={`reread-${page.id}`}
            rows={Math.min(12, Math.max(3, reread.text.split('\n').length + 1))}
            value={reread.text}
            spellCheck={false}
            onChange={(e) => setReread((r) => r && { ...r, text: e.target.value })}
          />
          <div className="actions">
            <button type="button" className="primary" onClick={acceptReread} disabled={!reread.text.trim()}>
              Use this
            </button>
            <button type="button" onClick={() => setReread((r) => r && { ...r, phase: 'select', text: '' })}>
              Try another box
            </button>
            <button type="button" onClick={closeReread}>
              Keep mine
            </button>
          </div>
          <p className="hint">“Use this” puts it in the editor above; press Done there to keep it.</p>
        </div>
      ) : (
        <p className="hint reread-action">Draw a box on the original page, on the left.</p>
      )}
    </>
  ) : figBlock >= 0 ? (
    panel
  ) : null;

  const action =
    page.status === 'queued' ? (
      <button type="button" onClick={() => onUnqueue(page.id)}>
        Cancel waiting
      </button>
    ) : (
      <button
        type="button"
        className={hasResult ? undefined : 'primary'}
        onClick={convert}
        disabled={working || !canConvert || busy === 'rereading'}
        title={!canConvert ? 'Choose a model first.' : busy === 'rereading' ? 'Wait for the re-read to finish.' : undefined}
      >
        {hasResult ? 'Convert again' : 'Convert this page'}
      </button>
    );

  return (
    <article className="page" aria-labelledby={headingId} ref={rootRef}>
      <header className="page-head">
        <div className="page-title">
          <h2 id={headingId}>
            Page {pageNo} <span className="of">of {count}</span>
          </h2>
          <span className="page-label">{page.label}</span>
          <span className={`badge ${statusClass(page.status)}`}>{STATUS[page.status]}</span>
        </div>
        <div className="actions page-actions">
          <button type="button" onClick={() => onGo(-1)} disabled={index === 0} aria-label="Previous page">
            ← Prev
          </button>
          <button type="button" onClick={() => onGo(1)} disabled={index === count - 1} aria-label="Next page">
            Next →
          </button>
          <span className="sep" aria-hidden="true" />
          {(hasResult || page.status === 'queued') && action}
          <button type="button" onClick={() => onMove(page.id, -1)} disabled={index === 0} aria-label={`Move page ${pageNo} earlier`} title="Move earlier">
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(page.id, 1)}
            disabled={index === count - 1}
            aria-label={`Move page ${pageNo} later`}
            title="Move later"
          >
            ↓
          </button>
          <button type="button" onClick={remove} disabled={working}>
            Remove
          </button>
        </div>
      </header>

      {page.error && (
        <p className="error page-error" role="alert">
          <span>{page.error}</span>
          {page.status === 'done' && (
            <button type="button" onClick={() => onUpdate(page.id, { error: undefined })}>
              Dismiss
            </button>
          )}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {note}
      </p>

      <div className="page-body">
        <div className="col-image" ref={imgColRef}>
          {imageTools}
          <CropCanvas
            src={page.url}
            alt={`Original handwritten page: ${page.label}`}
            figures={page.figures}
            active={active}
            onSelect={(id) => selectFigure(id)}
            onChange={setBox}
            selecting={reread?.phase === 'select'}
            selection={reread?.box ?? null}
            onSelection={(box) => setReread((r) => r && { ...r, box, error: '' })}
            spotlight={spotlight}
            loupe={loupe}
          />
        </div>

        <div className="col-text">
          {working ? (
            <div>
              <p className="hint">{page.status === 'locating' ? 'Finding and describing figures…' : 'Model output (live):'}</p>
              <pre className="live">{liveText || '…'}</pre>
            </div>
          ) : !hasResult ? (
            <div className="not-converted">
              {page.status === 'queued' ? (
                <>
                  <p>Waiting for its turn. It starts after the page being converted.</p>
                  {action}
                </>
              ) : (
                <>
                  <p>{canConvert ? 'This page isn’t converted yet.' : 'Choose a model first (Model button, top right).'}</p>
                  {action}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="doc-bar">
                <div className="seg" role="group" aria-label="View">
                  <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
                    Preview
                  </button>
                  <button
                    type="button"
                    aria-pressed={tab === 'edit'}
                    onClick={() => {
                      commit();
                      setActive(null);
                      setTab('edit');
                    }}
                  >
                    Edit source
                  </button>
                </div>
                <div className="actions undo-group">
                  <button
                    type="button"
                    disabled={!history.past.length}
                    onClick={undo}
                    title="Undo page edit (⌘/Ctrl+Z)"
                    aria-label="Undo page edit"
                  >
                    ↶ Undo
                  </button>
                  <button
                    type="button"
                    disabled={!history.future.length}
                    onClick={redo}
                    title="Redo page edit (⌘/Ctrl+Shift+Z)"
                    aria-label="Redo page edit"
                  >
                    ↷ Redo
                  </button>
                </div>
                {tab === 'preview' && (
                  <p id={hintId} className="hint edit-hint">
                    Click a paragraph, equation, or figure to edit it (or Tab to it and press Enter).
                  </p>
                )}
              </div>

              {warnings.length > 0 && (
                <ul className="warn" aria-label="LaTeX warnings">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              {tab === 'edit' ? (
                <>
                  <div className="editor">
                    <label htmlFor={`src-${page.id}`}>Transcription (Markdown with $LaTeX$; figures are [[FIGURE n]])</label>
                    <MarkupToolbar target={srcRef} onChange={(v) => applyPageEdit({ source: v }, 350)} label={`Markup for page ${pageNo}`} />
                    <textarea
                      ref={srcRef}
                      id={`src-${page.id}`}
                      value={page.source}
                      spellCheck={false}
<<<<<<< HEAD
                      onChange={(e) => applyPageEdit({ source: e.target.value }, 350)}
=======
                      onChange={(e) => onUpdate(page.id, { source: e.target.value })}
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
                      onKeyDown={(e) => {
                        const mk = shortcutMark(e);
                        if (mk && srcRef.current) {
                          e.preventDefault();
<<<<<<< HEAD
                          applyMarkToTextarea(srcRef.current, mk, (v) => applyPageEdit({ source: v }, 350));
=======
                          applyMarkToTextarea(srcRef.current, mk, (v) => onUpdate(page.id, { source: v }));
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
                        }
                      }}
                    />
                  </div>
                  <Preview html={plainHtml} label={`Preview of page ${pageNo}`} />
                </>
              ) : (
                <>
                  {activeFig && figBlock < 0 && panel}
                  {splitAt !== null && splitAt > 0 && (
                    <Preview
                      html={before}
                      label={`Page ${pageNo}, before the part being edited`}
                      onBlock={openBlock}
                      onHoverBlock={(i) => setHoverBlock(i)}
                    />
                  )}
                  {openInPlace}
                  {(splitAt === null || splitAt < pb.html.length - 1 || pb.tail) && (
                    <Preview
                      html={after}
                      label={splitAt === null ? `Page ${pageNo}` : `Page ${pageNo}, after the part being edited`}
                      onBlock={(i) => openBlock(splitAt !== null ? splitAt + 1 + i : i)}
                      onHoverBlock={(i) => setHoverBlock(i === null ? null : splitAt !== null ? splitAt + 1 + i : i)}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
});
