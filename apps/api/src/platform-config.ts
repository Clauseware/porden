import { resolve } from 'node:path';
import { z } from 'zod';
import { Origin } from '@porden/contracts';

export const PlatformEnvironment = z.object({
  PORDEN_DATABASE_URL: z
    .url()
    .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  PORDEN_PUBLIC_ORIGIN: Origin,
  PORDEN_ALLOWED_ORIGINS: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(Origin).min(1)),
  PORDEN_SESSION_SECRET: z.string().min(32),
  PORDEN_SIGNING_KEY_PATH: z.string().min(1),
  PORDEN_SIGNING_KEY_ID: z.string().min(1).default('porden-platform-v1'),
  PORDEN_PORT: z.coerce.number().int().min(1).max(65535).default(5300),
  PORDEN_HOST: z.string().min(1).default('127.0.0.1'),
});
export function loadPlatformConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = PlatformEnvironment.safeParse(env);
  if (!parsed.success)
    throw Object.assign(new Error('Invalid platform configuration'), {
      code: 'CONFIGURATION_INVALID',
      configurationField: parsed.error.issues[0]?.path[0],
    });
  const value = parsed.data;
  if (!value.PORDEN_ALLOWED_ORIGINS.includes(value.PORDEN_PUBLIC_ORIGIN))
    throw Object.assign(new Error('Dashboard origin must be allowed'), {
      code: 'CONFIGURATION_INVALID',
      configurationField: 'PORDEN_ALLOWED_ORIGINS',
    });
  return {
    databaseUrl: value.PORDEN_DATABASE_URL,
    origin: value.PORDEN_PUBLIC_ORIGIN,
    allowedOrigins: value.PORDEN_ALLOWED_ORIGINS,
    sessionSecret: value.PORDEN_SESSION_SECRET,
    keyPath: resolve(value.PORDEN_SIGNING_KEY_PATH),
    keyId: value.PORDEN_SIGNING_KEY_ID,
    port: value.PORDEN_PORT,
    host: value.PORDEN_HOST,
  };
}
export type PlatformConfig = ReturnType<typeof loadPlatformConfig>;
