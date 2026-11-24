import { ClosingBand } from '../components/closing-band';
import { Hero } from '../components/hero';
import { IlloPlayback } from '../components/illo-playback';
import { ProductSection } from '../components/product-section';
import { SiteHeader } from '../components/site-header';
import { StepsSection } from '../components/steps-section';

export default function Page() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <ProductSection />
        <StepsSection />
        <ClosingBand />
      </main>
      <IlloPlayback />
    </>
  );
}
