'use client';

import type { PordenEvent, TransferOutcome, VerifiedReceipt } from '@porden/contracts';
import type { ClaimConsent } from '@porden/contracts/delivery-claims';
import { createPordenClient, getErrorMessage } from '@porden/sdk/delivery';
import { useEffect, useRef, useState } from 'react';
import { createMerchantClaimsClient } from '../../../../claims-client';
import { ALL_FIELDS, failureText, FIELD_LABEL } from '../copy';

type Client = ReturnType<typeof createPordenClient>;
type Review = Parameters<Parameters<Client['transfer']>[0]['confirm']>[0];

// The merchant server keeps what the customer consented to share until the case can't be sent.
type Consent =
  | { state: 'loading' }
  | { state: 'ready'; consent: ClaimConsent | null }
  | { state: 'error'; message: string };

type State =
  | { state: 'idle' }
  | { state: 'working'; text: string }
  | { state: 'review'; review: Review }
  | { state: 'result'; tone: 'ok' | 'info' | 'refused' | 'error'; title: string; text: string }
  | { state: 'unknown'; transferId: string; text: string };

// The SDK transfer() has no timeout of its own. Its steps are: the assistant prepares the transfer
// (about a minute with the free model), then two boxes the person must click (the runtime's
// "Review the approved courier transfer" box and the "Open action site" box that opens the courier
// window from a real click), then approval in the courier window. Each wait gets a limit here.
const PREPARE_LIMIT_MS = 120_000;
const CONFIRM_LIMIT_MS = 150_000;
const PREPARING_TEXT =
  'Consent recorded. The assistant is preparing the transfer. This can take about a minute with the current model. Keep this tab open.';
const CONFIRMING_TEXT =
  'Waiting for you. A box called “Review the approved courier transfer” will appear on this page: confirm it. Then a second box asks you to open the courier window: open it and approve there. If your browser blocks the window, allow pop-ups for this site.';

const draftKey = (handoffId: string, version: number) =>
  `porden-claim-transfer:${handoffId}:${version}`;

