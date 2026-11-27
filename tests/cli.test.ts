// Run: npm test   (Headless Batch CLI: arg parsing, Node raster backend, Node MathJax offline pre-renderer, Ollama unloadModel)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { parseCliArgs } from '../src/lib/cliArgs.ts';
import { buildDocument } from '../src/lib/exportHtml.ts';
import { unloadModel } from '../src/lib/ollama.ts';
import { loadNodeFile, nodeRaster } from '../cli/nodeRaster.ts';
import { prerenderOfflineHtmlNode } from '../cli/nodeMathjax.ts';

/* ---------------- 1. CLI argument parsing ---------------- */
{
  const a = parseCliArgs(['notes/lec01.pdf', 'notes/lec02.png', '--8gb', '--offline', '--look', 'classic', '--out', './out']);
  assert.deepEqual(a.inputs, ['notes/lec01.pdf', 'notes/lec02.png']);
  assert.equal(a.numCtx, 4096, '--8gb defaults numCtx to 4096');
  assert.equal(a.offline, true);
  assert.equal(a.look, 'classic');
  assert.equal(a.outDir, './out');
  assert.equal(a.keepLoaded, false);
  assert.equal(a.autoRedraw, false, 'CLI defaults to crop-only (no redraw) for speed on 8 GB');

  const b = parseCliArgs(['a.pdf', '--8gb', '--ctx', '6144', '--detail', 'high', '--prompt', 'large', '--json-only', '--no-redraw', '--keep-loaded', '--genai']);
  assert.equal(b.numCtx, 6144, 'explicit --ctx overrides --8gb');
  assert.equal(b.detail, 1792);
  assert.equal(b.promptSet, 'large');
  assert.equal(b.jsonOnly, true);
  assert.equal(b.autoRedraw, false);
  assert.equal(b.keepLoaded, true);
  assert.equal(b.provider, 'genai');

  const c = parseCliArgs(['a.pdf', '--redraw']);
  assert.equal(c.autoRedraw, true, '--redraw enables automatic SVG redraw in CLI');

  assert.throws(() => parseCliArgs(['a.pdf', '--json-only', '--html-only']), /Cannot combine/);
  assert.throws(() => parseCliArgs(['--unknown-flag']), /Unknown option/);
}

/* ---------------- 2. Node raster backend (loadNodeFile + nodeRaster) ---------------- */
{
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ink2web-cli-'));
  try {
    const imgPath = path.join(tmpDir, 'sketch.png');
    const c = createCanvas(400, 300);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 300);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 4;
    ctx.strokeRect(80, 70, 140, 120);
    await fs.writeFile(imgPath, c.toBuffer('image/png'));

    const loaded = await loadNodeFile(imgPath);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].width, 400);
    assert.equal(loaded[0].height, 300);

    const blob = loaded[0].image;
    const ink = await nodeRaster.pageInkMap(blob);
    assert(ink.w > 0 && ink.h > 0 && ink.ink.length === ink.w * ink.h);

    const b64Model = await nodeRaster.modelImage(blob, 1024, true);
    assert(b64Model.length > 100);
    const b64Square = await nodeRaster.squareImage(blob);
    assert(b64Square.length > 100);
    const figUrl = await nodeRaster.cropFigure(blob, { x: 0.15, y: 0.15, w: 0.5, h: 0.55 });
    assert(figUrl.startsWith('data:image/'));

    const snapped = await nodeRaster.snapToInk(blob, { x: 0.1, y: 0.1, w: 0.65, h: 0.7 });
    assert(snapped.x >= 0.1 && snapped.w < 0.65 && snapped.h < 0.7, 'snapToInk tightens around drawn box');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/* ---------------- 3. Node MathJax offline pre-rendering ---------------- */
{
  const rawHtml = buildDocument(
    [
      {
        id: 'p1',
        label: 'test.pdf',
        image: new Blob([], { type: 'image/png' }),
        url: '',
        width: 800,
        height: 1000,
        status: 'done',
        source: '# Test Notes\n\nConsider $f(x) = x^2$.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$',
        figures: [],
      },
    ],
    { title: 'Test Notes', titleFromFileName: false, lang: 'en', pageMarkers: true, look: 'cards' },
  );
  const offlineHtml = await prerenderOfflineHtmlNode(rawHtml);
  assert(offlineHtml.includes('<mjx-container'), 'renders MathJax containers');
  assert(offlineHtml.includes('mjx-assistive-mml'), 'keeps assistive MathML for screen readers');
  assert(offlineHtml.includes('MJX-SVG-styles'), 'embeds MJX-SVG stylesheet');
  assert(offlineHtml.includes('MJX-SVG-global-cache'), 'embeds global glyph cache');
  assert(!offlineHtml.includes('cdn.jsdelivr.net/npm/mathjax'), 'removes external MathJax CDN script');
}

/* ---------------- 4. Ollama unloadModel (`keep_alive: 0`) ---------------- */
{
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
    return new Response(JSON.stringify({ done: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const ok = await unloadModel('http://127.0.0.1:11434', 'qwen3.5:4b-mlx');
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/generate');
    assert.equal(calls[0].body.keep_alive, 0);
    assert.equal(calls[0].body.model, 'qwen3.5:4b-mlx');
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('Batch CLI tests passed.');
