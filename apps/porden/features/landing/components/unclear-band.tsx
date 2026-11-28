import { Illo } from './illo';

/** The colour flip: each step must confirm; when one doesn't, a person is called in to check. */
export function UnclearBand() {
  return (
    <section className="px-3 py-16 sm:px-5">
      <div className="relative mx-auto min-h-[34rem] w-full max-w-[92rem] overflow-hidden rounded-[2.75rem] bg-[radial-gradient(120%_140%_at_10%_0%,color-mix(in_srgb,var(--brand-lavender)_100%,white_18%),var(--brand-lavender)_50%,color-mix(in_srgb,var(--brand-lavender)_70%,var(--thread-rose)))] text-primary-foreground">
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-24 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:py-28">
          <div className="flex flex-col gap-8">
            <span className="text-sm text-primary-foreground/70">When it is unclear</span>
            <h2 className="max-w-3xl font-heading text-5xl leading-[0.98] font-medium tracking-[-0.05em] text-balance sm:text-7xl">
              Every step lights up, or someone looks.
            </h2>
            <p className="max-w-lg text-lg text-pretty text-primary-foreground/75">
              A handoff passes lock, approval and acceptance in order. If one of those steps doesn’t
              confirm, Porden stops the line and asks a person to check the other side. It never
              sends the work twice.
            </p>
          </div>
          <Illo className="illo--on-lavender w-full" name="handoff-steps" />
        </div>
      </div>
    </section>
  );
}
