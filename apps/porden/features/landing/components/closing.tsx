'use client';

import { ArrowRightIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { alpha, ThreadCanvas, type Frame } from '@/lib/canvas/thread-canvas';

/* ---------- Closing: every thread ties into one knot ---------- */

type Knot = {
  /** The mark's centre, where the threads tie off. */
  x: number;
  y: number;
  /** The headline's top edge: no thread may come below it. */
  floor: number;
};

/**
 * Two bundles of thread, one from each side, tie off at the Porden mark. Every thread starts
 * and curves above the headline, so the copy always sits on clean background.
 */
function drawTie({ ctx, t, w, h, colors }: Frame, knot: Knot) {
  if (!knot.x) return;
  const sway = 28;
  const top = h * 0.04;
  const bottom = Math.max(top + 40, knot.floor - sway - 48);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.9;
  const n = 64;
  for (const [side, from, to] of [
    [-1, colors.lavender, colors.rose],
    [1, colors.mint, colors.amber],
  ] as const) {
    const sx = side < 0 ? -20 : w + 20;
    for (let i = 0; i < n; i += 1) {
      const k = i / (n - 1) - 0.5;
      const sy = top + (k + 0.5) * (bottom - top);
      const drift = Math.sin(t * 0.4 + i * 0.37) * sway;
      const grad = ctx.createLinearGradient(sx, 0, knot.x, 0);
      grad.addColorStop(0, alpha(from, 0.05));
      grad.addColorStop(0.7, alpha(to, 0.22));
      grad.addColorStop(1, alpha(colors.paper, 0.5));
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(
        sx + (knot.x - sx) * 0.45,
        sy + drift,
        // The last stretch arrives from its own side, so the bundles never cross over the mark.
        knot.x + side * Math.min(140, Math.abs(knot.x - sx) * 0.4),
        knot.y + k * 24,
        knot.x,
        knot.y,
      );
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  const glow = ctx.createRadialGradient(knot.x, knot.y, 0, knot.x, knot.y, 90);
  glow.addColorStop(0, alpha(colors.lavender, 0.5));
  glow.addColorStop(1, alpha(colors.lavender, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(knot.x - 90, knot.y - 90, 180, 180);
}

export function Closing() {
  const sectionRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const knot = useRef<Knot>({ x: 0, y: 0, floor: 0 });

  // The threads tie off exactly where the mark sits, and stay above the headline.
  useEffect(() => {
    const section = sectionRef.current;
    const mark = markRef.current;
    const heading = headingRef.current;
    if (!section || !mark || !heading) return;
    const measure = () => {
      const s = section.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      knot.current = {
        x: m.left + m.width / 2 - s.left,
        y: m.top + m.height / 2 - s.top,
        floor: heading.getBoundingClientRect().top - s.top,
      };
    };
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    measure();
    // Web fonts change the headline's height once they load.
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);

  return (
    <section className="relative isolate overflow-hidden" id="closing" ref={sectionRef}>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,transparent,black_18%)]"
      >
        <ThreadCanvas draw={(frame) => drawTie(frame, knot.current)} still={3} />
      </div>
      <div className="pointer-events-none mx-auto flex min-h-[85vh] w-full max-w-6xl flex-col items-center justify-center gap-8 px-5 py-32 text-center sm:px-8">
        <span className="grid size-24 place-items-center rounded-full bg-background" ref={markRef}>
          <LogoMark className="size-12" />
        </span>
        <h2
          className="max-w-[min(14ch,100%)] font-heading text-[clamp(3rem,7vw,6.5rem)] leading-[0.92] font-medium tracking-[-0.05em] text-balance hyphens-auto wrap-break-word"
          ref={headingRef}
        >
          Pass work on with confidence.
        </h2>
        <p className="max-w-md text-lg text-pretty text-muted-foreground">
          Start with the browser SDK. Your API and your database stay yours.
        </p>
        <Button
          className="pointer-events-auto rounded-full"
          render={<a href="#developers" />}
          size="lg"
        >
          Read the SDK
          <ArrowRightIcon
            aria-hidden="true"
            className="transition-transform in-[[data-slot=button]:hover]:translate-x-0.5"
          />
        </Button>
      </div>
    </section>
  );
}
