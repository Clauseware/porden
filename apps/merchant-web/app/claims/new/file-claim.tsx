'use client';

import { PublicConfig } from '@porden/contracts';
import { ClaimView, type ClaimPolicy, type OrderFacts } from '@porden/contracts/delivery-claims';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { proposeClaimAction, submitClaimProposal, type ClaimTurn } from '../../../../claims-agent';
import { createMerchantClaimsClient } from '../../../../claims-client';
import { loadAgent, type Agent } from '../agent';
import { deriveClaim } from './claim-args';
import { ALL_FIELDS, failureText, FIELD_LABEL, isSignedOut, moneyText, refusalText } from '../copy';

type Facts =
  | { state: 'loading' }
  | { state: 'error'; message: string; signedOut: boolean }
  | { state: 'ready'; order: OrderFacts; policy: ClaimPolicy };

type Message = { role: 'customer' | 'assistant'; text: string };
type Proposal = {
  turn: Extract<ClaimTurn, { kind: 'proposal' }>;
  agent: Agent;
  approvedFields: readonly (typeof ALL_FIELDS)[number][];
};
type Phase =
  | { state: 'idle' }
  | { state: 'working'; text: string }
  | { state: 'proposed'; proposal: Proposal }
  | {
      state: 'result';
      tone: 'ok' | 'info' | 'refused' | 'error';
      title: string;
      text: string;
      claimId?: string;
    }
  | { state: 'unknown'; operationId?: string; checking: boolean; text: string };

