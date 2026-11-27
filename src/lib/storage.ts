import type { Figure, Page, PageStatus } from '../types.ts';
import { fileSlug } from './exportHtml.ts';

/**
 * Saving work so it survives a refresh, a crash, or closing the tab.
 *
 * 1. Autosave in the browser (IndexedDB). Page images are stored once per page
 *    (they never change); the small "session" record (transcriptions, notes,
 *    figures, alt text, title) is rewritten after each edit.
 * 2. Project files (*.ink2web.json): one self-contained file with the page images
 *    embedded, for keeping alongside the PDF or moving to another computer.
 *
 * Nothing here talks to a server; everything stays on this computer.
 */

/** Increase when the saved format changes in a way older versions can't read. */
export const FORMAT_VERSION = 1;

/** What is saved for a page (no object URL: it is recreated on restore). */
export interface StoredPage {
  id: string;
  label: string;
  width: number;
  height: number;
  status: PageStatus;
  source: string;
  figures: Figure[];
  error?: string;
}

export interface SessionMeta {
  title: string;
  titleAuto: boolean;
  pageMarkers: boolean;
}

export interface Session extends SessionMeta {
  pages: (StoredPage & { image: Blob })[];
  savedAt: number;
}

/**
 * A page that was converting or waiting when the app closed can't resume, so it
 * comes back as done (if it has a transcription) or not converted.
 */
export function restoredStatus(p: { status: PageStatus; source: string; figures: Figure[] }): PageStatus {
  if (p.status === 'transcribing' || p.status === 'locating' || p.status === 'queued') {
    return p.source || p.figures.length ? 'done' : 'idle';
  }
  return p.status;
}

/**
 * What a page becomes when its conversion fails or is stopped. A page that already
 * had a result ("Convert again") keeps it, still done, so it stays in the export;
 * the user's edits are never lost to a failed re-conversion.
 */
export function afterFailedConversion(
  p: { source: string; figures: Figure[] },
  error: string | null,
): { status: PageStatus; error?: string } {
  const kept = !!p.source || p.figures.length > 0;
  if (error === null) return { status: kept ? 'done' : 'cancelled' };
  return kept ? { status: 'done', error: `Converting again failed, so the previous version is kept. ${error}` } : { status: 'error', error };
}

export function toStored(p: Page): StoredPage {
  const { id, label, width, height, source, figures, error } = p;
  return { id, label, width, height, status: restoredStatus(p), source, figures, ...(error ? { error } : {}) };
}

/* ---------------------------------------------------------------------------------
 * Project files
 * ------------------------------------------------------------------------------- */

export const PROJECT_EXT = '.ink2web.json';

interface ProjectFile extends SessionMeta {
  app: 'ink2web-lite';
  format: number;
  savedAt: number;
  pages: (StoredPage & { image: string })[];
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

function dataUrlToBlob(url: string): Blob {
  const m = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!m || !m[2]) throw new Error('A page image in the project file is damaged.');
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'image/png' });
}

/** The whole project as one JSON text (page images embedded). */
export async function projectToJson(meta: SessionMeta, pages: Page[]): Promise<string> {
  const file: ProjectFile = {
    app: 'ink2web-lite',
    format: FORMAT_VERSION,
    savedAt: Date.now(),
    ...meta,
    pages: await Promise.all(pages.map(async (p) => ({ ...toStored(p), image: await blobToDataUrl(p.image) }))),
  };
  return JSON.stringify(file);
}

/** Reads a project file; throws an Error with a readable message if it isn't one. */
export function projectFromJson(text: string): Session {
  let f: Partial<ProjectFile>;
  try {
    f = JSON.parse(text) as Partial<ProjectFile>;
  } catch {
    throw new Error('This file is not an Ink2Web Lite project.');
  }
  if (f.app !== 'ink2web-lite' || !Array.isArray(f.pages)) throw new Error('This file is not an Ink2Web Lite project.');
  if ((f.format ?? 0) > FORMAT_VERSION) throw new Error('This project was saved by a newer version of Ink2Web Lite. Please update the app.');
  return {
    title: f.title ?? '',
    titleAuto: f.titleAuto ?? true,
    pageMarkers: f.pageMarkers ?? true,
    savedAt: f.savedAt ?? 0,
    pages: f.pages.map((p) => ({
      id: p.id,
      label: p.label,
      width: p.width,
      height: p.height,
      status: restoredStatus(p),
      source: p.source ?? '',
      figures: p.figures ?? [],
      ...(p.error ? { error: p.error } : {}),
      image: dataUrlToBlob(p.image),
    })),
  };
}

