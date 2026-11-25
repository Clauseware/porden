import type { Context, Next } from 'hono';
import { logRequest } from '../observability/logger';

export async function requestLogging(c: Context, next: Next) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  c.header('X-Request-Id', requestId);
  try {
    await next();
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error('Unexpected request failure', { cause });
  } finally {
    logRequest({
      requestId,
      method: c.req.method,
      route: c.req.routePath || 'unmatched',
      status: c.res.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}
