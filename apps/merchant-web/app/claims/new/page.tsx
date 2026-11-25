import type { Metadata } from 'next';
import { Shell } from '../shell';
import FileClaim from './file-claim';

export const metadata: Metadata = { title: 'File a claim | Porden merchant' };

export default function Page() {
  return (
    <Shell crumb="new claim">
      <FileClaim />
    </Shell>
  );
}
