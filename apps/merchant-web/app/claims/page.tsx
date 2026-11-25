import type { Metadata } from 'next';
import ClaimList from './claim-list';
import { Shell } from './shell';

export const metadata: Metadata = { title: 'Your claims | Porden merchant' };

export default function Page() {
  return (
    <Shell crumb="claims">
      <ClaimList />
    </Shell>
  );
}
