import { and, or, eq, asc, desc, count, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { z } from 'zod';
import type { Principal, HandoffDetail } from '@porden/contracts';
import { HandoffQuery } from '@porden/contracts';
import {
  organizations,
  handoffs,
  handoffVersions,
  handoffRevisions,
  handoffReceipts,
} from '../platform-schema';

type Database = ReturnType<typeof drizzle>;
export type HandoffTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type HandoffConnection = Database | HandoffTransaction;
type HandoffQueryInput = z.infer<typeof HandoffQuery>;

export function handoffQueries(db: Database) {
  const visible = (principal: Principal) =>
    or(
      eq(handoffs.senderOrganizationId, principal.organizationId),
      eq(handoffs.receiverOrganizationId, principal.organizationId),
    );
  async function owned(
    connection: HandoffConnection,
    principal: Principal,
    id: string,
    lock = false,
  ) {
    const query = connection
      .select()
      .from(handoffs)
      .where(and(eq(handoffs.id, id), visible(principal)));
    const [row] = await (lock ? query.for('update') : query);
    return row;
  }
  return {
    async ready() {
      await db.select({ id: handoffs.id }).from(handoffs).limit(1);
    },
    owned,
    async version(connection: HandoffConnection, id: string, value: number) {
      const [row] = await connection
        .select()
        .from(handoffVersions)
        .where(and(eq(handoffVersions.handoffId, id), eq(handoffVersions.version, value)));
      return row;
    },
    async detail(
      connection: HandoffConnection,
      principal: Principal,
      id: string,
    ): Promise<HandoffDetail | undefined> {
      const row = await owned(connection, principal, id);
      if (!row) return undefined;
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
      const sender = participants.find((item) => item.id === row.senderOrganizationId);
      const receiver = participants.find((item) => item.id === row.receiverOrganizationId);
      if (!current || !sender || !receiver) throw Error('Incomplete handoff records');
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        goal: current.terms.goal,
        senderName: sender.name,
        receiverName: receiver.name,
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
        clarifications: receipts.flatMap(({ claims }) => {
          if (claims.event?.type !== 'clarification_requested') return [];
          const clarification = claims.event.clarification;
          const resolution = receipts.find(
            ({ claims: other }) =>
              other.event?.type === 'clarification_resolved' &&
              other.event.clarificationId === clarification.id,
          )?.claims.event;
          return [
            {
              ...clarification,
              ...(resolution?.type === 'clarification_resolved'
                ? { response: resolution.response }
                : {}),
            },
          ];
        }),
        executions: receipts.flatMap(({ claims }) => {
          if (claims.event?.type !== 'execution_reserved') return [];
          const execution = claims.event.execution;
          const settlement = receipts.find(
            ({ claims: other }) =>
              other.event?.type === 'execution_settled' && other.event.executionId === execution.id,
          )?.claims.event;
          return [
            {
              ...execution,
              ...(settlement?.type === 'execution_settled'
                ? { status: settlement.outcome, resultReference: settlement.resultReference }
                : {}),
            },
          ];
        }),
      };
    },
    async organizations() {
      return db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .orderBy(asc(organizations.name));
    },
    async organization(connection: HandoffConnection, id: string) {
      const [row] = await connection.select().from(organizations).where(eq(organizations.id, id));
      return row;
    },
    async senderApprovalPolicy(connection: HandoffTransaction, id: string) {
      const [row] = await connection
        .select({ humanApprovalRequired: organizations.humanApprovalRequired })
        .from(organizations)
        .where(eq(organizations.id, id));
      return row;
    },
    async workflowExists(connection: HandoffTransaction, workflowId: string) {
      const [row] = await connection
        .select({ id: handoffs.id })
        .from(handoffs)
        .where(eq(handoffs.workflowId, workflowId))
        .limit(1);
      return Boolean(row);
    },
    async latestVersion(connection: HandoffTransaction, id: string) {
      const [row] = await connection
        .select({ version: handoffVersions.version })
        .from(handoffVersions)
        .where(eq(handoffVersions.handoffId, id))
        .orderBy(desc(handoffVersions.version))
        .limit(1);
      return row?.version;
    },
    async revision(connection: HandoffTransaction, id: string, revisionId: string) {
      const [row] = await connection
        .select()
        .from(handoffRevisions)
        .where(and(eq(handoffRevisions.id, revisionId), eq(handoffRevisions.handoffId, id)));
      return row;
    },
    async pendingIds(connection: HandoffTransaction, organizationId: string) {
      const rows = await connection
        .select({ id: handoffs.id })
        .from(handoffs)
        .where(
          and(
            eq(handoffs.senderOrganizationId, organizationId),
            inArray(handoffs.status, ['draft', 'awaiting_approval']),
          ),
        )
        .orderBy(asc(handoffs.createdAt));
      return rows.map((row) => row.id);
    },
    async workflowIds(connection: HandoffTransaction, principal: Principal, workflowId: string) {
      const rows = await connection
        .select({ id: handoffs.id })
        .from(handoffs)
        .where(and(eq(handoffs.workflowId, workflowId), visible(principal)))
        .orderBy(asc(handoffs.createdAt), asc(handoffs.id));
      return rows.map((row) => row.id);
    },
    async receiptByRequest(connection: HandoffConnection, principalId: string, requestId: string) {
      const [row] = await connection
        .select()
        .from(handoffReceipts)
        .where(
          and(
            eq(handoffReceipts.principalId, principalId),
            eq(handoffReceipts.requestId, requestId),
          ),
        );
      return row;
    },
    async list(connection: HandoffTransaction, principal: Principal, input: HandoffQueryInput) {
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
      const [{ total }] = await connection.select({ total: count() }).from(handoffs).where(filter);
      const rows = await connection
        .select({ id: handoffs.id })
        .from(handoffs)
        .where(filter)
        .orderBy(asc(handoffs.createdAt), asc(handoffs.id))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit);
      return { total, ids: rows.map((row) => row.id) };
    },
  };
}
