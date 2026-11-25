import type { Metadata } from 'next';
import Inbox from './inbox';
import { Shell } from './shell';

export const metadata: Metadata = { title: 'Claims inbox | Porden courier' };

export default function Page() {
  return (
    <Shell crumb="claims">
      <Inbox />
    </Shell>
  );
}
