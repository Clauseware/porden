'use client';

import type { VerifiedReceipt } from '@porden/contracts';
import type { ClaimView } from '@porden/contracts/delivery-claims';
import { createPordenClient } from '@porden/sdk/delivery';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { proposeClaimAction, submitClaimProposal, type ClaimTask } from '../../../../claims-agent';
import { createMerchantClaimsClient } from '../../../../claims-client';
import { loadAgent } from '../agent';
import {
  actionText,
  failureText,
  isSignedOut,
  refusalText,
  resolutionText,
  statusLine,
  when,
} from '../copy';
import { Receipts } from './receipts';
import { SendCase } from './send-case';

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string; signedOut: boolean }
  | { state: 'ready'; view: ClaimView };

type Act =
  | { state: 'idle' }
  | { state: 'working'; text: string }
  | { state: 'result'; tone: 'ok' | 'info' | 'refused' | 'error'; title: string; text: string }
  | { state: 'unknown'; operationId?: string; checking: boolean; text: string };

const CLOSED = ['completed', 'failed', 'rejected', 'cancelled'];

export default function Status({ handoffId }: { handoffId: string }) {
  const [client] = useState(() => createMerchantClaimsClient());
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const [act, setAct] = useState<Act>({ state: 'idle' });
  const [answer, setAnswer] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [verified, setVerified] = useState<ReadonlySet<string>>(new Set());
  const [caseReceipt, setCaseReceipt] = useState<VerifiedReceipt | undefined>(undefined);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const view = await client.claim(handoffId);
        if (active) setLoad({ state: 'ready', view });
      } catch (error) {
        if (active)
          setLoad({ state: 'error', message: failureText(error), signedOut: isSignedOut(error) });
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [client, handoffId, tick]);

  useEffect(() => {
    if (load.state !== 'loading') titleRef.current?.focus();
  }, [load.state]);
  useEffect(() => {
    if (act.state === 'result' || act.state === 'unknown') resultRef.current?.focus();
  }, [act]);

  // The courier's case receipt is read back from the transfer this tab started, if there was one.
  const acceptedVersion = load.state === 'ready' ? load.view.handoff.acceptedVersion : null;
  useEffect(() => {
    if (acceptedVersion === null) return;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(`porden-claim-transfer:${handoffId}:${acceptedVersion}`);
    } catch {
      id = null;
    }
    if (!id) return;
    let active = true;
    createPordenClient()
      .getTransfer(id)
      .then((draft) => {
        if (active && draft.status === 'accepted' && draft.receipt) setCaseReceipt(draft.receipt);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [handoffId, acceptedVersion, tick]);

  function reload() {
    setLoad({ state: 'loading' });
    setTick((value) => value + 1);
  }

  const busy = act.state === 'working' || act.state === 'unknown';

  async function checkOperation(operationId: string) {
    setAct({
      state: 'unknown',
      operationId,
      checking: true,
      text: 'Checking what the server recorded. New changes stay off until this is settled.',
    });
    try {
      await client.operation(operationId);
      setAct({
        state: 'result',
        tone: 'ok',
        title: 'Outcome confirmed',
        text: 'The server recorded the result. The claim was reloaded.',
      });
      reload();
    } catch {
      setAct({
        state: 'unknown',
        operationId,
        checking: false,
        text: 'The server has not confirmed the outcome yet. Check again. Nothing is sent again automatically.',
      });
    }
  }

  async function runAgent(task: ClaimTask) {
    setAct({ state: 'working', text: 'The assistant is preparing a reply…' });
    try {
      const agent = await loadAgent();
      const turn = await proposeClaimAction(agent.engine, agent.actionBindings, task);
      if (turn.kind === 'none') {
        setAct({
          state: 'result',
          tone: 'info',
          title: 'The assistant has a question',
          text: turn.text,
        });
        return;
      }
      if (turn.kind === 'invalid') {
        setAct({
          state: 'result',
          tone: 'error',
          title: 'No valid reply',
          text: 'The assistant could not prepare a valid action. Nothing was sent. Try again.',
        });
        return;
      }
      setAct({ state: 'working', text: 'Waiting for your review in the dialog…' });
      const outcome = await submitClaimProposal(agent.engine, turn);
      if (outcome.status === 'succeeded') {
        setAnswer('');
        setAct({
          state: 'result',
          tone: 'ok',
          title: 'Sent',
          text: 'The server accepted this. The claim was reloaded.',
        });
        reload();
      } else if (outcome.status === 'refused') {
        setAct({
          state: 'result',
          tone: 'refused',
          title: 'Refused',
          text: refusalText(outcome.code),
        });
      } else if (outcome.status === 'cancelled') {
        setAct({
          state: 'result',
          tone: 'info',
          title: 'Cancelled',
          text: 'You declined in the review dialog. Nothing changed. Your answer is still in the box.',
        });
      } else if (outcome.operationId) {
        await checkOperation(outcome.operationId);
      } else {
        setAct({
          state: 'unknown',
          checking: false,
          text: 'The outcome is not known. Reload the claim to see what the server recorded. Nothing is sent again automatically.',
        });
      }
    } catch {
      setAct({
        state: 'result',
        tone: 'error',
        title: 'Not sent',
        text: 'The assistant could not be reached. Nothing was sent. Your answer is still in the box. Try again.',
      });
    }
  }

  async function cancelClaim(version: number) {
    const requestId = crypto.randomUUID();
    setConfirmCancel(false);
    setAct({ state: 'working', text: 'Cancelling the claim…' });
    try {
      await client.cancel(handoffId, { requestId, version });
      setAct({
        state: 'result',
        tone: 'ok',
        title: 'Claim cancelled',
        text: 'The server recorded the cancellation.',
      });
      reload();
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      // A write that failed in transit, or whose answer could not be read, may still have happened.
      if (code === 'OUTCOME_UNKNOWN' || code === 'INVALID_RESPONSE') {
        await checkOperation(requestId);
      } else {
        setAct({
          state: 'result',
          tone: 'refused',
          title: 'Not cancelled',
          text: failureText(error),
        });
      }
    }
  }

  if (load.state === 'loading') {
    return (
      <section className="claims-detail" aria-live="polite" aria-busy="true">
        <h1 ref={titleRef} tabIndex={-1}>
          Your claim
        </h1>
        <p role="status">Loading your claim…</p>
      </section>
    );
  }

  if (load.state === 'error') {
    return (
      <section className="claims-detail" aria-live="polite">
        <h1 ref={titleRef} tabIndex={-1}>
          The claim could not be loaded
        </h1>
        <div className="notice danger" role="alert">
          <p>{load.message}</p>
          {load.signedOut && (
            <p>
              <Link href="/">Go to the merchant sign-in</Link>
            </p>
          )}
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={reload}>
            Try again
          </button>
          <Link className="claims-back" href="/claims/new">
            File a new claim
          </Link>
        </div>
      </section>
    );
  }

  const { view } = load;
  const { handoff } = view;
  const completedReceiptVerified = handoff.receipts.some(
    (receipt) => receipt.action === 'completed' && verified.has(receipt.receiptId),
  );
  const open = handoff.clarifications.filter((item) => item.response === undefined);
  const reserved = handoff.executions.some((item) => item.status === 'reserved');
  const sent =
    handoff.acceptedVersion !== null &&
    handoff.executions.some(
      (item) => item.version === handoff.acceptedVersion && item.status === 'completed',
    );
  const canSend = handoff.status === 'accepted' && handoff.acceptedVersion !== null && !sent;
  const closed = CLOSED.includes(handoff.status);
  const acceptedParameters = view.versions.find(
    (item) => item.version === handoff.acceptedVersion,
  )?.parameters;
  const timeline = [...handoff.receipts].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const who = (organizationId: string) =>
    organizationId === handoff.senderOrganizationId ? 'You' : 'Courier';

  return (
    <section className="claims-app">
      <nav className="claims-side" aria-label="Claim">
        <p className="claims-side-title">Claim</p>
        <p>
          <span className="stage-tag">{handoff.status.replaceAll('_', ' ')}</span>
        </p>
        <p>
          <Link className="claims-back" href="/claims">
            Your claims
          </Link>
        </p>
        <p>
          <Link className="claims-back" href="/claims/new">
            File a new claim
          </Link>
        </p>
      </nav>

      <div className="claims-main">
        <h1 ref={titleRef} tabIndex={-1}>
          Your claim: {view.current.claim.orderReference}
        </h1>
        <p className="claims-status">{statusLine(handoff, completedReceiptVerified)}</p>
        <p className="hint">
          Version {handoff.currentVersion} · updated {when(handoff.updatedAt)}
        </p>
        <p className="hint">
          You can find this claim again under <Link href="/claims">Your claims</Link>.
        </p>

        <div className="claims-cols">
          <div className="claims-col">
            <div className="panel claims-card">
              <h2>Current terms</h2>
              <p>{resolutionText(view.current.resolution)}</p>
              <ul className="plain-list">
                {view.versions.map((item) => (
                  <li key={item.version}>
                    Version {item.version}: {resolutionText(item.parameters.resolution)}
                    {item.version === handoff.currentVersion ? ' (current)' : ''}
                    {item.version === handoff.acceptedVersion ? ' (accepted)' : ''}
                  </li>
                ))}
              </ul>
            </div>

            {open.map((item) => (
              <div className="panel claims-card" key={item.id}>
                <h2>The courier needs more information</h2>
                <p>{item.reason}</p>
                <ul className="plain-list">
                  {item.missingInformation.map((entry) => (
                    <li key={entry}>{entry.replaceAll('_', ' ')}</li>
                  ))}
                </ul>
                <p className="hint">Photos can’t be attached here. Answer in words.</p>
                <label htmlFor="answer">Your answer</label>
                <textarea
                  id="answer"
                  rows={4}
                  maxLength={4000}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                />
                <button
                  type="button"
                  disabled={busy || answer.trim().length === 0}
                  onClick={() =>
                    void runAgent({
                      task: 'answer_clarification',
                      customerMessage: answer.trim(),
                      handoffId,
                      version: handoff.currentVersion,
                      clarification: {
                        id: item.id,
                        missingInformation: item.missingInformation,
                        reason: item.reason,
                      },
                    })
                  }
                >
                  {act.state === 'working' ? 'Working…' : 'Send answer'}
                </button>
              </div>
            ))}

            {handoff.status === 'awaiting_approval' && (
              <div className="panel claims-card">
                <h2>Counter-offer</h2>
                <p>
                  The courier proposed version {handoff.currentVersion}:{' '}
                  {resolutionText(view.current.resolution).toLowerCase()}. Your approver decides
                  this in the Porden dashboard. Nothing is sent to the courier until then.
                </p>
              </div>
            )}

            {canSend && (
              <SendCase
                handoffId={handoffId}
                version={handoff.acceptedVersion ?? handoff.currentVersion}
                executionReserved={reserved}
                onReceipt={setCaseReceipt}
                onChanged={reload}
              />
            )}

            {!closed && !sent && (
              <div className="panel claims-card">
                <h2>Cancel claim</h2>
                {confirmCancel ? (
                  <>
                    <p>Cancel this claim? The courier will not review it any further.</p>
                    <div className="actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void cancelClaim(handoff.currentVersion)}
                      >
                        Confirm cancel
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setConfirmCancel(false)}
                      >
                        Keep claim
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setConfirmCancel(true)}
                  >
                    Cancel claim
                  </button>
                )}
              </div>
            )}

            <div aria-live="polite" className="claims-live">
              {act.state === 'working' && <p role="status">{act.text}</p>}
              {act.state === 'result' && (
                <div className={`notice claims-result ${act.tone}`}>
                  <h2 ref={resultRef} tabIndex={-1}>
                    {act.title}
                  </h2>
                  <p>{act.text}</p>
                </div>
              )}
              {act.state === 'unknown' && (
                <div className="notice claims-result info">
                  <h2 ref={resultRef} tabIndex={-1}>
                    Checking
                  </h2>
                  <p>{act.text}</p>
                  {act.operationId && !act.checking && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void checkOperation(act.operationId ?? '')}
                    >
                      Check again
                    </button>
                  )}
                  {!act.operationId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setAct({ state: 'idle' });
                        reload();
                      }}
                    >
                      Reload the claim
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="claims-col">
            <div className="panel claims-card">
              <h2>Negotiation timeline</h2>
              {timeline.length === 0 ? (
                <p className="hint">Nothing is recorded yet.</p>
              ) : (
                <ol className="timeline">
                  {timeline.map((receipt) => (
                    <li key={receipt.receiptId}>
                      <strong>{actionText(receipt.action)}</strong>
                      <span className="hint">
                        {who(receipt.organizationId)} · version {receipt.version} ·{' '}
                        {when(receipt.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="hint">
                Each step is a platform receipt. Check them under Receipts. Nothing is marked as
                verified until the check says so.
              </p>
            </div>

            <Receipts
              handoff={handoff}
              caseReceipt={caseReceipt}
              resolution={acceptedParameters?.resolution}
              onValid={(id) => setVerified((previous) => new Set(previous).add(id))}
            />

            <details className="panel claims-card claims-details">
              <summary>Details</summary>
              <dl>
                <div>
                  <dt>Claim ID</dt>
                  <dd>
                    <code>{handoff.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{handoff.status}</dd>
                </div>
                {caseReceipt && (
                  <div>
                    <dt>Courier case</dt>
                    <dd>
                      <code>{caseReceipt.receiverCaseId}</code>
                    </dd>
                  </div>
                )}
              </dl>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}
