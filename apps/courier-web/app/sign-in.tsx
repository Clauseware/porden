'use client';
import { useState, type FormEvent } from 'react';
import { createPordenClient, getErrorMessage } from '@porden/sdk/delivery';
import type { ReceivedCase } from '@porden/contracts';
export default function SignIn({ receiptId }: { receiptId?: string }) {
  const [status, setStatus] = useState('');
  const [client] = useState(() => createPordenClient());
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<ReceivedCase | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password'));
    setLoading(true);
    setStatus('');
    try {
      await client.signIn(password);
      setSignedIn(true);
      setStatus('Signed in. You can now approve a courier case.');
      if (receiptId) setReceipt(await client.getReceipt(receiptId));
    } catch (cause) {
      setStatus(getErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="workspace">
      <section className="panel">
        <div className="section-title">
          <span className="step">01</span>
          <h2>Courier account</h2>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="password">Courier demo password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            maxLength={256}
            autoComplete="current-password"
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : signedIn ? 'Sign in again' : 'Sign in to courier'}
          </button>
          <p role="status">{status}</p>
        </form>
        {signedIn && (
          <p className="notice">
            Return to the merchant site. When it prompts you, open the courier approval window and
            review the exact case details.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="section-title">
          <span className="step">02</span>
          <h2>{receipt ? 'Courier-owned case record' : 'Your approval stays here'}</h2>
        </div>
        {receipt ? (
          <>
            <p className="badge">Case accepted</p>
            <p>This record is stored by the courier. It confirms acceptance, not resolution.</p>
            <dl>
              <div>
                <dt>Case</dt>
                <dd>
                  <code>{receipt.caseId}</code>
                </dd>
              </div>
              <div>
                <dt>Receipt</dt>
                <dd>
                  <code>{receipt.receiptId}</code>
                </dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{new Date(receipt.receivedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>{receipt.data.orderReference}</dd>
              </div>
              <div>
                <dt>Damage description</dt>
                <dd>{receipt.data.damageDescription}</dd>
              </div>
              {receipt.data.deliveryAddress && (
                <div>
                  <dt>Delivery address</dt>
                  <dd>{receipt.data.deliveryAddress}</dd>
                </div>
              )}
            </dl>
          </>
        ) : (
          <>
            <p>
              Signing in does not create a case. You will review and approve the requested write in
              a separate courier window.
            </p>
            <p>
              You can refuse the request there. An uncertain result must be checked before another
              submission.
            </p>
            {receiptId && <p className="hint">Sign in to view your receipt.</p>}
          </>
        )}
      </section>
    </div>
  );
}
