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
export const TransferReview = CreateDraft;
export type TransferReview = z.infer<typeof TransferReview>;
export const ReceiptSubmission = z.strictObject({receipt: z.string().max(16384), requestId: z.string().min(1).max(500)});
export type ReceiptSubmission = z.infer<typeof ReceiptSubmission>;
export const OutcomeUpdate = z.strictObject({status: z.enum(['cancelled', 'unknown'])});
export const SignIn = z.strictObject({password: z.string().min(1).max(256)});
export const PublicConfig = z.strictObject({openrouterConfigured: z.boolean(), openrouterModel: z.string(), recipientOrigin: Origin});
export const ReceivedCase = CaseResponse.extend({data: DamageData, receivedAt: z.iso.datetime(), status: z.literal('accepted')});
export type CreateDraft = z.infer<typeof CreateDraft>;
export type ApproveTransfer = z.infer<typeof ApproveTransfer>;
export type CreateCase = z.infer<typeof CreateCase>;
export type ReceivedCase = z.infer<typeof ReceivedCase>;
export type PublicConfig = z.infer<typeof PublicConfig>;
export type DamageData = z.infer<typeof DamageData>;
export type Draft = z.infer<typeof Draft>;
export type ActionArguments = z.infer<typeof ActionArguments>;
export type ReceiptClaims = z.infer<typeof ReceiptClaims>;
export type ApprovalClaims = z.infer<typeof ApprovalClaims>;
export type VerifiedReceipt = z.infer<typeof VerifiedReceipt>;
export type TransferStatus = z.infer<typeof TransferStatus>;
export const TransferOutcome = z.discriminatedUnion('status', [
  z.strictObject({status: z.literal('accepted'), transferId: z.uuid(), receipt: VerifiedReceipt}),
  z.strictObject({status: z.literal('rejected'), transferId: z.uuid(), reasonCode: z.string()}),
  z.strictObject({status: z.literal('unknown'), transferId: z.uuid(), reasonCode: z.string()}),
  z.strictObject({status: z.literal('cancelled'), transferId: z.uuid()}),
]);
export type TransferOutcome = z.infer<typeof TransferOutcome>;
export type EventName = 'draft_created' | 'recipient_discovered' | 'consent_required' | 'consent_approved' |
  'delegating' | 'receiver_confirmation_required' | 'submitted' | 'receipt_verified' | 'rejected' | 'cancelled' | 'outcome_unknown';
export type PordenEvent = {type: EventName; transferId: string};
export const Session = z.strictObject({customerId: z.literal('demo-user'), csrf: z.string().min(1)});
export const ErrorResponse = z.object({error:z.object({code:z.string().min(1),message:z.string().optional(),requestId:z.uuid().optional()})});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
export const errorMessages: Record<string,string> = {
  INVALID_INPUT:'Check the supplied details and try again.', INVALID_RESPONSE:'The service returned an invalid response. Check the transfer before trying again.',
  NETWORK_ERROR:'Could not reach the service. Check your connection and the existing transfer before trying again.',
  UNAUTHORIZED_ACTION:'Sign in again before continuing.', ORIGIN_NOT_ALLOWED:'This site is not allowed to make that request.',
  CSRF_MISMATCH:'Your session has changed. Sign in again before continuing.', REQUEST_CONFLICT:'This transfer has already changed. Check its current status.',
  CONSENT_REQUIRED:'Sharing approval is required or has expired. Review a new transfer.',
  CONSENT_SCOPE_MISMATCH:'The proposed details differ from your approval. The transfer was stopped.',
  RECIPIENT_NOT_ALLOWED:'This recipient is not allowed.', NOT_FOUND:'The requested record was not found.',
  PAYLOAD_TOO_LARGE:'The request is too large. Shorten the case details.', NOT_READY:'The service is not ready. Try again later.',
  DATABASE_UNAVAILABLE:'Case storage is unavailable. Check the transfer before trying again.',
  PROVIDER_NOT_CONFIGURED:'The AI service is not configured. Contact the demo operator.',
  PROVIDER_CONNECTION_FAILED:'The server could not connect to the AI provider. Contact the demo operator.',
  PROVIDER_AUTHENTICATION_FAILED:'The AI provider rejected the server credentials. Contact the demo operator.',
  PROVIDER_CREDITS_EXHAUSTED:'The AI provider account needs attention. Contact the demo operator.',
  PROVIDER_MODEL_UNAVAILABLE:'The configured AI model is unavailable. Contact the demo operator.',
  PROVIDER_REQUEST_REJECTED:'The AI provider rejected this request. Contact the demo operator.',
  PROVIDER_RATE_LIMITED:'The AI provider is busy. Try again later; do not resubmit an uncertain transfer.',
  PROVIDER_TIMEOUT:'The AI provider timed out. Check the existing transfer before trying again.',
  PROVIDER_UNAVAILABLE:'The AI provider is unavailable. Try again later.',
  RECIPIENT_UNAVAILABLE:'The courier could not be reached. Check the receipt again later; no new case was submitted.',
  SIGNATURE_INVALID:'The signed approval or receipt could not be verified.', RECEIPT_INVALID:'The courier receipt does not match this transfer.',
  MODEL_REQUIRED:'The demo needs an AI model configured before sharing.', CONFIG_UNAVAILABLE:'The service configuration is unavailable. Reload the page later.',
  INVALID_PROPOSAL:'The courier did not return a valid proposal. No case was confirmed.',
  DELEGATION_FAILED:'The courier handoff could not be completed. No case was confirmed.',
  HANDOFF_FAILED:'The handoff could not be completed. Check the existing transfer before trying again.',
  INTERNAL_ERROR:'The service could not complete the request. Check the transfer before trying again.',
  HTTP_ERROR:'The service could not complete the request. Check the transfer before trying again.',
};

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
