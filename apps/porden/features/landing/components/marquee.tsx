'use client';

import { useEffect, useRef } from 'react';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Marquee: speeds up and leans with the scroll ---------- */

export function Marquee({ words }: { words: string[] }) {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const reduced = reducedMotion();
    let frame = 0;
    let visible = false;
    let offset = 0;
    let last = 0;
    let lastScroll = window.scrollY;
    let velocity = 0;
    let skew = 0;
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const scrolled = window.scrollY - lastScroll;
      lastScroll = window.scrollY;
      velocity += (scrolled / Math.max(dt, 1 / 120) - velocity) * 0.1;
      skew += (Math.max(-10, Math.min(10, velocity * 0.012)) - skew) * 0.12;
      offset -= (60 + Math.abs(velocity) * 0.45) * dt;
      const half = track.scrollWidth / 2;
      if (-offset > half) offset += half;
      track.style.transform = `translateX(${offset}px) skewX(${-skew}deg)`;
      frame = visible ? requestAnimationFrame(loop) : 0;
    };
    const watcher = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible && !reduced && !frame) {
        last = 0;
        lastScroll = window.scrollY;
        frame = requestAnimationFrame(loop);
      }
    });
    watcher.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden py-12 [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]"
    >
      <div className="flex w-max gap-12 whitespace-nowrap will-change-transform" ref={trackRef}>
        {[...words, ...words].map((word, index) => (
          <span
            className="flex items-center gap-12 font-heading text-5xl font-medium tracking-[-0.03em] text-foreground/20 sm:text-7xl"
            key={`${word}-${index}`}
          >
            {word}
            <span className="size-2.5 rounded-full bg-[var(--brand-lavender)]/60" />
          </span>
        ))}
      </div>
    </div>
  );
}