/** File name for a saved project, from the document title. */
export function projectFileName(title: string): string {
  return `${fileSlug(title)}${PROJECT_EXT}`;
}

/* ---------------------------------------------------------------------------------
 * Autosave (IndexedDB)
 * ------------------------------------------------------------------------------- */

const DB_NAME = 'ink2web-lite';
const DB_VERSION = 2;
const META = 'session';
const IMAGES = 'images';
const RECENT = 'recent';
const KEY = 'current';
const MAX_RECENT = 5;

export interface RecentSummary {
  id: string;
  title: string;
  pageCount: number;
  doneCount: number;
  savedAt: number;
}

interface RecentRecord extends MetaRecord {
  id: string;
}

/** Deduplicates by id, sorts newest-first, and keeps at most `max` recent snapshots. */
export function pruneRecentList<T extends { id: string; savedAt: number }>(items: T[], max = MAX_RECENT): T[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((it) => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    })
    .slice(0, max);
}

interface MetaRecord extends SessionMeta {
  format: number;
  savedAt: number;
  pages: StoredPage[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('This browser cannot save work locally.'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
        if (!d.objectStoreNames.contains(IMAGES)) d.createObjectStore(IMAGES);
        if (!d.objectStoreNames.contains(RECENT)) d.createObjectStore(RECENT);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open local storage.'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Saving failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving failed (the browser may be out of storage space).'));
  });

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Page images already written in this browser session (they never change). */
const written = new Set<string>();

/** Saves the session. Writes only images not saved yet and removes orphaned images (preserving recent snapshots). */
export async function saveSession(meta: SessionMeta, pages: Page[]): Promise<number> {
  const d = await db();
  const savedAt = Date.now();
  const tx = d.transaction([META, IMAGES, RECENT], 'readwrite');
  const images = tx.objectStore(IMAGES);
  const keep = new Set(pages.map((p) => p.id));
  for (const p of pages) {
    if (!written.has(p.id)) {
      images.put(p.image, p.id);
      written.add(p.id);
    }
  }
  const recentReq = tx.objectStore(RECENT).getAll();
  recentReq.onsuccess = () => {
    for (const r of (recentReq.result ?? []) as RecentRecord[]) {
      for (const p of r.pages ?? []) keep.add(p.id);
    }
    const keys = images.getAllKeys();
    keys.onsuccess = () => {
      for (const k of keys.result) if (!keep.has(String(k))) images.delete(k);
    };
  };
  const record: MetaRecord = { format: FORMAT_VERSION, savedAt, ...meta, pages: pages.map(toStored) };
  tx.objectStore(META).put(record, KEY);
  try {
    await done(tx);
  } catch (e) {
    // Images may not have been written; try them again next time.
    for (const p of pages) written.delete(p.id);
    throw e;
  }
  return savedAt;
}

/** The saved session, or null if there is none (or it can't be read). */
export async function loadSession(): Promise<Session | null> {
  const d = await db();
  const tx = d.transaction([META, IMAGES], 'readonly');
  const rec = (await request(tx.objectStore(META).get(KEY))) as MetaRecord | undefined;
  if (!rec || !Array.isArray(rec.pages) || !rec.pages.length || rec.format > FORMAT_VERSION) return null;
  const images = tx.objectStore(IMAGES);
  const pages: Session['pages'] = [];
  for (const p of rec.pages) {
    const image = (await request(images.get(p.id))) as Blob | undefined;
    if (image) pages.push({ ...p, status: restoredStatus(p), image });
  }
  if (!pages.length) return null;
  return { title: rec.title, titleAuto: rec.titleAuto, pageMarkers: rec.pageMarkers, savedAt: rec.savedAt, pages };
}

