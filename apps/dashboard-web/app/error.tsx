'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section role="alert">
      <h1>Could not display the dashboard</h1>
      <p>Reload the existing handoff before making another decision.</p>
      <button onClick={reset}>Try loading again</button>
    </section>
  );
}
