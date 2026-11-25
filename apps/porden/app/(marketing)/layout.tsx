import type { ReactNode } from 'react';
import { LandingLayout } from '@/features/landing/components/landing-layout';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <LandingLayout>{children}</LandingLayout>;
}
