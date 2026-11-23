import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, check, unique } from 'drizzle-orm/pg-core';
import type { DamageData } from '@porden/contracts';

export const shipments = pgTable('shipments', {
  orderReference: text('order_reference').primaryKey(),
  customerId: text('customer_id').notNull(),
});
export const cases = pgTable(
  'cases',
  {
    id: uuid('id').primaryKey(),
    publicCaseId: text('public_case_id').notNull().unique(),
    customerId: text('customer_id').notNull(),
    callerOrigin: text('caller_origin').notNull(),
    requestId: text('request_id').notNull(),
    transferId: uuid('transfer_id').notNull(),
    caseType: text('case_type').$type<'delivery_damage'>().notNull(),
    requestSha256: text('request_sha256').notNull(),
    caseData: jsonb('case_data').$type<DamageData>().notNull(),
    status: text('status').$type<'accepted'>().notNull().default('accepted'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('cases_case_type_check', sql`${table.caseType} = 'delivery_damage'`),
    check('cases_status_check', sql`${table.status} = 'accepted'`),
    unique('cases_caller_origin_request_id_key').on(table.callerOrigin, table.requestId),
    unique('cases_caller_origin_transfer_id_key').on(table.callerOrigin, table.transferId),
  ],
);
export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey(),
  caseId: uuid('case_id')
    .notNull()
    .unique()
    .references(() => cases.id),
  issuer: text('issuer').notNull(),
  keyId: text('key_id').notNull(),
  signedJws: text('signed_jws').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});
