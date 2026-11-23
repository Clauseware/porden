import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, bigint, check, index } from 'drizzle-orm/pg-core';
import type {
  DamageData,
  TransferStatus,
  VerifiedReceipt,
  ApproveTransfer,
} from '@porden/contracts';

export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').primaryKey(),
    customerId: text('customer_id').notNull(),
    senderOrg: text('sender_org').notNull(),
    recipientOrigin: text('recipient_origin').notNull(),
    caseType: text('case_type').$type<'delivery_damage'>().notNull(),
    draftData: jsonb('draft_data').$type<DamageData>().notNull(),
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
