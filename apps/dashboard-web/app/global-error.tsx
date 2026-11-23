'use client';
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main role="alert">
          <h1>Porden could not load</h1>
          <p>Your operation may already have completed. Check it before submitting again.</p>
          <button onClick={reset}>Reload</button>
        </main>
      </body>
    </html>
  );
}
