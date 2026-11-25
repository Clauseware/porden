import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, bigint, check, index } from 'drizzle-orm/pg-core';
import type {
  DamageData,
  TransferStatus,
  VerifiedReceipt,
  ApproveTransfer,
  DeliveryGovernance,
} from '@porden/contracts';
import type { z } from 'zod';

export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').primaryKey(),
    customerId: text('customer_id').notNull(),
    senderOrg: text('sender_org').notNull(),
    recipientOrigin: text('recipient_origin').notNull(),
    caseType: text('case_type').$type<'delivery_damage'>().notNull(),
    draftData: jsonb('draft_data').$type<DamageData>().notNull(),
    governance: jsonb('governance').$type<z.infer<typeof DeliveryGovernance>>(),
    approvedData: jsonb('approved_data').$type<DamageData>(),
    status: text('status').$type<TransferStatus>().notNull().default('draft'),
    approvedFields: text('approved_fields')
      .array()
      .$type<ApproveTransfer['approvedFields']>()
      .notNull()
      .default(sql`'{}'::text[]`),
    payloadSha256: text('payload_sha256'),
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    consentExpiresAt: timestamp('consent_expires_at', { withTimezone: true }),
    receiverCaseId: text('receiver_case_id'),
    receiverReceiptId: uuid('receiver_receipt_id'),
    verifiedReceipt: jsonb('verified_receipt').$type<VerifiedReceipt>(),
    signedReceipt: text('signed_receipt'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('transfers_case_type_check', sql`${table.caseType} = 'delivery_damage'`),
    check(
      'transfers_status_check',
      sql`${table.status} IN ('draft','approved','submitted','accepted','rejected','cancelled','unknown')`,
    ),
  ],
);
export const transferEvents = pgTable(
  'transfer_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfers.id),
    eventType: text('event_type').notNull(),
    safeMetadata: jsonb('safe_metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('transfer_events_transfer_time_idx').on(table.transferId, table.occurredAt)],
);

// Claims this merchant files for its customers. The platform keeps only a hash of the consented
// details, so the merchant holds the exact consented data here until the case can no longer be
// sent; then the data is cleared and only the record of the claim remains. The row is written
// before the platform call, keyed by its request ID, so an uncertain filing that later reconciles
// still has its consent. `handoff_id` is set once the platform's claim is known.
export const merchantClaims = pgTable(
  'merchant_claims',
  {
    requestId: uuid('request_id').primaryKey(),
    handoffId: uuid('handoff_id').unique(),
    // Hash of the filing request without its ID: a replay with different content is a conflict.
    requestSha256: text('request_sha256').notNull(),
    customerId: text('customer_id').notNull(),
    orderReference: text('order_reference').notNull(),
    consentData: jsonb('consent_data').$type<DamageData>(),
    approvedFields: text('approved_fields').array().$type<ApproveTransfer['approvedFields']>(),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
    consentClearedAt: timestamp('consent_cleared_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'merchant_claims_consent_check',
      sql`(${table.consentData} IS NULL) = (${table.approvedFields} IS NULL) AND (${table.consentData} IS NULL) = (${table.consentClearedAt} IS NOT NULL)`,
    ),
    // Consent is only cleared for a claim that exists on the platform.
    check(
      'merchant_claims_cleared_check',
      sql`${table.consentClearedAt} IS NULL OR ${table.handoffId} IS NOT NULL`,
    ),
    index('merchant_claims_customer_filed_idx').on(table.customerId, table.filedAt),
  ],
);
