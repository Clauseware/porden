import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../application/errors';

/**
 * Fixed-window, in-memory request limit for public endpoints of a single API process.
 * Clients are identified by the right-most X-Forwarded-For entry: in the deployment, Caddy is the
 * only public entry point and replaces client-supplied forwarding headers with the address it saw.
 * The global ceiling bounds total work (and memory) even if that header is ever spoofed.
 */
export function rateLimit(options: {
  windowMs: number;
  perClient: number;
  total: number;
  now?: () => number;
}): MiddlewareHandler {
  const now = options.now ?? Date.now;
  let windowStart = 0,
    total = 0;
  const clients = new Map<string, number>();
  return async (c, next) => {
    const at = now();
    if (at - windowStart >= options.windowMs) {
      windowStart = at;
      total = 0;
      clients.clear();
    }
    const client = c.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim() || 'unidentified';
    const count = clients.get(client) ?? 0;
    if (total >= options.total || count >= options.perClient) {
      c.header(
        'Retry-After',
        String(Math.max(1, Math.ceil((windowStart + options.windowMs - at) / 1000))),
      );
      throw new ApiError('RATE_LIMITED', 429);
    }
    total += 1;
    clients.set(client, count + 1);
    await next();
  };
}