/** Deletes the saved active session (preserving images still referenced by recent snapshots). */
export async function clearSession(): Promise<void> {
  const d = await db();
  const tx = d.transaction([META, IMAGES, RECENT], 'readwrite');
  tx.objectStore(META).delete(KEY);
  const keep = new Set<string>();
  const recentReq = tx.objectStore(RECENT).getAll();
  recentReq.onsuccess = () => {
    for (const r of (recentReq.result ?? []) as RecentRecord[]) {
      for (const p of r.pages ?? []) keep.add(p.id);
    }
    const images = tx.objectStore(IMAGES);
    const keys = images.getAllKeys();
    keys.onsuccess = () => {
      for (const k of keys.result) if (!keep.has(String(k))) images.delete(k);
    };
  };
  written.clear();
  await done(tx);
}

/** Moves the active saved session into the Recent list (keeping up to MAX_RECENT). */
export async function archiveCurrentSession(): Promise<void> {
  const d = await db();
  const tx = d.transaction([META, RECENT], 'readwrite');
  const cur = (await request(tx.objectStore(META).get(KEY))) as MetaRecord | undefined;
  if (!cur || !cur.pages?.length) return;
  const store = tx.objectStore(RECENT);
  const all = ((await request(store.getAll())) as RecentRecord[]) ?? [];
  const docId = cur.pages[0].id;
  const next = pruneRecentList([...all, { ...cur, id: docId }], MAX_RECENT);
  store.clear();
  for (const r of next) store.put(r, r.id);
  await done(tx);
}

/** Lists up to MAX_RECENT archived sessions in this browser. */
export async function listRecentSessions(): Promise<RecentSummary[]> {
  const d = await db();
  const tx = d.transaction([RECENT], 'readonly');
  const all = ((await request(tx.objectStore(RECENT).getAll())) as RecentRecord[]) ?? [];
  return pruneRecentList(all, MAX_RECENT).map((r) => ({
    id: r.id,
    title: r.title,
    pageCount: r.pages.length,
    doneCount: r.pages.filter((p) => restoredStatus(p) === 'done').length,
    savedAt: r.savedAt,
  }));
}

/** Loads one archived recent session by id (promoting its blobs back to usable pages). */
export async function loadRecentSession(id: string): Promise<Session | null> {
  const d = await db();
  const tx = d.transaction([RECENT, IMAGES], 'readonly');
  const rec = (await request(tx.objectStore(RECENT).get(id))) as RecentRecord | undefined;
  if (!rec || !Array.isArray(rec.pages) || !rec.pages.length || rec.format > FORMAT_VERSION) return null;
  const images = tx.objectStore(IMAGES);
  const pages: Session['pages'] = [];
  for (const p of rec.pages) {
    const image = (await request(images.get(p.id))) as Blob | undefined;
    if (image) pages.push({ ...p, status: restoredStatus(p), image });
  }
  if (!pages.length) return null;
  return { title: rec.title, titleAuto: rec.titleAuto, pageMarkers: rec.pageMarkers, savedAt: rec.savedAt, pages };
}

/* ---------------------------------------------------------------------------------
 * Multi-tab autosave coordination (lazy BroadcastChannel, browser only)
 * ------------------------------------------------------------------------------- */

const SYNC_CHANNEL = 'ink2web-lite:sync';
const TAB_ID = Math.random().toString(36).slice(2, 10);

/** Broadcasts that this tab wrote a newer session to IndexedDB. */
export function notifyTabSave(savedAt: number): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    const bc = new BroadcastChannel(SYNC_CHANNEL);
    bc.postMessage({ tabId: TAB_ID, savedAt });
    bc.close();
  } catch {
    /* ignore */
  }
}

/** Listens for saves made by other open tabs; returns a cleanup callback. */
export function watchTabSaves(onExternalSave: (savedAt: number) => void): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => undefined;
  try {
    const bc = new BroadcastChannel(SYNC_CHANNEL);
    bc.onmessage = (ev: MessageEvent<{ tabId?: string; savedAt?: number }>) => {
      if (ev.data && ev.data.tabId && ev.data.tabId !== TAB_ID && typeof ev.data.savedAt === 'number') {
        onExternalSave(ev.data.savedAt);
      }
    };
    return () => bc.close();
  } catch {
    return () => undefined;
  }
}

/** Marks pages whose images are already in storage (after a restore), so they aren't rewritten. */
export function markWritten(ids: string[]) {
  ids.forEach((id) => written.add(id));
}

/** Forgets which images were written (after opening a project file, all are written again). */
export function resetWritten() {
  written.clear();
}
