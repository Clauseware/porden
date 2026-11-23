import Handoff from './handoff';
import Link from 'next/link';
export default function Page() {
  return (
    <>
      <Link href="/tasks">Open Company A task integration</Link>
      <Handoff />
    </>
  );
}
