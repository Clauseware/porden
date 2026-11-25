'use client';

import { useEffect, useRef } from 'react';

// A slow vortex of thin lines and fine dots behind the hero. One 2D canvas, drawn by hand, no
// library. It only ever draws lines and dots in the theme's own text colour at low opacity, so the
// page background stays flat. Everything here is decoration: it is hidden from assistive tech,
// ignores the pointer and never takes focus.

const PEAK = 0.3; // the strongest opacity any line or dot may reach
const CALM = 0.12; // share of PEAK kept behind text, so copy stays readable
const CALM_PAD = 8; // px around a text block that stay at the calm level
const CALM_FEATHER = 48; // px over which the lines return to full strength
const LEVELS = 6; // opacity steps; each step is drawn as one batched path
const SEED = 20240611; // fixed, so the still frame is the same on every load
const TILT = 0.16; // how much the funnel is seen from above
const DISC_TILT = 0.22;
const TWIST = 2.2 * Math.PI; // turns an arm makes from rim to neck
const SPIN = 0.12; // radians per second
const H_MIN = 0.06; // lowest height on the funnel, as a share of its height
const SEGMENTS = 40; // segments per arm
const RING_SEGMENTS = 56;
const FRAME_MS = 1000 / 30;
const STILL_TIME = 6; // seconds into the motion that the still frame shows
const ANIMATED_MIN_WIDTH = 640;
const MAX_DPR = 2;

type Rect = { l: number; t: number; r: number; b: number };
type Arm = { phase: number; h0: number; h1: number; weight: number };
type Dot = { arm: number; p: number; speed: number; off: number };
type Ring = { radius: number; start: number; span: number; speed: number; weight: number };
type Scene = {
  w: number;
  h: number;
  dpr: number;
  cx: number;
  baseY: number;
  height: number;
  rim: number;
  neck: number;
  arms: Arm[];
  dots: Dot[];
  rings: Ring[];
  calm: Rect[];
};

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function buildScene(w: number, h: number, dpr: number, calm: Rect[]): Scene {
  const random = seeded(SEED);
  const wide = w >= 1024;
  const rim = w * (wide ? 0.55 : 0.46);
  const height = Math.min(h * 0.74, w * 0.8);
  const baseY = Math.min(h * 0.84, height + h * 0.08);
  const neck = rim * 0.06;

  const armCount = clamp(Math.round(w / 10), 56, 160);
  const arms: Arm[] = [];
  for (let i = 0; i < armCount; i += 1) {
    arms.push({
      phase: (i / armCount) * Math.PI * 2 + random() * 0.06,
      h0: H_MIN + random() * 0.4,
      h1: 0.88 + random() * 0.12,
      weight: 0.55 + random() * 0.45,
    });
  }

  const dotCount = clamp(Math.round(w / 5), 80, 260);
  const dots: Dot[] = [];
  for (let i = 0; i < dotCount; i += 1) {
    dots.push({
      arm: Math.floor(random() * armCount),
      p: random(),
      speed: 0.012 + random() * 0.02,
      off: (random() - 0.5) * 0.18,
    });
  }

  const ringCount = 14;
  const rings: Ring[] = [];
  for (let i = 0; i < ringCount; i += 1) {
    const share = i / (ringCount - 1);
    rings.push({
      radius: neck * 1.5 + (rim * 0.6 - neck * 1.5) * Math.pow(share, 1.15),
      start: random() * Math.PI * 2,
      span: Math.PI * (1.2 + random() * 0.7),
      speed: (i % 2 === 0 ? 1 : -1) * (0.05 + random() * 0.08),
      weight: 0.8 - share * 0.45,
    });
  }

  return {
    w,
    h,
    dpr,
    cx: w * (wide ? 0.3 : 0.5),
    baseY,
    height,
    rim,
    neck,
    arms,
    dots,
    rings,
    calm,
  };
}

