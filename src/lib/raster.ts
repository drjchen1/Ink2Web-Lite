import type { Box } from '../types.ts';
import type { InkMap } from './layout.ts';
import { clampBox } from './transcript.ts';

/**
 * Pluggable raster/imaging operations shared by the browser app (backed by
 * HTMLCanvasElement / PDF.js in images.ts) and the Node CLI (backed by
 * @napi-rs/canvas in cli/nodeRaster.ts). Zero DOM dependencies.
 */
export interface RasterBackend {
  pageInkMap(blob: Blob): Promise<InkMap>;
  figureInkMap(blob: Blob, box: Box): Promise<InkMap>;
  modelImage(blob: Blob, maxSide: number, doEnhance: boolean): Promise<string>;
  regionImage(blob: Blob, box: Box, doEnhance: boolean): Promise<string>;
  squareImage(blob: Blob): Promise<string>;
  cropFigure(blob: Blob, box: Box): Promise<string>;
  cropBase64(blob: Blob, box: Box): Promise<string>;
  snapToInk(blob: Blob, box: Box): Promise<Box>;
}

/**
 * Refines a rough box against a precomputed page InkMap: grows any edge that
 * cuts through ink (up to a limit), trims blank margins, then adds a small pad.
 */
export function snapBoxToInkMap(map: InkMap, box: Box): Box {
  const { w, h, ink } = map;
  let x0 = Math.floor(box.x * w);
  let y0 = Math.floor(box.y * h);
  let x1 = Math.min(w - 1, Math.ceil((box.x + box.w) * w));
  let y1 = Math.min(h - 1, Math.ceil((box.y + box.h) * h));

  const row = (y: number, a: number, b: number) => {
    let n = 0;
    for (let x = a; x <= b; x++) n += ink[y * w + x];
    return n;
  };
  const col = (x: number, a: number, b: number) => {
    let n = 0;
    for (let y = a; y <= b; y++) n += ink[y * w + x];
    return n;
  };
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
