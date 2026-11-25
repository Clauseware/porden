import type { ClaimParameters, ClaimView } from '@porden/contracts/delivery-claims';
import { PordenError } from '@porden/sdk';

type Handoff = ClaimView['handoff'];

// Words for the customer. Status lines follow docs/claims-integration-contract.md section 8.
export type ClaimField = 'orderReference' | 'damageDescription' | 'deliveryAddress';
export const FIELD_LABEL: Record<ClaimField, string> = {
  orderReference: 'Order reference',
  damageDescription: 'Damage description',
  deliveryAddress: 'Delivery address',
};
export const ALL_FIELDS: readonly ClaimField[] = [
  'orderReference',
  'damageDescription',
  'deliveryAddress',
];

const money = (amountMinor: number, currency: string) =>
  `${(amountMinor / 100).toFixed(2)} ${currency}`;

export function resolutionText(resolution: ClaimParameters['resolution']) {
  if (resolution.remedy === 'reship') return 'Reship the parcel';
  const amount = money(resolution.amountMinor, resolution.currency);
  return resolution.remedy === 'full_refund'
    ? `Full refund of ${amount}`
    : `Partial refund of ${amount}`;
}

export function moneyText(amountMinor: number, currency: string) {
  return money(amountMinor, currency);
}

export function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

export const RECEIPT_NOTICE =
  'A receipt proves the issuer recorded this. It does not prove the claim was paid, resolved, or that the damage happened.';

// One plain sentence for the claim's state. "Done. Signed receipt verified." needs a valid check.
export function statusLine(handoff: Handoff, receiptVerified: boolean) {
  const executed = (version: number | null) =>
    version !== null &&
    handoff.executions.some((item) => item.version === version && item.status === 'completed');
  if (handoff.status === 'completed')
    return receiptVerified
      ? 'Done. Signed receipt verified.'
      : 'Done. The courier completed the claim. The receipt has not been checked on this page yet.';
  if (handoff.status === 'rejected') return 'The courier refused this claim.';
  if (handoff.status === 'cancelled') return 'This claim was cancelled.';
  if (handoff.status === 'failed') return 'This claim could not be completed.';
  if (handoff.executions.some((item) => item.status === 'reserved'))
    return 'Checking: sending the case was interrupted, and its outcome is not confirmed yet.';
  if (handoff.clarifications.some((item) => item.response === undefined))
    return 'The courier needs more information from you.';
  if (handoff.status === 'draft')
    return 'Waiting for approval. The courier has not received this claim yet.';
  if (handoff.status === 'awaiting_approval')
    return 'The courier made a counter-offer: needs your approval';
  if (handoff.status === 'accepted')
    return executed(handoff.acceptedVersion)
      ? 'The case was sent. Waiting for the courier to complete the claim.'
      : 'Courier accepted. Ready to send the case.';
  return 'Waiting for the courier';
}

// What each platform receipt records, in plain words.
const ACTION_TEXT: Record<string, string> = {
  created: 'Claim sent',
  authorized: 'Claim approved',
  accepted: 'Courier accepted the version',
  rejected: 'Courier refused the claim',
  cancelled: 'Claim cancelled',
  revision_proposed: 'Courier made a counter-offer',
  clarification_requested: 'Courier asked a question',
  clarification_resolved: 'Question answered',
  execution_reserved: 'Sending the case started',
  execution_settled: 'Sending the case finished',
  completed: 'Courier completed the claim',
  failed: 'Claim could not be completed',
};
export function actionText(action: string) {
  return ACTION_TEXT[action] ?? `Recorded: ${action.replaceAll('_', ' ')}`;
}

export function refusalText(code: string) {
  if (code === 'CONSENT_SCOPE_MISMATCH')
    return 'The fields to share did not match the claim. Nothing was changed.';
  if (code === 'STALE_VERSION')
    return 'The claim changed after you opened it. Reload the claim and try again. Nothing was changed.';
  if (code === 'POLICY_VIOLATION')
    return 'That is not allowed by the courier’s policy. Nothing was changed.';
  return `The server refused this request (${code}). Nothing was changed.`;
}

export function isSignedOut(error: unknown) {
  return error instanceof PordenError && (error.status === 401 || error.status === 403);
}

export function failureText(error: unknown, notFound = 'We could not find this claim.') {
  if (isSignedOut(error))
    return 'You are not signed in to the merchant site. Sign in on the home page, then reload this page.';
  if (error instanceof PordenError) {
    if (error.status === 404) return notFound;
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (error.status >= 500) return 'The service had a problem. Nothing was changed. Try again.';
    if (error.status >= 400) return 'The service refused this request. Nothing was changed.';
  }
  return 'We could not reach the service. Nothing was changed. Try again.';
}
