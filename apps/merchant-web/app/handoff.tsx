'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { createPordenClient, getErrorMessage, PordenError } from '@porden/sdk';
import PordenSymbol from '../../logo';
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
export type DebugState = 'empty' | 'success' | 'error';
const debugTransferId = '00000000-0000-4000-8000-000000000000';
const debugEvents: PordenEvent[] = (
  [
    'draft_created',
    'recipient_discovered',
    'consent_approved',
    'receiver_confirmation_required',
    'submitted',
    'receipt_verified',
  ] satisfies PordenEvent['type'][]
).map((type) => ({ type, transferId: debugTransferId }));
const debugOutcome: TransferOutcome = {
  status: 'accepted',
  transferId: debugTransferId,
  receipt: {
    issuer: 'http://localhost:4200',
    receiptId: '00000000-0000-4000-8000-000000000001',
    receiverCaseId: 'CASE-DEBUG-1',
    requestId: 'debug',
    receivedAt: '2026-01-01T00:00:00.000Z',
    verification: 'valid',
  },
};
// Dev-only state preview (/?debug=empty|success|error). page.tsx passes `debug` only outside production.
export default function Handoff({ debug }: { debug?: DebugState }) {
  const success = debug === 'success';
  const [events, setEvents] = useState<PordenEvent[]>(success ? debugEvents : []);
  const [client, setClient] = useState(() => createPordenClient());
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [signedIn, setSignedIn] = useState(debug !== undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    debug === 'error'
      ? 'Debug: the service could not complete the request. Your details are preserved.'
      : '',
  );
  const [notice, setNotice] = useState('');
  const [passwordRejected, setPasswordRejected] = useState(false);
  const [shareAddress, setShareAddress] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [outcome, setOutcome] = useState<TransferOutcome | null>(success ? debugOutcome : null);
  const [transferId, setTransferId] = useState(success ? debugTransferId : '');
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
    if (outcome) document.getElementById('result-heading')?.focus();
  }, [outcome]);
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
    createPordenClient()
      .getSession()
      .then(() => {
        if (active) setSignedIn(true);
      })
      .catch((cause) => {
        // A 401 only means there is no session yet; the sign-in form covers it.
        if (active && !(cause instanceof PordenError && cause.status === 401))
          setError(getErrorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setPasswordRejected(false);
    try {
      await client.signIn(String(new FormData(event.currentTarget).get('password')));
      flushSync(() => {
        setSignedIn(true);
        setLoading(false);
      });
      document.getElementById('description')?.focus();
    } catch (cause) {
      if (cause instanceof PordenError && cause.code === 'UNAUTHORIZED_ACTION') {
        setPasswordRejected(true);
        setError(
          `That password is incorrect. Check the merchant demo password and try again.${cause.requestId ? ` Reference: ${cause.requestId}.` : ''}`,
        );
      } else showError(cause);
      document.getElementById('password')?.focus();
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
    setNotice('');
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
      setError('');
      setNotice('No transfer has been started in this tab yet.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
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
  function startNewCase() {
    sessionStorage.removeItem('porden-transfer');
    flushSync(() => {
      setOutcome(null);
      setEvents([]);
      setTransferId('');
      setError('');
      setNotice('');
    });
    document.getElementById('description')?.focus();
  }
  const blocked = loading || outcome?.status === 'unknown' || outcome?.status === 'accepted';
  const unconfigured = config !== null && (!config.openrouterConfigured || !config.openrouterModel);
  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href="/">
          <PordenSymbol />
          porden<span> / merchant</span>
        </Link>
        <nav className="topnav" aria-label="Merchant">
          <Link href="/tasks">Company A task integration</Link>
          <span className="badge">Independent merchant</span>
        </nav>
      </header>
      <section className="intro">
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
        <section className="zone">
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
              aria-invalid={passwordRejected}
              aria-describedby={passwordRejected ? 'merchant-error' : undefined}
            />
            <button disabled={loading || !config}>
              {loading ? 'Signing in…' : 'Sign in to merchant'}
            </button>
          </form>
          <form onSubmit={submit} hidden={!signedIn}>
            <fieldset disabled={Boolean(blocked)}>
              <label htmlFor="order">Order reference</label>
              <input id="order" value="DEMO-1042" readOnly aria-describedby="order-hint" />
              <p className="hint" id="order-hint">
                Demo order. It cannot be changed.
              </p>
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
              <button
                disabled={!config?.openrouterConfigured || !config.openrouterModel}
                aria-describedby={unconfigured ? 'config-notice' : undefined}
              >
                {loading ? 'Preparing your handoff…' : 'Review sharing details'}
              </button>
            </fieldset>
            {unconfigured && (
              <p className="notice" id="config-notice">
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
          <p className="status" role="status">
            {notice}
          </p>
          {error && (
            <p className="notice danger" id="merchant-error" role="alert">
              {error}
            </p>
          )}
        </section>
        {outcome?.status === 'accepted' ? (
          <aside className="zone result" data-status="accepted" aria-labelledby="result-heading">
            <div className="section-title">
              <span className="step">02</span>
              <h2 id="result-heading" tabIndex={-1}>
                Courier received your case
              </h2>
            </div>
            <p className="hint">
              Accepted for investigation. This does not mean the issue is resolved.
            </p>
            <dl>
              <div>
                <dt>Status</dt>
                <dd className="verified">
                  Receipt verified
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path
                      d="M3 8.5l3.2 3L13 4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </dd>
              </div>
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
              className="button"
              href={`${config?.recipientOrigin}/?receiptId=${outcome.receipt.receiptId}`}
              target="_blank"
              rel="noreferrer"
            >
              View the courier-owned record ↗
            </a>
            <button className="link-button" onClick={startNewCase}>
              Start a new case
            </button>
          </aside>
        ) : (
          <aside className="zone">
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
            <ol className="timeline" aria-label="Transfer progress" aria-live="polite">
              {events.length ? (
                events.map((event, index) => <li key={index}>{eventLabels[event.type]}</li>)
              ) : (
                <li className="empty">No details shared yet</li>
              )}
            </ol>
            <p className="status" role="status">
              {loading && !review && signedIn
                ? 'Working on your handoff. Keep this tab open. If a courier window opens, approve the case there.'
                : ''}
            </p>
            {transferId && (
              <p className="metadata">
                Transfer <code>{transferId}</code>
              </p>
            )}
          </aside>
        )}
      </div>
      {review && (
        <section className="panel review" aria-labelledby="review-heading">
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
      {outcome && outcome.status !== 'accepted' && (
        <section className="panel result" data-status={outcome.status}>
          <h2 id="result-heading" tabIndex={-1}>
            {outcome.status === 'cancelled'
              ? 'Transfer cancelled'
              : outcome.status === 'rejected'
                ? 'Transfer refused'
                : outcome.reasonCode === 'RECEIVER_DECLINED'
                  ? 'Courier approval declined'
                  : 'Receipt not yet confirmed'}
          </h2>
          {outcome.status === 'unknown' ? (
            <>
              <p>
                {outcome.reasonCode === 'RECEIVER_DECLINED'
                  ? 'The courier window reported that the case was declined. This transfer stays unconfirmed until the courier receipt check agrees.'
                  : 'The courier may have received this case.'}{' '}
                Check the courier receipt before you send this case again. If the courier still has
                no record, contact the courier first.
              </p>
              <button onClick={refresh} disabled={loading}>
                {loading ? 'Checking…' : 'Check courier receipt'}
              </button>
            </>
          ) : (
            <p>
              {outcome.status === 'rejected' ? 'The courier refused this case. ' : ''}No courier
              case was confirmed. Your details are still in the form, so you can review them and
              start a new transfer.
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
