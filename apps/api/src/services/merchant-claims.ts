import { Fields, type HandoffDetail, type ReceiptClaims } from '@porden/contracts';
import type {
  ClaimView,
  FileClaim,
  OrderFacts,
  ResolveClaimClarification,
  Resolution,
} from '@porden/contracts/delivery-claims';
import type { Config } from '../config';
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

// Merchant side of the damaged-parcel example. The integration token stays on this server and
// only these operations are exposed to the signed-in customer.
export function merchantClaims(config: Config, fetcher: Fetcher) {
  const { client, handoff } = deliveryPlatform(config, fetcher);
  const load = (handoffId: string) => handoff({ handoffId }).catch(authorizationFailure);
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
          parametersSha256: hash({ caseType: 'delivery_damage', data: input.data }),
        },
      );
      const result = await client
        .createHandoff({
          requestId: input.requestId,
          receiverOrganizationId: platform.peerOrganizationId,
          terms,
        })
        .catch(authorizationFailure);
      return view(result.handoff);
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
      return view(result.handoff);
    },
    /** Read-only lookup of an uncertain write by its request ID; never repeats the write. */
    async reconcile(requestId: string) {
      const result = await client.reconcileOperation(requestId).catch(authorizationFailure);
      // Only operations on claims sent to the configured courier are visible here.
      if (result.handoff.receiverOrganizationId !== config.platform?.peerOrganizationId)
        throw new ApiError('NOT_FOUND', 404);
      view(result.handoff);
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
