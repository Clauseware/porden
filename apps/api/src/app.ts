import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  CreateDraft,
  ApproveTransfer,
  CreateCase,
  CaseResponse,
  ReceiptSubmission,
  OutcomeUpdate,
  SignIn,
  VersionCommand,
  VerifyReceiptRequest,
  actionSchema,
  errorMessages,
} from '@porden/contracts';
import { agentRoutes } from './agents';
import { equal, sessionTools, signer, verifyReceipt, type Fetcher } from './security';
import { ApiError } from './application/errors';
import { reportError } from './observability/logger';
import { errorResponse, notFoundResponse } from './http/error-handler';
import { requestLogging } from './http/request-logging';
import { rateLimit } from './http/rate-limit';
import type { Config } from './config';
import type { store } from './db/store';
import { createDeliveryCase, recoverDeliveryExecutions } from './services/delivery-authorization';
import {
  ClaimInboxQuery,
  CourierClaimDecision,
  FileClaim,
  ResolveClaimClarification,
} from '@porden/contracts/delivery-claims';
import { courierClaimPolicy } from './services/courier-claim-policy';
import { courierClaims } from './services/courier-claims';
import { merchantClaims, orderFacts } from './services/merchant-claims';
import { checkReceipt } from './services/receipt-verification';

type Store = ReturnType<typeof store>;
export function createApp(
  config: Config,
  db: Store,
  signing: ReturnType<typeof signer>,
  fetcher: Fetcher = fetch,
) {
  const app = new Hono();
  const sessions = sessionTools(config);
  const cookieName = `porden_${config.role}_session`;
  function failure(
    c: Context,
    code: string,
    status: ContentfulStatusCode,
    message = errorMessages[code] || errorMessages.INTERNAL_ERROR,
  ) {
    const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();
    c.header('X-Request-Id', requestId);
    return c.json({ error: { code, message, requestId } }, status);
  }
  app.use('*', requestLogging);
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  // The public verifier is cookie-free; its CORS headers are set before the body limit and rate
  // limit so cross-origin callers can read 413 and 429 responses (including Retry-After).
  app.use('/api/v1/receipts/verify', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    c.header('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id');
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({ maxSize: 65536, onError: (c) => failure(c, 'PAYLOAD_TOO_LARGE', 413) }),
  );
  app.onError((error, c) => {
    const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();
    c.header('X-Request-Id', requestId);
    const result = errorResponse(error, requestId);
    return c.json(result.body, result.status);
  });
  app.notFound((c) => {
    const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();
    c.header('X-Request-Id', requestId);
    return c.json(notFoundResponse(requestId), 404);
  });
  app.get('/health', (c) => c.json({ status: 'ok', role: config.role }));
  app.get('/ready', async (c) => {
    try {
      await db.ready();
      return c.json({ status: 'ready' });
    } catch (error) {
      throw new ApiError('NOT_READY', 503, undefined, { cause: error });
    }
  });
  app.get('/.well-known/jwks.json', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    return c.json(signing.jwks);
  });
  // Sign-in is a password check open to anyone: bound guessing to 20 attempts per client and 300
  // in total per minute per process, using the same limiter as the public verifier.
  const signInLimit = rateLimit({ windowMs: 60_000, perClient: 20, total: 300 });
  app.post('/api/v1/session', signInLimit, async (c) => {
    if (c.req.header('Origin') !== config.origin) throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
    const input = SignIn.parse(await c.req.json());
    if (!equal(input.password, config.demoPassword)) throw new ApiError('UNAUTHORIZED_ACTION', 401);
    const token = sessions.issue();
    setCookie(c, cookieName, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.origin.startsWith('https:'),
      path: '/',
      maxAge: 3600,
    });
    return c.json({ customerId: 'demo-user', csrf: sessions.csrf(token) });
  });
  app.use('/api/v1/*', async (c, next) => {
    if (c.req.path === '/api/v1/case-types' && c.req.method === 'GET') return next();
    // Public, read-only and cookie-free: anyone may check a receipt.
    if (c.req.path === '/api/v1/receipts/verify') return next();
    if (
      config.role === 'courier' &&
      c.req.path === '/api/v1/claim-policy' &&
      c.req.method === 'GET'
    )
      return next();
    if (
      config.role === 'courier' &&
      c.req.path.startsWith('/api/v1/cases/by-') &&
      c.req.method === 'GET'
    ) {
      if (!equal(c.req.header('Authorization') || '', `Bearer ${config.partnerSecret}`))
        throw new ApiError('UNAUTHORIZED_ACTION', 401);
      return next();
    }
    const token = getCookie(c, cookieName) || '';
    if (!sessions.valid(token)) throw new ApiError('UNAUTHORIZED_ACTION', 401);
    if (c.req.method !== 'GET') {
      if (c.req.header('Origin') !== config.origin) throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
      if (!equal(c.req.header('X-CSRF-Token') || '', sessions.csrf(token)))
        throw new ApiError('CSRF_MISMATCH', 403);
    }
    await next();
  });
  app.get('/api/v1/session', (c) =>
    c.json({ customerId: 'demo-user', csrf: sessions.csrf(getCookie(c, cookieName)!) }),
  );
  // Both organizations run their own agents through their own server-side model route.
  app.get('/api/config', (c) =>
    c.json({
      openrouterConfigured: Boolean(config.openrouterKey),
      openrouterModel: config.model,
      recipientOrigin: config.peerOrigin,
    }),
  );
  app.post('/api/llm/chat/completions', async (c) => {
    const token = getCookie(c, cookieName) || '';
    if (!sessions.valid(token)) throw new ApiError('UNAUTHORIZED_ACTION', 401);
    if (c.req.header('Origin') !== config.origin) throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
    if (!config.openrouterKey || !config.model) throw new ApiError('PROVIDER_NOT_CONFIGURED', 503);
    // Only chat-completion fields reach the provider. OpenRouter routing and billing extensions
    // (`models` fallbacks, `provider`, `plugins`, ...) are refused, so the site pays for one model only.
    const body = z
      .strictObject({
        model: z.string().min(1),
        messages: z.array(z.unknown()),
        stream: z.boolean().optional(),
        stream_options: z.strictObject({ include_usage: z.boolean().optional() }).optional(),
        tools: z.array(z.unknown()).optional(),
        tool_choice: z.unknown().optional(),
        parallel_tool_calls: z.boolean().optional(),
        temperature: z.number().optional(),
        top_p: z.number().optional(),
        max_tokens: z.number().int().positive().optional(),
        max_completion_tokens: z.number().int().positive().optional(),
        stop: z.union([z.string(), z.array(z.string())]).optional(),
        n: z.literal(1).optional(),
      })
      .parse(await c.req.json());
    // The site pays for this route, so it serves only the configured model; clients cannot choose another.
    if (body.model !== config.model) throw new ApiError('MODEL_NOT_ALLOWED', 400);
    const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: c.req.raw.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openrouterKey}`,
      },
      body: JSON.stringify(body),
    }).catch((cause) => {
      throw new ApiError(
        cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name)
          ? 'PROVIDER_TIMEOUT'
          : 'PROVIDER_CONNECTION_FAILED',
        cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name) ? 504 : 502,
        undefined,
        { cause },
      );
    });
    if (!response.ok) {
      await response.body
        ?.cancel()
        .catch((cause) =>
          reportError(
            'provider response cleanup',
            cause,
            c.res.headers.get('X-Request-Id') || undefined,
          ),
        );
      const upstream: Record<number, [string, ApiError['status']]> = {
        400: ['PROVIDER_REQUEST_REJECTED', 502],
        401: ['PROVIDER_AUTHENTICATION_FAILED', 502],
        403: ['PROVIDER_AUTHENTICATION_FAILED', 502],
        402: ['PROVIDER_CREDITS_EXHAUSTED', 503],
        404: ['PROVIDER_MODEL_UNAVAILABLE', 502],
        408: ['PROVIDER_TIMEOUT', 504],
        422: ['PROVIDER_REQUEST_REJECTED', 502],
        429: ['PROVIDER_RATE_LIMITED', 429],
        504: ['PROVIDER_TIMEOUT', 504],
      };
      const [code, status] = upstream[response.status] || ['PROVIDER_UNAVAILABLE', 502];
      throw new ApiError(code, status, undefined, { cause: { upstreamStatus: response.status } });
    }
    if (!response.body) throw new ApiError('PROVIDER_UNAVAILABLE', 502);
    const reader = response.body.getReader(),
      requestId = c.res.headers.get('X-Request-Id') || undefined;
    const bodyStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (cause) {
          reportError('provider stream', cause, requestId);
          controller.error(new Error(errorMessages.PROVIDER_UNAVAILABLE));
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch (cause) {
          reportError('provider stream cleanup', cause, requestId);
        }
      },
    });
    return new Response(bodyStream, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-store',
      },
    });
  });
  app.options('/api/v1/receipts/verify', (c) => c.body(null, 204));
  // Anyone may call the verifier, so bound its work: 30 checks per client and 600 in total per
  // minute per process. Issuer keys are cached, so a burst does not become a burst of key fetches.
  const verifyLimit = rateLimit({ windowMs: 60_000, perClient: 30, total: 600 });
  app.post('/api/v1/receipts/verify', verifyLimit, async (c) => {
    const input = VerifyReceiptRequest.parse(await c.req.json());
    return c.json(await checkReceipt(config, fetcher, input.receipt));
  });
  agentRoutes(app, config);
  if (config.role === 'courier') {
    app.get('/api/v1/claim-policy', (c) => {
      c.header('Access-Control-Allow-Origin', '*');
      return c.json(courierClaimPolicy);
    });
    app.get('/api/v1/claims/operations/:requestId', async (c) =>
      c.json(
        await courierClaims(config, fetcher).reconcile(z.uuid().parse(c.req.param('requestId'))),
      ),
    );
    app.get('/api/v1/claims', async (c) =>
      c.json(await courierClaims(config, fetcher).inbox(ClaimInboxQuery.parse(c.req.query()))),
    );
    app.post('/api/v1/claims/:id/executions/recover', async (c) =>
      c.json(
        await recoverDeliveryExecutions(config, db, fetcher, z.uuid().parse(c.req.param('id'))),
      ),
    );
    app.get('/api/v1/claims/:id/evaluation', async (c) =>
      c.json(await courierClaims(config, fetcher).evaluate(z.uuid().parse(c.req.param('id')))),
    );
    app.post('/api/v1/claims/:id/decisions', async (c) => {
      const input = CourierClaimDecision.parse(await c.req.json());
      return c.json(
        await courierClaims(config, fetcher).decide(z.uuid().parse(c.req.param('id')), input),
      );
    });
    app.get('/api/v1/case-types', (c) => c.json({ caseTypes: ['delivery_damage'], actionSchema }));
    app.post('/api/v1/cases', async (c) => {
      const args = CreateCase.parse(await c.req.json());
      const result = await createDeliveryCase(config, db, fetcher, args);
      return c.json(result, result.idempotent ? 200 : 201);
    });
    app.get('/api/v1/cases/by-request/:requestId', async (c) =>
      c.json(
        await db.findCase('request', CreateCase.shape.requestId.parse(c.req.param('requestId'))),
      ),
    );
    app.get('/api/v1/cases/by-transfer/:id', async (c) =>
      c.json(await db.findCase('transfer', z.uuid().parse(c.req.param('id')))),
    );
    app.get('/api/v1/receipts/:id', async (c) =>
      c.json(await db.getReceipt(z.uuid().parse(c.req.param('id')))),
    );
  } else {
    app.post('/api/v1/claims', async (c) =>
      c.json(
        await merchantClaims(config, fetcher, db).file(FileClaim.parse(await c.req.json())),
        201,
      ),
    );
    app.get('/api/v1/claims', async (c) =>
      c.json(await merchantClaims(config, fetcher, db).list()),
    );
    app.get('/api/v1/claims/:id/consent', async (c) =>
      c.json(await merchantClaims(config, fetcher, db).consent(z.uuid().parse(c.req.param('id')))),
    );
    app.get('/api/v1/orders/:reference', (c) => c.json(orderFacts(c.req.param('reference'))));
    app.get('/api/v1/claims/operations/:requestId', async (c) =>
      c.json(
        await merchantClaims(config, fetcher, db).reconcile(
          z.uuid().parse(c.req.param('requestId')),
        ),
      ),
    );
    app.get('/api/v1/claims/:id', async (c) =>
      c.json(await merchantClaims(config, fetcher, db).read(z.uuid().parse(c.req.param('id')))),
    );
    app.post('/api/v1/claims/:id/clarifications/resolve', async (c) => {
      const input = ResolveClaimClarification.parse(await c.req.json());
      return c.json(
        await merchantClaims(config, fetcher, db).resolveClarification(
          z.uuid().parse(c.req.param('id')),
          input,
        ),
      );
    });
    app.post('/api/v1/claims/:id/cancel', async (c) => {
      const input = VersionCommand.parse(await c.req.json());
      return c.json(
        await merchantClaims(config, fetcher, db).cancel(z.uuid().parse(c.req.param('id')), input),
      );
    });
    app.post('/api/v1/transfers', async (c) => {
      const input = CreateDraft.parse(await c.req.json());
      if (input.recipientOrigin !== config.peerOrigin)
        throw new ApiError('RECIPIENT_NOT_ALLOWED', 403);
      return c.json(await db.createDraft(input), 201);
    });
    app.get('/api/v1/transfers/:id', async (c) =>
      c.json(await db.getDraft(z.uuid().parse(c.req.param('id')))),
    );
    app.post('/api/v1/transfers/:id/approve', async (c) => {
      const input = ApproveTransfer.parse(await c.req.json());
      return c.json(
        await db.approve(z.uuid().parse(c.req.param('id')), input.approvedFields, fetcher),
      );
    });
    app.post('/api/v1/transfers/:id/submit', async (c) =>
      c.json(await db.transition(z.uuid().parse(c.req.param('id')), 'submitted')),
    );
    app.post('/api/v1/transfers/:id/outcome', async (c) => {
      const input = OutcomeUpdate.parse(await c.req.json());
      return c.json(await db.transition(z.uuid().parse(c.req.param('id')), input.status));
    });
    async function accept(id: string, token: string, requestId: string) {
      const claims = await verifyReceipt({ receipt: token, requestId }, config, fetcher);
      if (claims.governance)
        await merchantClaims(config, fetcher, db).verifyReceiptResolution(claims);
      return db.accept(id, claims, token);
    }
    app.post('/api/v1/transfers/:id/receipts', async (c) => {
      const input = ReceiptSubmission.parse(await c.req.json());
      return c.json(
        await accept(z.uuid().parse(c.req.param('id')), input.receipt, input.requestId),
      );
    });
    app.post('/api/v1/transfers/:id/reconcile', async (c) => {
      const id = z.uuid().parse(c.req.param('id')),
        draft = await db.getDraft(id);
      if (draft.status === 'accepted') return c.json(draft);
      if (!['submitted', 'unknown'].includes(draft.status))
        throw new ApiError('REQUEST_CONFLICT', 409);
      const response = await fetcher(`${config.peerOrigin}/api/v1/cases/by-transfer/${id}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${config.partnerSecret}` },
      }).catch((cause) => {
        throw new ApiError('RECIPIENT_UNAVAILABLE', 502, undefined, { cause });
      });
      if (response.status === 404) return c.json(await db.transition(id, 'unknown'));
      if (!response.ok) throw new ApiError('RECIPIENT_UNAVAILABLE', 502);
      const payload = await response.json().catch((cause) => {
        throw new ApiError('RECIPIENT_UNAVAILABLE', 502, undefined, { cause });
      });
      const parsed = CaseResponse.safeParse(payload);
      if (!parsed.success)
        throw new ApiError('RECIPIENT_UNAVAILABLE', 502, undefined, { cause: parsed.error });
      const result = parsed.data;
      await accept(id, result.receipt, result.requestId);
      return c.json(await db.getDraft(id));
    });
  }
  return app;
}
