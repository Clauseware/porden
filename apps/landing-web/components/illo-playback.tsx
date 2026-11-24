'use client';

import { useEffect } from 'react';
import { useReducedMotion } from './use-reduced-motion';

// Each animated asset loops while it is on screen and pauses when it is not. Under reduced
// motion the assets hold one still frame on their own, so nothing runs here.
export function IlloPlayback() {
  const reduce = useReducedMotion();
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-illos]');
    if (reduce) {
      for (const el of els) el.style.removeProperty('--illos-play');
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target instanceof HTMLElement) {
          e.target.style.setProperty('--illos-play', e.isIntersecting ? 'running' : 'paused');
        }
      }
    });
    for (const el of els) {
      el.style.setProperty('--illos-play', 'paused');
      io.observe(el);
    }
    return () => io.disconnect();
  }, [reduce]);
  return null;
}
