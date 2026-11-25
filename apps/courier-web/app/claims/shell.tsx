import Link from 'next/link';
import type { ReactNode } from 'react';
import PordenSymbol from '../../../logo';
import './claims.css';

// The courier top bar and footer, as on the other courier pages.
export function Shell({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href="/">
          <PordenSymbol />
          porden<span> / courier / {crumb}</span>
        </Link>
        <span className="badge">Independent courier</span>
      </header>
      {children}
      <footer>
        porden · Context carried with permission. <span>Synthetic delivery demo</span>
      </footer>
    </>
  );
}
