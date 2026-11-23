import SignIn from './sign-in';
import Link from 'next/link';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ receiptId?: string }>;
}) {
  const { receiptId } = await searchParams;
  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href="/">
          porden<span> / courier</span>
        </Link>
        <span className="badge">Independent courier</span>
      </header>
      <section className="intro">
        <p className="eyebrow">The receiving side</p>
        <h1>
          A clear next step.
          <br />
          An accountable receipt.
        </h1>
        <p>
          Approve a delivery case on the courier’s own site. Your receipt records acceptance for
          investigation.
        </p>
      </section>
      <SignIn receiptId={receiptId} />
      <footer>
        porden · Context carried with permission. <span>Synthetic delivery demo</span>
      </footer>
    </>
  );
}
