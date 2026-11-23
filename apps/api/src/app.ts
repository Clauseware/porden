import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { DrizzleQueryError } from 'drizzle-orm';
import { CreateDraft, ApproveTransfer, CreateCase, ApprovalClaims, ReceiptClaims, ReceiptSubmission,
  OutcomeUpdate, actionSchema } from '@porden/contracts';
import { agentRoutes } from './agents';
import { ApiError, equal, hash, sessionTools, signer, verifyToken, type Fetcher } from './security';
import type { Config } from './config';
import type { store } from './db/store';

type Store = ReturnType<typeof store>;
export function createApp(config: Config, db: Store, signing: ReturnType<typeof signer>, fetcher: Fetcher = fetch) {
  const app = new Hono();
  const sessions = sessionTools(config);
  const cookieName = `porden_${config.role}_session`;
  app.use('*', async (c, next) => {c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); await next();});
  app.use('/api/*', bodyLimit({maxSize: 65536, onError: c => c.json({error: {code: 'PAYLOAD_TOO_LARGE'}}, 413)}));
  app.onError((error, c) => {
    const databaseError = error instanceof DrizzleQueryError ? error.cause : error;
    if (databaseError && 'errno' in databaseError && databaseError.errno === '23505') return c.json({error: {code: 'REQUEST_CONFLICT'}}, 409);
    if (error instanceof ApiError) return c.json({error: {code: error.code, message: error.message}}, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({error: {code: 'INVALID_INPUT'}}, 400);
    console.error('Porden request failed', error.name);
    return c.json({error: {code: 'INTERNAL_ERROR'}}, 500);
  });
  app.notFound(c => c.json({error: {code: 'NOT_FOUND'}}, 404));
  app.get('/healthz', c => c.json({status: 'ok', role: config.role}));
  app.get('/readyz', async c => {try {await db.ready(); return c.json({status: 'ready'});} catch {return c.json({error: {code: 'NOT_READY'}}, 503);}});
  app.get('/.well-known/jwks.json', c => {c.header('Access-Control-Allow-Origin', '*'); return c.json({keys: [signing.jwk]});});
  app.post('/api/v1/session', async c => {
    if (c.req.header('Origin') !== config.origin) throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
    const input = z.strictObject({password: z.string()}).parse(await c.req.json());
    if (!equal(input.password, config.demoPassword)) throw new ApiError('UNAUTHORIZED_ACTION', 401);
    const token = sessions.issue();
    setCookie(c, cookieName, token, {httpOnly: true, sameSite: 'Lax', secure: config.origin.startsWith('https:'), path: '/', maxAge: 3600});
    return c.json({customerId: 'demo-user', csrf: sessions.csrf(token)});
  });
  app.use('/api/v1/*', async (c, next) => {
    if (c.req.path === '/api/v1/case-types' && c.req.method === 'GET') return next();
    if (config.role === 'courier' && c.req.path.startsWith('/api/v1/cases/by-') && c.req.method === 'GET') {
      if (!equal(c.req.header('Authorization') || '', `Bearer ${config.partnerSecret}`)) throw new ApiError('UNAUTHORIZED_ACTION', 401);
      return next();
    }
    const token = getCookie(c, cookieName) || '';
    if (!sessions.valid(token)) throw new ApiError('UNAUTHORIZED_ACTION', 401);
    if (c.req.method !== 'GET') {
      if (c.req.header('Origin') !== config.origin) throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
      if (!equal(c.req.header('X-CSRF-Token') || '', sessions.csrf(token))) throw new ApiError('CSRF_MISMATCH', 403);
    }
    await next();
  });
  app.get('/api/v1/session', c => c.json({customerId: 'demo-user', csrf: sessions.csrf(getCookie(c, cookieName)!)}));
  agentRoutes(app, config);
  if (config.role === 'courier') {
    app.get('/api/v1/case-types', c => c.json({caseTypes: ['delivery_damage'], actionSchema}));
    app.post('/api/v1/cases', async c => {
      const args = CreateCase.parse(await c.req.json());
      const approval = ApprovalClaims.parse(await verifyToken(args.approval, config.peerOrigin, 'porden-approval+jwt', fetcher));
      if (approval.issuer !== config.peerOrigin || approval.audience !== config.origin || approval.transferId !== args.transferId ||
        approval.expiresAt <= Date.now() || approval.caseType !== args.caseType || approval.payloadSha256 !== hash(args.data) ||
        hash([...approval.approvedFields].sort()) !== hash(Object.keys(args.data).sort())) throw new ApiError('CONSENT_SCOPE_MISMATCH', 403);
      const result = await db.createCase(args);
      return c.json(result, result.idempotent ? 200 : 201);
    });
    app.get('/api/v1/cases/by-request/:requestId', async c => c.json(await db.findCase('request', c.req.param('requestId'))));
    app.get('/api/v1/cases/by-transfer/:id', async c => c.json(await db.findCase('transfer', z.uuid().parse(c.req.param('id')))));
  } else {
    app.get('/api/config', c => c.json({openrouterConfigured: Boolean(config.openrouterKey), openrouterModel: config.model}));
    app.post('/api/llm/chat/completions', async c => {
      const token = getCookie(c, cookieName) || '';
      if (!sessions.valid(token)) throw new ApiError('UNAUTHORIZED_ACTION', 401);
      if (c.req.header('Origin') !== config.origin) throw new ApiError('ORIGIN_NOT_ALLOWED', 403);
      if (!config.openrouterKey) throw new ApiError('PROVIDER_NOT_CONFIGURED', 503);
      const body = z.object({model: z.string().min(1), messages: z.array(z.unknown())}).passthrough().parse(await c.req.json());
      const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {method: 'POST', redirect: 'error',
        signal: c.req.raw.signal, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.openrouterKey}`}, body: JSON.stringify(body)});
      if (!response.ok) {await response.body?.cancel(); throw new ApiError('PROVIDER_UNAVAILABLE', 502);}
      return new Response(response.body, {headers: {'Content-Type': response.headers.get('content-type') || 'text/event-stream', 'Cache-Control': 'no-store'}});
    });
    app.post('/api/v1/transfers', async c => {
      const input = CreateDraft.parse(await c.req.json());
      if (input.recipientOrigin !== config.peerOrigin) throw new ApiError('RECIPIENT_NOT_ALLOWED', 403);
      return c.json(await db.createDraft(input), 201);
    });
    app.get('/api/v1/transfers/:id', async c => c.json(await db.getDraft(z.uuid().parse(c.req.param('id')))));
    app.post('/api/v1/transfers/:id/approve', async c => {
      const input = ApproveTransfer.parse(await c.req.json());
      return c.json(await db.approve(z.uuid().parse(c.req.param('id')), input.approvedFields));
    });
    app.post('/api/v1/transfers/:id/submit', async c => c.json(await db.transition(z.uuid().parse(c.req.param('id')), 'submitted')));
    app.post('/api/v1/transfers/:id/outcome', async c => {
      const input = OutcomeUpdate.parse(await c.req.json());
      return c.json(await db.transition(z.uuid().parse(c.req.param('id')), input.status));
    });
    async function accept(id: string, token: string, requestId: string) {
      const claims = ReceiptClaims.parse(await verifyToken(token, config.peerOrigin, 'porden-receipt+jwt', fetcher));
      if (claims.requestId !== requestId) throw new ApiError('RECEIPT_INVALID', 403);
      return db.accept(id, claims, token);
    }
    app.post('/api/v1/transfers/:id/receipts', async c => {
      const input = ReceiptSubmission.parse(await c.req.json());
      return c.json(await accept(z.uuid().parse(c.req.param('id')), input.receipt, input.requestId));
    });
    app.post('/api/v1/transfers/:id/reconcile', async c => {
      const id = z.uuid().parse(c.req.param('id')), draft = await db.getDraft(id);
      if (draft.status === 'accepted') return c.json(draft);
      if (!['submitted', 'unknown'].includes(draft.status)) throw new ApiError('REQUEST_CONFLICT', 409);
      const response = await fetcher(`${config.peerOrigin}/api/v1/cases/by-transfer/${id}`, {redirect: 'error',
        signal: AbortSignal.timeout(5000), headers: {Authorization: `Bearer ${config.partnerSecret}`}});
      if (response.status === 404) return c.json(await db.transition(id, 'unknown'));
      if (!response.ok) throw new ApiError('RECIPIENT_UNAVAILABLE', 502);
      const result = await response.json() as {receipt: string; requestId: string};
      await accept(id, result.receipt, result.requestId);
      return c.json(await db.getDraft(id));
    });
  }
  return app;
}
