import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Bricolage_Grotesque, Geist_Mono, Inter } from 'next/font/google';
import { cn } from '@/lib/utils';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
/** Headlines use a display face with more character than Inter. */
const heading = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-heading' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Porden — Pass with confidence',
  description:
    'Porden moves customer-approved cases between independent organizations and their AI agents, and returns a signed receipt the sender can verify.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={cn('dark', inter.variable, heading.variable, geistMono.variable)} lang="en">
      <body>
        <div className="isolate">{children}</div>
      </body>
    </html>
  );
}
