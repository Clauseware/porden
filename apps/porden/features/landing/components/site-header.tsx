import { Logo } from '@/components/brand/logo';
import { HandoffNav } from '@/components/ui/handoff-nav';
import { navigation } from '../content';

/** A bar at the top that docks into a pill as you scroll, and catches the hero's button. */
export function SiteHeader() {
  return (
    <HandoffNav
      className="[--handoff-nav-width:88rem]"
      links={navigation}
      logo={
        <a
          aria-label="Porden home"
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          href="#top"
        >
          <Logo />
        </a>
      }
    />
  );
}
