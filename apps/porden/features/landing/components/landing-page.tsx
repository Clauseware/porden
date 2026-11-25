import { marqueeWords } from '../content';
import { Closing } from './closing';
import { Developers } from './developers';
import { Faq } from './faq';
import { Guarantees } from './guarantees';
import { Hero } from './hero';
import { HowItWorks } from './how-it-works';
import { Marquee } from './marquee';
import { UnclearBand } from './unclear-band';

/** The landing page: its sections, in reading order. */
export function LandingPage() {
  return (
    <main className="flex flex-col" id="top">
      <Hero />
      {/* A band of what happens to every handoff; scrolling speeds it up and leans it. */}
      <Marquee words={marqueeWords} />
      <HowItWorks />
      <Guarantees />
      <UnclearBand />
      <Developers />
      <Faq />
      <Closing />
    </main>
  );
}
