import { ErrorResponse, HandoffMutation, ReceiptVerification, Session } from '@porden/contracts';
import {
  ClaimEvaluation,
  ClaimInbox,
  ClaimPolicy,
  ClaimView,
  CourierClaimDecision,
  ExecutionRecovery,
  FileClaim,
  OrderFacts,
  ResolveClaimClarification,
} from '@porden/contracts/delivery-claims';
import { PordenError } from '@porden/sdk';
import type { z } from 'zod';

// Typed same-origin client for the damaged-parcel claims example (merchant and courier sites).
// Writes that fail in transit or with a server error are reported as OUTCOME_UNKNOWN: reconcile
// them with `operation(requestId)` and never resubmit automatically.
async function call<T extends z.ZodType>(
  schema: T,
  path: string,
  init: { body?: unknown; csrf?: () => Promise<string>; credentials?: RequestCredentials } = {},
): Promise<z.output<T>> {
  const write = init.body !== undefined;
  const headers: Record<string, string> = {};
  if (write) headers['Content-Type'] = 'application/json';
  if (write && init.csrf) headers['X-CSRF-Token'] = await init.csrf();
  const response = await fetch(path, {
    method: write ? 'POST' : 'GET',
    credentials: init.credentials ?? 'include',
    headers,
    body: write ? JSON.stringify(init.body) : undefined,
  }).catch((cause) => {
    throw new PordenError(write ? 'OUTCOME_UNKNOWN' : 'NETWORK_ERROR', 0, undefined, { cause });
  });
  const payload: unknown = await response.json().catch((cause) => {
    throw new PordenError(
      write ? 'OUTCOME_UNKNOWN' : 'INVALID_RESPONSE',
      response.status,
      undefined,
      { cause },
    );
  });
  if (!response.ok) {
    const parsed = ErrorResponse.safeParse(payload);
    const code = parsed.success ? parsed.data.error.code : 'HTTP_ERROR';
    throw new PordenError(
      write && response.status >= 500 && code !== 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : code,
      response.status,
      parsed.success ? parsed.data.error.requestId : undefined,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new PordenError('INVALID_RESPONSE', response.status, undefined, { cause: parsed.error });
  return parsed.data;
}

function session() {
  let csrf: string | undefined;
  return async () => {
    csrf ??= (await call(Session, '/api/v1/session')).csrf;
    return csrf;
  };
}
const id = (value: string) => encodeURIComponent(value);

export function createMerchantClaimsClient() {
  const csrf = session();
  return {
    order: (reference: string) => call(OrderFacts, `/api/v1/orders/${id(reference)}`),
    // Public cross-origin read: no cookies, so the courier's wildcard CORS policy applies.
    courierPolicy: (courierOrigin: string) =>
      call(ClaimPolicy, `${courierOrigin}/api/v1/claim-policy`, { credentials: 'omit' }),
    file: (body: FileClaim) => call(ClaimView, '/api/v1/claims', { body, csrf }),
    claim: (handoffId: string) => call(ClaimView, `/api/v1/claims/${id(handoffId)}`),
    answerClarification: (handoffId: string, body: z.input<typeof ResolveClaimClarification>) =>
      call(ClaimView, `/api/v1/claims/${id(handoffId)}/clarifications/resolve`, { body, csrf }),
    cancel: (handoffId: string, body: { requestId: string; version: number }) =>
      call(ClaimView, `/api/v1/claims/${id(handoffId)}/cancel`, { body, csrf }),
    operation: (requestId: string) =>
      call(HandoffMutation, `/api/v1/claims/operations/${id(requestId)}`),
  };
}

export function createCourierClaimsClient() {
  const csrf = session();
  return {
    inbox: (query: { status?: string; page?: number; limit?: number } = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
      return call(ClaimInbox, `/api/v1/claims?${params}`);
    },
    evaluation: (handoffId: string) =>
      call(ClaimEvaluation, `/api/v1/claims/${id(handoffId)}/evaluation`),
    decide: (handoffId: string, body: CourierClaimDecision) =>
      call(HandoffMutation, `/api/v1/claims/${id(handoffId)}/decisions`, { body, csrf }),
    recoverExecutions: (handoffId: string) =>
      call(ExecutionRecovery, `/api/v1/claims/${id(handoffId)}/executions/recover`, {
        body: {},
        csrf,
      }),
    operation: (requestId: string) =>
      call(HandoffMutation, `/api/v1/claims/operations/${id(requestId)}`),
  };
}

/**
 * Checks any Porden receipt (platform handoff receipt or courier case receipt) with this site's
 * public verifier. No session is needed. `valid: false` is a definite verdict; a thrown
 * VERIFICATION_UNAVAILABLE means the issuer's keys could not be reached and nothing was decided.
 */
export function verifyReceipt(receipt: string, siteOrigin = '') {
  return call(ReceiptVerification, `${siteOrigin}/api/v1/receipts/verify`, {
    body: { receipt },
    credentials: 'omit',
  });
}
