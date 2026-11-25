import { z } from 'zod';
import { HandoffDetail, HandoffStatus, HandoffSummary } from './handoffs';

// Damaged-parcel claims are an integration example built on the generic handoff lifecycle.
// Other integrations define their own parameter schemas the same way without changing Porden core.
const Currency = z.string().regex(/^[A-Z]{3}$/);
const AmountMinor = z.number().int().min(0).max(100_000_000);
export const ParcelClass = z.enum(['standard', 'fragile', 'electronics']);
export const Resolution = z.discriminatedUnion('remedy', [
  z.strictObject({remedy: z.literal('full_refund'), amountMinor: AmountMinor, currency: Currency}),
  z.strictObject({remedy: z.literal('partial_refund'), amountMinor: AmountMinor, currency: Currency}),
  z.strictObject({remedy: z.literal('reship')}),
]);
export type Resolution = z.infer<typeof Resolution>;
export const ClaimFacts = z.strictObject({
  orderReference: z.string().trim().min(1).max(100),
  parcelClass: ParcelClass,
  declaredValueMinor: AmountMinor,
  currency: Currency,
  photoProvided: z.boolean(),
});
export type ClaimFacts = z.infer<typeof ClaimFacts>;
/** The negotiated object. Its canonical form is carried in the handoff terms of every version. */
export const ClaimParameters = z.strictObject({claim: ClaimFacts, resolution: Resolution});
export type ClaimParameters = z.infer<typeof ClaimParameters>;

/** Courier-owned policy. It is published for transparency; the courier server enforces it. */
export const ClaimPolicy = z.strictObject({
  id: z.string(),
  currency: Currency,
  maxRefundMinor: z.strictObject({standard: AmountMinor, fragile: AmountMinor, electronics: AmountMinor}),
  photoRequiredAboveMinor: AmountMinor,
  reshipClasses: z.array(ParcelClass),
});
export type ClaimPolicy = z.infer<typeof ClaimPolicy>;
export const MissingInformation = z.enum(['photo_of_damage']);
export const ClaimFinding = z.enum([
  'WITHIN_POLICY', 'PHOTO_REQUIRED', 'REFUND_EXCEEDS_COVER', 'CURRENCY_NOT_SUPPORTED', 'RESHIP_NOT_AVAILABLE',
]);
export const AllowedDecision = z.discriminatedUnion('decision', [
  z.strictObject({decision: z.literal('accept')}),
  z.strictObject({decision: z.literal('clarify'), missingInformation: z.array(MissingInformation).min(1)}),
  z.strictObject({decision: z.literal('counter'), resolution: Resolution}),
  z.strictObject({decision: z.literal('reject')}),
]);
export type AllowedDecision = z.infer<typeof AllowedDecision>;
export const ClaimEvaluation = z.strictObject({
  handoffId: z.uuid(), version: z.number().int().positive(), policyId: z.string(),
  parameters: ClaimParameters, findings: z.array(ClaimFinding).min(1), allowed: z.array(AllowedDecision).min(1),
});
export type ClaimEvaluation = z.infer<typeof ClaimEvaluation>;

