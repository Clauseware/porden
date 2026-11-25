import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  check,
  unique,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import type { TaskTerms, Principal, HandoffReceiptClaims } from '@porden/contracts';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  humanApprovalRequired: boolean('human_approval_required').notNull().default(true),
});
export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    login: text('login').notNull().unique(),
    kind: text('kind').$type<Principal['kind']>().notNull(),
    role: text('role').$type<Principal['role']>().notNull(),
    secretHash: text('secret_hash').notNull(),
    active: integer('active').notNull().default(1),
  },
  (table) => [
    check('principal_kind', sql`${table.kind} IN ('human','integration')`),
    check('principal_role', sql`${table.role} IN ('member','approver')`),
    check('principal_approver_kind', sql`${table.kind} = 'human' OR ${table.role} = 'member'`),
  ],
);
export const platformSessions = pgTable('platform_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  principalId: uuid('principal_id')
    .notNull()
    .references(() => principals.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const handoffs = pgTable(
  'handoffs',
  {
    id: uuid('id').primaryKey(),
    senderOrganizationId: uuid('sender_organization_id')
      .notNull()
      .references(() => organizations.id),
    receiverOrganizationId: uuid('receiver_organization_id')
      .notNull()
      .references(() => organizations.id),
    status: text('status')
      .$type<
        | 'draft'
        | 'approved'
        | 'accepted'
        | 'rejected'
        | 'cancelled'
        | 'awaiting_approval'
        | 'completed'
        | 'failed'
      >()
      .notNull(),
    currentVersion: integer('current_version').notNull(),
    approvedVersion: integer('approved_version'),
    acceptedVersion: integer('accepted_version'),
    pendingRevisionId: uuid('pending_revision_id'),
    workflowId: uuid('workflow_id').notNull(),
    previousHandoffId: uuid('previous_handoff_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'handoff_participants',
      sql`${table.senderOrganizationId} <> ${table.receiverOrganizationId}`,
    ),
    check(
      'handoff_status',
      sql`${table.status} IN ('draft','approved','accepted','rejected','cancelled','awaiting_approval','completed','failed')`,
    ),
    check(
      'handoff_version',
      sql`${table.currentVersion} > 0 AND (${table.approvedVersion} IS NULL OR ${table.approvedVersion} = ${table.currentVersion}) AND (${table.acceptedVersion} IS NULL OR (${table.approvedVersion} IS NOT NULL AND ${table.acceptedVersion} = ${table.approvedVersion}))`,
    ),
    check(
      'handoff_pending',
      sql`(${table.status} = 'awaiting_approval') = (${table.pendingRevisionId} IS NOT NULL)`,
    ),
    index('handoff_workflow_idx').on(table.workflowId, table.createdAt),
    index('handoff_sender_idx').on(table.senderOrganizationId, table.createdAt),
    index('handoff_receiver_idx').on(table.receiverOrganizationId, table.createdAt),
  ],
);
export const handoffVersions = pgTable(
  'handoff_versions',
  {
    handoffId: uuid('handoff_id')
      .notNull()
      .references(() => handoffs.id),
    version: integer('version').notNull(),
    terms: jsonb('terms').$type<TaskTerms>().notNull(),
    termsSha256: text('terms_sha256').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.handoffId, table.version] })],
);
export const handoffRevisions = pgTable(
  'handoff_revisions',
  {
    id: uuid('id').primaryKey(),
    handoffId: uuid('handoff_id')
      .notNull()
      .references(() => handoffs.id),
    baseVersion: integer('base_version').notNull(),
    proposedVersion: integer('proposed_version').notNull(),
    baseStatus: text('base_status').$type<'approved' | 'accepted'>().notNull(),
    reason: text('reason').notNull(),
    proposerId: uuid('proposer_id')
      .notNull()
      .references(() => principals.id),
    status: text('status').$type<'pending' | 'approved' | 'rejected'>().notNull(),
    decidedBy: uuid('decided_by').references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    unique('revision_version_unique').on(table.handoffId, table.proposedVersion),
    check('revision_status', sql`${table.status} IN ('pending','approved','rejected')`),
  ],
);
export const handoffReceipts = pgTable(
  'handoff_receipts',
  {
    id: uuid('id').primaryKey(),
    handoffId: uuid('handoff_id')
      .notNull()
      .references(() => handoffs.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    requestId: uuid('request_id').notNull(),
    requestSha256: text('request_sha256').notNull(),
    claims: jsonb('claims').$type<HandoffReceiptClaims>().notNull(),
    signedReceipt: text('signed_receipt').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('receipt_request_unique').on(table.principalId, table.requestId),
    index('receipt_handoff_idx').on(table.handoffId, table.occurredAt),
  ],
);
