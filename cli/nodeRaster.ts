import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { Box } from '../src/types.ts';
import type { LoadedPage } from '../src/lib/images.ts';
import { buildInkMap, cropInkMap, type InkMap } from '../src/lib/layout.ts';
import { snapBoxToInkMap, type RasterBackend } from '../src/lib/raster.ts';

/**
 * Node headless raster backend for the CLI (`cli/convert.ts`), backed by
 * @napi-rs/canvas and pdfjs-dist/legacy/build/pdf.mjs. Kept outside `src/` so the
 * browser Vite build never bundles Node bindings.
 */

const STORE_SIDE = 2200;

function enhancePixels(d: Uint8ClampedArray, w: number, h: number) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0]++;
  const total = w * h;
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= total * p) return v;
    return 255;
  };
  const lo = pct(0.005);
  const hi = Math.max(lo + 30, pct(0.9));
  const scale = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, Math.round((d[i] - lo) * scale)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round((d[i + 1] - lo) * scale)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round((d[i + 2] - lo) * scale)));
  }
}

function makeCanvas(w: number, h: number): [Canvas, SKRSContext2D] {
  const c = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  return [c, ctx];
}

function enhanceCtx(ctx: SKRSContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  enhancePixels(img.data, w, h);
  ctx.putImageData(img, 0, 0);
}

const jpegBase64 = (c: Canvas, quality = 90) => c.toBuffer('image/jpeg', quality).toString('base64');

/** Loads a PDF or image file from disk into normalized PNG Blob pages (<= 2200px long side). */
export async function loadNodeFile(filePath: string, onPage?: (n: number, total: number) => void): Promise<LoadedPage[]> {
  const name = path.basename(filePath);
  const bytes = await fs.readFile(filePath);
  if (/\.pdf$/i.test(filePath)) {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
      getDocument: (src: Record<string, unknown>) => {
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getViewport: (o: { scale: number }) => { width: number; height: number };
            render: (o: { canvasContext: unknown; viewport: { width: number; height: number } }) => { promise: Promise<void> };
            cleanup: () => void;
          }>;
          destroy: () => Promise<void>;
        }>;
        destroy: () => Promise<void>;
      };
    };
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const pages: LoadedPage[] = [];
    try {
      const pdf = await task.promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: STORE_SIDE / Math.max(base.width, base.height) });
        const [c, ctx] = makeCanvas(viewport.width, viewport.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        page.cleanup();
        const png = c.toBuffer('image/png');
        pages.push({
          label: pdf.numPages > 1 ? `${name}, page ${n}` : name,
          image: new Blob([new Uint8Array(png)], { type: 'image/png' }),
          width: c.width,
          height: c.height,
        });
        onPage?.(n, pdf.numPages);
      }
      await pdf.destroy();
    } finally {
      await task.destroy().catch(() => undefined);
    }
    return pages;
  }

  const img = await loadImage(bytes);
  const s = Math.min(1, STORE_SIDE / Math.max(img.width, img.height));
  const [c, ctx] = makeCanvas(img.width * s, img.height * s);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const png = c.toBuffer('image/png');
  onPage?.(1, 1);
  return [{ label: name, image: new Blob([new Uint8Array(png)], { type: 'image/png' }), width: c.width, height: c.height }];
}

const decoded = new Map<Blob, Promise<Image>>();
function decodeBlob(blob: Blob): Promise<Image> {
  let p = decoded.get(blob);
  if (p) decoded.delete(blob);
  else {
    p = blob.arrayBuffer().then((ab) => loadImage(Buffer.from(ab)));
  }
  decoded.set(blob, p);
  while (decoded.size > 3) decoded.delete(decoded.keys().next().value!);
  return p;
}

const inkMaps = new WeakMap<Blob, Promise<InkMap>>();
function getInkMap(blob: Blob): Promise<InkMap> {
  let p = inkMaps.get(blob);
  if (!p) {
    p = (async () => {
      const img = await decodeBlob(blob);
      const s = Math.min(1, 800 / Math.max(img.width, img.height));
      const [c, ctx] = makeCanvas(img.width * s, img.height * s);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      return buildInkMap(id.data, c.width, c.height);
    })();
    inkMaps.set(blob, p);
  }
  return p;
}

async function cropCanvas(blob: Blob, box: Box): Promise<[Canvas, SKRSContext2D]> {
  const img = await decodeBlob(blob);
  const sx = box.x * img.width;
  const sy = box.y * img.height;
  const sw = Math.max(1, box.w * img.width);
  const sh = Math.max(1, box.h * img.height);
  const s = Math.min(1, 1600 / Math.max(sw, sh));
  const [c, ctx] = makeCanvas(sw * s, sh * s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return [c, ctx];
}

export const nodeRaster: RasterBackend = {
  pageInkMap: (blob) => getInkMap(blob),
  figureInkMap: async (blob, box) => cropInkMap(await getInkMap(blob), box),
  modelImage: async (blob, maxSide, doEnhance) => {
    const img = await decodeBlob(blob);
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    const [c, ctx] = makeCanvas(img.width * s, img.height * s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (doEnhance) enhanceCtx(ctx, c.width, c.height);
    return jpegBase64(c, 90);
  },
  regionImage: async (blob, box, doEnhance) => {
    const [c, ctx] = await cropCanvas(blob, box);
    if (doEnhance) enhanceCtx(ctx, c.width, c.height);
    return jpegBase64(c, 90);
  },
  squareImage: async (blob) => {
    const img = await decodeBlob(blob);
    const s = 1000 / Math.max(img.width, img.height);
    const [c, ctx] = makeCanvas(1000, 1000);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.width * s, img.height * s);
    return jpegBase64(c, 90);
  },
  cropFigure: async (blob, box) => {
    const [c] = await cropCanvas(blob, box);
    const png = c.toBuffer('image/png');
    const jpg = c.toBuffer('image/jpeg', 88);
    if (png.length <= jpg.length * 1.15) return `data:image/png;base64,${png.toString('base64')}`;
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  },
  cropBase64: async (blob, box) => {
    const url = await nodeRaster.cropFigure(blob, box);
    return url.split(',')[1];
  },
  snapToInk: async (blob, box) => snapBoxToInkMap(await getInkMap(blob), box),
};
