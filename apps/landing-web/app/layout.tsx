import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../../brand.css';
import './landing.css';

export const metadata: Metadata = {
  title: 'Porden: hand off tasks between organizations',
  description:
    'Porden moves tasks between organizations. Each handoff has a locked version, a human approval step when the sender requires it, and a signed receipt. A receipt means accepted, not resolved.',
};

// Same value as --bg in apps/brand.css.
export const viewport: Viewport = { themeColor: '#0c0c0e' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
