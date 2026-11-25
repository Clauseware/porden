'use client';

import { ArrowDownIcon, ArrowRightIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { HandoffNavCta } from '@/components/ui/handoff-nav';
import { alpha, strokeCurve, ThreadCanvas, type Frame } from '@/lib/canvas/thread-canvas';
import { HandoffRecord } from './handoff-record';

const THREADS = 170;
const STEPS = 96;

function d(ms: number) {
  return { '--d': `${ms}ms` } as React.CSSProperties;
}

/** Where the two agents sit, in canvas pixels, measured from the layout. */
type Ends = { ax: number; ay: number; bx: number; by: number };

type Mote = { u: number; k: number; speed: number; size: number };

/** Context in transit: motes that ride the ribbon from one agent to the other. */
function makeMotes(): Mote[] {
  return Array.from({ length: 110 }, (_, i) => ({
    u: (i * 0.618) % 1,
    k: ((i * 0.382) % 1) - 0.5,
    speed: 0.035 + ((i * 0.27) % 1) * 0.05,
    size: 1 + ((i * 0.53) % 1) * 1.8,
  }));
}

/**
 * The ribbon runs between the two halves of the headline: every thread leaves
 * your agent in one bundle, opens into a twisting band, and gathers again at
 * theirs. Nearby threads lean towards the pointer.
 */
function drawRibbon(
  { ctx, t, dt, w, pointer, colors }: Frame,
  ends: Ends,
  bend: { x: number; y: number; s: number; motes: Mote[] },
) {
  const { ax, ay, bx, by } = ends;
  if (bx - ax < 40) return;
  const span = bx - ax;
  const width = Math.min(w * 0.11, 130);
  const sway = Math.min(w * 0.02, 26);
  const baseY = (u: number) => ay + (by - ay) * u;

  bend.s += ((pointer.inside ? 1 : 0) - bend.s) * 0.06;
  if (pointer.inside) {
    bend.x += (pointer.x - bend.x) * 0.12;
    bend.y += (pointer.y - bend.y) * 0.12;
  }

  const grad = ctx.createLinearGradient(ax, 0, bx, 0);
  grad.addColorStop(0, alpha(colors.lavender, 0.9));
  grad.addColorStop(0.35, alpha(colors.rose, 0.9));
  grad.addColorStop(0.62, alpha(colors.amber, 0.85));
  grad.addColorStop(1, alpha(colors.mint, 0.9));

  const xs = new Array<number>(STEPS + 1);
  const ys = new Array<number>(STEPS + 1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = grad;

  for (let i = 0; i < THREADS; i += 1) {
    const k = i / (THREADS - 1) - 0.5;
    ctx.globalAlpha = 0.11 + 0.1 * (1 - Math.abs(k) * 2);
    for (let s = 0; s <= STEPS; s += 1) {
      const u = s / STEPS;
      const x = ax + u * span;
      const env = Math.sin(Math.PI * u) ** 1.25;
      const centre = Math.sin(u * Math.PI * 1.8 + t * 0.32) * sway;
      const twist = Math.cos(u * Math.PI * 2.3 - t * 0.22 + k * 0.6);
      const strand = Math.sin(u * 14 + i * 0.7 + t * 0.6) * 2.2;
      let y = baseY(u) + env * (centre + k * width * twist + strand);
      const near = Math.exp(-((x - bend.x) ** 2) / (2 * 130 ** 2));
      y += (bend.y - y) * near * 0.3 * env * bend.s;
      xs[s] = x;
      ys[s] = y;
    }
    strokeCurve(ctx, xs, ys);
  }

  const hues = [colors.lavender, colors.rose, colors.amber, colors.mint];
  for (const m of bend.motes) {
    m.u = (m.u + m.speed * dt) % 1;
    const env = Math.sin(Math.PI * m.u) ** 1.25;
    const x = ax + m.u * span;
    const centre = Math.sin(m.u * Math.PI * 1.8 + t * 0.32) * sway;
    const twist = Math.cos(m.u * Math.PI * 2.3 - t * 0.22 + m.k * 0.6);
    let y = baseY(m.u) + env * (centre + m.k * width * twist);
    const near = Math.exp(-((x - bend.x) ** 2) / (2 * 130 ** 2));
    y += (bend.y - y) * near * 0.3 * env * bend.s;
    const r = m.size * 3.5;
    const mote = ctx.createRadialGradient(x, y, 0, x, y, r);
    const hue = hues[Math.min(hues.length - 1, Math.floor(m.u * hues.length))];
    mote.addColorStop(0, alpha(colors.paper, 0.9));
    mote.addColorStop(0.35, alpha(hue, 0.5));
    mote.addColorStop(1, alpha(hue, 0));
    ctx.globalAlpha = env;
    ctx.fillStyle = mote;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // A handoff in flight rides the middle of the ribbon.
  const p = (t * 0.16) % 1;
  const px = ax + p * span;
  const py =
    baseY(p) + Math.sin(Math.PI * p) ** 1.25 * Math.sin(p * Math.PI * 1.8 + t * 0.32) * sway;
  const glow = ctx.createRadialGradient(px, py, 0, px, py, 46);
  glow.addColorStop(0, alpha(colors.paper, 0.85));
  glow.addColorStop(0.3, alpha(colors.amber, 0.35));
  glow.addColorStop(1, alpha(colors.amber, 0));
  ctx.globalAlpha = Math.sin(Math.PI * p);
  ctx.fillStyle = glow;
  ctx.fillRect(px - 46, py - 46, 92, 92);

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  for (const [x, y, color] of [
    [ax, ay, colors.lavender],
    [bx, by, colors.mint],
  ] as const) {
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 34);
    halo.addColorStop(0, alpha(color, 0.5));
    halo.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(x - 34, y - 34, 68, 68);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/* ---------- Hero ---------- */

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const aRef = useRef<HTMLSpanElement>(null);
  const bRef = useRef<HTMLSpanElement>(null);
  const ends = useRef<Ends>({ ax: 0, ay: 0, bx: 0, by: 0 });
  const bend = useRef({ x: 0, y: 0, s: 0, motes: makeMotes() });

  // The ribbon is tied to two points in the layout, so it follows the type at every width.
  useEffect(() => {
    const section = sectionRef.current;
    const a = aRef.current;
    const b = bRef.current;
    if (!section || !a || !b) return;
    const measure = () => {
      const s = section.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      ends.current = {
        ax: ra.left - s.left,
        ay: ra.top - s.top,
        bx: rb.left - s.left,
        by: rb.top - s.top,
      };
    };
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    measure();
    // Web fonts change the line heights once they load.
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
    <section className="relative isolate overflow-hidden" ref={sectionRef}>
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <ThreadCanvas draw={(frame) => drawRibbon(frame, ends.current, bend.current)} still={6} />
      </div>

      <div className="pointer-events-none mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-[88rem] flex-col px-5 pt-12 pb-10 sm:px-8 lg:px-12 lg:pt-16">
        <h1 className="flex flex-col font-heading text-[clamp(3.2rem,8.6vw,8.75rem)] leading-[0.9] font-medium tracking-[-0.05em]">
          <span className="reveal-line">
            <span style={d(60)}>Hand off work.</span>
          </span>
          {/* The ribbon's two ends: your agent here, theirs at the far side. */}
          <span aria-hidden="true" className="relative block h-[clamp(8rem,24vh,14rem)]">
            <span className="absolute top-[22%] left-[0.4rem] size-0" ref={aRef} />
            <span className="absolute right-[0.4rem] bottom-[22%] size-0" ref={bRef} />
          </span>
          <span className="reveal-line self-end text-right">
            <span style={d(200)}>Keep the context.</span>
          </span>
        </h1>

        <div className="mt-auto grid grid-cols-1 gap-8 pt-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="enter-fade flex max-w-lg flex-col gap-6" style={d(380)}>
            <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
              Porden passes work between AI agents at different companies. Each side approves what
              leaves, checks what arrives and keeps a signed receipt. When something is unclear, a
              person decides.
            </p>
            <div className="pointer-events-auto flex flex-wrap items-center gap-x-6 gap-y-3">
              {/* As the hero scrolls away, this button flies up into the nav. */}
              <HandoffNavCta className="group" href="#developers">
                Read the SDK
                <ArrowRightIcon
                  aria-hidden="true"
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                />
              </HandoffNavCta>
              <a
                className="inline-flex items-center gap-1.5 rounded-full text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                href="#how"
              >
                How a handoff works
                <ArrowDownIcon aria-hidden="true" className="size-4" />
              </a>
            </div>
          </div>
          <div className="enter-fade pointer-events-auto" style={d(520)}>
            <HandoffRecord />
          </div>
        </div>
      </div>
    </section>
  );
}
