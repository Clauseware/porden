import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { DrizzleQueryError } from 'drizzle-orm';
import { z } from 'zod';
import {
  type Principal,
  PlatformSignIn,
  CreateHandoff,
  HandoffParams,
  RevisionParams,
  HandoffQuery,
  VersionCommand,
  ProposeRevision,
  RevisionDecision,
  FinishHandoff,
  AuthorizationQuery,
  errorMessages,
} from '@porden/contracts';
import { ApiError, equal, reportError, errorDiagnostics, type signer } from './security';
import type { PlatformConfig } from './platform-config';
import type { platformStore } from './db/platform-store';
import type { platformAuth } from './platform-auth';

const json = <T extends z.ZodType>(schema: T) => validator('json', (value) => schema.parse(value));
const params = <T extends z.ZodType>(schema: T) =>
  validator('param', (value) => schema.parse(value));
const query = <T extends z.ZodType>(schema: T) =>
  validator('query', (value) => schema.parse(value));
export function createPlatformApp(
  config: PlatformConfig,
  db: ReturnType<typeof platformStore>,
  auth: ReturnType<typeof platformAuth>,
  signing: ReturnType<typeof signer>,
) {
  const app = new Hono<{ Variables: { principal: Principal; requestId: string } }>();
  const cookie = 'porden_platform_session';
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.header('X-Request-Id', c.get('requestId'));
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.onError((error, c) => {
    const cause = error instanceof DrizzleQueryError ? error.cause : error;
    const { systemCode } = errorDiagnostics(cause);
    let code = 'INTERNAL_ERROR';
    let status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503 | 504 = 500;
    if (error instanceof ApiError) {
      code = error.code;
      status = error.status;
    } else if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof HTTPException && error.status === 400)
    ) {
      code = 'INVALID_INPUT';
      status = 400;
    } else if (systemCode === '23505') {
      code = 'REQUEST_CONFLICT';
      status = 409;
    } else if (
      error instanceof DrizzleQueryError &&
      systemCode &&
      /^(08|53|57P|ECONN|ETIMEDOUT|ERR_POSTGRES_CONNECTION)/.test(systemCode)
    ) {
      code = 'DATABASE_UNAVAILABLE';
      status = 503;
    }
    if (status >= 500) reportError(c.req.routePath, error, c.get('requestId'));
    return c.json(
      {
        error: {
          code,
          message: errorMessages[code] || errorMessages.INTERNAL_ERROR,
          requestId: c.get('requestId'),
        },
      },
      status,
    );
  });
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: errorMessages.NOT_FOUND,
          requestId: c.get('requestId'),
        },
      },
      404,
    ),
  );
  app.use(
    '/api/v2/*',
    bodyLimit({
      maxSize: 65536,
      onError: () => {
        throw new ApiError('PAYLOAD_TOO_LARGE', 413);
      },
    }),
  );
  app.use(
    '/api/v2/*',
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : undefined),
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
      exposeHeaders: ['X-Request-Id'],
    }),
  );
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/readyz', async (c) => {
    await db.ready();
    return c.json({ status: 'ready' });
  });
  app.get('/.well-known/jwks.json', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    return c.json({ keys: [signing.jwk] });
  });
  app.post(
    '/api/v2/session',
    async (c, next) => {
      if (!config.allowedOrigins.includes(c.req.header('Origin') || ''))
        throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
      await next();
    },
    json(PlatformSignIn),
    async (c) => {
      const input = c.req.valid('json'),
        session = await auth.login(input.login, input.password);
      setCookie(c, cookie, session.token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: config.origin.startsWith('https:'),
        path: '/',
        maxAge: 3600,
      });
      return c.json({ principal: session.principal, csrf: session.csrf });
    },
  );
  app.use('/api/v2/*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !config.allowedOrigins.includes(origin))
      throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
    const authorization = c.req.header('Authorization');
    if (authorization && !/^Bearer [A-Za-z0-9_-]{16,256}$/.test(authorization))
      throw new ApiError('UNAUTHORIZED_ACTION', 401);
    const bearer = Boolean(authorization),
      token = bearer ? authorization!.slice(7) : getCookie(c, cookie) || '';
    c.set('principal', await auth.authenticate(token, bearer));
    if (c.req.method !== 'GET' && !bearer) {
      if (!origin || !config.allowedOrigins.includes(origin))
        throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
      if (!equal(c.req.header('X-CSRF-Token') || '', auth.csrf(token)))
        throw new ApiError('CSRF_MISMATCH', 403);
    }
    await next();
  });
  app.get('/api/v2/session', (c) =>
    c.json({ principal: c.get('principal'), csrf: auth.csrf(getCookie(c, cookie) || '') }),
  );
  app.post('/api/v2/logout', json(z.strictObject({})), async (c) => {
    if (c.get('principal').kind !== 'human') throw new ApiError('UNAUTHORIZED_ACTION', 403);
    await auth.logout(getCookie(c, cookie) || '');
    deleteCookie(c, cookie, { path: '/' });
    return c.json({ signedOut: true });
  });
  app.get('/api/v2/organizations', async (c) => c.json({ items: await db.organizations() }));
  app.get('/api/v2/handoffs', query(HandoffQuery), async (c) =>
    c.json(await db.list(c.get('principal'), c.req.valid('query'))),
  );
  app.post('/api/v2/handoffs', json(CreateHandoff), async (c) =>
    c.json(await db.create(c.get('principal'), c.req.valid('json')), 201),
  );
  app.get('/api/v2/handoffs/:id', params(HandoffParams), async (c) =>
    c.json(await db.get(c.get('principal'), c.req.valid('param').id)),
  );
  app.post('/api/v2/handoffs/:id/approve', params(HandoffParams), json(VersionCommand), async (c) =>
    c.json(await db.approve(c.get('principal'), c.req.valid('param').id, c.req.valid('json'))),
  );
  app.post('/api/v2/handoffs/:id/accept', params(HandoffParams), json(VersionCommand), async (c) =>
    c.json(await db.accept(c.get('principal'), c.req.valid('param').id, c.req.valid('json'))),
  );
  app.post('/api/v2/handoffs/:id/reject', params(HandoffParams), json(VersionCommand), async (c) =>
    c.json(await db.accept(c.get('principal'), c.req.valid('param').id, c.req.valid('json'), true)),
  );
  app.post('/api/v2/handoffs/:id/cancel', params(HandoffParams), json(VersionCommand), async (c) =>
    c.json(await db.cancel(c.get('principal'), c.req.valid('param').id, c.req.valid('json'))),
  );
  app.post(
    '/api/v2/handoffs/:id/revisions',
    params(HandoffParams),
    json(ProposeRevision),
    async (c) =>
      c.json(
        await db.propose(c.get('principal'), c.req.valid('param').id, c.req.valid('json')),
        201,
      ),
  );
  app.post(
    '/api/v2/handoffs/:id/revisions/:revisionId/decision',
    params(RevisionParams),
    json(RevisionDecision),
    async (c) =>
      c.json(
        await db.decide(
          c.get('principal'),
          c.req.valid('param').id,
          c.req.valid('param').revisionId,
          c.req.valid('json'),
        ),
      ),
  );
  app.post('/api/v2/handoffs/:id/finish', params(HandoffParams), json(FinishHandoff), async (c) =>
    c.json(await db.finish(c.get('principal'), c.req.valid('param').id, c.req.valid('json'))),
  );
  app.get(
    '/api/v2/handoffs/:id/authorization',
    params(HandoffParams),
    query(AuthorizationQuery),
    async (c) =>
      c.json(
        await db.authorization(
          c.get('principal'),
          c.req.valid('param').id,
          c.req.valid('query').version,
        ),
      ),
  );
  app.get('/api/v2/approvals', query(z.strictObject({})), async (c) =>
    c.json(await db.pending(c.get('principal'))),
  );
  app.get('/api/v2/workflows/:id', params(HandoffParams), async (c) =>
    c.json(await db.workflow(c.get('principal'), c.req.valid('param').id)),
  );
  app.get('/api/v2/operations/:id', params(HandoffParams), async (c) =>
    c.json(await db.reconcile(c.get('principal'), c.req.valid('param').id)),
  );
  return app;
}
