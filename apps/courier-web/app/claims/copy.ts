import type {
  AllowedDecision,
  ClaimEvaluation,
  ClaimParameters,
  ClaimStage,
} from '@porden/contracts/delivery-claims';
import { PordenError } from '@porden/sdk';

// Words for staff. Stage names follow the courier action table in docs/claims-integration-contract.md.
export const STAGES: readonly { id: ClaimStage; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'waiting_for_customer', label: 'Waiting for customer' },
  { id: 'waiting_for_merchant_approval', label: 'Waiting for merchant approval' },
  { id: 'waiting_for_execution', label: 'Waiting for execution' },
  { id: 'execution_unresolved', label: 'Execution unresolved' },
  { id: 'ready_to_complete', label: 'Ready to complete' },
  { id: 'closed', label: 'Closed' },
];

export const STAGE_LABEL: Record<ClaimStage, string> = {
  review: 'Review',
  waiting_for_customer: 'Waiting for customer',
  waiting_for_merchant_approval: 'Waiting for merchant approval',
  waiting_for_execution: 'Waiting for execution',
  execution_unresolved: 'Execution unresolved',
  ready_to_complete: 'Ready to complete',
  closed: 'Closed',
};

// What the desk does at each stage (contract section 4).
export const STAGE_NOTE: Record<ClaimStage, string> = {
  review: 'Run the claims agent to propose a decision.',
  waiting_for_customer: 'Waiting for the customer’s answer. Nothing to do yet.',
  waiting_for_merchant_approval: 'Waiting for the merchant approver. Nothing to do yet.',
  waiting_for_execution: 'Waiting for the merchant’s transfer. Nothing to do yet.',
  execution_unresolved:
    'An earlier write was interrupted. Recover the execution to settle it from what the courier database committed.',
  ready_to_complete: 'The case exists. Run the claims agent to complete the claim.',
  closed: 'This claim is closed. It is read only.',
};

export const FINDING_TEXT: Record<ClaimEvaluation['findings'][number], string> = {
  WITHIN_POLICY: 'Within the courier’s claims policy.',
  PHOTO_REQUIRED: 'The courier needs a photo of the damage for refunds above 25.00 USD.',
  REFUND_EXCEEDS_COVER: 'The request is above the courier’s cover for this parcel.',
  RESHIP_NOT_AVAILABLE: 'The courier can’t reship this kind of item.',
  CURRENCY_NOT_SUPPORTED: 'The courier only handles claims in USD.',
};

export const DECISION_TEXT: Record<AllowedDecision['decision'], string> = {
  accept: 'Accept the request',
  clarify: 'Ask the customer for more information',
  counter: 'Make a counter-offer',
  reject: 'Refuse the claim',
};

const money = (amountMinor: number, currency: string) =>
  `${(amountMinor / 100).toFixed(2)} ${currency}`;

export function resolutionText(resolution: ClaimParameters['resolution']) {
  if (resolution.remedy === 'reship') return 'Reship the parcel';
  const amount = money(resolution.amountMinor, resolution.currency);
  return resolution.remedy === 'full_refund'
    ? `Full refund of ${amount}`
    : `Partial refund of ${amount}`;
}

export function termsSummary(current: ClaimParameters) {
  return `${resolutionText(current.resolution)} · order ${current.claim.orderReference}`;
}

export function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

// A refusal means the server decided and nothing changed.
export function refusalText(code: string) {
  if (code === 'POLICY_VIOLATION')
    return 'That decision isn’t allowed by the courier’s policy. Nothing was changed.';
  if (code === 'STALE_VERSION')
    return 'The claim changed after you opened it. Reload the claim and review it again. Nothing was changed.';
  return `The server refused this request (${code}). Nothing was changed.`;
}

export function isSignedOut(error: unknown) {
  return error instanceof PordenError && (error.status === 401 || error.status === 403);
}

// Plain sentence per kind of error. Staff also get the code and request reference in brackets.
export function failureText(error: unknown) {
  if (isSignedOut(error))
    return 'You are not signed in to the courier site. Sign in on the home page, then reload this page.';
  let sentence = 'We could not reach the service. Nothing was changed. Try again.';
  if (error instanceof PordenError) {
    if (error.status === 404) sentence = 'We could not find this claim.';
    else if (error.status === 429) sentence = 'Too many requests. Wait a moment and try again.';
    else if (error.status >= 500)
      sentence = 'The service had a problem. Nothing was changed. Try again.';
    else if (error.status >= 400)
      sentence = 'The service refused this request. Nothing was changed.';
    const ref = error.requestId ? ', reference ' + error.requestId : '';
    return sentence + ' (' + error.code + ref + ')';
  }
  return sentence;
}
