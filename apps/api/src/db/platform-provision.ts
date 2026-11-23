import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { organizations, principals } from './platform-schema';
import { loadPlatformConfig } from '../platform-config';
import { reportError } from '../security';

export const Provisioning = z.strictObject({
  organizations: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: z.string().min(1).max(200),
        humanApprovalRequired: z.boolean().optional(),
      }),
    )
    .min(1),
  principals: z
    .array(
      z.strictObject({
        id: z.uuid(),
        organizationId: z.uuid(),
        name: z.string().min(1).max(200),
        login: z.string().min(1).max(200),
        kind: z.enum(['human', 'integration']),
        role: z.enum(['member', 'approver']),
        secret: z.string().min(16).max(256),
      }),
    )
    .min(1),
});
export async function provisionPlatform(client: SQL, input: z.infer<typeof Provisioning>) {
  const records = await Promise.all(
    input.principals.map(async (principal) => {
      const { secret, ...record } = principal;
      if (record.kind === 'integration' && record.role !== 'member')
        throw Error('Integration principals cannot be human approvers');
      return {
        ...record,
        secretHash:
          record.kind === 'human'
            ? await Bun.password.hash(secret)
            : createHash('sha256').update(secret).digest('hex'),
      };
    }),
  );
  await drizzle(client).transaction(async (tx) => {
    await tx.insert(organizations).values(input.organizations);
    await tx.insert(principals).values(records);
  });
}
if (import.meta.main) {
  let client: SQL | undefined;
  try {
    const path = process.env.PORDEN_PROVISION_FILE;
    if (!path) throw Error('PORDEN_PROVISION_FILE is required');
    const input = Provisioning.parse(await Bun.file(path).json());
    client = new SQL({ url: loadPlatformConfig().databaseUrl, prepare: false });
    await provisionPlatform(client, input);
    console.log('Provisioned Porden organizations and principals');
  } catch (error) {
    reportError('platform provisioning', error);
    process.exitCode = 1;
  } finally {
    await client?.close();
  }
}
