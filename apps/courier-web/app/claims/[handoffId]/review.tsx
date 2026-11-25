'use client';

import type {
  AllowedDecision,
  ClaimEvaluation,
  ClaimInbox,
  ClaimStage,
} from '@porden/contracts/delivery-claims';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { proposeClaimAction, submitClaimProposal, type ClaimTask } from '../../../../claims-agent';
import { createCourierClaimsClient } from '../../../../claims-client';
import { loadAgent } from '../agent';
import {
  DECISION_TEXT,
  failureText,
  FINDING_TEXT,
  isSignedOut,
  refusalText,
  resolutionText,
  STAGE_LABEL,
  STAGE_NOTE,
  termsSummary,
  when,
} from '../copy';

type Item = ClaimInbox['items'][number];
type Evaluation =
  | { state: 'none' }
  | { state: 'ready'; value: ClaimEvaluation }
  | { state: 'error' };

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string; signedOut: boolean }
  | { state: 'missing' }
  | { state: 'ready'; item: Item; evaluation: Evaluation };

// What the last action did. `unknown` keeps every write disabled until the outcome is read back.
type Action =
  | { state: 'idle' }
  | { state: 'working'; text: string }
  | { state: 'result'; tone: 'ok' | 'info' | 'refused' | 'error'; title: string; text: string }
  | { state: 'unknown'; operationId?: string; checking: boolean; text: string };

const PAGE_LIMIT = 50;
const SIDE_STAGES: readonly ClaimStage[] = ['review', 'waiting_for_customer', 'ready_to_complete'];
const DECISION_ORDER: readonly AllowedDecision['decision'][] = [
  'accept',
  'clarify',
  'counter',
  'reject',
];
const ADAPTER_NOTE = 'Nothing was sent.';

