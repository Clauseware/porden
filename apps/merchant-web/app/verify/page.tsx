import type { Metadata } from 'next';
import Verifier from './verifier';
import './verify.css';

export const metadata: Metadata = { title: 'Check a receipt | Porden' };

export default function Page() {
  return <Verifier />;
}