// 1 away from text, CALM on top of it, easing back in between.
function calmAt(x: number, y: number, rects: Rect[]) {
  let m = 1;
  for (const rect of rects) {
    const dx = Math.max(rect.l - x, 0, x - rect.r);
    const dy = Math.max(rect.t - y, 0, y - rect.b);
    const d = Math.hypot(dx, dy);
    if (d >= CALM_FEATHER) continue;
    const s = d / CALM_FEATHER;
    m = Math.min(m, CALM + (1 - CALM) * s * s * (3 - 2 * s));
  }
  return m;
}

function levelOf(alpha: number) {
  return Math.min(LEVELS - 1, Math.floor((alpha / PEAK) * LEVELS));
}

function radiusAt(h: number, scene: Scene) {
  return scene.neck + (scene.rim - scene.neck) * Math.pow(h, 2.2);
}

function angleAt(h: number, phase: number, spin: number) {
  return phase + spin + TWIST * Math.pow(1 - h, 0.8);
}

function draw(ctx: CanvasRenderingContext2D, scene: Scene, color: string, time: number) {
  ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
  ctx.clearRect(0, 0, scene.w, scene.h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  const spin = time * SPIN;
  const strokes = Array.from({ length: LEVELS }, () => new Path2D());
  const specks = Array.from({ length: LEVELS }, () => new Path2D());

  // Spiral arms down the funnel.
  for (const arm of scene.arms) {
    let px = 0;
    let py = 0;
    let pa = 0;
    for (let j = 0; j <= SEGMENTS; j += 1) {
      const h = arm.h0 + ((arm.h1 - arm.h0) * j) / SEGMENTS;
      const theta = angleAt(h, arm.phase, spin);
      const r = radiusAt(h, scene);
      const s = Math.sin(theta);
      const x = scene.cx + r * Math.cos(theta);
      const y = scene.baseY - h * scene.height + r * s * TILT;
      const depth = (s + 1) / 2;
      const fade = clamp(Math.min((h - arm.h0) / 0.08, (arm.h1 - h) / 0.12), 0, 1);
      const a = PEAK * arm.weight * (0.35 + 0.65 * depth) * fade * calmAt(x, y, scene.calm);
      if (j > 0) {
        const lv = levelOf((a + pa) / 2);
        const path = strokes[lv];
        if (path) {
          path.moveTo(px, py);
          path.lineTo(x, y);
        }
      }
      px = x;
      py = y;
      pa = a;
    }
  }

  // Curved lines of the disc at the foot of the funnel.
  for (const ring of scene.rings) {
    const from = ring.start + time * ring.speed;
    let px = 0;
    let py = 0;
    let pa = 0;
    for (let j = 0; j <= RING_SEGMENTS; j += 1) {
      const u = j / RING_SEGMENTS;
      const ang = from + ring.span * u;
      const s = Math.sin(ang);
      const x = scene.cx + ring.radius * Math.cos(ang);
      const y = scene.baseY + ring.radius * s * DISC_TILT;
      const ends = clamp(Math.min(u, 1 - u) / 0.12, 0, 1);
      const a =
        PEAK * ring.weight * (0.35 + 0.65 * ((s + 1) / 2)) * ends * calmAt(x, y, scene.calm);
      if (j > 0) {
        const path = strokes[levelOf((a + pa) / 2)];
        if (path) {
          path.moveTo(px, py);
          path.lineTo(x, y);
        }
      }
      px = x;
      py = y;
      pa = a;
    }
  }

  // Fine dots drifting down the arms.
  for (const dot of scene.dots) {
    const arm = scene.arms[dot.arm];
    if (!arm) continue;
    const cycle = (dot.p + time * dot.speed) % 1;
    const h = H_MIN + (1 - H_MIN) * (1 - cycle);
    const theta = angleAt(h, arm.phase + dot.off, spin);
    const r = radiusAt(h, scene);
    const s = Math.sin(theta);
    const x = scene.cx + r * Math.cos(theta);
    const y = scene.baseY - h * scene.height + r * s * TILT;
    const a =
      PEAK *
      (0.35 + 0.65 * ((s + 1) / 2)) *
      Math.sqrt(Math.sin(Math.PI * cycle)) *
      calmAt(x, y, scene.calm);
    const path = specks[levelOf(a)];
    if (path) path.rect(x - 0.75, y - 0.75, 1.5, 1.5);
  }

  for (let i = 0; i < LEVELS; i += 1) {
    ctx.globalAlpha = ((i + 1) / LEVELS) * PEAK;
    const line = strokes[i];
    const speck = specks[i];
    if (line) ctx.stroke(line);
    if (speck) ctx.fill(speck);
  }
  ctx.globalAlpha = 1;
}

function readColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
}

