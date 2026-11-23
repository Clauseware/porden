import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { and, or, eq, sql, asc, count, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { z } from 'zod';
import type {
  Principal,
  HandoffDetail,
  HandoffReceiptClaims,
  HandoffAuthorization,
  TaskTerms,
} from '@porden/contracts';
import {
  CreateHandoff,
  VersionCommand,
  ProposeRevision,
  RevisionDecision,
  FinishHandoff,
  HandoffQuery,
} from '@porden/contracts';
import { ApiError } from '../application/errors';
import { hash, type signer } from '../security';
import {
  organizations,
  handoffs,
  handoffVersions,
  handoffRevisions,
  handoffReceipts,
} from './platform-schema';

export function platformStore(client: SQL, signing: ReturnType<typeof signer>) {
  const db = drizzle(client);
  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  type Connection = typeof db | Transaction;
  type Row = typeof handoffs.$inferSelect;
  const visible = (principal: Principal) =>
    or(
      eq(handoffs.senderOrganizationId, principal.organizationId),
      eq(handoffs.receiverOrganizationId, principal.organizationId),
    );
  async function owned(connection: Connection, principal: Principal, id: string, lock = false) {
    const query = connection
      .select()
      .from(handoffs)
      .where(and(eq(handoffs.id, id), visible(principal)));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new ApiError('NOT_FOUND', 404);
    return row;
  }
  function requireSender(principal: Principal, row: Row, human = false) {
    if (
      row.senderOrganizationId !== principal.organizationId ||
      (human && (principal.kind !== 'human' || principal.role !== 'approver'))
    )
      throw new ApiError('UNAUTHORIZED_ACTION', 403);
  }
  function requireReceiver(principal: Principal, row: Row) {
    if (row.receiverOrganizationId !== principal.organizationId)
      throw new ApiError('UNAUTHORIZED_ACTION', 403);
  }
  function requireVersion(row: Row, version: number) {
    if (row.currentVersion !== version) throw new ApiError('REQUEST_CONFLICT', 409);
  }
  async function version(connection: Connection, id: string, value: number) {
    const [row] = await connection
      .select()
      .from(handoffVersions)
      .where(and(eq(handoffVersions.handoffId, id), eq(handoffVersions.version, value)));
    if (!row) throw new ApiError('REQUEST_CONFLICT', 409);
    return row;
  }
  async function detail(
    connection: Connection,
    principal: Principal,
    id: string,
  ): Promise<HandoffDetail> {
    const row = await owned(connection, principal, id);
    const versions = await connection
      .select()
      .from(handoffVersions)
      .where(eq(handoffVersions.handoffId, id))
      .orderBy(asc(handoffVersions.version));
    const revisions = await connection
      .select()
      .from(handoffRevisions)
      .where(eq(handoffRevisions.handoffId, id))
      .orderBy(asc(handoffRevisions.proposedVersion));
    const receipts = await connection
      .select()
      .from(handoffReceipts)
      .where(eq(handoffReceipts.handoffId, id))
      .orderBy(asc(handoffReceipts.occurredAt), asc(handoffReceipts.id));
    const participants = await connection
      .select()
      .from(organizations)
      .where(inArray(organizations.id, [row.senderOrganizationId, row.receiverOrganizationId]));
    const current = versions.find((item) => item.version === row.currentVersion);
    if (!current) throw Error('Missing handoff version');
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      goal: current.terms.goal,
      senderName: participants.find((item) => item.id === row.senderOrganizationId)!.name,
      receiverName: participants.find((item) => item.id === row.receiverOrganizationId)!.name,
      versions: versions.map((item) => ({
        version: item.version,
        terms: item.terms,
        termsSha256: item.termsSha256,
        createdBy: item.createdBy,
        createdAt: item.createdAt.toISOString(),
      })),
      revisions: revisions.map((item) => ({
        id: item.id,
        baseVersion: item.baseVersion,
        proposedVersion: item.proposedVersion,
        reason: item.reason,
        proposerId: item.proposerId,
        status: item.status,
        decidedBy: item.decidedBy,
        createdAt: item.createdAt.toISOString(),
        decidedAt: item.decidedAt?.toISOString() || null,
      })),
      receipts: receipts.map((item) => ({ ...item.claims, signedReceipt: item.signedReceipt })),
    };
  }
  async function mutate(
    principal: Principal,
    requestId: string,
    action: string,
    input: unknown,
    change: (tx: Transaction) => Promise<{ row: Row; version: number; note?: string }>,
  ) {
    const fingerprint = hash({ action, input });
    const receipt = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${principal.id + ':' + requestId},0))`,
      );
      const [previous] = await tx
        .select()
        .from(handoffReceipts)
        .where(
          and(
            eq(handoffReceipts.principalId, principal.id),
            eq(handoffReceipts.requestId, requestId),
          ),
        );
      if (previous) {
        if (previous.requestSha256 !== fingerprint) throw new ApiError('REQUEST_CONFLICT', 409);
        await owned(tx, principal, previous.handoffId);
        return { ...previous.claims, signedReceipt: previous.signedReceipt };
      }
      const { row, version: value, note } = await change(tx);
      const terms = await version(tx, row.id, value);
      const claims: HandoffReceiptClaims = {
        receiptId: randomUUID(),
        handoffId: row.id,
        workflowId: row.workflowId,
        principalId: principal.id,
        organizationId: principal.organizationId,
        principalKind: principal.kind,
        requestId,
        action,
        version: value,
        termsSha256: terms.termsSha256,
        occurredAt: new Date().toISOString(),
        ...(note ? { note } : {}),
      };
      const signedReceipt = signing.sign(claims, 'porden-handoff-receipt+jwt');
      await tx.insert(handoffReceipts).values({
        id: claims.receiptId,
        handoffId: row.id,
        principalId: principal.id,
        requestId,
        requestSha256: fingerprint,
        claims,
        signedReceipt,
        occurredAt: new Date(claims.occurredAt),
      });
      return { ...claims, signedReceipt };
    });
    return { handoff: await detail(db, principal, receipt.handoffId), receipt };
  }
  async function update(
    tx: Transaction,
    id: string,
    values: Partial<typeof handoffs.$inferInsert>,
  ) {
    const [row] = await tx
      .update(handoffs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(handoffs.id, id))
      .returning();
    return row;
  }
  async function insertVersion(
    tx: Transaction,
    id: string,
    value: number,
    terms: TaskTerms,
    principal: Principal,
  ) {
    await tx.insert(handoffVersions).values({
      handoffId: id,
      version: value,
      terms,
      termsSha256: hash(terms),
      createdBy: principal.id,
    });
  }
  const api = {
    async ready() {
      await db.select({ id: handoffs.id }).from(handoffs).limit(1);
    },
    async organizations() {
      return db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .orderBy(asc(organizations.name));
    },
    get(principal: Principal, id: string) {
      return db.transaction((tx) => detail(tx, principal, id), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      });
    },
    async list(principal: Principal, input: z.infer<typeof HandoffQuery>) {
      return db.transaction(
        async (tx) => {
          const filter = and(
            visible(principal),
            input.status ? eq(handoffs.status, input.status) : undefined,
            input.direction
              ? eq(
                  input.direction === 'sent'
                    ? handoffs.senderOrganizationId
                    : handoffs.receiverOrganizationId,
                  principal.organizationId,
                )
              : undefined,
          );
          const [{ total }] = await tx.select({ total: count() }).from(handoffs).where(filter);
          const rows = await tx
            .select({ id: handoffs.id })
            .from(handoffs)
            .where(filter)
            .orderBy(asc(handoffs.createdAt), asc(handoffs.id))
            .limit(input.limit)
            .offset((input.page - 1) * input.limit);
          const items = [];
          for (const row of rows) {
            const {
              versions: _versions,
              revisions: _revisions,
              receipts: _receipts,
              ...summary
            } = await detail(tx, principal, row.id);
            items.push(summary);
          }
          return { items, page: input.page, limit: input.limit, total };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    create(principal: Principal, input: z.infer<typeof CreateHandoff>) {
      return mutate(principal, input.requestId, 'created', input, async (tx) => {
        const [sender] = await tx
          .select({ humanApprovalRequired: organizations.humanApprovalRequired })
          .from(organizations)
          .where(eq(organizations.id, principal.organizationId));
        if (!sender) throw new ApiError('UNAUTHORIZED_ACTION', 403);
        const [receiver] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, input.receiverOrganizationId));
        if (!receiver || receiver.id === principal.organizationId)
          throw new ApiError('INVALID_INPUT', 400);
        let workflowId = input.workflowId || randomUUID();
        if (input.previousHandoffId) {
          const previous = await owned(tx, principal, input.previousHandoffId, true);
          if (
            ![previous.senderOrganizationId, previous.receiverOrganizationId].includes(
              receiver.id,
            ) ||
            (input.workflowId && input.workflowId !== previous.workflowId)
          )
            throw new ApiError('REQUEST_CONFLICT', 409);
          workflowId = previous.workflowId;
        } else if (input.workflowId) {
          // Every existing workflow continuation must identify its predecessor.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${'workflow:' + input.workflowId},0))`,
          );
          const [existing] = await tx
            .select({ id: handoffs.id })
            .from(handoffs)
            .where(eq(handoffs.workflowId, input.workflowId))
            .limit(1);
          if (existing) throw new ApiError('INVALID_INPUT', 400);
        }
        const [row] = await tx
          .insert(handoffs)
          .values({
            id: randomUUID(),
            senderOrganizationId: principal.organizationId,
            receiverOrganizationId: receiver.id,
            status: sender.humanApprovalRequired ? 'draft' : 'approved',
            currentVersion: 1,
            approvedVersion: sender.humanApprovalRequired ? null : 1,
            workflowId,
            previousHandoffId: input.previousHandoffId,
          })
          .returning();
        await insertVersion(tx, row.id, 1, input.terms, principal);
        return {
          row,
          version: 1,
          note: sender.humanApprovalRequired
            ? 'Human approval required by sender organization policy'
            : 'Automatically authorized by sender organization policy',
        };
      });
    },
    approve(principal: Principal, id: string, input: z.infer<typeof VersionCommand>) {
      return mutate(principal, input.requestId, 'authorized', { id, ...input }, async (tx) => {
        const row = await owned(tx, principal, id, true);
        requireSender(principal, row, true);
        requireVersion(row, input.version);
        if (row.status !== 'draft') throw new ApiError('REQUEST_CONFLICT', 409);
        return {
          row: await update(tx, id, { status: 'approved', approvedVersion: input.version }),
          version: input.version,
        };
      });
    },
    accept(
      principal: Principal,
      id: string,
      input: z.infer<typeof VersionCommand>,
      reject = false,
    ) {
      return mutate(
        principal,
        input.requestId,
        reject ? 'rejected' : 'accepted',
        { id, ...input },
        async (tx) => {
          const row = await owned(tx, principal, id, true);
          requireReceiver(principal, row);
          requireVersion(row, input.version);
          if (row.status !== 'approved' || row.approvedVersion !== input.version)
            throw new ApiError('REQUEST_CONFLICT', 409);
          return {
            row: await update(tx, id, {
              status: reject ? 'rejected' : 'accepted',
              acceptedVersion: reject ? null : input.version,
            }),
            version: input.version,
          };
        },
      );
    },
    cancel(principal: Principal, id: string, input: z.infer<typeof VersionCommand>) {
      return mutate(principal, input.requestId, 'cancelled', { id, ...input }, async (tx) => {
        const row = await owned(tx, principal, id, true);
        requireSender(principal, row);
        requireVersion(row, input.version);
        if (!['draft', 'approved', 'accepted', 'awaiting_approval'].includes(row.status))
          throw new ApiError('REQUEST_CONFLICT', 409);
        if (row.pendingRevisionId)
          await tx
            .update(handoffRevisions)
            .set({ status: 'rejected', decidedBy: principal.id, decidedAt: new Date() })
            .where(eq(handoffRevisions.id, row.pendingRevisionId));
        return {
          row: await update(tx, id, { status: 'cancelled', pendingRevisionId: null }),
          version: input.version,
        };
      });
    },
    propose(principal: Principal, id: string, input: z.infer<typeof ProposeRevision>) {
      return mutate(
        principal,
        input.requestId,
        'revision_proposed',
        { id, ...input },
        async (tx) => {
          const row = await owned(tx, principal, id, true);
          requireReceiver(principal, row);
          requireVersion(row, input.version);
          if (row.status !== 'approved' && row.status !== 'accepted')
            throw new ApiError('REQUEST_CONFLICT', 409);
          if (hash(input.terms) === (await version(tx, id, input.version)).termsSha256)
            throw new ApiError('INVALID_INPUT', 400);
          const [latest] = await tx
            .select({ version: sql<number>`max(${handoffVersions.version})` })
            .from(handoffVersions)
            .where(eq(handoffVersions.handoffId, id));
          const proposedVersion = latest.version + 1,
            revisionId = randomUUID();
          await insertVersion(tx, id, proposedVersion, input.terms, principal);
          await tx.insert(handoffRevisions).values({
            id: revisionId,
            handoffId: id,
            baseVersion: input.version,
            proposedVersion,
            baseStatus: row.status,
            reason: input.reason,
            proposerId: principal.id,
            status: 'pending',
          });
          return {
            row: await update(tx, id, {
              status: 'awaiting_approval',
              pendingRevisionId: revisionId,
            }),
            version: proposedVersion,
            note: input.reason,
          };
        },
      );
    },
    decide(
      principal: Principal,
      id: string,
      revisionId: string,
      input: z.infer<typeof RevisionDecision>,
    ) {
      return mutate(
        principal,
        input.requestId,
        `revision_${input.decision}`,
        { id, revisionId, ...input },
        async (tx) => {
          const row = await owned(tx, principal, id, true);
          requireSender(principal, row, true);
          const [revision] = await tx
            .select()
            .from(handoffRevisions)
            .where(and(eq(handoffRevisions.id, revisionId), eq(handoffRevisions.handoffId, id)));
          if (!revision) throw new ApiError('NOT_FOUND', 404);
          if (
            row.status !== 'awaiting_approval' ||
            row.pendingRevisionId !== revisionId ||
            revision.status !== 'pending' ||
            revision.proposedVersion !== input.version ||
            revision.baseVersion !== row.currentVersion
          )
            throw new ApiError('REQUEST_CONFLICT', 409);
          await tx
            .update(handoffRevisions)
            .set({ status: input.decision, decidedBy: principal.id, decidedAt: new Date() })
            .where(eq(handoffRevisions.id, revisionId));
          const accepted = input.decision === 'approved';
          return {
            row: await update(
              tx,
              id,
              accepted
                ? {
                    status: 'approved',
                    currentVersion: input.version,
                    approvedVersion: input.version,
                    acceptedVersion: null,
                    pendingRevisionId: null,
                  }
                : { status: revision.baseStatus, pendingRevisionId: null },
            ),
            version: input.version,
          };
        },
      );
    },
    finish(principal: Principal, id: string, input: z.infer<typeof FinishHandoff>) {
      return mutate(principal, input.requestId, input.status, { id, ...input }, async (tx) => {
        const row = await owned(tx, principal, id, true);
        requireReceiver(principal, row);
        requireVersion(row, input.version);
        if (
          row.status !== 'accepted' ||
          row.approvedVersion !== input.version ||
          row.acceptedVersion !== input.version
        )
          throw new ApiError('REQUEST_CONFLICT', 409);
        return {
          row: await update(tx, id, { status: input.status }),
          version: input.version,
          note: input.note,
        };
      });
    },
    async authorization(
      principal: Principal,
      id: string,
      value: number,
    ): Promise<z.infer<typeof HandoffAuthorization>> {
      const row = await api.get(principal, id),
        terms = row.versions.find((item) => item.version === value);
      if (!terms) throw new ApiError('NOT_FOUND', 404);
      const reasonCode =
        row.status === 'awaiting_approval'
          ? 'AWAITING_APPROVAL'
          : value !== row.currentVersion
            ? 'STALE_VERSION'
            : ['cancelled', 'rejected', 'completed', 'failed'].includes(row.status)
              ? 'TERMINAL_STATE'
              : row.status !== 'accepted' ||
                  row.acceptedVersion !== value ||
                  row.approvedVersion !== value
                ? 'ACCEPTANCE_REQUIRED'
                : 'AUTHORIZED';
      return {
        handoffId: id,
        version: value,
        eligible: reasonCode === 'AUTHORIZED',
        status: row.status,
        reasonCode,
        termsSha256: terms.termsSha256,
      };
    },
    async pending(principal: Principal) {
      if (principal.kind !== 'human' || principal.role !== 'approver')
        throw new ApiError('UNAUTHORIZED_ACTION', 403);
      return db.transaction(
        async (tx) => {
          const rows = await tx
            .select({ id: handoffs.id })
            .from(handoffs)
            .where(
              and(
                eq(handoffs.senderOrganizationId, principal.organizationId),
                inArray(handoffs.status, ['draft', 'awaiting_approval']),
              ),
            )
            .orderBy(asc(handoffs.createdAt));
          const items = [];
          for (const row of rows) items.push(await detail(tx, principal, row.id));
          return { items };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async workflow(principal: Principal, id: string) {
      return db.transaction(
        async (tx) => {
          const rows = await tx
            .select({ id: handoffs.id })
            .from(handoffs)
            .where(and(eq(handoffs.workflowId, id), visible(principal)))
            .orderBy(asc(handoffs.createdAt), asc(handoffs.id));
          if (!rows.length) throw new ApiError('NOT_FOUND', 404);
          const items = [];
          for (const row of rows) items.push(await detail(tx, principal, row.id));
          return { items };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async reconcile(principal: Principal, requestId: string) {
      const [receipt] = await db
        .select()
        .from(handoffReceipts)
        .where(
          and(
            eq(handoffReceipts.principalId, principal.id),
            eq(handoffReceipts.requestId, requestId),
          ),
        );
      if (!receipt) throw new ApiError('NOT_FOUND', 404);
      return {
        handoff: await api.get(principal, receipt.handoffId),
        receipt: { ...receipt.claims, signedReceipt: receipt.signedReceipt },
      };
    },
  };
  return api;
}
