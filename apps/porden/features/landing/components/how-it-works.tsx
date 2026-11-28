import { Reveal } from '@/components/reveal';
import { steps } from '../content';
import { Illo } from './illo';
import { StepCard } from './step-card';

/** The four steps, under their heading. Each card shows the illustration for its step. */
export function HowItWorks() {
  return (
    <Reveal id="how">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-28 sm:px-6 lg:py-36">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-end">
          <div className="flex flex-col gap-4">
            <span className="sx-rise text-sm text-muted-foreground">How it works</span>
            <h2 className="sx-rise font-heading text-4xl leading-[1.02] font-medium tracking-[-0.045em] text-balance sm:text-6xl">
              Four steps. <span className="thread-text">Nothing extra crosses.</span>
            </h2>
          </div>
          <p
            className="sx-rise max-w-md text-lg text-pretty text-muted-foreground lg:justify-self-end"
            style={{ '--d': '120ms' } as React.CSSProperties}
          >
            The same lifecycle for any kind of work and any two organizations.
          </p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <StepCard
              body={step.body}
              figure={<Illo className="illo--fill" crop name={step.figure} />}
              index={index}
              key={step.title}
              title={step.title}
            />
          ))}
        </ol>
      </div>
    </Reveal>
  );
}
