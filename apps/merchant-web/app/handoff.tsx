'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createPordenClient, getErrorMessage, PordenError } from '@porden/sdk';
import {
  DamageData,
  type PublicConfig,
  type PordenEvent,
  type TransferOutcome,
} from '@porden/contracts';

type Review = Parameters<
  Parameters<ReturnType<typeof createPordenClient>['transfer']>[0]['confirm']
>[0];
const eventLabels: Record<PordenEvent['type'], string> = {
  draft_created: 'Case prepared',
  recipient_discovered: 'Courier agent responded',
  consent_required: 'Your approval requested',
  consent_approved: 'Sharing approved',
  delegating: 'Contacting the courier',
  receiver_confirmation_required: 'Courier approval requested',
  submitted: 'Transfer submitted for approval',
  receipt_verified: 'Courier receipt verified',
  rejected: 'Transfer refused',
  cancelled: 'Transfer cancelled',
  outcome_unknown: 'Receipt not yet confirmed',
};
export default function Handoff() {
  const [events, setEvents] = useState<PordenEvent[]>([]);
  const [client, setClient] = useState(() => createPordenClient());
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shareAddress, setShareAddress] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [outcome, setOutcome] = useState<TransferOutcome | null>(null);
  const [transferId, setTransferId] = useState('');
  const approval = useRef<((allowed: boolean) => void) | null>(null);
  function showError(cause: unknown, suffix = '') {
    setError(`${getErrorMessage(cause)}${suffix}`);
    if (
      cause instanceof PordenError &&
      ['UNAUTHORIZED_ACTION', 'CSRF_MISMATCH'].includes(cause.code)
    )
      setSignedIn(false);
  }
  useEffect(() => {
    if (review) document.getElementById('review-heading')?.focus();
  }, [review]);
  useEffect(() => {
    let active = true;
    createPordenClient()
      .getConfig()
      .then((settings) => {
        if (!active) return;
        setConfig(settings);
        setClient(
          createPordenClient({
            model: settings.openrouterModel,
            onEvent: (event) => setEvents((previous) => [...previous, event]),
          }),
        );
      })
      .catch((cause) => {
        if (active) setError(getErrorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await client.signIn(String(new FormData(event.currentTarget).get('password')));
      setSignedIn(true);
    } catch (cause) {
      showError(cause);
    } finally {
      setLoading(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError('');
    setOutcome(null);
    setEvents([]);
    try {
      const data = DamageData.parse({
        orderReference: 'DEMO-1042',
        damageDescription: form.get('description'),
        ...(shareAddress ? { deliveryAddress: form.get('address') } : {}),
      });
      const draft = await client.createDraft({
        recipientOrigin: config.recipientOrigin,
        caseType: 'delivery_damage',
        data,
      });
      setTransferId(draft.id);
      sessionStorage.setItem('porden-transfer', draft.id);
      const result = await client.transfer({
        transferId: draft.id,
        approvedFields: shareAddress
          ? ['orderReference', 'damageDescription', 'deliveryAddress']
          : ['orderReference', 'damageDescription'],
        confirm: (requested) =>
          new Promise<boolean>((resolve) => {
            approval.current = resolve;
            setReview(requested);
          }),
      });
      setOutcome(result);
    } catch (cause) {
      showError(cause, ' Your details are preserved.');
    } finally {
      setLoading(false);
      setReview(null);
      approval.current = null;
    }
  }
  function decide(allowed: boolean) {
    approval.current?.(allowed);
    approval.current = null;
    setReview(null);
  }
  async function refresh() {
    const id = transferId || sessionStorage.getItem('porden-transfer');
    if (!id) {
      setError('No transfer to check in this tab.');
      return;
    }
    setLoading(true);
    setError('');
    setTransferId(id);
    try {
      const draft = await client.getTransfer(id);
      if (draft.status === 'accepted' && draft.receipt) {
        setOutcome({ status: 'accepted', transferId: id, receipt: draft.receipt });
        if (!events.length) setEvents([{ type: 'receipt_verified', transferId: id }]);
      } else if (draft.status === 'submitted' || draft.status === 'unknown') {
        const refreshed = await client.reconcile(id);
        setOutcome(
          refreshed.status === 'accepted' && refreshed.receipt
            ? { status: 'accepted', transferId: id, receipt: refreshed.receipt }
            : { status: 'unknown', transferId: id, reasonCode: 'OUTCOME_UNKNOWN' },
        );
      } else if (draft.status === 'cancelled') setOutcome({ status: 'cancelled', transferId: id });
      else setError(`This transfer is ${draft.status}. It has no verified courier receipt.`);
    } catch (cause) {
      showError(cause, ' No new case was submitted.');
    } finally {
      setLoading(false);
    }
  }
  const blocked = loading || outcome?.status === 'unknown' || outcome?.status === 'accepted';
  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href="/">
          porden<span> / merchant</span>
        </Link>
        <span className="badge">Independent merchant</span>
      </header>
      <section className="intro">
        <p className="eyebrow">A careful handoff</p>
        <h1>
          Share the context.
          <br />
          Keep the choice.
        </h1>
        <p>
          Send a delivery damage case to the courier, with only the details you approve. Get a
          receipt when the courier accepts it.
        </p>
      </section>
      <div className="workspace">
        <section className="panel">
          <div className="section-title">
            <span className="step">01</span>
            <h2>Your delivery case</h2>
          </div>
          <form onSubmit={signIn} hidden={signedIn}>
            <p>Sign in with the merchant demo account to prepare your case.</p>
            <label htmlFor="password">Merchant demo password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
            <button disabled={loading || !config}>
              {loading ? 'Signing in…' : 'Sign in to merchant'}
            </button>
          </form>
          <form onSubmit={submit} hidden={!signedIn}>
            <fieldset disabled={Boolean(blocked)}>
              <label htmlFor="order">Order reference</label>
              <input id="order" value="DEMO-1042" readOnly />
              <label htmlFor="description">What happened?</label>
              <textarea
                id="description"
                name="description"
                required
                minLength={8}
                maxLength={500}
                defaultValue="The parcel arrived with a damaged outer box and a broken item inside."
                rows={4}
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={shareAddress}
                  onChange={(event) => setShareAddress(event.target.checked)}
                />
                Include my delivery address
              </label>
              <p className="hint">Your address stays out of the handoff unless you select it.</p>
              {shareAddress && (
                <>
                  <label htmlFor="address">Delivery address</label>
                  <textarea
                    id="address"
                    name="address"
                    minLength={5}
                    maxLength={250}
                    required
                    rows={2}
                  />
                </>
              )}
              <button disabled={!config?.openrouterConfigured || !config.openrouterModel}>
                {loading ? 'Preparing your handoff…' : 'Review sharing details'}
              </button>
            </fieldset>
            {config && (!config.openrouterConfigured || !config.openrouterModel) && (
              <p className="notice">
                This demo is awaiting service configuration. Ask the demo operator to enable
                transfers.
              </p>
            )}
          </form>
          {signedIn && (
            <button className="secondary" onClick={refresh} disabled={loading}>
              Check existing transfer
            </button>
          )}
          {error && (
            <p className="notice danger" role="alert">
              {error}
            </p>
          )}
        </section>
        <aside className="panel">
          <div className="section-title">
            <span className="step">02</span>
            <h2>A handoff you can follow</h2>
          </div>
          <p>
            You approve what is shared. The courier asks for a separate approval before creating
            your case.
          </p>
          {config && (
            <a href={config.recipientOrigin} target="_blank" rel="noreferrer">
              Open courier site to sign in ↗
            </a>
          )}
          <ol className="timeline" aria-label="Transfer progress">
            {events.length ? (
              events.map((event, index) => <li key={index}>{eventLabels[event.type]}</li>)
            ) : (
              <li>No details shared yet</li>
            )}
          </ol>
          {loading && !review && (
            <p role="status">
              Follow the review dialogs. Open the courier window when prompted to approve the case
              there.
            </p>
          )}
          {transferId && (
            <p className="metadata">
              Transfer <code>{transferId}</code>
            </p>
          )}
        </aside>
      </div>
      {review && (
        <section className="panel review" aria-labelledby="review-heading">
          <p className="eyebrow">Your permission</p>
          <h2 id="review-heading" tabIndex={-1}>
            Share these details with the courier?
          </h2>
          <p>
            Recipient: <strong>{review.recipientOrigin}</strong>
          </p>
          <dl>
            {Object.entries(review.data).map(([key, value]) => (
              <div key={key}>
                <dt>
                  {key === 'orderReference'
                    ? 'Order reference'
                    : key === 'damageDescription'
                      ? 'Damage description'
                      : 'Delivery address'}
                </dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          <p>The courier will ask for a separate approval before creating a case.</p>
          <div className="actions">
            <button onClick={() => decide(true)}>Approve sharing</button>
            <button className="secondary" onClick={() => decide(false)}>
              Cancel transfer
            </button>
          </div>
        </section>
      )}
      {outcome && (
        <section className="panel result" data-status={outcome.status} aria-live="polite">
          <p className="eyebrow">Handoff outcome</p>
          <h2>
            {outcome.status === 'accepted'
              ? 'Courier received your case'
              : outcome.status === 'cancelled'
                ? 'Transfer cancelled'
                : outcome.status === 'rejected'
                  ? 'Transfer refused'
                  : outcome.reasonCode === 'RECEIVER_DECLINED'
                    ? 'Courier approval declined'
                    : 'Receipt not yet confirmed'}
          </h2>
          {outcome.status === 'accepted' ? (
            <>
              <p className="badge">Receipt verified</p>
              <p>
                The courier accepted your case for investigation. This does not mean the issue is
                resolved.
              </p>
              <dl>
                <div>
                  <dt>Courier case</dt>
                  <dd>
                    <code>{outcome.receipt.receiverCaseId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Receipt</dt>
                  <dd>
                    <code>{outcome.receipt.receiptId}</code>
                  </dd>
                </div>
              </dl>
              <a
                href={`${config?.recipientOrigin}/?receiptId=${outcome.receipt.receiptId}`}
                target="_blank"
                rel="noreferrer"
              >
                View the courier-owned record ↗
              </a>
            </>
          ) : outcome.status === 'unknown' ? (
            <>
              <p>
                The courier may have received this case. Check its receipt before starting another
                transfer.
              </p>
              <button onClick={refresh} disabled={loading}>
                {loading ? 'Checking…' : 'Check courier receipt'}
              </button>
            </>
          ) : (
            <p>
              No new courier case was confirmed. You can review your details and start a new
              transfer.
            </p>
          )}
        </section>
      )}
      <footer>
        porden · Context carried with permission. <span>Synthetic delivery demo</span>
      </footer>
    </>
  );
}
