'use client';

import type { ReactNode } from 'react';

/** One step: its illustration over the copy, in a frame that brightens near the pointer. */
export function StepCard({
  figure,
  index,
  title,
  body,
}: {
  figure: ReactNode;
  index: number;
  title: string;
  body: string;
}) {
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
      <div className="h-52 border-b border-white/5 px-8 py-7">{figure}</div>
      <div className="flex flex-col gap-2 p-6">
        <span className="text-sm text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
        <h3 className="text-xl font-medium tracking-[-0.02em]">{title}</h3>
        <p className="text-sm text-pretty text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}
