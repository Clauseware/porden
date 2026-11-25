'use client';

import type { VerifiedReceipt } from '@porden/contracts';
import { PordenError } from '@porden/sdk';
import type { ClaimView } from '@porden/contracts/delivery-claims';
import { useState } from 'react';
import { verifyReceipt } from '../../../../claims-client';
import { actionText, RECEIPT_NOTICE, resolutionText, when } from '../copy';

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'valid' }
  | { state: 'invalid' }
  | { state: 'not_checked'; message: string };

type Handoff = ClaimView['handoff'];

// Each platform receipt can be checked here with this site's public verifier. "Verified" is shown only
// after the verifier says valid. Unavailable keys mean "not checked", never "invalid".
function ReceiptRow(props: {
  receipt: Handoff['receipts'][number];
  who: string;
  onValid: (receiptId: string) => void;
}) {
  const { receipt } = props;
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  async function run() {
    setCheck({ state: 'checking' });
    try {
      const result = await verifyReceipt(receipt.signedReceipt);
      if (result.valid) {
        setCheck({ state: 'valid' });
        props.onValid(receipt.receiptId);
      } else setCheck({ state: 'invalid' });
    } catch (error) {
      const limited =
        error instanceof PordenError && (error.status === 429 || error.code === 'RATE_LIMITED');
      setCheck({
        state: 'not_checked',
        message: limited
          ? 'Too many checks; try again in a minute.'
          : 'Not checked. The issuer’s keys could not be reached, or the check failed. Try again.',
      });
    }
  }

  return (
    <li>
      <span className="claim-main">
        <strong>{actionText(receipt.action)}</strong>
        <span className="hint">
          {props.who} · version {receipt.version} · {when(receipt.occurredAt)}
        </span>
        {check.state === 'valid' && <span className="verified-tag">Signature valid: verified</span>}
        {check.state === 'invalid' && <span className="stage-tag">Not valid</span>}
        {check.state === 'not_checked' && <span className="hint">{check.message}</span>}
      </span>
      <button
        type="button"
        className="secondary"
        disabled={check.state === 'checking'}
        onClick={() => void run()}
      >
        {check.state === 'checking' ? 'Checking…' : 'Check this receipt'}
      </button>
    </li>
  );
}

export function Receipts(props: {
  handoff: Handoff;
  caseReceipt: VerifiedReceipt | undefined;
  resolution: Parameters<typeof resolutionText>[0] | undefined;
  onValid: (receiptId: string) => void;
}) {
  const { handoff } = props;
  const who = (organizationId: string) =>
    organizationId === handoff.senderOrganizationId ? 'You' : 'Courier';
  return (
    <div className="panel claims-card">
      <h2>Receipts</h2>
      {props.caseReceipt && (
        <div className="notice">
          <p>
            <strong>
              Courier confirmed:{' '}
              {props.resolution ? resolutionText(props.resolution).toLowerCase() : 'the case'}
            </strong>
          </p>
          <p className="hint">
            This site checked the courier’s signature when the case was accepted on{' '}
            {when(props.caseReceipt.receivedAt)}.
          </p>
        </div>
      )}
      {!props.caseReceipt && (
        <p className="hint">
          The courier’s case receipt is not available in this tab yet. It appears after you send the
          case.
        </p>
      )}
      {handoff.receipts.length === 0 ? (
        <p className="hint">No platform receipts are recorded for this claim yet.</p>
      ) : (
        <ul className="claims-list">
          {handoff.receipts.map((receipt) => (
            <ReceiptRow
              key={receipt.receiptId}
              receipt={receipt}
              who={who(receipt.organizationId)}
              onValid={props.onValid}
            />
          ))}
        </ul>
      )}
      <p className="hint">{RECEIPT_NOTICE}</p>
    </div>
  );
}
