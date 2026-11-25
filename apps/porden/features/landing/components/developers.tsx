'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Reveal } from '@/components/reveal';
import { Button } from '@/components/ui/button';
import { alpha, strokeCurve, ThreadCanvas, type Frame } from '@/lib/canvas/thread-canvas';
import { developerStack, sdkSnippet } from '../content';

/* ---------- Developers: real code over a quiet thread field ---------- */

function Code({ line }: { line: string }) {
  if (line.trimStart().startsWith('//'))
    return <span className="text-muted-foreground">{line}</span>;
  return (
    <>
      {line.split(/('[^']*')/).map((part, index) =>
        part.startsWith("'") ? (
          <span className="text-[var(--thread-mint)]" key={index}>
            {part}
          </span>
        ) : (
          <span key={index}>
            {part.split(/(\/\*.*?\*\/)/).map((piece, inner) =>
              piece.startsWith('/*') ? (
                <span className="text-muted-foreground" key={inner}>
                  {piece}
                </span>
              ) : (
                piece
              ),
            )}
          </span>
        ),
      )}
    </>
  );
}

function drawField({ ctx, t, w, h, colors }: Frame) {
  const xs: number[] = [];
  const ys: number[] = [];
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i += 1) {
    xs.length = 0;
    ys.length = 0;
    const y0 = (i / 39) * h;
    for (let s = 0; s <= 40; s += 1) {
      const u = s / 40;
      xs.push(u * w);
      ys.push(y0 + Math.sin(u * 4 + t * 0.25 + i * 0.35) * 14);
    }
    ctx.strokeStyle = alpha(i % 3 ? colors.lavender : colors.sky, 0.07);
    strokeCurve(ctx, xs, ys);
  }
}

export function Developers() {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copied === 'idle') return;
    const timer = window.setTimeout(() => setCopied('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Reveal className="relative overflow-hidden" id="developers">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <ThreadCanvas draw={drawField} />
      </div>
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 py-28 sm:px-6 lg:grid-cols-[1fr_1.3fr] lg:py-36">
        <div className="flex flex-col gap-6">
          <span className="sx-rise text-sm text-muted-foreground">Developers</span>
          <h2 className="sx-rise font-heading text-4xl leading-[1.02] font-medium tracking-[-0.045em] text-balance sm:text-5xl">
            Three calls. <span className="thread-text">Typed end to end.</span>
          </h2>
          <p
            className="sx-rise max-w-md text-lg text-pretty text-muted-foreground"
            style={{ '--d': '120ms' } as React.CSSProperties}
          >
            Draft, transfer and reconcile from the browser SDK. Agent execution stays on the
            official nsDeploy runtime; your API and database stay yours.
          </p>
          <ul
            className="sx-rise flex flex-wrap gap-2"
            style={{ '--d': '200ms' } as React.CSSProperties}
          >
            {developerStack.map((item) => (
              <li className="glass rounded-full px-3 py-1 text-sm text-muted-foreground" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <figure
          className="sx-rise glow-frame glass min-w-0 overflow-hidden rounded-[1.75rem] shadow-2xl shadow-black/50"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
            event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
          }}
          style={{ '--d': '160ms' } as React.CSSProperties}
        >
          <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[var(--thread-rose)]/70" />
                <span className="size-2.5 rounded-full bg-[var(--thread-amber)]/70" />
                <span className="size-2.5 rounded-full bg-[var(--thread-mint)]/70" />
              </span>
              handoff.ts
            </span>
            <Button
              className="rounded-full"
              onClick={() => {
                navigator.clipboard
                  .writeText(sdkSnippet)
                  .then(() => setCopied('copied'))
                  .catch(() => setCopied('failed'));
              }}
              size="sm"
              variant="ghost"
            >
              {copied === 'copied' ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
            </Button>
          </figcaption>
          <pre className="overflow-x-auto py-5 font-mono text-[13px] leading-6">
            <code className="grid">
              {sdkSnippet.split('\n').map((line, index) => (
                <span className="grid grid-cols-[3rem_1fr] pe-5" key={index}>
                  <span
                    aria-hidden="true"
                    className="pe-4 text-end text-muted-foreground/40 select-none"
                  >
                    {index + 1}
                  </span>
                  <span className="whitespace-pre">
                    <Code line={line} />
                  </span>
                </span>
              ))}
            </code>
          </pre>
        </figure>
      </div>
    </Reveal>
  );
}
