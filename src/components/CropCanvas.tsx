import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Box, Figure } from '../types.ts';
import { clampBox } from '../lib/transcript.ts';

interface Props {
  src: string;
  alt: string;
  figures: Figure[];
  active: number | null;
  onSelect: (id: number) => void;
  onChange: (id: number, box: Box) => void;
  /** Re-read mode (2.0): any drag draws the region to re-read; figure boxes are inert. */
  selecting?: boolean;
  selection?: Box | null;
  onSelection?: (box: Box) => void;
}

type Drag =
  | { mode: 'move'; start: Box; px: number; py: number }
  | { mode: 'draw'; px: number; py: number }
  | { mode: 'resize'; start: Box; corner: string; px: number; py: number }
  | { mode: 'select'; px: number; py: number };

const MIN = 0.02;

/**
 * Page image with figure boxes. The active box can be moved/resized with the
 * pointer (drag inside / drag a corner / draw a new box on empty space) or with
 * the keyboard (arrows move, Shift+arrows resize).
 */
export function CropCanvas({ src, alt, figures, active, onSelect, onChange, selecting = false, selection = null, onSelection }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const point = (e: PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { px: (e.clientX - r.left) / r.width, py: (e.clientY - r.top) / r.height };
  };
  const activeFig = figures.find((f) => f.id === active);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const p = point(e);
    if (selecting) {
      drag.current = { mode: 'select', ...p };
      wrap.current!.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const id = Number(t.closest<HTMLElement>('[data-fig]')?.dataset.fig);
    if (id && id !== active) {
      onSelect(id);
      return;
    }
    if (!activeFig) return;
    const corner = t.dataset.corner;
    if (corner) drag.current = { mode: 'resize', corner, start: activeFig.box, ...p };
    else if (id === active) drag.current = { mode: 'move', start: activeFig.box, ...p };
    else drag.current = { mode: 'draw', ...p };
    wrap.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { px, py } = point(e);
    if (d.mode === 'select') {
      const b = { x: Math.min(px, d.px), y: Math.min(py, d.py), w: Math.abs(px - d.px), h: Math.abs(py - d.py) };
      if (b.w >= MIN && b.h >= MIN) onSelection?.(clampBox(b));
      return;
    }
    if (active == null) return;
    const dx = px - d.px;
    const dy = py - d.py;
    let b: Box;
    if (d.mode === 'draw') {
      b = { x: Math.min(px, d.px), y: Math.min(py, d.py), w: Math.abs(dx), h: Math.abs(dy) };
    } else if (d.mode === 'move') {
      b = {
        ...d.start,
        x: Math.min(Math.max(d.start.x + dx, 0), 1 - d.start.w),
        y: Math.min(Math.max(d.start.y + dy, 0), 1 - d.start.h),
      };
    } else {
      let { x, y, w, h } = d.start;
      if (d.corner.includes('w')) { x += dx; w -= dx; }
      if (d.corner.includes('e')) w += dx;
      if (d.corner.includes('n')) { y += dy; h -= dy; }
      if (d.corner.includes('s')) h += dy;
      if (w < MIN || h < MIN) return;
      b = { x, y, w, h };
    }
    if (b.w >= MIN && b.h >= MIN) onChange(active, clampBox(b));
  };

  const onUp = () => {
    drag.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, f: Figure) => {
    const step = 0.01;
    const k: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const v = k[e.key];
    if (!v) return;
    e.preventDefault();
    const b = f.box;
    onChange(
      f.id,
      clampBox(
        e.shiftKey
          ? { ...b, w: Math.max(MIN, b.w + v[0]), h: Math.max(MIN, b.h + v[1]) }
          : { ...b, x: Math.min(Math.max(b.x + v[0], 0), 1 - b.w), y: Math.min(Math.max(b.y + v[1], 0), 1 - b.h) },
      ),
    );
  };

  return (
    <div
      ref={wrap}
      className={`crop${selecting ? ' selecting' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <img src={src} alt={alt} draggable={false} />
      {selecting && selection && (
        <div
          className="reread-box"
          aria-hidden="true"
          style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.w * 100}%`, height: `${selection.h * 100}%` }}
        />
      )}
      {figures.map((f) => {
        const on = f.id === active;
        return (
          <div
            key={f.id}
            data-fig={f.id}
            className={`box${on ? ' on' : ''}${f.needsReview ? ' review' : ''}`}
            style={{ left: `${f.box.x * 100}%`, top: `${f.box.y * 100}%`, width: `${f.box.w * 100}%`, height: `${f.box.h * 100}%` }}
            tabIndex={on ? 0 : -1}
            role={on ? 'group' : undefined}
            aria-label={on ? `Crop for figure ${f.id}. Arrow keys move it; Shift plus arrow keys resize it.` : undefined}
            onKeyDown={on ? (e) => onKey(e, f) : undefined}
          >
            <span className="box-tag" aria-hidden="true">
              {f.id}
            </span>
            {on && ['nw', 'ne', 'sw', 'se'].map((c) => <span key={c} data-corner={c} className={`handle ${c}`} />)}
          </div>
        );
      })}
    </div>
  );
}
