import type { ReceiptVerification } from '@porden/contracts';
import type { Resolution } from '@porden/contracts/delivery-claims';
import { PordenError } from '@porden/sdk';

export const RECEIPT_LIMIT = 16384;

// The sentence that always follows a valid result.
export const VALID_NOTICE =
  'A receipt proves the issuer recorded this. It does not prove the claim was paid, resolved, or that the damage happened.';

export type Outcome =
  | { state: 'valid'; summary: string; details: { label: string; value: string }[] }
  | { state: 'invalid'; reason: string }
  | { state: 'not_checked'; message: string }
  | { state: 'rate_limited'; message: string }
  | { state: 'error'; message: string };

// Plain words for each reasonCode. Each sentence says no more than the code does.
const REASONS: Record<Extract<ReceiptVerification, { valid: false }>['reasonCode'], string> = {
  MALFORMED: 'The text is not in the shape of a signed receipt.',
  UNSUPPORTED_TYPE: 'This is not a kind of receipt this page can check.',
  UNTRUSTED_ISSUER: 'The receipt names an issuer this site does not trust.',
  SIGNATURE_INVALID: 'The signature does not match the issuer’s keys.',
  CLAIMS_INVALID: 'The signed content does not have the expected fields.',
};

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

function resolution(value: Resolution | undefined) {
  if (!value) return 'the agreed resolution';
  if (value.remedy === 'reship') return 'a reshipment';
  const amount = `${(value.amountMinor / 100).toFixed(2)} ${value.currency}`;
  return value.remedy === 'full_refund'
    ? `a full refund of ${amount}`
    : `a partial refund of ${amount}`;
}

export function describeVerification(result: ReceiptVerification): Outcome {
  if (!result.valid) return { state: 'invalid', reason: REASONS[result.reasonCode] };
  const { receipt } = result;
  const common = [
    { label: 'Issuer', value: result.issuer },
    { label: 'Key ID', value: result.keyId },
  ];
  if (receipt.kind === 'handoff') {
    const { action, version, occurredAt } = receipt.claims;
    return {
      state: 'valid',
      summary: `Porden recorded ${action} on version ${version} at ${when(occurredAt)}.`,
      details: [{ label: 'Receipt type', value: 'Handoff receipt' }, ...common],
    };
  }
  const { caseId, receivedAt, governance, resolution: agreed } = receipt.claims;
  const forVersion = governance ? `, for handoff version ${governance.version}` : '';
  return {
    state: 'valid',
    summary: `The courier signed that it accepted case ${caseId} into its system on ${when(receivedAt)}${forVersion}, with ${resolution(agreed)}.`,
    details: [{ label: 'Receipt type', value: 'Courier case receipt' }, ...common],
  };
}

// Turns a thrown error into a state. Nothing is retried here, and "not checked" is never "invalid".
export function describeFailure(error: unknown): Outcome {
  if (error instanceof PordenError) {
    if (error.code === 'VERIFICATION_UNAVAILABLE' || error.status === 502) {
      return {
        state: 'not_checked',
        message: 'The issuer’s keys could not be reached. Try again.',
      };
    }
    if (error.code === 'RATE_LIMITED' || error.status === 429) {
      return {
        state: 'rate_limited',
        message: 'Too many checks; try again in a minute.',
      };
    }
  }
  return {
    state: 'error',
    message: 'The receipt could not be checked. Nothing was decided. Try again.',
  };
}
