import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  type Draft,
  type DamageData,
  type ReceiptClaims,
  type VerifiedReceipt,
  type CreateDraft,
  type ApproveTransfer,
  type CreateCase,
  type DeliveryGovernance,
} from '@porden/contracts';
import type { z } from 'zod';
import type { ClaimConsent, Resolution } from '@porden/contracts/delivery-claims';
import { ApiError } from '../application/errors';
import { hash, type signer, type Fetcher } from '../security';
import { verifyDeliveryConsent } from '../services/delivery-authorization';
import type { Config } from '../config';
import { merchantClaims, transfers, transferEvents } from './merchant-schema';
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
      ...(row.governance ? { governance: row.governance } : {}),
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
  function clearConsent(connection: typeof db | Transaction, handoffId: string) {
    return connection
      .update(merchantClaims)
      .set({ consentData: null, approvedFields: null, consentClearedAt: new Date() })
      .where(
        and(
          eq(merchantClaims.handoffId, handoffId),
          eq(merchantClaims.customerId, 'demo-user'),
          isNotNull(merchantClaims.consentData),
        ),
      );
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
          governance: input.governance,
        })
        .returning();
      return draft(row);
    },
    /**
     * Stores the consent for a filing before the platform is called. An exact replay of a filing
     * that is not linked yet restarts its clock, so the stale-filing sweep can't remove it while
     * the replay is in flight. Any other replay returns the existing record unchanged, so the
     * caller can check it is the same filing.
     */
    async reserveClaim(requestId: string, requestSha256: string, consent: ClaimConsent) {
      await db
        .insert(merchantClaims)
        .values({
          requestId,
          requestSha256,
          customerId: 'demo-user',
          orderReference: consent.data.orderReference,
          consentData: consent.data,
          approvedFields: consent.approvedFields,
        })
        .onConflictDoUpdate({
          target: merchantClaims.requestId,
          set: { filedAt: sql`now()` },
          setWhere: and(
            isNull(merchantClaims.handoffId),
            eq(merchantClaims.requestSha256, requestSha256),
            eq(merchantClaims.customerId, 'demo-user'),
          ),
        });
      const [row] = await db
        .select()
        .from(merchantClaims)
        .where(
          and(eq(merchantClaims.requestId, requestId), eq(merchantClaims.customerId, 'demo-user')),
        );
      return row;
    },
    /** A filing whose platform claim is not known yet. */
    async findPendingClaim(requestId: string) {
      const [row] = await db
        .select()
        .from(merchantClaims)
        .where(
          and(
            eq(merchantClaims.requestId, requestId),
            eq(merchantClaims.customerId, 'demo-user'),
            isNull(merchantClaims.handoffId),
          ),
        );
      return row;
    },
    /** Unlinked filings older than `before`, oldest first, for the stale-filing sweep. */
    async stalePendingClaims(before: Date, limit: number) {
      return db
        .select({ requestId: merchantClaims.requestId })
        .from(merchantClaims)
        .where(
          and(
            eq(merchantClaims.customerId, 'demo-user'),
            isNull(merchantClaims.handoffId),
            lt(merchantClaims.filedAt, before),
          ),
        )
        .orderBy(asc(merchantClaims.filedAt))
        .limit(limit);
    },
    /** Links a filing to its platform claim. Already-linked filings are left as they are. */
    async bindClaim(requestId: string, handoffId: string) {
      await db
        .update(merchantClaims)
        .set({ handoffId })
        .where(
          and(
            eq(merchantClaims.requestId, requestId),
            eq(merchantClaims.customerId, 'demo-user'),
            isNull(merchantClaims.handoffId),
          ),
        );
    },
    /**
     * Removes an unlinked filing the sweep settled. Only a filing still older than the sweep's
     * cutoff is removed: a replay that restarted its clock in the meantime keeps it.
     */
    async discardPendingClaim(requestId: string, filedBefore: Date) {
      await db
        .delete(merchantClaims)
        .where(
          and(
            eq(merchantClaims.requestId, requestId),
            eq(merchantClaims.customerId, 'demo-user'),
            isNull(merchantClaims.handoffId),
            lt(merchantClaims.filedAt, filedBefore),
          ),
        );
    },
    /** The customer's own claim record, or undefined if this customer did not file it here. */
    async findClaim(handoffId: string) {
      const [row] = await db
        .select()
        .from(merchantClaims)
        .where(
          and(eq(merchantClaims.handoffId, handoffId), eq(merchantClaims.customerId, 'demo-user')),
        );
      return row;
    },
    async clearClaimConsent(handoffId: string) {
      await clearConsent(db, handoffId);
    },
    async listClaims(limit: number) {
      return db
        .select({
          handoffId: merchantClaims.handoffId,
          orderReference: merchantClaims.orderReference,
          filedAt: merchantClaims.filedAt,
        })
        .from(merchantClaims)
        .where(and(eq(merchantClaims.customerId, 'demo-user'), isNotNull(merchantClaims.handoffId)))
        .orderBy(desc(merchantClaims.filedAt))
        .limit(limit);
    },
    async getDraft(id: string) {
      const [row] = await db
        .select()
        .from(transfers)
        .where(and(eq(transfers.id, id), eq(transfers.customerId, 'demo-user')));
      if (!row) throw new ApiError('NOT_FOUND', 404);
      return draft(row);
    },
    async approve(id: string, fields: ApproveTransfer['approvedFields'], fetcher: Fetcher = fetch) {
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
        if (row.governance) await verifyDeliveryConsent(config, fetcher, row.governance, data);
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
            ...(row.governance ? { governance: row.governance } : {}),
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
          hash(claims.governance ?? null) !== hash(row.governance ?? null) ||
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
        // The case for this claim is sent: the consented details are no longer needed.
        if (row.governance) await clearConsent(tx, row.governance.handoffId);
        return receipt;
      });
    },
    async createCase(
      args: CreateCase,
      governance?: z.infer<typeof DeliveryGovernance>,
      resolution?: Resolution,
      // Runs under the transfer lock before a new case is inserted; throw to abort without writing.
      beforeInsert?: () => Promise<void>,
    ) {
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
          ...(governance ? { governance } : {}),
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
        if (beforeInsert) await beforeInsert();
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
            ...(governance ? { governance } : {}),
            ...(resolution ? { resolution } : {}),
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
    /**
     * Holds the transfer lock (the same lock a case write takes) while `settle` runs with the
     * committed case, if any. A concurrent write either committed before this read or will see
     * the settled reservation after it and abort, so the two can never disagree.
     */
    async whileTransferLocked<T>(
      transferId: string,
      settle: (committed: ReturnType<typeof caseResponse> | undefined) => Promise<T>,
    ) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${config.peerOrigin + ':' + transferId},0))`,
        );
        const [row] = await tx
          .select({ case: cases, receipt: receipts })
          .from(cases)
          .innerJoin(receipts, eq(receipts.caseId, cases.id))
          .where(and(eq(cases.callerOrigin, config.peerOrigin), eq(cases.transferId, transferId)));
        return settle(row ? caseResponse(row, true) : undefined);
      });
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
