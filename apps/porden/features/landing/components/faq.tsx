import { Reveal } from '@/components/reveal';
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { faqs } from '../content';

/* ---------- FAQ ---------- */

export function Faq() {
  return (
    <Reveal id="faq">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-28 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-36">
        <div className="flex flex-col gap-4">
          <span className="sx-rise text-sm text-muted-foreground">Questions</span>
          <h2 className="sx-rise font-heading text-4xl leading-[1.02] font-medium tracking-[-0.045em] sm:text-5xl">
            Plain answers.
          </h2>
        </div>
        <div
          className="sx-rise glass rounded-[1.75rem] px-6 py-2"
          style={{ '--d': '120ms' } as React.CSSProperties}
        >
          <Accordion defaultValue={[faqs[0].q]}>
            {faqs.map((faq) => (
              <AccordionItem key={faq.q} value={faq.q}>
                <AccordionTrigger className="py-5 text-base">{faq.q}</AccordionTrigger>
                <AccordionPanel className="text-pretty text-muted-foreground">
                  {faq.a}
                </AccordionPanel>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </Reveal>
  );
}
