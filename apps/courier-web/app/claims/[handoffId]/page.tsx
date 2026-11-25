import type { Metadata } from 'next';
import { Shell } from '../shell';
import Review from './review';

export const metadata: Metadata = { title: 'Claim review | Porden courier' };

export default async function Page({ params }: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await params;
  return (
    <Shell crumb="claim">
      <Review handoffId={handoffId} />
    </Shell>
  );
}
