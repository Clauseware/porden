import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-5 text-center">
      <LogoMark className="size-10" />
      <h1 className="font-heading text-4xl font-medium tracking-[-0.04em]">Page not found.</h1>
      <p className="max-w-sm text-pretty text-muted-foreground">
        There’s nothing at this address. It may have moved, or the link may be wrong.
      </p>
      <Button className="rounded-full" render={<Link href="/" />}>
        Go to the home page
      </Button>
    </main>
  );
}
