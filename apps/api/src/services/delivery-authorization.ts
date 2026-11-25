import { createHandoffClient, PordenError } from '@porden/sdk';
import type { store } from '../db/store';
import type { CreateCase, DamageData, DeliveryGovernance } from '@porden/contracts';
import type { z } from 'zod';
import type { Config } from '../config';
import { ApiError } from '../application/errors';
import { hash, verifyApproval, type Fetcher } from '../security';
import { readClaimTerms } from './claim-terms';

export function authorizationFailure(cause: unknown): never {
  if (!(cause instanceof PordenError)) throw cause;
  if (cause.status === 409) throw new ApiError(cause.code, 409, undefined, { cause });
  if (cause.status === 403 || cause.status === 404)
    throw new ApiError('UNAUTHORIZED_ACTION', 403, undefined, { cause });
  throw new ApiError(
    cause.code === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'AUTHORIZATION_UNAVAILABLE',
    502,
    undefined,
    { cause },
  );
}

export function deliveryPlatform(config: Config, fetcher: Fetcher) {
  const integration = config.platform;
  if (!integration) throw new ApiError('AUTHORIZATION_UNAVAILABLE', 503);
  const client = createHandoffClient({
    baseUrl: integration.origin + '/api/v2',
    token: integration.token,
    fetch: (url, init) =>
      fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) }),
  });
  const handoff = async (governance: Pick<z.infer<typeof DeliveryGovernance>, 'handoffId'>) => {
    const [session, state] = await Promise.all([
      client.session(),
      client.getHandoff(governance.handoffId),
    ]);
    const sender =
      config.role === 'merchant' ? integration.organizationId : integration.peerOrganizationId;
    const receiver =
      config.role === 'courier' ? integration.organizationId : integration.peerOrganizationId;
    if (
      session.principal.kind !== 'integration' ||
      session.principal.organizationId !== integration.organizationId ||
      state.senderOrganizationId !== sender ||
      state.receiverOrganizationId !== receiver
    )
      throw new ApiError('UNAUTHORIZED_ACTION', 403);
    return state;
  };
  return { client, handoff };
}

export async function verifyDeliveryConsent(
  config: Config,
  fetcher: Fetcher,
  governance: z.infer<typeof DeliveryGovernance>,
  data: DamageData,
) {
  const { handoff } = deliveryPlatform(config, fetcher);
  const state = await handoff(governance).catch(authorizationFailure);
  const terms = state.versions.find((item) => item.version === governance.version)?.terms;
  if (
    state.currentVersion !== governance.version ||
    !['draft', 'approved', 'accepted'].includes(state.status)
  )
    throw new ApiError('REQUEST_CONFLICT', 409);
  if (
    !terms?.executionScopes?.some(
      (scope) =>
        scope.action === 'courier.create_case' &&
        scope.parametersSha256 === hash({ caseType: 'delivery_damage', data }),
    )
  )
    throw new ApiError('SCOPE_MISMATCH', 403);
}

export async function reserveDeliveryCase(
  config: Config,
  fetcher: Fetcher,
  governance: z.infer<typeof DeliveryGovernance>,
  args: CreateCase,
) {
  const { client, handoff } = deliveryPlatform(config, fetcher);
  const state = await handoff(governance);
  const terms = state.versions.find((item) => item.version === governance.version)?.terms;
  // Claim handoffs bind the agreed resolution to the version; the receipt states it.
  const resolution = terms ? readClaimTerms(terms)?.parameters.resolution : undefined;
  const result = await client.reserveExecution(governance.handoffId, {
    requestId: args.transferId,
    version: governance.version,
    action: 'courier.create_case',
    parametersSha256: hash({ caseType: args.caseType, data: args.data }),
    operationReference: hash({ transferId: args.transferId, requestId: args.requestId }),
  });
  const event = result.receipt.event;
  if (event?.type !== 'execution_reserved') throw new ApiError('AUTHORIZATION_UNAVAILABLE', 502);
  const execution = result.handoff.executions.find((item) => item.id === event.execution.id);
  if (!execution || execution.status === 'failed') throw new ApiError('REQUEST_CONFLICT', 409);
  return { client, execution, resolution };
}

