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

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503 | 504,
    message = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export function errorDiagnostics(error: unknown) {
  let systemCode: string | undefined,
    upstreamStatus: number | undefined,
    configurationField: string | undefined;
  for (
    let current: unknown = error, depth = 0;
    current && typeof current === 'object' && depth < 5;
    depth++
  ) {
    if ('errno' in current && typeof current.errno === 'string') systemCode = current.errno;
    else if ('code' in current && typeof current.code === 'string') systemCode = current.code;
    if ('upstreamStatus' in current && typeof current.upstreamStatus === 'number')
      upstreamStatus = current.upstreamStatus;
    if (
      'configurationField' in current &&
      typeof current.configurationField === 'string' &&
      /^[A-Z_]+$/.test(current.configurationField)
    )
      configurationField = current.configurationField;
    current = 'cause' in current ? current.cause : undefined;
  }
  // Never log error messages, SQL, request payloads, headers or provider response bodies.
  return {
    systemCode:
      systemCode && /^(CONFIGURATION_INVALID|E[A-Z_]+|ERR_[A-Z_]+|[A-Z0-9]{5})$/.test(systemCode)
        ? systemCode
        : undefined,
    upstreamStatus,
    configurationField,
  };
}
export function reportError(operation: string, error: unknown, requestId?: string) {
  const frames =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 4)
      : undefined;
  console.error('Porden error', {
    operation,
    requestId,
    errorName: error instanceof Error ? error.name : 'NonError',
    ...errorDiagnostics(error),
    frames,
  });
}
export const hash = (value: unknown) =>
  createHash('sha256').update(canonicalize(value)).digest('hex');
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function signer(config: Pick<Config, 'keyPath' | 'keyId'>) {
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
const PublicKeys = z.object({
  keys: z.array(
    z.object({
      kid: z.string(),
      alg: z.literal('ES256'),
      kty: z.literal('EC'),
      crv: z.literal('P-256'),
      use: z.literal('sig'),
      x: z.string(),
      y: z.string(),
    }),
  ),
});
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
    const response = await fetcher(`${origin}/.well-known/jwks.json`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    }).catch((cause) => {
      throw new ApiError('RECIPIENT_UNAVAILABLE', 502, undefined, { cause });
    });
    if (!response.ok) throw Error('Keys unavailable');
    const { keys } = PublicKeys.parse(await response.json());
    const jwk = keys.find(
      (key) =>
        key.kid === header.kid &&
        key.alg === 'ES256' &&
        key.kty === 'EC' &&
        key.crv === 'P-256' &&
        key.use === 'sig',
    );
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
