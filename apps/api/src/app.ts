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
  actionSchema,
  errorMessages,
} from '@porden/contracts';
import { agentRoutes } from './agents';
import { equal, sessionTools, signer, verifyReceipt, type Fetcher } from './security';
import { ApiError } from './application/errors';
import { reportError } from './observability/logger';
import { errorResponse, notFoundResponse } from './http/error-handler';
import { requestLogging } from './http/request-logging';
import type { Config } from './config';
import type { store } from './db/store';
import { createDeliveryCase } from './services/delivery-authorization';

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
    return c.json({ keys: [signing.jwk] });
  });
  app.post('/api/v1/session', async (c) => {
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
  agentRoutes(app, config);
  if (config.role === 'courier') {
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
      if (!config.openrouterKey) throw new ApiError('PROVIDER_NOT_CONFIGURED', 503);
      const body = z
        .object({ model: z.string().min(1), messages: z.array(z.unknown()) })
        .passthrough()
        .parse(await c.req.json());
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
