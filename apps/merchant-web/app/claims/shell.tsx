import Link from 'next/link';
import type { ReactNode } from 'react';
import PordenSymbol from '../../../logo';
import './claims.css';

// The merchant top bar and footer, as on the other merchant pages.
export function Shell({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <>
      <header className="topbar claims-topbar">
        <Link className="wordmark" href="/">
          <PordenSymbol />
          porden<span> / merchant / {crumb}</span>
        </Link>
        <span className="badge">Independent merchant</span>
      </header>
      {children}
      <footer>
        porden · Context carried with permission. <span>Synthetic delivery demo</span>
      </footer>
    </>
  );
}
