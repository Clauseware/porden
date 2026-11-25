import { Fields, type HandoffDetail, type ReceiptClaims } from '@porden/contracts';
import { PordenError } from '@porden/sdk';
import type {
  ClaimConsent,
  ClaimView,
  FileClaim,
  OrderFacts,
  ResolveClaimClarification,
  Resolution,
} from '@porden/contracts/delivery-claims';
import type { Config } from '../config';
import type { store } from '../db/store';
import { ApiError } from '../application/errors';
import { canonicalize } from '@porden/contracts';
import { hash, type Fetcher } from '../security';
import { caseAction, claimTerms, readClaimTerms } from './claim-terms';
import { authorizationFailure, deliveryPlatform } from './delivery-authorization';

// Synthetic order system for the demo merchant. Claim facts are read here, not supplied by clients.
const orders: Record<string, OrderFacts> = {
  'DEMO-1042': {
    orderReference: 'DEMO-1042',
    description: 'Hand-glazed ceramic vase',
    parcelClass: 'fragile',
    declaredValueMinor: 8_000,
    currency: 'USD',
  },
};
export function orderFacts(orderReference: string) {
  const order = orders[orderReference];
  if (!order) throw new ApiError('NOT_FOUND', 404);
  return order;
}
function price(order: OrderFacts, requested: FileClaim['requestedResolution']): Resolution {
  if (requested.remedy === 'reship') return { remedy: 'reship' };
  if (requested.remedy === 'full_refund')
    return {
      remedy: 'full_refund',
      amountMinor: order.declaredValueMinor,
      currency: order.currency,
    };
  if (requested.amountMinor >= order.declaredValueMinor) throw new ApiError('INVALID_INPUT', 400);
  return { remedy: 'partial_refund', amountMinor: requested.amountMinor, currency: order.currency };
}

function view(state: HandoffDetail): ClaimView {
  const versions = state.versions.map((item) => {
    const claim = readClaimTerms(item.terms);
    if (!claim) throw new ApiError('NOT_FOUND', 404);
    return { version: item.version, parameters: claim.parameters };
  });
  const current = versions.find((item) => item.version === state.currentVersion);
  if (!current) throw new ApiError('NOT_FOUND', 404);
  return { handoff: state, versions, current: current.parameters };
}

// How long an unlinked filing waits before the sweep asks the platform for its final outcome.
const STALE_AFTER_MS = 10 * 60_000;

// A claim whose case can no longer be sent: it closed, or the accepted version was carried out.
const CLOSED = new Set(['completed', 'failed', 'rejected', 'cancelled']);
function settled(state: HandoffDetail) {
  return (
    CLOSED.has(state.status) ||
    state.executions.some(
      (item) => item.version === state.acceptedVersion && item.status === 'completed',
    )
  );
}

type ClaimRecords = Pick<
  ReturnType<typeof store>,
  | 'reserveClaim'
  | 'findPendingClaim'
  | 'bindClaim'
  | 'discardPendingClaim'
  | 'stalePendingClaims'
  | 'findClaim'
  | 'clearClaimConsent'
  | 'listClaims'
>;

