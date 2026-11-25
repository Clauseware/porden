'use client';

import type { ClaimInbox, ClaimStage } from '@porden/contracts/delivery-claims';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createCourierClaimsClient } from '../../../claims-client';
import { failureText, isSignedOut, STAGE_LABEL, STAGES, termsSummary, when } from './copy';

const LIMIT = 50;

type View =
  | { state: 'loading' }
  | { state: 'error'; message: string; signedOut: boolean }
  | { state: 'ready'; inbox: ClaimInbox };

export default function Inbox() {
  const [client] = useState(() => createCourierClaimsClient());
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<ClaimStage>('review');
  const [view, setView] = useState<View>({ state: 'loading' });
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const inbox = await client.inbox({ page, limit: LIMIT });
        if (active) setView({ state: 'ready', inbox });
      } catch (error) {
        if (active)
          setView({ state: 'error', message: failureText(error), signedOut: isSignedOut(error) });
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [client, page, tick]);

  function go(target: number) {
    setView({ state: 'loading' });
    setPage(target);
  }

  // After the list changes, focus the title so the new state is read out.
  useEffect(() => {
    if (view.state !== 'loading') headingRef.current?.focus();
  }, [view.state, page]);

  const counts = useMemo(() => {
    const result: Record<ClaimStage, number> = {
      review: 0,
      waiting_for_customer: 0,
      waiting_for_merchant_approval: 0,
      waiting_for_execution: 0,
      execution_unresolved: 0,
      ready_to_complete: 0,
      closed: 0,
    };
    if (view.state === 'ready') for (const item of view.inbox.items) result[item.stage] += 1;
    return result;
  }, [view]);

  const rows =
    view.state === 'ready' ? view.inbox.items.filter((item) => item.stage === stage) : [];
  const inbox = view.state === 'ready' ? view.inbox : undefined;
  const hasNext = inbox ? inbox.page * inbox.limit < inbox.totalReceived : false;

  return (
    <section className="claims-app">
      <nav className="claims-side" aria-label="Claim stages">
        <p className="claims-side-title">Stage</p>
        <ul>
          {STAGES.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="stage-button"
                aria-pressed={stage === item.id}
                onClick={() => setStage(item.id)}
              >
                <span>{item.label}</span>
                {view.state === 'ready' && <span className="count">{counts[item.id]}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">
          Counts are for the claims on this page of the inbox. They come from the server’s answer.
        </p>
      </nav>

      <div className="claims-main" aria-live="polite" aria-busy={view.state === 'loading'}>
        <h1 ref={headingRef} tabIndex={-1}>
          Claims: {STAGE_LABEL[stage]}
        </h1>
        <p className="hint">Received claims in the selected stage.</p>

        {view.state === 'loading' && <p role="status">Loading claims…</p>}

        {view.state === 'error' && (
          <div className="notice danger" role="alert">
            <p>{view.message}</p>
            {view.signedOut && (
              <p>
                <Link href="/">Go to the courier sign-in</Link>
              </p>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setView({ state: 'loading' });
                setTick(tick + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {view.state === 'ready' && (
          <>
            {rows.length === 0 ? (
              <p className="claims-empty">No claims in this stage.</p>
            ) : (
              <ul className="claims-list">
                {rows.map((item) => (
                  <li key={item.handoff.id}>
                    <Link
                      className="claim-row"
                      href={`/claims/${encodeURIComponent(item.handoff.id)}`}
                    >
                      <span className="claim-main">
                        <strong>{item.current.claim.orderReference}</strong>
                        <span>{termsSummary(item.current)}</span>
                        {item.openClarifications > 0 && (
                          <span className="hint">
                            {item.openClarifications} open question
                            {item.openClarifications === 1 ? '' : 's'} for the customer
                          </span>
                        )}
                      </span>
                      <span className="claim-side">
                        <span className="stage-tag">{STAGE_LABEL[item.stage]}</span>
                        <span className="hint">Updated {when(item.handoff.updatedAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <div className="claims-pager">
              <p className="hint">
                Page {inbox?.page}. Read {inbox?.scanned} of {inbox?.totalReceived} received
                handoffs.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={page <= 1}
                  onClick={() => go(page - 1)}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!hasNext}
                  onClick={() => go(page + 1)}
                >
                  Next page
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
