'use client';

import type { MerchantClaimList } from '@porden/contracts/delivery-claims';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createMerchantClaimsClient } from '../../../claims-client';
import { failureText, isSignedOut, when } from './copy';

type View =
  | { state: 'loading' }
  | { state: 'error'; message: string; signedOut: boolean }
  | { state: 'ready'; list: MerchantClaimList };

// The signed-in customer's claims, newest first. Each claim's status is read on its own page.
export default function ClaimList() {
  const [view, setView] = useState<View>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    createMerchantClaimsClient()
      .claims()
      .then((list) => {
        if (active) setView({ state: 'ready', list });
      })
      .catch((error: unknown) => {
        if (active)
          setView({ state: 'error', message: failureText(error), signedOut: isSignedOut(error) });
      });
    return () => {
      active = false;
    };
  }, [tick]);

  useEffect(() => {
    if (view.state !== 'loading') headingRef.current?.focus();
  }, [view.state]);

  return (
    <section className="claims-app">
      <nav className="claims-side" aria-label="Claims">
        <p className="claims-side-title">Claims</p>
        <Link className="claims-back" href="/claims/new">
          File a new claim
        </Link>
      </nav>

      <div className="claims-main" aria-live="polite" aria-busy={view.state === 'loading'}>
        <h1 ref={headingRef} tabIndex={-1}>
          Your claims
        </h1>
        <p className="hint">Claims you filed from this merchant account, newest first.</p>

        {view.state === 'loading' && <p role="status">Loading your claims…</p>}
        {view.state === 'error' && (
          <div className="notice danger" role="alert">
            <p>{view.message}</p>
            {view.signedOut ? (
              <Link href="/">Go to the home page to sign in</Link>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setView({ state: 'loading' });
                  setTick((value) => value + 1);
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {view.state === 'ready' && !view.list.items.length && (
          <p className="claims-empty">You have not filed any claims yet.</p>
        )}
        {view.state === 'ready' && view.list.items.length > 0 && (
          <ul className="claims-list">
            {view.list.items.map((item) => (
              <li key={item.handoffId}>
                <Link className="claim-row" href={`/claims/${encodeURIComponent(item.handoffId)}`}>
                  <span className="claim-main">
                    <strong>{item.orderReference}</strong>
                  </span>
                  <span className="claim-side">
                    <span className="hint">Filed {when(item.filedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
