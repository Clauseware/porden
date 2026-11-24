'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type Palette = {
  lavender: string;
  rose: string;
  amber: string;
  mint: string;
  sky: string;
  ink: string;
  paper: string;
};

type Pointer = {
  /** Position in canvas pixels; far away when outside. */
  x: number;
  y: number;
  inside: boolean;
};

export type Frame = {
  ctx: CanvasRenderingContext2D;
  /** Scene clock in seconds. */
  t: number;
  dt: number;
  w: number;
  h: number;
  pointer: Pointer;
  colors: Palette;
};

/** Colours come from CSS tokens (features/landing/landing.css), never from the drawing code. */
function readPalette(el: Element): Palette {
  const style = getComputedStyle(el);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    lavender: token('--brand-lavender'),
    rose: token('--thread-rose'),
    amber: token('--thread-amber'),
    mint: token('--thread-mint'),
    sky: token('--thread-sky'),
    ink: token('--brand-near-black'),
    paper: token('--brand-off-white'),
  };
}

/** A hex colour at an alpha, for gradients and strokes. */
export function alpha(hex: string, a: number) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Draws a smooth open curve through points. */
export function strokeCurve(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  ys: number[],
  from = 0,
  to = xs.length,
) {
  if (to - from < 2) return;
  ctx.beginPath();
  ctx.moveTo(xs[from], ys[from]);
  for (let i = from + 1; i < to - 1; i += 1) {
    ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
  }
  ctx.lineTo(xs[to - 1], ys[to - 1]);
  ctx.stroke();
}

/**
 * A canvas that redraws every frame while it is on screen. Pointer input is read
 * from its parent, so text laid over the canvas still steers it. With reduced
 * motion it draws one still frame at `still` seconds and stops; a new `redrawKey`
 * draws that still frame again, for figures whose shape follows page state.
 */
export function ThreadCanvas({
  draw,
  className,
  still = 4,
  redrawKey,
}: {
  draw: (frame: Frame) => void;
  className?: string;
  still?: number;
  redrawKey?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const redrawStill = useRef<() => void>(() => {});

  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const host = canvas?.parentElement;
    if (!canvas || !ctx || !host) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer: Pointer = { x: -1e4, y: -1e4, inside: false };
    let w = 0;
    let h = 0;
    let t = 0;
    let last = 0;
    let frame = 0;
    let visible = false;
    let colors = readPalette(canvas);

    const render = (time: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      drawRef.current({ ctx, t: time, dt, w, h, pointer, colors });
    };
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      t += dt;
      render(t, dt);
      frame = visible ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (reduced || frame) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      colors = readPalette(canvas);
      if (reduced || !visible) render(reduced ? still : t, 0);
    };
    redrawStill.current = () => {
      if (reduced) render(still, 0);
    };

    const local = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onMove = (event: PointerEvent) => {
      const p = local(event);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.inside = true;
    };
    const onLeave = () => {
      pointer.inside = false;
      pointer.x = -1e4;
      pointer.y = -1e4;
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    const resizer = new ResizeObserver(resize);
    resizer.observe(canvas);
    const watcher = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
    });
    watcher.observe(canvas);
    resize();

    return () => {
      redrawStill.current = () => {};
      cancelAnimationFrame(frame);
      frame = 0;
      visible = false;
      resizer.disconnect();
      watcher.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [still]);

  useEffect(() => {
    redrawStill.current();
  }, [redrawKey]);

  return <canvas aria-hidden="true" className={cn('block size-full', className)} ref={ref} />;
}