/** Merchant order record. Facts come from the merchant's system, never from the customer or model. */
export const OrderFacts = ClaimFacts.omit({photoProvided: true}).extend({description: z.string()});
export type OrderFacts = z.infer<typeof OrderFacts>;
/** What the customer asks for; the merchant server prices it from the order record. */
export const RequestedResolution = z.discriminatedUnion('remedy', [
  z.strictObject({remedy: z.literal('full_refund')}),
  z.strictObject({remedy: z.literal('partial_refund'), amountMinor: AmountMinor.min(1)}),
  z.strictObject({remedy: z.literal('reship')}),
]);
/** Merchant boundary: the signed-in customer consents to the listed fields and files the claim. */
export const FileClaim = z.strictObject({
  requestId: z.uuid(),
  data: z.strictObject({
    orderReference: z.literal('DEMO-1042'),
    damageDescription: z.string().trim().min(8).max(500),
    deliveryAddress: z.string().trim().min(5).max(250).optional(),
  }),
  approvedFields: z.array(z.enum(['orderReference', 'damageDescription', 'deliveryAddress'])).min(2).max(3),
  photoProvided: z.boolean(),
  requestedResolution: RequestedResolution,
});
export type FileClaim = z.infer<typeof FileClaim>;
/** The exact details the customer consented to share, held by the merchant until the case is sent. */
export const ClaimConsent = z.strictObject({data: FileClaim.shape.data, approvedFields: FileClaim.shape.approvedFields});
export type ClaimConsent = z.infer<typeof ClaimConsent>;
/** `consent` is null once the case was sent or the claim closed: the details are no longer kept. */
export const ClaimConsentResponse = z.strictObject({consent: ClaimConsent.nullable()});
/** The signed-in customer's own claims, newest first. Status is read per claim. */
export const MerchantClaimList = z.strictObject({
  items: z.array(z.strictObject({handoffId: z.uuid(), orderReference: z.string(), filedAt: z.iso.datetime()})),
});
export type MerchantClaimList = z.infer<typeof MerchantClaimList>;
export const ResolveClaimClarification = z.strictObject({
  requestId: z.uuid(), version: z.number().int().positive(), clarificationId: z.uuid(),
  response: z.string().trim().min(1).max(4000),
});
export type ResolveClaimClarification = z.infer<typeof ResolveClaimClarification>;

/** Courier boundary: the agent proposes one decision; the server checks it against the evaluation. */
const DecisionBase = z.strictObject({
  requestId: z.uuid(), version: z.number().int().positive(), reason: z.string().trim().min(1).max(2000),
});
export const CourierClaimDecision = z.discriminatedUnion('decision', [
  DecisionBase.extend({decision: z.literal('accept')}),
  DecisionBase.extend({decision: z.literal('reject')}),
  DecisionBase.extend({decision: z.literal('clarify'), missingInformation: z.array(MissingInformation).min(1)}),
  DecisionBase.extend({decision: z.literal('counter'), remedy: z.enum(['partial_refund', 'reship'])}),
  DecisionBase.extend({decision: z.literal('complete')}),
]);
export type CourierClaimDecision = z.infer<typeof CourierClaimDecision>;

export const ClaimVersion = z.strictObject({version: z.number().int().positive(), parameters: ClaimParameters});
export const ClaimView = z.strictObject({
  handoff: HandoffDetail,
  versions: z.array(ClaimVersion),
  current: ClaimParameters,
});
export type ClaimView = z.infer<typeof ClaimView>;

/** What the courier desk should do next; derived on the server from persisted handoff state. */
export const ClaimStage = z.enum([
  'review', 'waiting_for_customer', 'waiting_for_merchant_approval', 'waiting_for_execution',
  'execution_unresolved', 'ready_to_complete', 'closed',
]);
export type ClaimStage = z.infer<typeof ClaimStage>;
export const ClaimInboxItem = z.strictObject({
  handoff: HandoffSummary, stage: ClaimStage, current: ClaimParameters,
  openClarifications: z.number().int().min(0),
});
export const ClaimInboxQuery = z.strictObject({
  status: HandoffStatus.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
/** `items` holds claims only; `scanned` counts received handoffs read for this page. */
export const ClaimInbox = z.strictObject({
  items: z.array(ClaimInboxItem), page: z.number().int(), limit: z.number().int(), scanned: z.number().int(),
  totalReceived: z.number().int(),
});
export type ClaimInbox = z.infer<typeof ClaimInbox>;
export const ExecutionRecovery = z.strictObject({
  handoffId: z.uuid(),
  recovered: z.array(z.strictObject({
    executionId: z.uuid(), outcome: z.enum(['completed', 'failed']), caseId: z.string().optional(),
  })),
});
