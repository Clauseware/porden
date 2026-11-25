'use client';

import { useRef } from 'react';
import { alpha, strokeCurve, ThreadCanvas, type Frame } from '@/lib/canvas/thread-canvas';

/* ---------- The colour flip: a tangle a person smooths out ---------- */

function drawTangle(
  { ctx, t, w, h, pointer, colors }: Frame,
  hand: { x: number; y: number; s: number },
) {
  hand.s += ((pointer.inside ? 1 : 0) - hand.s) * 0.05;
  if (pointer.inside) {
    hand.x += (pointer.x - hand.x) * 0.1;
    hand.y += (pointer.y - hand.y) * 0.1;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  // The threads live on the open right side and fade in there, so the copy on
  // the left sits on clean lavender.
  const x0 = w * 0.42;
  const fade = ctx.createLinearGradient(x0, 0, w * 0.58, 0);
  fade.addColorStop(0, alpha(colors.ink, 0));
  fade.addColorStop(1, alpha(colors.ink, 0.6));
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 26; i += 1) {
    const k = i / 25 - 0.5;
    xs.length = 0;
    ys.length = 0;
    for (let s = 0; s <= 90; s += 1) {
      const u = s / 90;
      const x = x0 + u * (w - x0);
      // Tangled in the middle of the right side; calm at its ends and under the hand.
      const knot = Math.exp(-((u - 0.5) ** 2) / 0.03);
      const calm =
        1 -
        hand.s * Math.exp(-((x - hand.x) ** 2 + (h * 0.5 - hand.y) ** 2 * 0.2) / (2 * 180 ** 2));
      const tangle = knot * calm * h * 0.22;
      xs.push(x + Math.sin(u * 40 + i * 1.7 + t * 0.9) * tangle * 0.35);
      ys.push(h * 0.5 + k * h * 0.55 + Math.sin(u * 23 + i * 2.3 - t * 1.1) * tangle);
    }
    ctx.strokeStyle = fade;
    strokeCurve(ctx, xs, ys);
  }
}

export function UnclearBand() {
  const hand = useRef({ x: -1e4, y: 0, s: 0 });
  return (
    <section className="px-3 py-16 sm:px-5">
      <div className="relative mx-auto min-h-[34rem] w-full max-w-[92rem] overflow-hidden rounded-[2.75rem] bg-[radial-gradient(120%_140%_at_10%_0%,color-mix(in_srgb,var(--brand-lavender)_100%,white_18%),var(--brand-lavender)_50%,color-mix(in_srgb,var(--brand-lavender)_70%,var(--thread-rose)))] text-primary-foreground">
        <div aria-hidden="true" className="absolute inset-0">
          <ThreadCanvas draw={(frame) => drawTangle(frame, hand.current)} still={2} />
        </div>
        <div className="pointer-events-none relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-24 sm:px-10 lg:py-28">
          <span className="text-sm text-primary-foreground/70">When it is unclear</span>
          <h2 className="max-w-3xl font-heading text-5xl leading-[0.98] font-medium tracking-[-0.05em] text-balance sm:text-7xl">
            A tangle is a cue for a person, not a retry.
          </h2>
          <p className="max-w-lg text-lg text-pretty text-primary-foreground/75">
            If a receipt doesn’t come back, Porden doesn’t guess and doesn’t send the work again. It
            waits for someone to check the other side.
          </p>
        </div>
      </div>
    </section>
  );
}
