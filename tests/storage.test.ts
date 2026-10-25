// Run: npm test   (project files and restore rules; autosave itself needs a browser)
import assert from 'node:assert/strict';
import { projectFileName, projectFromJson, projectToJson, restoredStatus, toStored, FORMAT_VERSION } from '../src/lib/storage.ts';
import type { Figure, Page } from '../src/types.ts';

const fig: Figure = { id: 1, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, alt: 'graph of u(t)', caption: '', src: 'data:image/png;base64,AAAA', needsReview: false, width: 60, align: 'center', wrap: false, besideLines: 0 };
const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256); // bigger than one btoa chunk
const page = (over: Partial<Page>): Page => ({
  id: 'p1', label: 'Lesson21.pdf, page 1', image: new Blob([bytes], { type: 'image/png' }), url: 'blob:x',
  width: 1600, height: 1236, status: 'done', source: '$$u(t) = R\\cos(7t - \\delta)$$\n[[note: R | new amplitude]]', figures: [fig], ...over,
});

/* restore rules: pages caught mid-conversion come back usable */
assert.equal(restoredStatus({ status: 'transcribing', source: '', figures: [] }), 'idle');
assert.equal(restoredStatus({ status: 'locating', source: 'x', figures: [] }), 'done');
assert.equal(restoredStatus({ status: 'queued', source: '', figures: [] }), 'idle');
assert.equal(restoredStatus({ status: 'error', source: '', figures: [] }), 'error');
const stored = toStored(page({ status: 'transcribing' }));
assert.equal(stored.status, 'done');
assert(!('url' in stored) && !('image' in stored), 'object URL and image are not part of the record');

/* project file round trip: text, notes, figures, title, and the exact image bytes */
const pages = [page({}), page({ id: 'p2', label: 'Lesson21.pdf, page 2', status: 'idle', source: '', figures: [], image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) })];
const json = await projectToJson({ title: 'Lesson21', titleAuto: true, pageMarkers: false }, pages);
const back = projectFromJson(json);
assert.equal(back.title, 'Lesson21');
assert.equal(back.pageMarkers, false);
assert.equal(back.pages.length, 2);
assert.equal(back.pages[0].source, pages[0].source);
assert.deepEqual(back.pages[0].figures, [fig]);
assert.equal(back.pages[1].status, 'idle');
assert.deepEqual(new Uint8Array(await back.pages[0].image.arrayBuffer()), bytes, 'image bytes preserved');
assert.equal(back.pages[1].image.type, 'image/jpeg');
assert.equal(JSON.parse(json).format, FORMAT_VERSION);

/* friendly errors */
assert.throws(() => projectFromJson('not json'), /not an Ink2Web Lite project/);
assert.throws(() => projectFromJson('{"pages":[]}'), /not an Ink2Web Lite project/);
assert.throws(() => projectFromJson(JSON.stringify({ app: 'ink2web-lite', format: 99, pages: [] })), /newer version/);

/* file names */
assert.equal(projectFileName('Lesson21'), 'lesson21.ink2web.json');
assert.equal(projectFileName('Mechanical Vibration (Continued)'), 'mechanical-vibration-continued.ink2web.json');
assert.equal(projectFileName(''), 'notes.ink2web.json');
console.log('All storage tests passed.');

/* ---------------- failed or stopped conversions (2.0.1) ---------------- */
{
  const { afterFailedConversion } = await import('../src/lib/storage.ts');
  const fresh = { source: '', figures: [] };
  const edited = { source: '## Springs\nedited text', figures: [] };
  assert.deepEqual(afterFailedConversion(fresh, null), { status: 'cancelled' }, 'stopped, nothing to keep');
  assert.deepEqual(afterFailedConversion(fresh, 'boom'), { status: 'error', error: 'boom' }, 'failed, nothing to keep');
  assert.deepEqual(afterFailedConversion(edited, null), { status: 'done' }, 'stopped Convert again keeps the page done');
  const f = afterFailedConversion(edited, 'Ollama error 500');
  assert.equal(f.status, 'done', 'failed Convert again keeps the page done (still exported)');
  assert.match(f.error ?? '', /previous version is kept.*Ollama error 500/);
  console.log('Failed-conversion tests passed.');
}
