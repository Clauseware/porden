'use client';

import { useEffect, useRef, useState } from 'react';
import {
  alpha,
  strokeCurve,
  ThreadCanvas,
  type Frame,
  type Palette,
} from '@/lib/canvas/thread-canvas';
import { guarantees } from '../content';

const N = 70;
const STEPS = 72;

type Shape = {
  /** Height of thread k (−0.5…0.5) at u (0…1), as a share of the canvas height. */
  y: (k: number, u: number, t: number) => number;
  /** Two drawn stretches of each thread, as [from, to] along u. */
  spans: (i: number, t: number) => [[number, number], [number, number]];
  color: (i: number, c: Palette) => string;
};

const wave = (k: number, u: number, t: number) => Math.sin(u * 6 + t * 0.6 + k * 3) * 0.012;
const held = (i: number) => i % 7 === 3 || i % 7 === 4;
const broken = (i: number) => i >= 30 && i < 40;

/** One shape per promise in `guarantees`, in the same order. */
const shapes: Shape[] = [
  // 0 · Only approved details travel: the withheld ones end at the gate.
  {
    y: (k, u, t) => 0.5 + k * 0.62 + wave(k, u, t),
    spans: (i) => [
      [0, held(i) ? 0.47 : 1],
      [1, 1],
    ],
    color: (i, c) => (held(i) ? c.rose : c.lavender),
  },
  // 1 · Never resent blindly: a bundle snaps, waits in amber, then rejoins.
  {
    y: (k, u, t) => 0.5 + k * 0.62 + wave(k, u, t),
    spans: (i, t) => {
      if (!broken(i))
        return [
          [0, 1],
          [1, 1],
        ];
      const gap = 0.08 * (0.5 + 0.5 * Math.cos(t * 0.9));
      return [
        [0, 0.5 - gap],
        [0.5 + gap, 1],
      ];
    },
    color: (i, c) => (broken(i) ? c.amber : c.lavender),
  },
  // 2 · One request, one record: every thread pinches into one point.
  {
    y: (k, u, t) => 0.5 + k * 0.62 * (1 - Math.exp(-((u - 0.62) ** 2) / 0.012)) + wave(k, u, t),
    spans: () => [
      [0, 1],
      [1, 1],
    ],
    color: (_i, c) => c.mint,
  },
  // 3 · Each side keeps its own data: two weaves with an open gap between.
  {
    y: (k, u, t) => 0.5 + k * 0.5 + Math.sin(u * 9 + t * 0.5 + k * 8) * 0.03,
    spans: () => [
      [0, 0.43],
      [0.57, 1],
    ],
    color: (i, c) => (i % 2 ? c.sky : c.lavender),
  },
];

const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Morphs between the shapes as `progress` runs from 0 to 3. */
function drawWeave(
  { ctx, t, dt, w, h, colors }: Frame,
  progress: { value: number; eased: number },
) {
  // A still frame (reduced motion, or drawn off screen) shows the current shape outright.
  progress.eased =
    dt === 0 ? progress.value : progress.eased + (progress.value - progress.eased) * 0.08;
  const p = Math.min(shapes.length - 1, Math.max(0, progress.eased));
  const a = Math.floor(Math.min(p, shapes.length - 1.001));
  const mix = smooth(p - a);
  const from = shapes[a];
  const to = shapes[Math.min(a + 1, shapes.length - 1)];

  const xs = new Array<number>(STEPS + 1);
  const ys = new Array<number>(STEPS + 1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1;
  for (let i = 0; i < N; i += 1) {
    const k = i / (N - 1) - 0.5;
    for (let s = 0; s <= STEPS; s += 1) {
      const u = s / STEPS;
      xs[s] = w * (0.04 + u * 0.92);
      ys[s] = h * lerp(from.y(k, u, t), to.y(k, u, t), mix);
    }
    const sa = from.spans(i, t);
    const sb = to.spans(i, t);
    const color = mix < 0.5 ? from.color(i, colors) : to.color(i, colors);
    ctx.strokeStyle = alpha(color, 0.5);
    for (const j of [0, 1]) {
      const u0 = lerp(sa[j][0], sb[j][0], mix);
      const u1 = lerp(sa[j][1], sb[j][1], mix);
      if (u1 - u0 < 0.01) continue;
      strokeCurve(ctx, xs, ys, Math.round(u0 * STEPS), Math.round(u1 * STEPS) + 1);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  // The gate, for the first state; fades as the weave moves on.
  const gate = Math.max(0, 1 - p);
  if (gate > 0) {
    ctx.strokeStyle = alpha(colors.paper, 0.6 * gate);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w * (0.04 + 0.47 * 0.92) + 8, h * 0.14);
    ctx.lineTo(w * (0.04 + 0.47 * 0.92) + 8, h * 0.86);
    ctx.stroke();
  }
}

/** Built to fail safely: a pinned weave that changes shape as you read each promise. */
export function Guarantees() {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useRef({ value: 0, eased: 0 });
  const [active, setActive] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const range = section.offsetHeight - window.innerHeight;
      const share = Math.min(1, Math.max(0, -rect.top / Math.max(1, range)));
      progress.current.value = share * (shapes.length - 1);
      setActive(Math.min(guarantees.length - 1, Math.round(share * (guarantees.length - 1))));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    // Pinned only where the scene fits one screen; elsewhere it reads as a plain list.
    <section className="relative pin:h-[400vh]" id="guarantees" ref={sectionRef}>
      <div className="flex flex-col pin:sticky pin:top-0 pin:h-dvh pin:overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl grow items-center gap-10 px-4 pt-20 pb-6 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <span className="text-sm text-muted-foreground">Guarantees</span>
              <h2 className="font-heading text-4xl leading-[1.02] font-medium tracking-[-0.045em] text-balance sm:text-5xl">
                Built to fail safely, <span className="thread-text">not to look successful.</span>
              </h2>
            </div>
            <ol className="flex flex-col gap-6">
              {guarantees.map((step, index) => (
                <li
                  className="weave-step flex gap-4"
                  data-active={index === active ? '' : undefined}
                  key={step.title}
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 h-px w-8 shrink-0 bg-linear-to-r from-primary to-transparent"
                  />
                  <div className="flex flex-col gap-1">
                    <h3 className="text-lg font-medium tracking-[-0.01em]">{step.title}</h3>
                    <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="glass relative h-[min(62vh,34rem)] overflow-hidden rounded-[2rem]">
            <ThreadCanvas
              draw={(frame) => drawWeave(frame, progress.current)}
              redrawKey={active}
              still={3}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between p-5 text-xs text-muted-foreground">
              <span>{guarantees[active].label}</span>
              <span className="tabular-nums">
                {active + 1} / {guarantees.length}
              </span>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="mx-auto mb-6 flex w-full max-w-6xl gap-2 px-4 sm:px-6">
          {guarantees.map((step, index) => (
            <span
              className="h-0.5 grow rounded-full bg-foreground/10 transition-colors duration-500"
              key={step.title}
              style={index <= active ? { backgroundColor: 'var(--brand-lavender)' } : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
