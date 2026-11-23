import { z } from 'zod';

export const Origin = z.url().refine(value => {
  const url = new URL(value);
  return url.origin === value && (url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
}, 'Expected an HTTPS origin or local HTTP origin');
export const DamageData = z.strictObject({
  orderReference: z.literal('DEMO-1042'),
  damageDescription: z.string().trim().min(8).max(500),
  deliveryAddress: z.string().trim().min(5).max(250).optional(),
});
export const Field = z.enum(['orderReference', 'damageDescription', 'deliveryAddress']);
export const Fields = z.array(Field).min(2).max(3).refine(fields =>
  new Set(fields).size === fields.length && fields.includes('orderReference') && fields.includes('damageDescription'));
export const TransferStatus = z.enum(['draft', 'approved', 'submitted', 'accepted', 'rejected', 'cancelled', 'unknown']);
export const CreateDraft = z.strictObject({recipientOrigin: Origin, caseType: z.literal('delivery_damage'), data: DamageData});
export const ApproveTransfer = z.strictObject({approvedFields: Fields});
export const ActionArguments = z.strictObject({
  transferId: z.uuid(), caseType: z.literal('delivery_damage'), data: DamageData,
  approval: z.string().min(1).max(8192),
});
export const CreateCase = ActionArguments.extend({requestId: z.string().min(1).max(500)});
export const ReceiptClaims = z.strictObject({
  issuer: Origin, audience: Origin, transferId: z.uuid(), requestId: z.string().min(1).max(500),
  caseId: z.string().min(1), receiptId: z.uuid(), caseType: z.literal('delivery_damage'),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/), approvedFields: Fields,
  status: z.literal('accepted'), receivedAt: z.iso.datetime(),
});
export const ApprovalClaims = z.strictObject({
  issuer: Origin, audience: Origin, transferId: z.uuid(), subject: z.literal('demo-user'),
  caseType: z.literal('delivery_damage'), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  approvedFields: Fields, expiresAt: z.number().int().positive(),
});
export const CaseResponse = z.strictObject({
  caseId: z.string(), receiptId: z.uuid(), receipt: z.string(), requestId: z.string(),
  transferId: z.uuid(), idempotent: z.boolean(),
});
export const VerifiedReceipt = z.strictObject({
  issuer: Origin, receiptId: z.uuid(), receiverCaseId: z.string(), requestId: z.string(),
  receivedAt: z.iso.datetime(), verification: z.literal('valid'),
});
export const Draft = CreateDraft.extend({id: z.uuid(), status: TransferStatus,
  approvedFields: z.array(Field), receipt: VerifiedReceipt.nullable(), createdAt: z.iso.datetime()});
export const Approval = z.strictObject({arguments: ActionArguments, expiresAt: z.iso.datetime()});
export const ReceiptSubmission = z.strictObject({receipt: z.string().max(16384), requestId: z.string().min(1).max(500)});
export const OutcomeUpdate = z.strictObject({status: z.enum(['cancelled', 'unknown'])});
export type DamageData = z.infer<typeof DamageData>;
export type Draft = z.infer<typeof Draft>;
export type ActionArguments = z.infer<typeof ActionArguments>;
export type ReceiptClaims = z.infer<typeof ReceiptClaims>;
export type ApprovalClaims = z.infer<typeof ApprovalClaims>;
export type VerifiedReceipt = z.infer<typeof VerifiedReceipt>;
export type TransferStatus = z.infer<typeof TransferStatus>;
export type TransferOutcome =
  | {status: 'accepted'; transferId: string; receipt: VerifiedReceipt}
  | {status: 'rejected' | 'unknown'; transferId: string; reasonCode: string}
  | {status: 'cancelled'; transferId: string};
export type EventName = 'draft_created' | 'recipient_discovered' | 'consent_required' | 'consent_approved' |
  'delegating' | 'receiver_confirmation_required' | 'submitted' | 'receipt_verified' | 'rejected' | 'cancelled' | 'outcome_unknown';
export type PordenEvent = {type: EventName; transferId: string};
export const Session = z.strictObject({customerId: z.literal('demo-user'), csrf: z.string().min(1)});

// All protocol payloads are JSON values; sorting keys makes hashes independent of property order.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' +
      canonicalize((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw new Error('Expected a JSON value');
}
export const actionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    transferId: {type: 'string', maxLength: 36}, caseType: {type: 'string', enum: ['delivery_damage']},
    approval: {type: 'string', maxLength: 8192},
    data: {type: 'object', additionalProperties: false, properties: {
      orderReference: {type: 'string', enum: ['DEMO-1042']},
      damageDescription: {type: 'string', minLength: 8, maxLength: 500},
      deliveryAddress: {type: 'string', minLength: 5, maxLength: 250},
    }, required: ['orderReference', 'damageDescription']},
  }, required: ['transferId', 'caseType', 'data', 'approval'],
};
