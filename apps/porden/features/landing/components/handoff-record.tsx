'use client';

import { CheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { handoffStages } from '../content';

/* ---------- The record of one handoff, as it moves through its states ---------- */

export function HandoffRecord() {
  // 0–3: that stage is in progress. 4–6: every stage is done and the record rests.
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setStep((s) => (s + 1) % (handoffStages.length + 3)),
      1300,
    );
    return () => window.clearInterval(timer);
  }, []);
  const done = step >= handoffStages.length;

  return (
    <figure className="glass w-full max-w-full rounded-[1.5rem] p-5 sm:w-[22rem]">
      <figcaption className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <span className="text-sm">
          <span className="text-muted-foreground">Handoff to </span>
          partner.example
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap transition-colors duration-300 ${
            done
              ? 'bg-[var(--thread-mint)]/15 text-[var(--thread-mint)]'
              : 'bg-white/5 text-muted-foreground'
          }`}
        >
          {done ? 'Done' : 'In progress'}
        </span>
      </figcaption>
      <p className="sr-only">
        A handoff moves through four states: approved, handed off, accepted, and receipt verified.
      </p>
      <ol aria-hidden="true" className="flex flex-col gap-3">
        {handoffStages.map((stage, index) => {
          const state = index < step ? 'done' : index === step ? 'active' : 'pending';
          return (
            <li className="flex items-start gap-3" key={stage.label}>
              <span
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${
                  state === 'done'
                    ? 'border-transparent bg-[var(--thread-mint)] text-primary-foreground'
                    : state === 'active'
                      ? 'record-pulse border-[var(--brand-lavender)]'
                      : 'border-white/15'
                }`}
              >
                {state === 'done' && <CheckIcon className="size-3" strokeWidth={3} />}
              </span>
              <span className="flex flex-col">
                <span
                  className={`text-sm transition-colors duration-300 ${
                    state === 'pending' ? 'text-muted-foreground/60' : 'text-foreground'
                  }`}
                >
                  {stage.label}
                </span>
                <span className="text-xs text-muted-foreground">{stage.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
