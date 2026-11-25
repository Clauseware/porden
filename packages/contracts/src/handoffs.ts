import { z } from 'zod';

const EvidenceUrl = z
  .url()
  .max(2048)
  .refine((value) => ['https:', 'http:'].includes(new URL(value).protocol), 'Expected an HTTP(S) source URL');
const EvidenceSource = z.strictObject({
  url: EvidenceUrl,
  locator: z.string().max(500).optional(),
  excerpt: z.string().max(4000).optional(),
});
const LegacyEvidenceReference = z.strictObject({
  claim: z.string().trim().min(1).max(1000),
  source: EvidenceSource,
});
const ContextEvidenceReference = z
  .strictObject({
    claim: z.string().trim().min(1).max(1000).optional(),
    sourceUrl: EvidenceUrl.optional(),
    excerpt: z.string().max(4000).optional(),
    locator: z.string().max(500).optional(),
  })
  .refine((value) => value.claim || value.sourceUrl || value.excerpt, 'Evidence needs a claim, source URL, or excerpt');
export const EvidenceReference = z.union([LegacyEvidenceReference, ContextEvidenceReference]);
export const HandoffContext = z.strictObject({
  completedWork: z.array(z.string().max(1000)).max(30).optional(),
  remainingWork: z.array(z.string().max(1000)).max(30).optional(),
  openQuestions: z.array(z.string().max(1000)).max(30).optional(),
  nextStep: z.string().trim().min(1).max(1000).optional(),
  evidence: z.array(EvidenceReference).max(20).optional(),
});
export type HandoffContext = z.infer<typeof HandoffContext>;
export const ExecutionScope = z.strictObject({
  action: z.string().trim().min(1).max(200),
  parametersSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const TaskTerms = z.strictObject({
  goal: z.string().trim().min(1).max(2000),
  constraints: z.array(z.string().trim().min(1).max(1000)).max(30),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  executionScopes: z.array(ExecutionScope).min(1).max(30).optional(),
  budget: z.strictObject({amountMinor: z.number().int().min(0).max(1_000_000_000_000), currency: z.string().regex(/^[A-Z]{3}$/)}).optional(),
  ...HandoffContext.shape,
});
export type TaskTerms = z.infer<typeof TaskTerms>;
export const Principal = z.strictObject({
  id: z.uuid(), organizationId: z.uuid(), name: z.string(),
  kind: z.enum(['human', 'integration']), role: z.enum(['member', 'approver']),
});
export type Principal = z.infer<typeof Principal>;
export const Organization = z.strictObject({id: z.uuid(), name: z.string()});
export const HandoffStatus = z.enum(['draft', 'approved', 'accepted', 'rejected', 'cancelled', 'awaiting_approval', 'completed', 'failed']);
export const RequestKey = z.strictObject({requestId: z.uuid()});
export const CreateHandoff = RequestKey.extend({
  receiverOrganizationId: z.uuid(), terms: TaskTerms,
  workflowId: z.uuid().optional(), previousHandoffId: z.uuid().optional(),
});
export const VersionCommand = RequestKey.extend({version: z.number().int().positive()});
export const ProposeRevision = VersionCommand.extend({terms: TaskTerms, reason: z.string().trim().min(1).max(2000)});
export const RevisionDecision = VersionCommand.extend({decision: z.enum(['approved', 'rejected'])});
export const CriterionResult = z.strictObject({
  criterionIndex: z.number().int().min(0).max(29), met: z.boolean(),
  reason: z.string().trim().min(1).max(2000).optional(),
}).refine(value => value.met || Boolean(value.reason), 'Unmet criteria require a reason');
export const FinishHandoff = VersionCommand.extend({
  status: z.enum(['completed', 'failed']), note: z.string().trim().min(1).max(2000),
  criterionResults: z.array(CriterionResult).min(1).max(30),
});
export const RequestClarification = VersionCommand.extend({
  missingInformation: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  reason: z.string().trim().min(1).max(2000),
});
export const ResolveClarification = VersionCommand.extend({
  clarificationId: z.uuid(), response: z.string().trim().min(1).max(4000),
});
export const VerifyAuthorization = ExecutionScope.extend({version: z.number().int().positive()});
export const ReserveExecution = VerifyAuthorization.extend({ ...RequestKey.shape, operationReference: z.string().trim().min(1).max(500) });
export const SettleExecution = VersionCommand.extend({
  executionId: z.uuid(), outcome: z.enum(['completed', 'failed']),
  resultReference: z.string().trim().min(1).max(2000),
});
export const Clarification = z.strictObject({
  id: z.uuid(), version: z.number().int().positive(),
  missingInformation: RequestClarification.shape.missingInformation,
  reason: RequestClarification.shape.reason,
  response: ResolveClarification.shape.response.optional(),
});
export const Execution = ExecutionScope.extend({
  id: z.uuid(), version: z.number().int().positive(), principalId: z.uuid(),
  operationReference: ReserveExecution.shape.operationReference,
  status: z.enum(['reserved', 'completed', 'failed']), resultReference: z.string().optional(),
});
export const HandoffEvent = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('clarification_requested'), clarification: Clarification}),
  z.strictObject({type: z.literal('clarification_resolved'), clarificationId: z.uuid(), response: ResolveClarification.shape.response}),
  z.strictObject({type: z.literal('execution_reserved'), execution: Execution}),
  z.strictObject({type: z.literal('execution_settled'), executionId: z.uuid(), outcome: SettleExecution.shape.outcome, resultReference: SettleExecution.shape.resultReference}),
  z.strictObject({type: z.literal('completion'), criterionResults: FinishHandoff.shape.criterionResults}),
]);
export const HandoffQuery = z.strictObject({
  status: HandoffStatus.optional(), direction: z.enum(['sent', 'received']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const HandoffParams = z.strictObject({id: z.uuid()});
export const RevisionParams = HandoffParams.extend({revisionId: z.uuid()});
export const AuthorizationQuery = z.strictObject({version: z.coerce.number().int().positive()});
export const PlatformSignIn = z.strictObject({login: z.string().trim().min(1).max(200), password: z.string().min(1).max(256)});
export const PlatformSession = z.strictObject({principal: Principal, csrf: z.string().min(1)});
export const HandoffVersion = z.strictObject({
  version: z.number().int().positive(), terms: TaskTerms, termsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdBy: z.uuid(), createdAt: z.iso.datetime(),
});
export const HandoffRevision = z.strictObject({
  id: z.uuid(), baseVersion: z.number().int().positive(), proposedVersion: z.number().int().positive(),
  reason: z.string(), proposerId: z.uuid(), status: z.enum(['pending', 'approved', 'rejected']),
  decidedBy: z.uuid().nullable(), createdAt: z.iso.datetime(), decidedAt: z.iso.datetime().nullable(),
});
export const HandoffReceiptClaims = z.strictObject({
  receiptId: z.uuid(), handoffId: z.uuid(), workflowId: z.uuid(),
  principalId: z.uuid(), organizationId: z.uuid(), principalKind: Principal.shape.kind,
  requestId: z.uuid(), action: z.string(), version: z.number().int().positive(),
  termsSha256: z.string().regex(/^[a-f0-9]{64}$/), occurredAt: z.iso.datetime(),
  note: z.string().optional(),
  event: HandoffEvent.optional(),
});
export const HandoffReceipt = HandoffReceiptClaims.extend({signedReceipt: z.string().min(1)});
export type HandoffReceiptClaims = z.infer<typeof HandoffReceiptClaims>;
export const HandoffSummary = z.strictObject({
  id: z.uuid(), senderOrganizationId: z.uuid(), receiverOrganizationId: z.uuid(),
  senderName: z.string(), receiverName: z.string(), goal: z.string(), status: HandoffStatus,
  currentVersion: z.number().int().positive(), approvedVersion: z.number().int().positive().nullable(),
  acceptedVersion: z.number().int().positive().nullable(), pendingRevisionId: z.uuid().nullable(),
  workflowId: z.uuid(), previousHandoffId: z.uuid().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const HandoffDetail = HandoffSummary.extend({
  versions: z.array(HandoffVersion), revisions: z.array(HandoffRevision), receipts: z.array(HandoffReceipt),
  clarifications: z.array(Clarification), executions: z.array(Execution),
});
export type HandoffDetail = z.infer<typeof HandoffDetail>;
export const HandoffList = z.strictObject({items: z.array(HandoffSummary), page: z.number().int(), limit: z.number().int(), total: z.number().int()});
export const HandoffMutation = z.strictObject({handoff: HandoffDetail, receipt: HandoffReceipt});
export const HandoffAuthorization = z.strictObject({
  handoffId: z.uuid(), version: z.number().int(), eligible: z.boolean(),
  status: HandoffStatus, reasonCode: z.enum(['AUTHORIZED', 'STALE_VERSION', 'AWAITING_APPROVAL', 'ACCEPTANCE_REQUIRED', 'TERMINAL_STATE', 'CLARIFICATION_REQUIRED', 'SCOPE_MISMATCH', 'EXECUTION_RESERVED', 'EXECUTION_ALREADY_COMPLETED']),
  termsSha256: z.string(),
});
export const WorkflowHistory = z.strictObject({items: z.array(HandoffDetail)});
export const PendingApprovals = z.strictObject({items: z.array(HandoffDetail)});
