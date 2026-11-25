import { DamageData, Fields, type ApproveTransfer } from '@porden/contracts';

// The arguments of the merchant_file_claim action, exactly as apps/api/public/actions.js defines
// them: damageDescription, deliveryAddress?, photoProvided, remedy, partialRefundMinor?. They are
// flat. The action's own handler builds `data` and `approvedFields` from them, so this does the same
// to know which fields the customer is about to share.
const KEYS = new Set([
  'damageDescription',
  'deliveryAddress',
  'photoProvided',
  'remedy',
  'partialRefundMinor',
]);
const REMEDIES = new Set(['full_refund', 'partial_refund', 'reship']);

export type DerivedClaim = { data: DamageData; approvedFields: ApproveTransfer['approvedFields'] };

export function deriveClaim(args: Record<string, unknown>): DerivedClaim | undefined {
  if (Object.keys(args).some((key) => !KEYS.has(key))) return undefined;
  const { damageDescription, deliveryAddress, photoProvided, remedy, partialRefundMinor } = args;
  if (typeof damageDescription !== 'string' || typeof photoProvided !== 'boolean') return undefined;
  if (typeof remedy !== 'string' || !REMEDIES.has(remedy)) return undefined;
  if (deliveryAddress !== undefined && typeof deliveryAddress !== 'string') return undefined;
  if (partialRefundMinor !== undefined) {
    if (typeof partialRefundMinor !== 'number' || !Number.isInteger(partialRefundMinor))
      return undefined;
    if (partialRefundMinor < 1) return undefined;
  }
  // A partial refund needs the amount the customer asked for (the action refuses it otherwise).
  if (remedy === 'partial_refund' && partialRefundMinor === undefined) return undefined;
  const withAddress = typeof deliveryAddress === 'string' && deliveryAddress !== '';
  const data = DamageData.safeParse({
    orderReference: 'DEMO-1042',
    damageDescription,
    ...(withAddress ? { deliveryAddress } : {}),
  });
  const approvedFields = Fields.safeParse(
    withAddress
      ? ['orderReference', 'damageDescription', 'deliveryAddress']
      : ['orderReference', 'damageDescription'],
  );
  return data.success && approvedFields.success
    ? { data: data.data, approvedFields: approvedFields.data }
    : undefined;
}