export async function createDeliveryCase(
  config: Config,
  db: ReturnType<typeof store>,
  fetcher: Fetcher,
  args: CreateCase,
) {
  const approval = await verifyApproval(args, config, fetcher);
  const reservation = approval.governance
    ? await reserveDeliveryCase(config, fetcher, approval.governance, args).catch(
        authorizationFailure,
      )
    : undefined;
  if (reservation?.execution.status === 'completed') {
    // A settled replay may only return the durable case; it cannot start another write.
    const result = await db.findCase('request', args.requestId);
    if (result.transferId !== args.transferId) throw new ApiError('REQUEST_CONFLICT', 409);
    return result;
  }
  const governance = approval.governance;
  // Under the transfer lock, insert only while this reservation is still open. If recovery has
  // already settled it, no case is written.
  const stillReserved =
    reservation && governance
      ? async () => {
          const state = await reservation.client
            .getHandoff(governance.handoffId)
            .catch(authorizationFailure);
          const current = state.executions.find((item) => item.id === reservation.execution.id);
          if (current?.status !== 'reserved') throw new ApiError('REQUEST_CONFLICT', 409);
        }
      : undefined;
  const result = await db.createCase(
    args,
    approval.governance,
    reservation?.resolution,
    stillReserved,
  );
  if (reservation && approval.governance) {
    await reservation.client
      .settleExecution(approval.governance.handoffId, {
        requestId: reservation.execution.id,
        executionId: reservation.execution.id,
        version: approval.governance.version,
        outcome: 'completed',
        resultReference: result.caseId,
      })
      .catch((cause) => {
        throw new ApiError('OUTCOME_UNKNOWN', 502, undefined, { cause });
      });
  }

  return result;
}

/**
 * Settles governed executions left reserved by an interrupted write (for example, a lost
 * platform response after the case committed). It never repeats the case write: it reads
 * what the courier database committed and settles the platform reservation to match.
 */
export async function recoverDeliveryExecutions(
  config: Config,
  db: ReturnType<typeof store>,
  fetcher: Fetcher,
  handoffId: string,
) {
  const { client, handoff } = deliveryPlatform(config, fetcher);
  const state = await handoff({ handoffId }).catch(authorizationFailure);
  const recovered = [];
  for (const execution of state.executions) {
    if (execution.status !== 'reserved' || execution.action !== 'courier.create_case') continue;
    const reservation = state.receipts.find(
      (item) =>
        item.event?.type === 'execution_reserved' && item.event.execution.id === execution.id,
    );
    if (!reservation) throw new ApiError('AUTHORIZATION_UNAVAILABLE', 502);
    // The reservation request ID is the transfer ID used by the case write. The settle runs while
    // the transfer lock is held, so a concurrent case write cannot commit around it.
    const transferId = reservation.requestId;
    const outcome = await db.whileTransferLocked(transferId, async (committed) => {
      if (
        committed &&
        hash({ transferId: committed.transferId, requestId: committed.requestId }) !==
          execution.operationReference
      )
        throw new ApiError('REQUEST_CONFLICT', 409);
      await client
        .settleExecution(handoffId, {
          requestId: execution.id,
          executionId: execution.id,
          version: execution.version,
          outcome: committed ? 'completed' : 'failed',
          resultReference: committed ? committed.caseId : 'NO_CASE_COMMITTED',
        })
        .catch(authorizationFailure);
      return committed;
    });
    const committed = outcome;
    recovered.push({
      executionId: execution.id,
      outcome: committed ? ('completed' as const) : ('failed' as const),
      ...(committed ? { caseId: committed.caseId } : {}),
    });
  }
  return { handoffId, recovered };
}
