'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { verifyReceipt } from '../../../claims-client';
import PordenSymbol from '../../../logo';
import {
  describeFailure,
  describeVerification,
  RECEIPT_LIMIT,
  VALID_NOTICE,
  type Outcome,
} from './describe';

type View = { state: 'idle' } | { state: 'checking' } | Outcome;

const HEADINGS: Record<Outcome['state'], string> = {
  valid: 'Signature valid',
  invalid: 'Not valid',
  not_checked: 'Not checked',
  rate_limited: 'Not checked',
  error: 'Not checked',
};

export default function Verifier() {
  const [text, setText] = useState('');
  const [view, setView] = useState<View>({ state: 'idle' });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const field = useId();
  const count = useId();

  const trimmed = text.trim();
  const tooLong = text.length > RECEIPT_LIMIT;
  const checking = view.state === 'checking';
  const canCheck = trimmed.length > 0 && !tooLong && !checking;

  // Move focus to the result title once a result is on screen.
  useEffect(() => {
    if (view.state !== 'idle' && view.state !== 'checking') headingRef.current?.focus();
  }, [view]);

  async function check() {
    if (!canCheck) return;
    setView({ state: 'checking' });
    try {
      setView(describeVerification(await verifyReceipt(trimmed)));
    } catch (error) {
      setView(describeFailure(error));
    }
  }

  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href="/">
          <PordenSymbol />
          porden<span> / check a receipt</span>
        </Link>
      </header>

      <section className="intro verify">
        <h1>Check a receipt</h1>
        <p>
          Paste a signed receipt (a long text that usually starts with <code>eyJ</code>). This page
          asks the server to check its signature. It needs no sign-in, and nothing is saved.
        </p>

        <form
          className="verify-form"
          onSubmit={(event) => {
            event.preventDefault();
            void check();
          }}
        >
          <label htmlFor={field}>Signed receipt</label>
          <textarea
            id={field}
            rows={7}
            value={text}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={count}
            aria-invalid={tooLong}
            onChange={(event) => setText(event.target.value)}
          />
          <p id={count} className={tooLong ? 'verify-count over' : 'verify-count'}>
            {text.length.toLocaleString('en-US')} / {RECEIPT_LIMIT.toLocaleString('en-US')}{' '}
            characters
            {tooLong ? '. Too long: a receipt is at most 16,384 characters.' : ''}
          </p>
          <button type="submit" disabled={!canCheck}>
            {checking ? 'Checking…' : 'Check receipt'}
          </button>
        </form>

        <div className="verify-result" aria-live="polite" aria-atomic="true">
          {view.state === 'idle' && (
            <p className="verify-hint">No receipt checked yet. The result will appear here.</p>
          )}
          {view.state === 'checking' && <p role="status">Checking the signature…</p>}
          {view.state !== 'idle' && view.state !== 'checking' && (
            <section className={`verify-card ${view.state}`}>
              <h2 ref={headingRef} tabIndex={-1}>
                {HEADINGS[view.state]}
              </h2>
              {view.state === 'valid' && (
                <>
                  <p>{view.summary}</p>
                  <p>{VALID_NOTICE}</p>
                  <details>
                    <summary>Details</summary>
                    <dl>
                      {view.details.map((item) => (
                        <div key={item.label}>
                          <dt>{item.label}</dt>
                          <dd>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </>
              )}
              {view.state === 'invalid' && <p>{view.reason}</p>}
              {(view.state === 'not_checked' ||
                view.state === 'rate_limited' ||
                view.state === 'error') && <p>{view.message}</p>}
            </section>
          )}
        </div>
      </section>

      <footer>
        porden · Context carried with permission. <span>Synthetic delivery demo</span>
      </footer>
    </>
  );
}
