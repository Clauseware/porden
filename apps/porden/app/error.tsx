'use client';

import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

/**
 * Shown when a page fails to render. The digest is the reference Next.js logs on the server,
 * so a report can be matched to its log entry without exposing the error itself.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-5 text-center">
      <LogoMark className="size-10" />
      <h1 className="font-heading text-4xl font-medium tracking-[-0.04em]">
        This page didn’t load.
      </h1>
      <p className="max-w-sm text-pretty text-muted-foreground">
        Something went wrong while showing it. Try again, or go back to the home page.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button className="rounded-full" onClick={reset}>
          Try again
        </Button>
        <Button className="rounded-full" render={<Link href="/" />} variant="ghost">
          Go to the home page
        </Button>
      </div>
      {error.digest && <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>}
    </main>
  );
}
