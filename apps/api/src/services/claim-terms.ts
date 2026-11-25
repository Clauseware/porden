import { canonicalize, type ExecutionScope, type TaskTerms } from '@porden/contracts';
import {
  ClaimParameters,
  type ClaimParameters as Parameters,
  type Resolution,
} from '@porden/contracts/delivery-claims';
import type { z } from 'zod';
import { ApiError } from '../application/errors';

// Damaged-parcel profile for generic handoff terms. Both organizations build terms with this
// function, so a version's terms are a deterministic rendering of its claim parameters.
const parametersPrefix = 'Claim parameters (canonical): ';
export const caseAction = 'courier.create_case';
type Scope = z.infer<typeof ExecutionScope>;

function money(amountMinor: number, currency: string) {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}
export function describeResolution(resolution: Resolution) {
  if (resolution.remedy === 'reship') return 'reship the order';
  const label = resolution.remedy === 'full_refund' ? 'full refund' : 'partial refund';
  return `${label} of ${money(resolution.amountMinor, resolution.currency)}`;
}

export function claimTerms(parameters: Parameters, caseScope: Scope): TaskTerms {
  const { claim, resolution } = parameters;
  const outcome = describeResolution(resolution);
  return {
    goal: `Resolve the damaged-parcel claim for order ${claim.orderReference}`,
    constraints: [
      `Resolution: ${outcome}`,
      `Parcel class: ${claim.parcelClass}; declared value ${money(claim.declaredValueMinor, claim.currency)}`,
      `Photo of damage: ${claim.photoProvided ? 'provided' : 'not provided'}`,
      parametersPrefix + canonicalize(parameters),
    ],
    acceptanceCriteria: [
      'Create exactly one courier damage case for the consented claim data',
      `Record the agreed resolution: ${outcome}`,
    ],
    ...(resolution.remedy === 'reship'
      ? {}
      : { budget: { amountMinor: resolution.amountMinor, currency: resolution.currency } }),
    executionScopes: [caseScope],
  };
}

/** Returns undefined for handoffs outside this profile; fails closed for altered claim terms. */
export function readClaimTerms(terms: TaskTerms) {
  const line = terms.constraints.find((item) => item.startsWith(parametersPrefix));
  if (line === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(parametersPrefix.length));
  } catch (cause) {
    throw new ApiError('SCOPE_MISMATCH', 409, undefined, { cause });
  }
  const parsed = ClaimParameters.safeParse(value);
  if (!parsed.success)
    throw new ApiError('SCOPE_MISMATCH', 409, undefined, { cause: parsed.error });
  const caseScope = terms.executionScopes?.length === 1 ? terms.executionScopes[0] : undefined;
  if (
    caseScope?.action !== caseAction ||
    canonicalize(claimTerms(parsed.data, caseScope)) !== canonicalize(terms)
  )
    throw new ApiError('SCOPE_MISMATCH', 409);
  return { parameters: parsed.data, caseScope };
}
