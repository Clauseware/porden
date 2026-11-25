import type {
  AllowedDecision,
  ClaimEvaluation,
  ClaimParameters,
  ClaimPolicy,
} from '@porden/contracts/delivery-claims';

// Courier-owned business rules. Agents may only choose among the decisions returned here.
export const courierClaimPolicy: ClaimPolicy = {
  id: 'courier-claims-2026-11',
  currency: 'USD',
  maxRefundMinor: { standard: 10_000, fragile: 5_000, electronics: 20_000 },
  photoRequiredAboveMinor: 2_500,
  reshipClasses: ['standard', 'fragile'],
};

type Outcome = Pick<ClaimEvaluation, 'findings' | 'allowed'>;
const reject: AllowedDecision = { decision: 'reject' };

export function evaluateClaim(
  policy: ClaimPolicy,
  parameters: ClaimParameters,
  evidence: { photoReceived: boolean },
): Outcome {
  const { claim, resolution } = parameters;
  if (
    claim.currency !== policy.currency ||
    (resolution.remedy !== 'reship' && resolution.currency !== policy.currency)
  )
    return { findings: ['CURRENCY_NOT_SUPPORTED'], allowed: [reject] };
  const refund = resolution.remedy === 'reship' ? 0 : resolution.amountMinor;
  if (refund > policy.photoRequiredAboveMinor && !claim.photoProvided && !evidence.photoReceived)
    return {
      findings: ['PHOTO_REQUIRED'],
      allowed: [{ decision: 'clarify', missingInformation: ['photo_of_damage'] }, reject],
    };
  const cover = Math.min(claim.declaredValueMinor, policy.maxRefundMinor[claim.parcelClass]);
  const reship = policy.reshipClasses.includes(claim.parcelClass);
  const partial: AllowedDecision = {
    decision: 'counter',
    resolution: { remedy: 'partial_refund', amountMinor: cover, currency: policy.currency },
  };
  if (resolution.remedy === 'reship' && !reship)
    return { findings: ['RESHIP_NOT_AVAILABLE'], allowed: [partial, reject] };
  if (refund > cover)
    return {
      findings: ['REFUND_EXCEEDS_COVER'],
      allowed: [
        ...(cover > 0 ? [partial] : []),
        ...(reship
          ? [{ decision: 'counter' as const, resolution: { remedy: 'reship' as const } }]
          : []),
        reject,
      ],
    };
  return { findings: ['WITHIN_POLICY'], allowed: [{ decision: 'accept' }] };
}