export default function FileClaim() {
  const [client] = useState(() => createMerchantClaimsClient());
  const [facts, setFacts] = useState<Facts>({ state: 'loading' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const [tick, setTick] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const proposedRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The page loads the facts first. The assistant never fetches them (contract section 6).
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const order = await client.order('DEMO-1042');
        const config = PublicConfig.safeParse(
          await fetch('/api/config').then((response) => response.json()),
        );
        if (!config.success) throw new Error('CONFIG_UNAVAILABLE');
        const policy = await client.courierPolicy(config.data.recipientOrigin);
        if (active) setFacts({ state: 'ready', order, policy });
      } catch (error) {
        if (active)
          setFacts({
            state: 'error',
            message: failureText(error, 'We could not find your order.'),
            signedOut: isSignedOut(error),
          });
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [client, tick]);

  useEffect(() => {
    if (facts.state !== 'loading') titleRef.current?.focus();
  }, [facts.state]);
  useEffect(() => {
    if (phase.state === 'result' || phase.state === 'unknown') resultRef.current?.focus();
    if (phase.state === 'proposed') proposedRef.current?.focus();
  }, [phase]);

  const working = phase.state === 'working' || phase.state === 'unknown';
  const canSend = facts.state === 'ready' && text.trim().length > 0 && !working;

  async function send() {
    if (facts.state !== 'ready' || !canSend) return;
    const message = text.trim();
    setPhase({ state: 'working', text: 'The assistant is preparing a claim…' });
    try {
      const agent = await loadAgent();
      const turn = await proposeClaimAction(agent.engine, agent.actionBindings, {
        task: 'file_claim',
        customerMessage: [
          ...messages.filter((entry) => entry.role === 'customer').map((entry) => entry.text),
          message,
        ].join('\n'),
        order: facts.order,
        courierPolicy: facts.policy,
      });
      if (turn.kind === 'none') {
        setMessages((previous) => [
          ...previous,
          { role: 'customer', text: message },
          { role: 'assistant', text: turn.text },
        ]);
        setText('');
        setPhase({ state: 'idle' });
        inputRef.current?.focus();
        return;
      }
      if (turn.kind === 'invalid') {
        setPhase({
          state: 'result',
          tone: 'error',
          title: 'No valid claim',
          text: 'The assistant could not prepare a valid action. Nothing was sent. Try again.',
        });
        return;
      }
      // The action's arguments are flat. The fields to share are derived the way the action does it.
      const derived = deriveClaim(turn.arguments);
      if (!derived) {
        setPhase({
          state: 'result',
          tone: 'error',
          title: 'No valid claim',
          text: 'The claim the assistant prepared did not pass the checks on its details. Nothing was sent. Try again.',
        });
        return;
      }
      setMessages((previous) => [...previous, { role: 'customer', text: message }]);
      setPhase({
        state: 'proposed',
        proposal: { turn, agent, approvedFields: derived.approvedFields },
      });
    } catch {
      setPhase({
        state: 'result',
        tone: 'error',
        title: 'Not sent',
        text: 'The assistant could not be reached. Nothing was sent. Your message is still in the box. Try again.',
      });
    }
  }

  async function checkOperation(operationId: string) {
    setPhase({
      state: 'unknown',
      operationId,
      checking: true,
      text: 'Checking what the server recorded. Nothing is sent again.',
    });
    try {
      const mutation = await client.operation(operationId);
      setText('');
      setPhase({
        state: 'result',
        tone: 'ok',
        title: 'Claim sent',
        text: 'The server recorded your claim.',
        claimId: mutation.handoff.id,
      });
    } catch {
      setPhase({
        state: 'unknown',
        operationId,
        checking: false,
        text: 'The server has not confirmed the outcome yet. Check again. Nothing is sent again automatically.',
      });
    }
  }

  async function review(proposal: Proposal) {
    setPhase({ state: 'working', text: 'Waiting for your review in the dialog…' });
    try {
      const outcome = await submitClaimProposal(proposal.agent.engine, proposal.turn);
      if (outcome.status === 'succeeded') {
        const view = ClaimView.safeParse(outcome.result);
        setText('');
        setPhase({
          state: 'result',
          tone: 'ok',
          title: 'Claim sent',
          text: view.success
            ? 'The server recorded your claim.'
            : 'The server accepted your claim. Its status could not be read back here.',
          ...(view.success ? { claimId: view.data.handoff.id } : {}),
        });
      } else if (outcome.status === 'refused') {
        setPhase({
          state: 'result',
          tone: 'refused',
          title: 'Refused',
          text: refusalText(outcome.code),
        });
      } else if (outcome.status === 'cancelled') {
        setPhase({
          state: 'result',
          tone: 'info',
          title: 'Cancelled',
          text: 'You declined in the review dialog. Nothing changed. Your message is still in the box.',
        });
      } else if (outcome.operationId) {
        await checkOperation(outcome.operationId);
      } else {
        setPhase({
          state: 'unknown',
          checking: false,
          text: 'The outcome is not known. Nothing is sent again automatically. If you are unsure, check with the merchant before you file this claim again.',
        });
      }
    } catch {
      setPhase({
        state: 'unknown',
        checking: false,
        text: 'The outcome is not known. Nothing is sent again automatically. If you are unsure, check with the merchant before you file this claim again.',
      });
    }
  }

  if (facts.state === 'loading') {
    return (
      <section className="claims-detail" aria-live="polite" aria-busy="true">
        <h1 ref={titleRef} tabIndex={-1}>
          File a claim
        </h1>
        <p role="status">Loading your order and the courier’s policy…</p>
      </section>
    );
  }

  if (facts.state === 'error') {
    return (
      <section className="claims-detail" aria-live="polite">
        <h1 ref={titleRef} tabIndex={-1}>
          File a claim
        </h1>
        <div className="notice danger" role="alert">
          <p>{facts.message}</p>
          {facts.signedOut && (
            <p>
              <Link href="/">Go to the merchant sign-in</Link>
            </p>
          )}
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setFacts({ state: 'loading' });
            setTick(tick + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  const { order } = facts;

  return (
    <section className="claims-app">
      <nav className="claims-side" aria-label="Order">
        <p className="claims-side-title">Order</p>
        <dl className="claims-facts">
          <div>
            <dt>Reference</dt>
            <dd>{order.orderReference}</dd>
          </div>
          <div>
            <dt>Item</dt>
            <dd>{order.description}</dd>
          </div>
          <div>
            <dt>Parcel</dt>
            <dd>{order.parcelClass}</dd>
          </div>
          <div>
            <dt>Declared value</dt>
            <dd>{moneyText(order.declaredValueMinor, order.currency)}</dd>
          </div>
        </dl>
        <p className="hint">Read only. These facts come from the merchant’s order record.</p>
      </nav>

      <div className="claims-main">
        <h1 ref={titleRef} tabIndex={-1}>
          File a claim
        </h1>
        <p className="hint">
          The assistant prepares a claim. You review it before anything is sent.
        </p>

        <ol className="chat" aria-label="Conversation">
          {messages.map((message, index) => (
            <li key={index} className={message.role}>
              <strong>{message.role === 'customer' ? 'You' : 'Assistant'}</strong>
              <span>{message.text}</span>
            </li>
          ))}
        </ol>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="damage">Describe the damage</label>
          <textarea
            id="damage"
            ref={inputRef}
            rows={4}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" disabled={!canSend}>
            {phase.state === 'working' ? 'Working…' : 'Send'}
          </button>
        </form>

        <div aria-live="polite" className="claims-live">
          {phase.state === 'working' && <p role="status">{phase.text}</p>}

          {phase.state === 'proposed' && (
            <div className="panel claims-card">
              <h2 ref={proposedRef} tabIndex={-1}>
                Review before sending
              </h2>
              <p>The assistant prepared a claim. Nothing has been sent yet.</p>
              {phase.proposal.turn.text && <p className="hint">{phase.proposal.turn.text}</p>}
              <h3>Fields that will be shared with the courier</h3>
              <ul className="decision-list">
                {ALL_FIELDS.map((field) => {
                  const shared = phase.proposal.approvedFields.includes(field);
                  return (
                    <li key={field} data-allowed={shared}>
                      <span>{FIELD_LABEL[field]}</span>
                      <span className="stage-tag">{shared ? 'Shared' : 'Not shared'}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="actions">
                <button type="button" onClick={() => void review(phase.proposal)}>
                  Review and send
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPhase({ state: 'idle' });
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {phase.state === 'result' && (
            <div className={`notice claims-result ${phase.tone}`}>
              <h2 ref={resultRef} tabIndex={-1}>
                {phase.title}
              </h2>
              <p>{phase.text}</p>
              {phase.claimId && (
                <>
                  <p>
                    <Link href={`/claims/${encodeURIComponent(phase.claimId)}`}>
                      Open your claim
                    </Link>
                  </p>
                  <p className="hint">
                    You can find it again under <Link href="/claims">Your claims</Link>.
                  </p>
                </>
              )}
            </div>
          )}

          {phase.state === 'unknown' && (
            <div className="notice claims-result info">
              <h2 ref={resultRef} tabIndex={-1}>
                Checking
              </h2>
              <p>{phase.text}</p>
              {phase.operationId && !phase.checking && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void checkOperation(phase.operationId ?? '')}
                >
                  Check again
                </button>
              )}
              {!phase.operationId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPhase({ state: 'idle' });
                  }}
                >
                  Start over
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
