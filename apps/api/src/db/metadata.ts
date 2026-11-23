import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Preserve the original role/checksum guard when adopting Drizzle migrations.
export const migrationMetadata = pgTable('porden_migrations', {
  version: text('version').primaryKey(),
  role: text('role').notNull(),
  checksum: text('checksum').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});
