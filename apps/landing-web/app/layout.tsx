import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../../brand.css';
import { THEME_COLORS, themeInitScript } from '../components/theme';
import './landing.css';

export const metadata: Metadata = {
  title: 'Porden: hand off tasks between organizations',
  description:
    'Porden moves tasks between organizations. Each handoff has a locked version, a human approval step when the sender requires it, and a signed receipt. A receipt means accepted, not resolved.',
};

// Dark is the default. The inline script below and the toggle change this per theme.
export const viewport: Viewport = { themeColor: THEME_COLORS.dark };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
