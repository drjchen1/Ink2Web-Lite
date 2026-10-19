import type { Box } from '../types.ts';
import { clampBox } from './transcript.ts';
import { analyzeLayout, buildInkMap, type InkMap, type Layout } from './layout.ts';

/** All raster work: loading files, preparing model input, cropping figures, ink analysis. */

export interface LoadedPage {
  label: string;
  image: Blob;
  width: number;
  height: number;
}

/** Long side of the stored page image. Figures are cropped from this. */
const STORE_SIDE = 2200;

export const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  return [c, ctx];
}

const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Image encoding failed.'))), type, q));

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Converts an uploaded PDF or image into one or more page images. */
export async function loadFile(file: File, onPage?: (n: number, total: number) => void): Promise<LoadedPage[]> {
  if (isPdf(file)) return loadPdf(file, onPage);
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: unsupported file type.`);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${file.name}: this image format can't be decoded by the browser (HEIC? convert to JPEG/PNG).`);
  }
  const s = Math.min(1, STORE_SIDE / Math.max(bmp.width, bmp.height));
  const [c, ctx] = canvas(bmp.width * s, bmp.height * s);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  onPage?.(1, 1);
  return [{ label: file.name, image: await toBlob(c), width: c.width, height: c.height }];
}

async function loadPdf(file: File, onPage?: (n: number, total: number) => void): Promise<LoadedPage[]> {
  // pdf.js is only downloaded when a PDF is actually opened.
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Scanned/copier PDFs often store ink as a JBIG2 mask over a JPEG background.
    // pdf.js's OffscreenCanvas / ImageDecoder fast paths can drop most of that ink
    // (notably in Safari), so force the plain-JavaScript image path everywhere.
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    // Decoders for JPEG 2000 images and ICC color profiles (served by vite.config.ts).
    wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
    iccUrl: `${import.meta.env.BASE_URL}pdfjs/iccs/`,
  });
  const pages: LoadedPage[] = [];
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: STORE_SIDE / Math.max(base.width, base.height) });
      const [c, ctx] = canvas(viewport.width, viewport.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
      page.cleanup();
      pages.push({
        label: pdf.numPages > 1 ? `${file.name}, page ${n}` : file.name,
        image: await toBlob(c),
        width: c.width,
        height: c.height,
      });
      onPage?.(n, pdf.numPages);
    }
  } catch (e) {
    throw new Error(`${file.name}: could not read PDF (${(e as Error).message}).`);
  } finally {
    // The loading task (not the document proxy) is the stable teardown API across pdf.js versions.
    await task.destroy();
  }
  return pages;
}

/* ---------- decoded-bitmap cache ---------- */

// A decoded page is ~20 MB, so keep only the few most recently used.
const bitmaps = new Map<Blob, Promise<ImageBitmap>>();
function bitmap(blob: Blob): Promise<ImageBitmap> {
  let p = bitmaps.get(blob);
  if (p) bitmaps.delete(blob);
  else p = createImageBitmap(blob);
  bitmaps.set(blob, p); // most recent last
  while (bitmaps.size > 3) bitmaps.delete(bitmaps.keys().next().value!);
  return p;
}

const base64Of = (c: HTMLCanvasElement, type: string, q?: number) => c.toDataURL(type, q).split(',')[1];

/**
 * Contrast stretch that keeps ink colors. The stretch is computed on brightness
 * (paper becomes white, ink darker) and the same mapping is applied to each color
 * channel, so red or green comments stay recognizably red or green for the model.
 * Helps faint pencil and phone photos.
 */
export function enhancePixels(d: Uint8ClampedArray, w: number, h: number) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0]++;
  const total = w * h;
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= total * p) return v;
    return 255;
  };
  const lo = pct(0.005);
  const hi = Math.max(lo + 30, pct(0.9)); // paper is the majority, so the 90th percentile is paper
  const scale = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (d[i] - lo) * scale;
    d[i + 1] = (d[i + 1] - lo) * scale;
    d[i + 2] = (d[i + 2] - lo) * scale;
  }
}

function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  enhancePixels(img.data, w, h);
  ctx.putImageData(img, 0, 0);
}

