'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyIcon, DoneIcon } from './icons';

type CopyState = 'idle' | 'done' | 'failed';

// The icon turns into a tick for a moment. A failed write says so; it never shows a tick.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let next: CopyState = 'done';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = 'failed';
    }
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1500);
  }

  return (
    <button
      className={state === 'done' ? 'copy done' : 'copy'}
      type="button"
      aria-label={state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      onClick={copy}
    >
      <CopyIcon />
      <DoneIcon />
    </button>
  );
}