function readCalmRects(canvas: HTMLCanvasElement): Rect[] {
  const host = canvas.parentElement;
  if (!host) return [];
  const origin = canvas.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const el of host.querySelectorAll('[data-vortex-calm]')) {
    const box = el.getBoundingClientRect();
    rects.push({
      l: box.left - origin.left - CALM_PAD,
      t: box.top - origin.top - CALM_PAD,
      r: box.right - origin.left + CALM_PAD,
      b: box.bottom - origin.top + CALM_PAD,
    });
  }
  return rects;
}

export function HeroVortex() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // no canvas support: the flat background stays and the page works the same

    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = matchMedia('(prefers-reduced-data: reduce)');
    const slowScreen = matchMedia('(update: slow)');

    let scene: Scene | null = null;
    let color = readColor();
    let visible = true;
    let animated = false;
    let elapsed = STILL_TIME;
    let lastDraw = 0;
    let raf = 0;

    const paint = () => {
      if (!scene || !color) return;
      try {
        draw(ctx, scene, color, elapsed);
      } catch {
        // A failed draw leaves the flat background. Nothing else on the page depends on it.
      }
    };

    const sync = () => {
      const run = animated && visible && !document.hidden;
      if (run && raf === 0) {
        lastDraw = performance.now();
        raf = requestAnimationFrame(tick);
      } else if (!run && raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const gap = now - lastDraw;
      if (gap < FRAME_MS) return;
      lastDraw = now;
      elapsed += Math.min(gap, 100) / 1000;
      paint();
    };

    // Size the bitmap and rebuild the scene in one go, then paint straight away so a resize
    // never shows an empty canvas.
    const measure = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      scene = buildScene(w, h, dpr, readCalmRects(canvas));
      animated =
        w >= ANIMATED_MIN_WIDTH &&
        !reduceMotion.matches &&
        !saveData.matches &&
        !slowScreen.matches;
      if (!animated) elapsed = STILL_TIME;
      paint();
      sync();
    };

    const resize = new ResizeObserver(measure);
    resize.observe(canvas);
    if (canvas.parentElement) resize.observe(canvas.parentElement);
    for (const el of canvas.parentElement?.querySelectorAll('[data-vortex-calm]') ?? []) {
      resize.observe(el);
    }

    const intersect = new IntersectionObserver((entries) => {
      for (const entry of entries) visible = entry.isIntersecting;
      sync();
    });
    intersect.observe(canvas);

    const theme = new MutationObserver(() => {
      color = readColor();
      paint();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    document.addEventListener('visibilitychange', sync);
    reduceMotion.addEventListener('change', measure);
    saveData.addEventListener('change', measure);
    slowScreen.addEventListener('change', measure);

    measure();

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      resize.disconnect();
      intersect.disconnect();
      theme.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduceMotion.removeEventListener('change', measure);
      saveData.removeEventListener('change', measure);
      slowScreen.removeEventListener('change', measure);
    };
  }, []);

  return <canvas ref={ref} className="hero-vortex" aria-hidden="true" tabIndex={-1} />;
}
