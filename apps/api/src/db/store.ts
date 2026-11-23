import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  type Draft,
  type DamageData,
  type ReceiptClaims,
  type VerifiedReceipt,
  type CreateDraft,
  type ApproveTransfer,
  type CreateCase,
} from '@porden/contracts';
import { ApiError, hash, type signer } from '../security';
import type { Config } from '../config';
import { transfers, transferEvents } from './merchant-schema';
import { cases, receipts, shipments } from './courier-schema';
import { migrationMetadata } from './metadata';

export function store(client: SQL, config: Config, signing: ReturnType<typeof signer>) {
  const db = drizzle(client);
  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  async function owned(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.id, id), eq(transfers.customerId, 'demo-user')))
      .for('update');
    if (!row) throw new ApiError('NOT_FOUND', 404);
    return row;
  }
  function draft(row: typeof transfers.$inferSelect): Draft {
    return {
      id: row.id,
      recipientOrigin: row.recipientOrigin,
      caseType: row.caseType,
      data: row.draftData,
      status: row.status,
      approvedFields: row.approvedFields,
      receipt: row.verifiedReceipt,
      createdAt: row.createdAt.toISOString(),
    };
  }
  function caseResponse(
    row: { case: typeof cases.$inferSelect; receipt: typeof receipts.$inferSelect },
    idempotent: boolean,
  ) {
    return {
      caseId: row.case.publicCaseId,
      receiptId: row.receipt.id,
      receipt: row.receipt.signedJws,
      requestId: row.case.requestId,
      transferId: row.case.transferId,
      idempotent,
    };
  }
  return {
    async ready() {
      const [row] = await db
        .select()
        .from(migrationMetadata)
        .where(eq(migrationMetadata.version, '0001'));
      if (row?.role !== config.role) throw Error('Database role or migration mismatch');
    },
    async createDraft(input: CreateDraft) {
      const [row] = await db
        .insert(transfers)
        .values({
          id: randomUUID(),
          customerId: 'demo-user',
          senderOrg: config.origin,
          recipientOrigin: input.recipientOrigin,
          caseType: input.caseType,
          draftData: input.data,
        })
        .returning();
      return draft(row);
    },
    async getDraft(id: string) {
      const [row] = await db
        .select()
        .from(transfers)
        .where(and(eq(transfers.id, id), eq(transfers.customerId, 'demo-user')));
      if (!row) throw new ApiError('NOT_FOUND', 404);
      return draft(row);
    },
    async approve(id: string, fields: ApproveTransfer['approvedFields']) {
      return db.transaction(async (tx) => {
        const row = await owned(tx, id);
        if (row.status !== 'draft') throw new ApiError('REQUEST_CONFLICT', 409);
        if (fields.includes('deliveryAddress') && row.draftData.deliveryAddress === undefined)
          throw new ApiError('CONSENT_SCOPE_MISMATCH', 400);
        const data: DamageData = {
          orderReference: row.draftData.orderReference,
          damageDescription: row.draftData.damageDescription,
          ...(fields.includes('deliveryAddress')
            ? { deliveryAddress: row.draftData.deliveryAddress }
            : {}),
        };
        const payloadSha256 = hash(data),
          expiresAt = Date.now() + 10 * 60 * 1000;
        const approval = signing.sign(
          {
            issuer: config.origin,
            audience: row.recipientOrigin,
            transferId: id,
            subject: 'demo-user',
            caseType: row.caseType,
            payloadSha256,
            approvedFields: fields,
            expiresAt,
          },
          'porden-approval+jwt',
        );
        await tx
          .update(transfers)
          .set({
            status: 'approved',
            approvedData: data,
            approvedFields: fields,
            payloadSha256,
            consentedAt: new Date(),
            consentExpiresAt: new Date(expiresAt),
            updatedAt: new Date(),
          })
          .where(eq(transfers.id, id));
        await tx.insert(transferEvents).values({ transferId: id, eventType: 'consent_approved' });
        return {
          arguments: { transferId: id, caseType: row.caseType, data, approval },
          expiresAt: new Date(expiresAt).toISOString(),
        };
      });
    },
    async transition(id: string, next: 'submitted' | 'cancelled' | 'unknown') {
      return db.transaction(async (tx) => {
        const row = await owned(tx, id);
        const allowed =
          next === 'submitted'
            ? ['approved']
            : next === 'cancelled'
              ? ['draft', 'approved', 'submitted']
              : ['submitted', 'unknown'];
        if (!allowed.includes(row.status)) throw new ApiError('REQUEST_CONFLICT', 409);
        if (
          next === 'submitted' &&
          (!row.consentExpiresAt || row.consentExpiresAt.getTime() <= Date.now())
        )
          throw new ApiError('CONSENT_REQUIRED', 403);
        const [updated] = await tx
          .update(transfers)
          .set({ status: next, updatedAt: new Date() })
          .where(eq(transfers.id, id))
          .returning();
        await tx.insert(transferEvents).values({ transferId: id, eventType: next });
        return draft(updated);
      });
    },
    async accept(id: string, claims: ReceiptClaims, token: string): Promise<VerifiedReceipt> {
      return db.transaction(async (tx) => {
        const row = await owned(tx, id);
        if (row.status === 'accepted') {
          if (row.signedReceipt !== token || !row.verifiedReceipt)
            throw new ApiError('REQUEST_CONFLICT', 409);
          return row.verifiedReceipt;
        }
        if (
          !['submitted', 'unknown'].includes(row.status) ||
          claims.transferId !== id ||
          claims.issuer !== row.recipientOrigin ||
          claims.audience !== config.origin ||
          claims.caseType !== row.caseType ||
          claims.payloadSha256 !== row.payloadSha256 ||
          hash([...claims.approvedFields].sort()) !== hash([...row.approvedFields].sort())
        )
          throw new ApiError('RECEIPT_INVALID', 403);
        const receipt: VerifiedReceipt = {
          issuer: claims.issuer,
          receiptId: claims.receiptId,
          receiverCaseId: claims.caseId,
          requestId: claims.requestId,
          receivedAt: claims.receivedAt,
          verification: 'valid',
        };
        await tx
          .update(transfers)
          .set({
            status: 'accepted',
            receiverCaseId: claims.caseId,
            receiverReceiptId: claims.receiptId,
            verifiedReceipt: receipt,
            signedReceipt: token,
            updatedAt: new Date(),
          })
          .where(eq(transfers.id, id));
        await tx.insert(transferEvents).values({ transferId: id, eventType: 'receipt_verified' });
        return receipt;
      });
    },
    async createCase(args: CreateCase) {
      return db.transaction(async (tx) => {
        // Serialize a transfer across differing runtime request IDs as well as exact replays.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${config.peerOrigin + ':' + args.transferId},0))`,
        );
        const fingerprint = hash({
          transferId: args.transferId,
          requestId: args.requestId,
          caseType: args.caseType,
          data: args.data,
        });
        const existing = await tx
          .select({ case: cases, receipt: receipts })
          .from(cases)
          .innerJoin(receipts, eq(receipts.caseId, cases.id))
          .where(
            and(
              eq(cases.callerOrigin, config.peerOrigin),
              or(eq(cases.requestId, args.requestId), eq(cases.transferId, args.transferId)),
            ),
          );
        if (existing.length) {
          if (existing.length !== 1 || existing[0].case.requestSha256 !== fingerprint)
            throw new ApiError('REQUEST_CONFLICT', 409);
          return caseResponse(existing[0], true);
        }
        const [shipment] = await tx
          .select()
          .from(shipments)
          .where(
            and(
              eq(shipments.orderReference, args.data.orderReference),
              eq(shipments.customerId, 'demo-user'),
            ),
          );
        if (!shipment) throw new ApiError('UNAUTHORIZED_ACTION', 403);
        const id = randomUUID(),
          receiptId = randomUUID(),
          caseId = `COU-${id.toUpperCase()}`,
          receivedAt = new Date().toISOString();
        const receipt = signing.sign(
          {
            issuer: config.origin,
            audience: config.peerOrigin,
            transferId: args.transferId,
            requestId: args.requestId,
            caseId,
            receiptId,
            caseType: args.caseType,
            payloadSha256: hash(args.data),
            approvedFields: Object.keys(args.data),
            status: 'accepted',
            receivedAt,
          },
          'porden-receipt+jwt',
        );
        await tx.insert(cases).values({
          id,
          publicCaseId: caseId,
          customerId: 'demo-user',
          callerOrigin: config.peerOrigin,
          requestId: args.requestId,
          transferId: args.transferId,
          caseType: args.caseType,
          requestSha256: fingerprint,
          caseData: args.data,
        });
        await tx.insert(receipts).values({
          id: receiptId,
          caseId: id,
          issuer: config.origin,
          keyId: config.keyId,
          signedJws: receipt,
        });
        return {
          caseId,
          receiptId,
          receipt,
          requestId: args.requestId,
          transferId: args.transferId,
          idempotent: false,
        };
      });
    },
    async findCase(kind: 'request' | 'transfer', value: string) {
      const [row] = await db
        .select({ case: cases, receipt: receipts })
        .from(cases)
        .innerJoin(receipts, eq(receipts.caseId, cases.id))
        .where(
          and(
            eq(cases.callerOrigin, config.peerOrigin),
            kind === 'request' ? eq(cases.requestId, value) : eq(cases.transferId, value),
          ),
        );
      if (!row) throw new ApiError('NOT_FOUND', 404);
      return caseResponse(row, true);
    },
    async getReceipt(id: string) {
      const [row] = await db
        .select({ case: cases, receipt: receipts })
        .from(cases)
        .innerJoin(receipts, eq(receipts.caseId, cases.id))
        .where(and(eq(receipts.id, id), eq(cases.customerId, 'demo-user')));
      if (!row) throw new ApiError('NOT_FOUND', 404);
      return {
        ...caseResponse(row, true),
        data: row.case.caseData,
        receivedAt: row.receipt.issuedAt.toISOString(),
        status: row.case.status,
      };
    },
  };
}
