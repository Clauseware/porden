import type { Metadata } from 'next';
import { Shell } from '../shell';
import Status from './status';

export const metadata: Metadata = { title: 'Claim status | Porden merchant' };

export default async function Page({ params }: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await params;
  return (
    <Shell crumb="claim">
      <Status handoffId={handoffId} />
    </Shell>
  );
}
