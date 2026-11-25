import type { HandoffDetail } from '@porden/contracts';
import type {
  ClaimEvaluation,
  ClaimInbox,
  ClaimInboxQuery,
  ClaimStage,
  CourierClaimDecision,
  MissingInformation,
} from '@porden/contracts/delivery-claims';
import type { z } from 'zod';
import type { Config } from '../config';
import { ApiError } from '../application/errors';
import type { Fetcher } from '../security';
import { caseAction, claimTerms, readClaimTerms } from './claim-terms';
import { courierClaimPolicy, evaluateClaim } from './courier-claim-policy';
import { authorizationFailure, deliveryPlatform } from './delivery-authorization';

const missingText: Record<z.infer<typeof MissingInformation>, string> = {
  photo_of_damage: 'photo_of_damage: a clear photo of the damaged parcel and its contents',
};

export function claimStage(state: HandoffDetail): ClaimStage {
  if (['completed', 'failed', 'rejected', 'cancelled'].includes(state.status)) return 'closed';
  if (state.executions.some((item) => item.status === 'reserved')) return 'execution_unresolved';
  if (state.clarifications.some((item) => item.response === undefined))
    return 'waiting_for_customer';
  if (state.status === 'awaiting_approval' || state.status === 'draft')
    return 'waiting_for_merchant_approval';
  if (state.status === 'accepted')
    return state.executions.some(
      (item) => item.version === state.acceptedVersion && item.status === 'completed',
    )
      ? 'ready_to_complete'
      : 'waiting_for_execution';
  return 'review';
}

function currentClaim(state: HandoffDetail) {
  const terms = state.versions.find((item) => item.version === state.currentVersion)?.terms;
  const claim = terms ? readClaimTerms(terms) : undefined;
  if (!claim) throw new ApiError('NOT_FOUND', 404);
  return claim;
}
function photoReceived(state: HandoffDetail) {
  return state.clarifications.some(
    (item) =>
      item.response !== undefined &&
      item.missingInformation.some((entry) => entry.startsWith('photo_of_damage')),
  );
}

// The courier's claims desk. Agents propose a decision; this service checks it against the
// courier policy and only then calls the generic Porden lifecycle with server-built terms.
export function courierClaims(config: Config, fetcher: Fetcher) {
  const { client, handoff } = deliveryPlatform(config, fetcher);
  const load = (handoffId: string) => handoff({ handoffId }).catch(authorizationFailure);
  function evaluation(state: HandoffDetail): ClaimEvaluation {
    const { parameters } = currentClaim(state);
    return {
      handoffId: state.id,
      version: state.currentVersion,
      policyId: courierClaimPolicy.id,
      parameters,
      ...evaluateClaim(courierClaimPolicy, parameters, { photoReceived: photoReceived(state) }),
    };
  }
  return {
    /** Read-only lookup of an uncertain decision by its request ID; never repeats the write. */
    async reconcile(requestId: string) {
      const result = await client.reconcileOperation(requestId).catch(authorizationFailure);
      // Only operations on claims from the configured merchant are visible here.
      if (result.handoff.senderOrganizationId !== config.platform?.peerOrganizationId)
        throw new ApiError('NOT_FOUND', 404);
      currentClaim(result.handoff);
      return result;
    },
    /** Courier inbox: received handoffs that follow the claim profile, with the next step. */
    async inbox(query: z.infer<typeof ClaimInboxQuery>): Promise<ClaimInbox> {
      const page = await client
        .listHandoffs({
          direction: 'received',
          page: query.page,
          limit: query.limit,
          ...(query.status ? { status: query.status } : {}),
        })
        .catch(authorizationFailure);
      const items: ClaimInbox['items'] = [];
      for (const summary of page.items) {
        // Handoffs from other senders, or that do not follow the claim profile, are not claims for
        // this desk; one malformed handoff must not hide the rest of the inbox.
        if (summary.senderOrganizationId !== config.platform?.peerOrganizationId) continue;
        const state = await load(summary.id);
        const terms = state.versions.find((item) => item.version === state.currentVersion)?.terms;
        let claim: ReturnType<typeof readClaimTerms>;
        try {
          claim = terms ? readClaimTerms(terms) : undefined;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'SCOPE_MISMATCH') continue;
          throw error;
        }
        if (!claim) continue;
        items.push({
          handoff: summary,
          stage: claimStage(state),
          current: claim.parameters,
          openClarifications: state.clarifications.filter((item) => item.response === undefined)
            .length,
        });
      }
      return {
        items,
        page: page.page,
        limit: page.limit,
        scanned: page.items.length,
        totalReceived: page.total,
      };
    },
    async evaluate(handoffId: string) {
      return evaluation(await load(handoffId));
    },
    async decide(handoffId: string, input: CourierClaimDecision) {
      const state = await load(handoffId);
      if (input.version !== state.currentVersion) throw new ApiError('STALE_VERSION', 409);
      const command = { requestId: input.requestId, version: input.version };
      if (input.decision === 'complete') {
        currentClaim(state);
        const executed = state.executions.some(
          (item) =>
            item.version === input.version &&
            item.action === caseAction &&
            item.status === 'completed',
        );
        if (state.status !== 'accepted' || state.acceptedVersion !== input.version || !executed)
          throw new ApiError('REQUEST_CONFLICT', 409);
        return client
          .finishHandoff(handoffId, {
            ...command,
            status: 'completed',
            note: input.reason,
            criterionResults: [
              { criterionIndex: 0, met: true },
              { criterionIndex: 1, met: true },
            ],
          })
          .catch(authorizationFailure);
      }
      const result = evaluation(state);
      const allowed = result.allowed.find((item) => item.decision === input.decision);
      if (input.decision === 'accept' && allowed)
        return client.acceptHandoff(handoffId, command).catch(authorizationFailure);
      if (input.decision === 'reject' && allowed)
        return client.rejectHandoff(handoffId, command).catch(authorizationFailure);
      if (
        input.decision === 'clarify' &&
        allowed?.decision === 'clarify' &&
        input.missingInformation.every((item) => allowed.missingInformation.includes(item))
      )
        return client
          .requestClarification(handoffId, {
            ...command,
            missingInformation: input.missingInformation.map((item) => missingText[item]),
            reason: input.reason,
          })
          .catch(authorizationFailure);
      if (input.decision === 'counter') {
        const offer = result.allowed.find(
          (item) => item.decision === 'counter' && item.resolution.remedy === input.remedy,
        );
        if (offer?.decision === 'counter') {
          const { caseScope } = currentClaim(state);
          const claim = {
            ...result.parameters.claim,
            photoProvided: photoReceived(state) || result.parameters.claim.photoProvided,
          };
          return client
            .proposeRevision(handoffId, {
              ...command,
              terms: claimTerms({ claim, resolution: offer.resolution }, caseScope),
              reason: input.reason,
            })
            .catch(authorizationFailure);
        }
      }
      throw new ApiError('POLICY_VIOLATION', 422);
    },
  };
}
