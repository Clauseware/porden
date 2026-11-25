import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  canonicalize,
  ApprovalClaims,
  ReceiptClaims,
  type CreateCase,
  type ReceiptSubmission,
} from '@porden/contracts';
import type { Config } from './config';
import { ApiError } from './application/errors';
export const hash = (value: unknown) =>
  createHash('sha256').update(canonicalize(value)).digest('hex');
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
const PublishedKey = z.strictObject({
  kid: z.string().min(1),
  alg: z.literal('ES256'),
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  use: z.literal('sig'),
  x: z.string(),
  y: z.string(),
});
/**
 * Loads retired public keys that stay published so receipts signed before a key rotation remain
 * verifiable. Fails fast on private material, malformed keys or duplicate key IDs.
 */
function retiredKeys(path: string | undefined, currentKid: string) {
  if (!path) return [];
  const parsed = z
    .strictObject({ keys: z.array(PublishedKey) })
    .safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success)
    throw new Error('Retired signing keys must be public ES256 P-256 JWKs (no private fields)');
  const kids = new Set([currentKid]);
  for (const key of parsed.data.keys) {
    if (kids.has(key.kid)) throw new Error(`Duplicate signing key ID: ${key.kid}`);
    kids.add(key.kid);
    createPublicKey({ key, format: 'jwk' });
  }
  return parsed.data.keys;
}
export function signer(
  config: Pick<Config, 'keyPath' | 'keyId'> & { retiredKeysPath?: string | undefined },
) {
  const key = createPrivateKey(readFileSync(config.keyPath));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('ES256 P-256 key required');
  const jwk = {
    ...createPublicKey(key).export({ format: 'jwk' }),
    kid: config.keyId,
    alg: 'ES256',
    use: 'sig',
  };
  return {
    jwk,
    /** Published key set: the current signing key first, then retired verification-only keys. */
    jwks: { keys: [jwk, ...retiredKeys(config.retiredKeysPath, config.keyId)] },
    sign(
      payload: unknown,
      typ: 'porden-approval+jwt' | 'porden-receipt+jwt' | 'porden-handoff-receipt+jwt',
    ) {
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId, typ })).toString(
        'base64url',
      );
      const data = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
      return `${data}.${sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    },
  };
}
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const PublicKey = z.object({
  kid: z.string(),
  alg: z.literal('ES256'),
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  use: z.literal('sig'),
  x: z.string(),
  y: z.string(),
});
type PublicKey = z.infer<typeof PublicKey>;
// Issuer keys are cached per fetcher so public verification does not fetch keys on every request.
// An unknown key ID forces one refresh (the issuer may have rotated), at most every 30 seconds.
const keyCacheMs = 5 * 60_000,
  keyRefreshMs = 30_000;
const keyCache = new WeakMap<Fetcher, Map<string, { keys: PublicKey[]; fetchedAt: number }>>();
// Unavailable or unreadable keys mean a token could not be checked, never that it is invalid.
const unavailable = (cause?: unknown) =>
  new ApiError('RECIPIENT_UNAVAILABLE', 502, undefined, { cause });
async function fetchKeys(origin: string, fetcher: Fetcher) {
  const response = await fetcher(`${origin}/.well-known/jwks.json`, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  }).catch((cause) => {
    throw unavailable(cause);
  });
  if (!response.ok) throw unavailable();
  const document = z.object({ keys: z.array(z.unknown()) }).safeParse(
    await response.json().catch((cause) => {
      throw unavailable(cause);
    }),
  );
  if (!document.success) throw unavailable(document.error);
  // Keys this verifier cannot use (other algorithms or types) are skipped, not fatal.
  const keys: PublicKey[] = [];
  for (const entry of document.data.keys) {
    const key = PublicKey.safeParse(entry);
    if (key.success) keys.push(key.data);
  }
  return keys;
}
async function issuerKey(origin: string, kid: string, fetcher: Fetcher, now = Date.now()) {
  let byOrigin = keyCache.get(fetcher);
  if (!byOrigin) keyCache.set(fetcher, (byOrigin = new Map()));
  const cached = byOrigin.get(origin);
  if (cached && now - cached.fetchedAt < keyCacheMs) {
    const known = cached.keys.find((key) => key.kid === kid);
    if (known) return known;
    // Unknown key ID but a refresh is throttled: the issuer may have just rotated, so this token
    // cannot be checked yet. Report it as unavailable rather than invalid.
    if (now - cached.fetchedAt < keyRefreshMs) throw unavailable();
  }
  const keys = await fetchKeys(origin, fetcher);
  byOrigin.set(origin, { keys, fetchedAt: now });
  return keys.find((key) => key.kid === kid);
}
export async function verifyToken(
  token: string,
  origin: string,
  typ: string,
  fetcher: Fetcher = fetch,
) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[\w-]+$/.test(part)))
      throw Error('Malformed JWS');
    const [headerPart, body, signature] = parts;
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
    if (header.alg !== 'ES256' || header.typ !== typ || typeof header.kid !== 'string')
      throw Error('Invalid header');
    const jwk = await issuerKey(origin, header.kid, fetcher);
    if (
      !jwk ||
      !verify(
        'sha256',
        Buffer.from(`${headerPart}.${body}`),
        { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      )
    )
      throw Error('Signature invalid');
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as unknown;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new ApiError('SIGNATURE_INVALID', 403, undefined, { cause });
  }
}
export async function verifyApproval(args: CreateCase, config: Config, fetcher: Fetcher) {
  const parsed = ApprovalClaims.safeParse(
    await verifyToken(args.approval, config.peerOrigin, 'porden-approval+jwt', fetcher),
  );
  if (!parsed.success)
    throw new ApiError('CONSENT_SCOPE_MISMATCH', 403, undefined, { cause: parsed.error });
  const approval = parsed.data;
  if (
    approval.issuer !== config.peerOrigin ||
    approval.audience !== config.origin ||
    approval.transferId !== args.transferId ||
    approval.expiresAt <= Date.now() ||
    approval.caseType !== args.caseType ||
    approval.payloadSha256 !== hash(args.data) ||
    hash([...approval.approvedFields].sort()) !== hash(Object.keys(args.data).sort())
  )
    throw new ApiError('CONSENT_SCOPE_MISMATCH', 403);
  return approval;
}
export async function verifyReceipt(input: ReceiptSubmission, config: Config, fetcher: Fetcher) {
  const parsed = ReceiptClaims.safeParse(
    await verifyToken(input.receipt, config.peerOrigin, 'porden-receipt+jwt', fetcher),
  );
  if (!parsed.success)
    throw new ApiError('RECEIPT_INVALID', 403, undefined, { cause: parsed.error });
  const claims = parsed.data;
  if (claims.requestId !== input.requestId) throw new ApiError('RECEIPT_INVALID', 403);
  return claims;
}
export function sessionTools(config: Config) {
  const mac = (value: string) =>
    createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
  return {
    issue() {
      const value = Buffer.from(
        JSON.stringify({ user: 'demo-user', exp: Date.now() + 3600000 }),
      ).toString('base64url');
      return `${value}.${mac(value)}`;
    },
    valid(token: string) {
      try {
        const [value, signature] = token.split('.');
        return (
          equal(mac(value), signature) &&
          JSON.parse(Buffer.from(value, 'base64url').toString()).exp > Date.now()
        );
      } catch {
        return false;
      }
    },
    csrf(token: string) {
      return mac(`csrf:${token}`);
    },
  };
}
