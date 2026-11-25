import { Origin } from '@porden/contracts';
import { z } from 'zod';
import { resolve } from 'node:path';

export type Config = ReturnType<typeof loadConfig>;
export function loadConfig(env: Record<string, string | undefined> = process.env) {
  function required(name: string) {
    const value = env[name];
    if (!value)
      throw Object.assign(new Error(`${name} is required`), {
        code: 'CONFIGURATION_INVALID',
        configurationField: name,
      });
    return value;
  }
  const role = required('ORGANIZATION_ROLE');
  if (role !== 'merchant' && role !== 'courier')
    throw new Error('ORGANIZATION_ROLE must be merchant or courier');
  const origin = Origin.parse(required('PUBLIC_ORIGIN'));
  const peerOrigin = Origin.parse(required('PEER_ORIGIN'));
  if (origin === peerOrigin) throw new Error('Organizations must have different origins');
  const databaseUrl = required('DATABASE_URL');
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol))
    throw new Error('PostgreSQL is required');
  const sessionSecret = required('SESSION_SECRET');
  const partnerSecret = required('PARTNER_SECRET');
  if (sessionSecret.length < 32 || partnerSecret.length < 32)
    throw new Error('Secrets must have at least 32 characters');
  const port = Number(env.PORT || (role === 'merchant' ? 5100 : 5200));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const platformConfigured = [
    'PORDEN_API_ORIGIN',
    'PORDEN_INTEGRATION_TOKEN',
    'PORDEN_ORGANIZATION_ID',
    'PORDEN_PEER_ORGANIZATION_ID',
  ].some((name) => env[name]);
  const platform = platformConfigured
    ? {
        origin: Origin.parse(required('PORDEN_API_ORIGIN')),
        token: required('PORDEN_INTEGRATION_TOKEN'),
        organizationId: z.uuid().parse(required('PORDEN_ORGANIZATION_ID')),
        peerOrganizationId: z.uuid().parse(required('PORDEN_PEER_ORGANIZATION_ID')),
      }
    : undefined;
  if (
    platform &&
    (platform.token.length < 16 ||
      platform.token.length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(platform.token) ||
      platform.organizationId === platform.peerOrganizationId)
  )
    throw new Error('Invalid platform integration configuration');
  // Groq is the fallback for the OpenRouter model route.
  const groq = { key: required('GROQ_API_KEY'), model: required('GROQ_MODEL') };
  return {
    role,
    host: env.HOST || '127.0.0.1',
    platform,
    origin,
    peerOrigin,
    databaseUrl,
    sessionSecret,
    partnerSecret,
    port,
    demoPassword: required('DEMO_PASSWORD'),
    keyPath: resolve(required('SIGNING_KEY_PATH')),
    keyId: env.SIGNING_KEY_ID || `porden-${role}-v1`,
    // Optional JSON file {keys:[public JWK]} of retired keys kept published for old receipts.
    retiredKeysPath: env.SIGNING_RETIRED_KEYS_PATH
      ? resolve(env.SIGNING_RETIRED_KEYS_PATH)
      : undefined,
    runtimePath: resolve(env.NSDEPLOY_RUNTIME_PATH || 'vendor/nsdeploy/nsdeploy/runtime'),
    openrouterKey: env.OPENROUTER_API_KEY || env.openrouter_api_key || '',
    model: env.OPENROUTER_MODEL || env.openrouter_model || '',
    groq,
  } as const;
}
