'use client';
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="panel result" role="alert">
      <h1>This page could not be displayed.</h1>
      <p>
        Your transfer may still be processing. After reopening this page, sign in and check the
        existing transfer before starting another one.
      </p>
      <button onClick={reset}>Reopen page</button>
    </section>
  );
}