// Sends the case for the ACCEPTED version through the existing transfer flow (contract section 7):
// a draft with governance {handoffId, version}, then the SDK transfer(). Consent is for that version.
export function SendCase(props: {
  handoffId: string;
  version: number;
  executionReserved: boolean;
  onReceipt: (receipt: VerifiedReceipt) => void;
  onChanged: () => void;
}) {
  const { handoffId, version } = props;
  const [saved, setSaved] = useState<Consent>({ state: 'loading' });
  const consent = saved.state === 'ready' ? saved.consent : null;
  const [state, setState] = useState<State>({ state: 'idle' });
  const approval = useRef<((allowed: boolean) => void) | undefined>(undefined);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const run = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const draftId = useRef<string | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    let active = true;
    createMerchantClaimsClient()
      .consent(handoffId)
      .then((result) => {
        if (active) setSaved({ state: 'ready', consent: result.consent });
      })
      .catch((error: unknown) => {
        if (active)
          setSaved({
            state: 'error',
            message: failureText(error, 'This claim was not filed from this merchant account.'),
          });
      });
    return () => {
      active = false;
    };
  }, [handoffId]);

  useEffect(() => {
    if (state.state === 'result' || state.state === 'unknown' || state.state === 'review')
      resultRef.current?.focus();
  }, [state]);

  const busy = state.state === 'working' || state.state === 'review' || state.state === 'unknown';

  function accepted(outcome: TransferOutcome) {
    if (outcome.status === 'accepted') {
      props.onReceipt(outcome.receipt);
      setState({
        state: 'result',
        tone: 'ok',
        title: 'Case sent',
        text: 'The courier accepted the case. A receipt means accepted, not resolved.',
      });
      props.onChanged();
    } else if (outcome.status === 'rejected') {
      setState({
        state: 'result',
        tone: 'refused',
        title: 'Refused',
        text: 'The courier refused the case. Nothing was changed on your claim.',
      });
    } else if (outcome.status === 'cancelled') {
      setState({
        state: 'result',
        tone: 'info',
        title: 'Cancelled',
        text: 'You declined to send the case. Nothing was changed.',
      });
    } else {
      setState({
        state: 'unknown',
        transferId: outcome.transferId,
        text: 'The outcome is not known. Check the courier receipt before you send this case again. Nothing is sent again automatically.',
      });
    }
  }

  function stopWatching() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }

  // A run that ran out of time is abandoned: its late callbacks are ignored, and nothing it does
  // later can change what this screen says.
  function watch(token: number, ms: number, expire: () => void) {
    stopWatching();
    timer.current = window.setTimeout(() => {
      if (run.current === token) expire();
    }, ms);
  }

  function preparingTimedOut(token: number) {
    run.current = token + 1;
    const id = draftId.current;
    // Mark the draft cancelled so a late step of the abandoned run cannot submit it.
    if (id)
      void createPordenClient()
        .cancel(id)
        .catch(() => undefined);
    setState({
      state: 'result',
      tone: 'error',
      title: 'Not sent',
      text: 'The assistant took too long to prepare the transfer, so it was stopped. Nothing was sent to the courier. Try again.',
    });
  }

  function confirmingTimedOut(token: number) {
    run.current = token + 1;
    const id = draftId.current;
    if (!id) return;
    setState({
      state: 'unknown',
      transferId: id,
      text: 'The courier window did not open, or the approval was not finished. Allow pop-ups for this site. The courier may not have recorded the case: use “Check courier receipt” before you try again. Nothing is sent again automatically.',
    });
  }

  async function send() {
    if (!consent) return;
    const token = run.current + 1;
    run.current = token;
    draftId.current = undefined;
    const live = () => run.current === token;
    setState({ state: 'working', text: 'Preparing to send the case…' });
    // Progress from the SDK tells the person where the transfer is, instead of a bare "Working…".
    const onEvent = (event: PordenEvent) => {
      if (!live()) return;
      if (event.type === 'consent_approved' || event.type === 'delegating') {
        setState({ state: 'working', text: PREPARING_TEXT });
        watch(token, PREPARE_LIMIT_MS, () => preparingTimedOut(token));
      } else if (event.type === 'submitted') {
        setState({ state: 'working', text: CONFIRMING_TEXT });
        watch(token, CONFIRM_LIMIT_MS, () => confirmingTimedOut(token));
      } else stopWatching();
    };
    try {
      const config = await createPordenClient().getConfig();
      const client = createPordenClient({ model: config.openrouterModel, onEvent });
      const draft = await client.createDraft({
        recipientOrigin: config.recipientOrigin,
        caseType: 'delivery_damage',
        data: consent.data,
        governance: { handoffId, version },
      });
      draftId.current = draft.id;
      try {
        sessionStorage.setItem(draftKey(handoffId, version), draft.id);
      } catch {
        // Storage is blocked: the outcome can still be read from the claim itself.
      }
      const outcome = await client.transfer({
        transferId: draft.id,
        approvedFields: consent.approvedFields,
        confirm: (requested) =>
          new Promise<boolean>((resolve) => {
            if (!live()) {
              resolve(false);
              return;
            }
            approval.current = resolve;
            setState({ state: 'review', review: requested });
          }),
      });
      if (!live()) return;
      stopWatching();
      accepted(outcome);
    } catch (error) {
      if (!live()) return;
      stopWatching();
      setState({
        state: 'result',
        tone: 'error',
        title: 'Not sent',
        text: `${getErrorMessage(error)} Your claim is unchanged.`,
      });
    } finally {
      approval.current = undefined;
    }
  }

  function decide(allowed: boolean) {
    approval.current?.(allowed);
    approval.current = undefined;
    if (!allowed) setState({ state: 'working', text: 'Declining…' });
    else setState({ state: 'working', text: 'Recording your consent…' });
  }

  async function checkReceipt(transferId: string) {
    setState({ state: 'working', text: 'Checking the courier receipt…' });
    try {
      const draft = await createPordenClient().reconcile(transferId);
      if (draft.status === 'accepted' && draft.receipt) {
        accepted({ status: 'accepted', transferId, receipt: draft.receipt });
      } else {
        setState({
          state: 'unknown',
          transferId,
          text: 'The courier receipt is not confirmed yet. Check again later. Nothing was sent again.',
        });
      }
    } catch (error) {
      setState({
        state: 'unknown',
        transferId,
        text: `${getErrorMessage(error)} Nothing was sent again.`,
      });
    }
  }

  function storedDraft() {
    try {
      return sessionStorage.getItem(draftKey(handoffId, version)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  return (
    <div className="panel claims-card">
      <h2>Send case to courier</h2>
      <p>
        The courier accepted version {version}. Consent applies to this version only. If the courier
        changes the terms, that is a new version and needs new consent.
      </p>
      {saved.state === 'loading' && <p role="status">Loading the details you agreed to share…</p>}
      {saved.state === 'error' && (
        <p className="notice" role="alert">
          {saved.message}
        </p>
      )}
      {saved.state === 'ready' && !consent && !props.executionReserved && (
        <p className="notice">
          The details you agreed to share are no longer kept for this claim, so the case can’t be
          sent. File a new claim if you still need one.
        </p>
      )}
      {consent && (
        <>
          <p className="hint">
            The merchant keeps the details you agreed to share only while you can still send this
            case.
          </p>
          <h3>Fields that will be shared</h3>
          <ul className="decision-list">
            {ALL_FIELDS.map((field) => {
              const shared = consent.approvedFields.includes(field);
              return (
                <li key={field} data-allowed={shared}>
                  <span>{FIELD_LABEL[field]}</span>
                  <span className="stage-tag">{shared ? 'Shared' : 'Not shared'}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {state.state === 'review' && (
        <div className="notice review-box" role="group" aria-labelledby="send-review-title">
          <h3 id="send-review-title" ref={resultRef} tabIndex={-1}>
            Confirm the details to share
          </h3>
          <dl>
            {Object.entries(state.review.data).map(([name, value]) => (
              <div key={name}>
                <dt>
                  {name === 'damageDescription'
                    ? FIELD_LABEL.damageDescription
                    : name === 'deliveryAddress'
                      ? FIELD_LABEL.deliveryAddress
                      : FIELD_LABEL.orderReference}
                </dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="actions">
            <button type="button" onClick={() => decide(true)}>
              Send case
            </button>
            <button type="button" className="secondary" onClick={() => decide(false)}>
              Decline
            </button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="claims-live">
        {state.state === 'working' && <p role="status">{state.text}</p>}
        {state.state === 'result' && (
          <div className={`notice claims-result ${state.tone}`}>
            <h2 ref={resultRef} tabIndex={-1}>
              {state.title}
            </h2>
            <p>{state.text}</p>
          </div>
        )}
        {state.state === 'unknown' && (
          <div className="notice claims-result info">
            <h2 ref={resultRef} tabIndex={-1}>
              Checking
            </h2>
            <p>{state.text}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => void checkReceipt(state.transferId)}
            >
              Check courier receipt
            </button>
          </div>
        )}
      </div>

      {props.executionReserved && state.state === 'idle' && storedDraft() && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const id = storedDraft();
            if (id) void checkReceipt(id);
          }}
        >
          Check courier receipt
        </button>
      )}
      {!props.executionReserved && (
        <button type="button" disabled={busy || !consent} onClick={() => void send()}>
          {state.state === 'working' ? 'Working…' : 'Send case to courier'}
        </button>
      )}
    </div>
  );
}
