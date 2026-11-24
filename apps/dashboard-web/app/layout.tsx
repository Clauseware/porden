import type { ReactNode } from 'react';
import '../../brand.css';
import './globals.css';
export const metadata = { title: 'Porden handoffs' };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