/** JPEG base64 of the page scaled so its long side is `maxSide`, for the transcription pass. */
export async function modelImage(blob: Blob, maxSide: number, doEnhance: boolean): Promise<string> {
  const bmp = await bitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const [c, ctx] = canvas(bmp.width * s, bmp.height * s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (doEnhance) enhance(ctx, c.width, c.height);
  return base64Of(c, 'image/jpeg', 0.9);
}

/**
 * The page letterboxed into a 1000x1000 white square (page at top-left).
 * In this square, "pixel coordinates" and "0-1000 normalized coordinates" are the
 * same numbers, so box output is correct whichever convention the model was trained on.
 */
export async function squareImage(blob: Blob): Promise<string> {
  const bmp = await bitmap(blob);
  const s = 1000 / Math.max(bmp.width, bmp.height);
  const [c, ctx] = canvas(1000, 1000);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, bmp.width * s, bmp.height * s);
  return base64Of(c, 'image/jpeg', 0.9);
}

/** Crops a normalized box out of the page. Returns the smaller of PNG / JPEG as a data URL. */
export async function cropFigure(blob: Blob, box: Box): Promise<string> {
  const bmp = await bitmap(blob);
  const sx = box.x * bmp.width;
  const sy = box.y * bmp.height;
  const sw = Math.max(1, box.w * bmp.width);
  const sh = Math.max(1, box.h * bmp.height);
  const s = Math.min(1, 1600 / Math.max(sw, sh));
  const [c, ctx] = canvas(sw * s, sh * s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const png = c.toDataURL('image/png');
  const jpg = c.toDataURL('image/jpeg', 0.88);
  return png.length <= jpg.length * 1.15 ? png : jpg;
}

/** Base64 of a crop, for asking the model to describe a figure. */
export async function cropBase64(blob: Blob, box: Box): Promise<string> {
  return (await cropFigure(blob, box)).split(',')[1];
}

/* ---------- ink analysis (figure detection + snap-to-ink) ---------- */

const inkMaps = new WeakMap<Blob, Promise<InkMap>>();

function inkMap(blob: Blob): Promise<InkMap> {
  let p = inkMaps.get(blob);
  if (!p) {
    p = (async () => {
      const bmp = await bitmap(blob);
      const s = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
      const [c, ctx] = canvas(bmp.width * s, bmp.height * s);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return buildInkMap(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    })();
    inkMaps.set(blob, p);
  }
  return p;
}

/** Finds drawings and text lines on the page from ink alone. */
export async function pageLayout(blob: Blob): Promise<Layout> {
  return analyzeLayout(await inkMap(blob));
}

/**
 * Refines a rough box: grows any edge that cuts through ink (up to a limit),
 * trims blank margins, then adds a small pad.
 */
export async function snapToInk(blob: Blob, box: Box): Promise<Box> {
  const { w, h, ink } = await inkMap(blob);
  let x0 = Math.floor(box.x * w);
  let y0 = Math.floor(box.y * h);
  let x1 = Math.min(w - 1, Math.ceil((box.x + box.w) * w));
  let y1 = Math.min(h - 1, Math.ceil((box.y + box.h) * h));

  const row = (y: number, a: number, b: number) => { let n = 0; for (let x = a; x <= b; x++) n += ink[y * w + x]; return n; };
  const col = (x: number, a: number, b: number) => { let n = 0; for (let y = a; y <= b; y++) n += ink[y * w + x]; return n; };
  const MIN = 2;

  let total = 0;
  for (let y = y0; y <= y1; y++) total += row(y, x0, x1);
  if (total < 20) return box; // nothing recognizable inside; leave for the user

  const gx = Math.round(w * 0.08);
  const gy = Math.round(h * 0.06);
  for (let k = 0; k < gy && y0 > 0 && row(y0, x0, x1) >= MIN; k++) y0--;
  for (let k = 0; k < gy && y1 < h - 1 && row(y1, x0, x1) >= MIN; k++) y1++;
  for (let k = 0; k < gx && x0 > 0 && col(x0, y0, y1) >= MIN; k++) x0--;
  for (let k = 0; k < gx && x1 < w - 1 && col(x1, y0, y1) >= MIN; k++) x1++;

  while (y0 < y1 && row(y0, x0, x1) < MIN) y0++;
  while (y1 > y0 && row(y1, x0, x1) < MIN) y1--;
  while (x0 < x1 && col(x0, y0, y1) < MIN) x0++;
  while (x1 > x0 && col(x1, y0, y1) < MIN) x1--;

  const pad = Math.round(Math.max(w, h) * 0.012);
  return clampBox({
    x: (x0 - pad) / w,
    y: (y0 - pad) / h,
    w: (x1 - x0 + 1 + 2 * pad) / w,
    h: (y1 - y0 + 1 + 2 * pad) / h,
  });
}
