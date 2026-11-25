import type { ReactNode } from 'react';
import { HandoffNavProvider } from '@/components/ui/handoff-nav';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import '../landing.css';

/** The public site's frame: the docking nav and the footer around a marketing page. */
export function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <HandoffNavProvider>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </div>
    </HandoffNavProvider>
  );
}
