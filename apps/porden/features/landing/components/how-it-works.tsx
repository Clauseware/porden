'use client';

import { useRef } from 'react';
import { Reveal } from '@/components/reveal';
import { alpha, strokeCurve, ThreadCanvas, type Frame } from '@/lib/canvas/thread-canvas';
import { steps } from '../content';

/** Hovering a figure speeds its clock up and brightens it; leaving eases it back. */
type Feel = { clock: number; boost: number };

function feel(f: Frame, state: Feel) {
  state.boost += ((f.pointer.inside ? 1 : 0) - state.boost) * 0.08;
  state.clock += f.dt * (1 + state.boost * 2.2);
  return state.clock;
}

/** 01 · Approve: threads flow through a comb; the withheld bundle stops short and curls back. */
function drawComb(f: Frame, state: Feel) {
  const { ctx, w, h, colors } = f;
  const t = feel(f, state);
  const comb = w * 0.56;
  const xs: number[] = [];
  const ys: number[] = [];
  ctx.lineWidth = 1;
  for (let i = 0; i < 34; i += 1) {
    const k = i / 33;
    const held = i % 6 === 2 || i % 6 === 3;
    const y0 = h * (0.18 + 0.64 * k);
    xs.length = 0;
    ys.length = 0;
    const end = held ? comb - 10 : w * 0.94;
    for (let s = 0; s <= 40; s += 1) {
      const u = s / 40;
      const x = w * 0.06 + u * (end - w * 0.06);
      xs.push(x);
      ys.push(y0 + Math.sin(u * 5 + t * 1.2 + i * 0.4) * 5 * (1 - u * 0.6));
    }
    if (held) {
      // The curl back: a small loop before the comb.
      const lx = xs.at(-1) ?? comb;
      const ly = ys.at(-1) ?? y0;
      for (let a = 0; a <= 1; a += 0.1) {
        xs.push(lx - Math.sin(a * Math.PI) * 14);
        ys.push(ly - (1 - Math.cos(a * Math.PI)) * 7);
      }
    }
    ctx.strokeStyle = held
      ? alpha(colors.rose, 0.75)
      : alpha(colors.lavender, 0.45 + state.boost * 0.35);
    ctx.setLineDash(held ? [] : [8, 10]);
    ctx.lineDashOffset = -t * 40;
    strokeCurve(ctx, xs, ys);
  }
  ctx.setLineDash([]);
  // The comb's teeth.
  ctx.strokeStyle = alpha(colors.paper, 0.55);
  ctx.lineWidth = 1.5;
  for (let j = 0; j < 12; j += 1) {
    const y = h * (0.15 + j * 0.065);
    ctx.beginPath();
    ctx.moveTo(comb, y);
    ctx.lineTo(comb + 8, y + 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(comb, h * 0.12);
  ctx.lineTo(comb, h * 0.88);
  ctx.stroke();
}

/** 02 · Hand off: chords spun between two rings, turning into a woven hyperboloid. */
function drawRings(f: Frame, state: Feel) {
  const { ctx, w, h, colors } = f;
  const t = feel(f, state);
  const r = Math.min(w, h) * 0.3;
  const a = { x: w * 0.28, y: h * 0.5 };
  const b = { x: w * 0.72, y: h * 0.5 };
  const n = 64;
  const shift = 10 + Math.sin(t * 0.35) * 9;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.8;
  for (let j = 0; j < n; j += 1) {
    const ta = (j / n) * Math.PI * 2 + t * 0.25;
    const tb = ((j + shift) / n) * Math.PI * 2 - t * 0.25;
    const p = { x: a.x + Math.cos(ta) * r * 0.42, y: a.y + Math.sin(ta) * r };
    const q = { x: b.x + Math.cos(tb) * r * 0.42, y: b.y + Math.sin(tb) * r };
    const g = ctx.createLinearGradient(p.x, p.y, q.x, q.y);
    g.addColorStop(0, alpha(colors.lavender, 0.5 + state.boost * 0.3));
    g.addColorStop(1, alpha(colors.mint, 0.5 + state.boost * 0.3));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = alpha(colors.paper, 0.4);
  for (const c of [a, b]) {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * 0.42, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 03 · Accept: a fan of threads squeezes through the receiver's gate and leaves as one strand. */
function drawGate(f: Frame, state: Feel) {
  const { ctx, w, h, colors } = f;
  const t = feel(f, state);
  const gx = w * 0.6;
  const gy = h * 0.5;
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 28; i += 1) {
    const k = i / 27 - 0.5;
    const y0 = gy + k * h * 0.72;
    ctx.strokeStyle = alpha(colors.sky, 0.32 + state.boost * 0.3);
    ctx.beginPath();
    ctx.moveTo(w * 0.05, y0 + Math.sin(t * 0.8 + i) * 4);
    ctx.bezierCurveTo(w * 0.35, y0, w * 0.45, gy + k * 6, gx, gy + k * 2);
    ctx.stroke();
  }
  // One strand on the other side, with a pulse riding it.
  ctx.strokeStyle = alpha(colors.mint, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(w * 0.86, gy);
  ctx.stroke();
  const p = (t * 0.45) % 1;
  ctx.fillStyle = colors.paper;
  ctx.beginPath();
  ctx.arc(gx + p * (w * 0.26), gy, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // The gate and the receiver.
  ctx.strokeStyle = alpha(colors.paper, 0.6);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(gx, gy - 26);
  ctx.lineTo(gx, gy - 8);
  ctx.moveTo(gx, gy + 8);
  ctx.lineTo(gx, gy + 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(w * 0.86, gy - 18, 22, 36, 8);
  ctx.stroke();
}

/** 04 · Prove: a times-table cardioid, the signature, slowly morphing. */
function drawSeal(f: Frame, state: Feel) {
  const { ctx, w, h, colors } = f;
  const t = feel(f, state);
  const n = 160;
  const r = Math.min(w, h) * 0.38;
  const cx = w / 2;
  const cy = h / 2;
  const m = 2 + (Math.sin(t * 0.12) + 1) * 1.5;
  const point = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = point(i);
    const [x2, y2] = point((i * m) % n);
    ctx.strokeStyle = alpha(i % 2 ? colors.amber : colors.lavender, 0.32 + state.boost * 0.3);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = alpha(colors.paper, 0.35);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

const figures = {
  comb: drawComb,
  rings: drawRings,
  gate: drawGate,
  seal: drawSeal,
} satisfies Record<(typeof steps)[number]['figure'], (f: Frame, state: Feel) => void>;

function StepCard({ step, index }: { step: (typeof steps)[number]; index: number }) {
  const state = useRef<Feel>({ clock: index * 7, boost: 0 });
  return (
    <li
      className="glow-frame sx-rise glass flex flex-col overflow-hidden rounded-[1.75rem]"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
      }}
      style={{ '--d': `${150 + index * 110}ms` } as React.CSSProperties}
    >
      <div className="relative h-56 border-b border-white/5">
        <ThreadCanvas draw={(frame) => figures[step.figure](frame, state.current)} />
      </div>
      <div className="flex flex-col gap-2 p-6">
        <span className="text-sm text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
        <h3 className="text-xl font-medium tracking-[-0.02em]">{step.title}</h3>
        <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
      </div>
    </li>
  );
}

function Steps() {
  return (
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => (
        <StepCard index={index} key={step.title} step={step} />
      ))}
    </ol>
  );
}

/** The four steps, under their heading. */
export function HowItWorks() {
  return (
    <Reveal id="how">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-28 sm:px-6 lg:py-36">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-end">
          <div className="flex flex-col gap-4">
            <span className="sx-rise text-sm text-muted-foreground">How it works</span>
            <h2 className="sx-rise font-heading text-4xl leading-[1.02] font-medium tracking-[-0.045em] text-balance sm:text-6xl">
              Four steps. <span className="thread-text">Nothing extra crosses.</span>
            </h2>
          </div>
          <p
            className="sx-rise max-w-md text-lg text-pretty text-muted-foreground lg:justify-self-end"
            style={{ '--d': '120ms' } as React.CSSProperties}
          >
            The same lifecycle for any kind of work and any two organizations.
          </p>
        </div>
        <Steps />
      </div>
    </Reveal>
  );
}
