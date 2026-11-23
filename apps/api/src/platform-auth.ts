import type { SQL } from 'bun';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { Principal } from '@porden/contracts';
import { principals, platformSessions } from './db/platform-schema';
import { ApiError } from './application/errors';
import type { PlatformConfig } from './platform-config';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function platformAuth(client: SQL, config: PlatformConfig) {
  const db = drizzle(client);
  function publicPrincipal(row: typeof principals.$inferSelect): Principal {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      kind: row.kind,
      role: row.role,
    };
  }
  const csrf = (token: string) =>
    createHmac('sha256', config.sessionSecret).update(`csrf:${token}`).digest('base64url');
  return {
    csrf,
    async login(login: string, password: string) {
      const [row] = await db
        .select()
        .from(principals)
        .where(
          and(eq(principals.login, login), eq(principals.kind, 'human'), eq(principals.active, 1)),
        );
      // Verify a dummy hash for unknown logins before returning the same authentication error.
      const invalidHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
      if (!(await Bun.password.verify(password, row?.secretHash || invalidHash)) || !row)
        throw new ApiError('UNAUTHORIZED_ACTION', 401);
      const token = randomBytes(32).toString('base64url');
      await db.insert(platformSessions).values({
        tokenHash: digest(token),
        principalId: row.id,
        expiresAt: new Date(Date.now() + 3600000),
      });
      return { token, principal: publicPrincipal(row), csrf: csrf(token) };
    },
    async authenticate(token: string, bearer: boolean) {
      if (!token || token.length > 256) throw new ApiError('UNAUTHORIZED_ACTION', 401);
      const rows = bearer
        ? await db
            .select({ principal: principals })
            .from(principals)
            .where(
              and(
                eq(principals.kind, 'integration'),
                eq(principals.secretHash, digest(token)),
                eq(principals.active, 1),
              ),
            )
        : await db
            .select({ principal: principals })
            .from(platformSessions)
            .innerJoin(principals, eq(principals.id, platformSessions.principalId))
            .where(
              and(
                eq(platformSessions.tokenHash, digest(token)),
                gt(platformSessions.expiresAt, new Date()),
                eq(principals.active, 1),
                eq(principals.kind, 'human'),
              ),
            );
      if (rows.length !== 1) throw new ApiError('UNAUTHORIZED_ACTION', 401);
      return publicPrincipal(rows[0].principal);
    },
    async logout(token: string) {
      await db.delete(platformSessions).where(eq(platformSessions.tokenHash, digest(token)));
    },
  };
}
