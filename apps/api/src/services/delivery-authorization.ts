import { createHandoffClient, PordenError } from '@porden/sdk';
import type { store } from '../db/store';
import type { CreateCase, DamageData, DeliveryGovernance } from '@porden/contracts';
import type { z } from 'zod';
import type { Config } from '../config';
import { ApiError } from '../application/errors';
import { hash, verifyApproval, type Fetcher } from '../security';

function authorizationFailure(cause: unknown): never {
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
  const handoff = async (governance: z.infer<typeof DeliveryGovernance>) => {
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
  await handoff(governance);
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
  return { client, execution };
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
  const result = await db.createCase(args, approval.governance);
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
