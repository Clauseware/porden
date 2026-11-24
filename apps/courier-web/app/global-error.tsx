'use client';
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{ background: '#0C0C0E', color: '#F5F5F5', fontFamily: 'system-ui', padding: 32 }}
      >
        <main>
          <h1>Porden could not display this page.</h1>
          <p>Check your courier receipt before submitting again.</p>
          <button onClick={reset}>Reopen page</button>
        </main>
      </body>
    </html>
  );
}