export default function Review({ handoffId }: { handoffId: string }) {
  const [client] = useState(() => createCourierClaimsClient());
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [action, setAction] = useState<Action>({ state: 'idle' });
  const [note, setNote] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const [tick, setTick] = useState(0);

  // The courier API has no single-claim read, so the claim is found in the inbox and then
  // evaluated for the current version.
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        let found: Item | undefined;
        for (let page = 1; !found; page += 1) {
          const inbox = await client.inbox({ page, limit: PAGE_LIMIT });
          found = inbox.items.find((item) => item.handoff.id === handoffId);
          if (page * inbox.limit >= inbox.totalReceived) break;
        }
        if (!found) {
          if (active) setLoad({ state: 'missing' });
          return;
        }
        let evaluation: Evaluation = { state: 'none' };
        if (found.stage === 'review') {
          evaluation = await client
            .evaluation(handoffId)
            .then((value): Evaluation => ({ state: 'ready', value }))
            .catch((): Evaluation => ({ state: 'error' }));
        }
        if (active) setLoad({ state: 'ready', item: found, evaluation });
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

  function reload() {
    setLoad({ state: 'loading' });
    setTick((value) => value + 1);
  }

  useEffect(() => {
    if (load.state !== 'loading') titleRef.current?.focus();
  }, [load.state]);

  // A new result takes focus, so a screen reader reads it.
  useEffect(() => {
    if (action.state === 'result' || action.state === 'unknown') resultRef.current?.focus();
  }, [action]);

  const busy = action.state === 'working' || action.state === 'unknown';

  async function checkOperation(operationId: string) {
    setAction({
      state: 'unknown',
      operationId,
      checking: true,
      text: 'Checking what the server recorded. New changes stay off until this is settled.',
    });
    try {
      await client.operation(operationId);
      setAction({
        state: 'result',
        tone: 'ok',
        title: 'Outcome confirmed',
        text: 'The server recorded the result. The claim was reloaded.',
      });
      reload();
    } catch {
      setAction({
        state: 'unknown',
        operationId,
        checking: false,
        text: 'The server has not confirmed the outcome yet. Check again. Nothing is sent again automatically.',
      });
    }
  }

  async function runAgent(task: ClaimTask) {
    setAction({ state: 'working', text: 'Preparing a proposal…' });
    let turn: Awaited<ReturnType<typeof proposeClaimAction>>;
    let agent: Awaited<ReturnType<typeof loadAgent>>;
    try {
      agent = await loadAgent();
      turn = await proposeClaimAction(agent.engine, agent.actionBindings, task);
    } catch {
      setAction({
        state: 'result',
        tone: 'error',
        title: 'Not sent',
        text: `The assistant could not be reached. ${ADAPTER_NOTE} Try again.`,
      });
      return;
    }
    if (turn.kind === 'none') {
      setAction({
        state: 'result',
        tone: 'info',
        title: 'The assistant has a question',
        text: turn.text,
      });
      return;
    }
    if (turn.kind === 'invalid') {
      setAction({
        state: 'result',
        tone: 'error',
        title: 'No valid proposal',
        text: `The assistant could not prepare a valid action. ${ADAPTER_NOTE} Try again.`,
      });
      return;
    }
    // The action's arguments include `decision` (courier_claim_decision in actions.js). Completing
    // is only for the complete task, and a review never completes.
    if ((turn.arguments.decision === 'complete') !== (task.task === 'complete_claim')) {
      setAction({
        state: 'result',
        tone: 'error',
        title: 'No valid proposal',
        text: `The assistant proposed a decision that does not fit this step. ${ADAPTER_NOTE} Try again.`,
      });
      return;
    }
    setAction({ state: 'working', text: 'Waiting for your review in the dialog…' });
    try {
      const outcome = await submitClaimProposal(agent.engine, turn);
      if (outcome.status === 'succeeded') {
        setAction({
          state: 'result',
          tone: 'ok',
          title: 'Sent',
          text: 'The server accepted this. The claim was reloaded.',
        });
        reload();
      } else if (outcome.status === 'refused') {
        setAction({
          state: 'result',
          tone: 'refused',
          title: 'Refused',
          text: refusalText(outcome.code),
        });
      } else if (outcome.status === 'cancelled') {
        setAction({
          state: 'result',
          tone: 'info',
          title: 'Cancelled',
          text: 'You declined in the review dialog. Nothing changed.',
        });
      } else if (outcome.operationId) {
        await checkOperation(outcome.operationId);
      } else {
        setAction({
          state: 'unknown',
          checking: false,
          text: 'The outcome is not known. Reload the claim to see what the server recorded. Nothing is sent again automatically.',
        });
      }
    } catch {
      setAction({
        state: 'unknown',
        checking: false,
        text: 'The outcome is not known. Reload the claim to see what the server recorded. Nothing is sent again automatically.',
      });
    }
  }

  async function recover() {
    setAction({ state: 'working', text: 'Recovering the execution…' });
    try {
      const result = await client.recoverExecutions(handoffId);
      const text =
        result.recovered.length === 0
          ? 'No interrupted execution was found. Nothing was changed.'
          : result.recovered
              .map((item) =>
                item.outcome === 'completed'
                  ? `Execution completed${item.caseId ? ` with case ${item.caseId}` : ''}.`
                  : 'Execution failed. No case was written.',
              )
              .join(' ');
      setAction({ state: 'result', tone: 'ok', title: 'Recovery finished', text });
      reload();
    } catch {
      setAction({
        state: 'unknown',
        checking: false,
        text: 'The outcome is not known. Reload the claim to see what the server recorded. Nothing is sent again automatically.',
      });
    }
  }

  if (load.state === 'loading') {
    return (
      <section className="claims-detail" aria-live="polite" aria-busy="true">
        <h1 ref={titleRef} tabIndex={-1}>
          Claim review
        </h1>
        <p role="status">Loading the claim…</p>
      </section>
    );
  }

  if (load.state === 'error' || load.state === 'missing') {
    return (
      <section className="claims-detail" aria-live="polite">
        <h1 ref={titleRef} tabIndex={-1}>
          {load.state === 'missing' ? 'Claim not found' : 'The claim could not be loaded'}
        </h1>
        <div className="notice danger" role="alert">
          <p>{load.state === 'missing' ? 'This claim is not in your inbox.' : load.message}</p>
          {load.state === 'error' && load.signedOut && (
            <p>
              <Link href="/">Go to the courier sign-in</Link>
            </p>
          )}
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => reload()}>
            Try again
          </button>
          <Link className="claims-back" href="/claims">
            Back to the claims inbox
          </Link>
        </div>
      </section>
    );
  }

  const { item, evaluation } = load;
  const { handoff, stage } = item;
  const version = handoff.currentVersion;

  return (
    <section className="claims-app">
      <nav className="claims-side" aria-label="Claim stage">
        <p className="claims-side-title">Stage</p>
        <ul>
          {SIDE_STAGES.map((id) => (
            <li key={id}>
              <span
                className="stage-button static"
                aria-current={stage === id ? 'step' : undefined}
              >
                {STAGE_LABEL[id]}
              </span>
            </li>
          ))}
        </ul>
        <p className="claims-side-title">Now</p>
        <p>
          <span className="stage-tag">{STAGE_LABEL[stage]}</span>
        </p>
        <Link className="claims-back" href="/claims">
          Back to the claims inbox
        </Link>
      </nav>

      <div className="claims-main">
        <h1 ref={titleRef} tabIndex={-1}>
          Claim review: {item.current.claim.orderReference}
        </h1>
        <p className="hint">
          {STAGE_LABEL[stage]} · version {version} · updated {when(handoff.updatedAt)}
        </p>
        <p>{termsSummary(item.current)}</p>
        <p className="hint">{STAGE_NOTE[stage]}</p>

        <div className="claims-cols">
          <div className="claims-col">
            <div className="panel claims-card">
              <h2>Evaluation</h2>
              {evaluation.state === 'ready' ? (
                <>
                  <ul className="plain-list">
                    {evaluation.value.findings.map((finding) => (
                      <li key={finding}>{FINDING_TEXT[finding]}</li>
                    ))}
                  </ul>
                  <h3>Decisions</h3>
                  <ul className="decision-list">
                    {decisionRows(evaluation.value).map((row) => (
                      <li key={row.id} data-allowed={row.allowed}>
                        <span>{row.label}</span>
                        <span className="stage-tag">
                          {row.allowed ? 'Allowed' : 'Not available'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : evaluation.state === 'error' ? (
                <p className="notice danger" role="alert">
                  The evaluation could not be loaded. You cannot send a decision until it loads.
                  Reload the claim.
                </p>
              ) : (
                <p className="hint">
                  The evaluation applies at the review stage. This claim is at “{STAGE_LABEL[stage]}
                  ”.
                </p>
              )}
            </div>

            <div className="panel claims-card">
              <h2>Next step</h2>
              <StageActions
                stage={stage}
                busy={busy}
                working={action.state === 'working'}
                evaluationReady={evaluation.state === 'ready'}
                note={note}
                onNote={setNote}
                onRun={() => {
                  if (stage === 'review' && evaluation.state === 'ready') {
                    const { findings, allowed, parameters, policyId } = evaluation.value;
                    void runAgent({
                      task: 'review_claim',
                      handoffId,
                      version,
                      status: handoff.status,
                      evaluation: { findings, allowed, parameters, policyId },
                      ...(note.trim() ? { staffNote: note.trim() } : {}),
                    });
                  } else if (stage === 'ready_to_complete') {
                    void runAgent({ task: 'complete_claim', handoffId, version });
                  }
                }}
                onRecover={() => void recover()}
              />
              <button type="button" className="secondary" disabled={busy} onClick={() => reload()}>
                Reload claim
              </button>
            </div>

            <div aria-live="polite" className="claims-live">
              {action.state === 'working' && <p role="status">{action.text}</p>}
              {action.state === 'result' && (
                <div className={`notice claims-result ${action.tone}`}>
                  <h2 ref={resultRef} tabIndex={-1}>
                    {action.title}
                  </h2>
                  <p>{action.text}</p>
                </div>
              )}
              {action.state === 'unknown' && (
                <div className="notice claims-result info">
                  <h2 ref={resultRef} tabIndex={-1}>
                    Checking
                  </h2>
                  <p>{action.text}</p>
                  {action.operationId && !action.checking && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void checkOperation(action.operationId ?? '')}
                    >
                      Check again
                    </button>
                  )}
                  {!action.operationId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setAction({ state: 'idle' });
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
              <h2>Timeline</h2>
              <ol className="timeline">
                <li>
                  <strong>Claim received</strong>
                  <span className="hint">
                    From {handoff.senderName} · {when(handoff.createdAt)}
                  </span>
                </li>
                {handoff.approvedVersion !== null && (
                  <li>
                    <strong>Version {handoff.approvedVersion} approved</strong>
                  </li>
                )}
                {handoff.acceptedVersion !== null && (
                  <li>
                    <strong>Version {handoff.acceptedVersion} accepted by the courier</strong>
                  </li>
                )}
                <li>
                  <strong>Version {version} is the current terms</strong>
                  <span className="hint">Last updated {when(handoff.updatedAt)}</span>
                </li>
              </ol>
              <p className="hint">
                This list comes from the claim’s current state. Receipts are not shown here, so
                nothing is marked as verified.
              </p>
            </div>

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
                {evaluation.state === 'ready' && (
                  <div>
                    <dt>Policy</dt>
                    <dd>
                      <code>{evaluation.value.policyId}</code>
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

function decisionRows(evaluation: ClaimEvaluation) {
  const allowed = new Map(evaluation.allowed.map((entry) => [entry.decision, entry]));
  return DECISION_ORDER.map((id) => {
    const entry = allowed.get(id);
    const extra =
      entry?.decision === 'counter'
        ? `: ${resolutionText(entry.resolution)}`
        : entry?.decision === 'clarify'
          ? ': photo of the damage'
          : '';
    return { id, allowed: entry !== undefined, label: `${DECISION_TEXT[id]}${extra}` };
  });
}

function StageActions(props: {
  stage: ClaimStage;
  busy: boolean;
  working: boolean;
  evaluationReady: boolean;
  note: string;
  onNote: (value: string) => void;
  onRun: () => void;
  onRecover: () => void;
}) {
  const { stage, busy } = props;
  if (stage === 'review')
    return (
      <>
        <label htmlFor="staff-note">Staff note (optional)</label>
        <textarea
          id="staff-note"
          rows={3}
          maxLength={2000}
          value={props.note}
          onChange={(event) => props.onNote(event.target.value)}
        />
        <p className="hint">
          The assistant proposes one decision. You review it before anything is sent.
        </p>
        <button type="button" disabled={busy || !props.evaluationReady} onClick={props.onRun}>
          {props.working ? 'Working…' : 'Run the claims agent'}
        </button>
      </>
    );
  if (stage === 'execution_unresolved')
    return (
      <button type="button" disabled={busy} onClick={props.onRecover}>
        {props.working ? 'Working…' : 'Recover execution'}
      </button>
    );
  if (stage === 'ready_to_complete')
    return (
      <>
        <p className="hint">
          The assistant proposes completing the claim. You review it before anything is sent.
        </p>
        <button type="button" disabled={busy} onClick={props.onRun}>
          {props.working ? 'Working…' : 'Complete claim'}
        </button>
      </>
    );
  return <p>{STAGE_NOTE[stage]}</p>;
}