// Merchant side of the damaged-parcel example. The integration token stays on this server and
// only these operations are exposed to the signed-in customer.
export function merchantClaims(config: Config, fetcher: Fetcher, records: ClaimRecords) {
  const { client, handoff } = deliveryPlatform(config, fetcher);
  const load = (handoffId: string) => handoff({ handoffId }).catch(authorizationFailure);
  const consentHash = (data: ClaimConsent['data']) => hash({ caseType: 'delivery_damage', data });
  /**
   * Links a stored filing to the claim a reconciled operation created, so an uncertain filing
   * keeps its consent. Only a claim whose version-1 terms carry this consent's hash is linked.
   */
  async function attach(requestId: string, state: HandoffDetail) {
    const pending = await records.findPendingClaim(requestId);
    if (!pending?.consentData) return false;
    const first = state.versions.find((item) => item.version === 1);
    const claim = first ? readClaimTerms(first.terms) : undefined;
    if (claim?.caseScope.parametersSha256 !== consentHash(pending.consentData)) return false;
    await records.bindClaim(requestId, state.id);
    return true;
  }
  /**
   * Settles filings left unlinked by a lost answer that nobody checked. The platform records a
   * filing's operation in the same transaction as the claim, and a filing call gives up after
   * five seconds, so after STALE_AFTER_MS the platform's answer is final: a claim made from this
   * consent is linked; otherwise nothing used the consent and it is deleted. While the platform
   * can't be reached, the filing is left for the next sweep.
   */
  async function sweep() {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const stale = await records.stalePendingClaims(cutoff, 20);
    for (const { requestId } of stale) {
      const found = await client.reconcileOperation(requestId).then(
        (result) => ({ state: 'found' as const, handoff: result.handoff }),
        (cause: unknown) => {
          if (cause instanceof PordenError && cause.status === 404)
            return { state: 'missing' as const };
          if (cause instanceof PordenError) return { state: 'unreachable' as const };
          throw cause;
        },
      );
      if (found.state === 'unreachable') continue;
      const linked =
        found.state === 'found' &&
        found.handoff.receiverOrganizationId === config.platform?.peerOrganizationId &&
        (await attach(requestId, found.handoff));
      if (!linked) await records.discardPendingClaim(requestId, cutoff);
    }
  }
  return {
    async file(input: FileClaim) {
      const fields = Fields.safeParse(input.approvedFields);
      // Customer consent is the exact field list; unconsented data never enters the terms.
      if (
        !fields.success ||
        canonicalize([...fields.data].sort()) !== canonicalize(Object.keys(input.data).sort())
      )
        throw new ApiError('CONSENT_SCOPE_MISMATCH', 400);
      const platform = config.platform;
      if (!platform) throw new ApiError('AUTHORIZATION_UNAVAILABLE', 503);
      const order = orderFacts(input.data.orderReference);
      const terms = claimTerms(
        {
          claim: {
            orderReference: order.orderReference,
            parcelClass: order.parcelClass,
            declaredValueMinor: order.declaredValueMinor,
            currency: order.currency,
            photoProvided: input.photoProvided,
          },
          resolution: price(order, input.requestedResolution),
        },
        {
          action: caseAction,
          parametersSha256: consentHash(input.data),
        },
      );
      // The consent is stored before the platform call, so it survives an uncertain outcome and
      // can be linked when the filing is reconciled. The platform keeps only its hash.
      const { requestId, ...request } = input;
      const reserved = await records.reserveClaim(requestId, hash(request), {
        data: input.data,
        approvedFields: fields.data,
      });
      if (!reserved || reserved.requestSha256 !== hash(request))
        throw new ApiError('REQUEST_CONFLICT', 409);
      const result = await client
        // On any failure the stored consent stays: an uncertain outcome is linked when it is
        // reconciled, and a filing that created nothing is removed by the stale-filing sweep.
        .createHandoff({ requestId, receiverOrganizationId: platform.peerOrganizationId, terms })
        .catch(authorizationFailure);
      await records.bindClaim(requestId, result.handoff.id);
      return view(result.handoff);
    },
    async list() {
      await sweep();
      const rows = await records.listClaims(50);
      return {
        items: rows.flatMap((row) =>
          row.handoffId
            ? [
                {
                  handoffId: row.handoffId,
                  orderReference: row.orderReference,
                  filedAt: row.filedAt.toISOString(),
                },
              ]
            : [],
        ),
      };
    },
    /** The consented details, while the case can still be sent. Cleared once it no longer can. */
    async consent(handoffId: string): Promise<{ consent: ClaimConsent | null }> {
      const record = await records.findClaim(handoffId);
      if (!record) throw new ApiError('NOT_FOUND', 404);
      if (!record.consentData || !record.approvedFields) return { consent: null };
      if (settled(await load(handoffId))) {
        await records.clearClaimConsent(handoffId);
        return { consent: null };
      }
      return { consent: { data: record.consentData, approvedFields: record.approvedFields } };
    },
    async read(handoffId: string) {
      return view(await load(handoffId));
    },
    async resolveClarification(handoffId: string, input: ResolveClaimClarification) {
      view(await load(handoffId));
      const result = await client
        .resolveClarification(handoffId, input)
        .catch(authorizationFailure);
      return view(result.handoff);
    },
    async cancel(handoffId: string, input: { requestId: string; version: number }) {
      view(await load(handoffId));
      const result = await client.cancelHandoff(handoffId, input).catch(authorizationFailure);
      if (settled(result.handoff)) await records.clearClaimConsent(handoffId);
      return view(result.handoff);
    },
    /** Read-only lookup of an uncertain write by its request ID; never repeats the write. */
    async reconcile(requestId: string) {
      const result = await client.reconcileOperation(requestId).catch(authorizationFailure);
      // Only operations on claims sent to the configured courier are visible here.
      if (result.handoff.receiverOrganizationId !== config.platform?.peerOrganizationId)
        throw new ApiError('NOT_FOUND', 404);
      view(result.handoff);
      await attach(requestId, result.handoff);
      return result;
    },
    /** A courier receipt for a claim must state the resolution of the version it executed. */
    async verifyReceiptResolution(claims: ReceiptClaims) {
      if (!claims.governance) return;
      const state = await load(claims.governance.handoffId);
      const terms = state.versions.find(
        (item) => item.version === claims.governance?.version,
      )?.terms;
      const claim = terms ? readClaimTerms(terms) : undefined;
      if (!claim) {
        if (claims.resolution) throw new ApiError('RECEIPT_INVALID', 403);
        return;
      }
      if (canonicalize(claims.resolution ?? null) !== canonicalize(claim.parameters.resolution))
        throw new ApiError('RECEIPT_INVALID', 403);
    },
  };
}
