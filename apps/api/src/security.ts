import { createHash, createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalize } from '@porden/contracts';
import type { Config } from './config';

export class ApiError extends Error {
  constructor(public code: string, public status: 400 | 401 | 403 | 404 | 409 | 413 | 502 | 503, message = code) { super(message); }
}
export const hash = (value: unknown) => createHash('sha256').update(canonicalize(value)).digest('hex');
export function equal(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function signer(config: Pick<Config, 'keyPath' | 'keyId'>) {
  const key = createPrivateKey(readFileSync(config.keyPath));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('ES256 P-256 key required');
  const jwk = {...createPublicKey(key).export({format: 'jwk'}), kid: config.keyId, alg: 'ES256', use: 'sig'};
  return {jwk, sign(payload: unknown, typ: 'porden-approval+jwt' | 'porden-receipt+jwt') {
    const header = Buffer.from(JSON.stringify({alg: 'ES256', kid: config.keyId, typ})).toString('base64url');
    const data = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    return `${data}.${sign('sha256', Buffer.from(data), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url')}`;
  }};
}
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export async function verifyToken(token: string, origin: string, typ: string, fetcher: Fetcher = fetch) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part))) throw Error('Malformed JWS');
    const [headerPart, body, signature] = parts;
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
    if (header.alg !== 'ES256' || header.typ !== typ || typeof header.kid !== 'string') throw Error('Invalid header');
    const response = await fetcher(`${origin}/.well-known/jwks.json`, {redirect: 'error', signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw Error('Keys unavailable');
    const {keys} = await response.json() as {keys: any[]};
    const jwk = keys.find(key => key.kid === header.kid && key.alg === 'ES256' && key.kty === 'EC' && key.crv === 'P-256' && key.use === 'sig');
    if (!jwk || !verify('sha256', Buffer.from(`${headerPart}.${body}`),
      {key: createPublicKey({key: jwk, format: 'jwk'}), dsaEncoding: 'ieee-p1363'}, Buffer.from(signature, 'base64url'))) throw Error('Signature invalid');
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as unknown;
  } catch { throw new ApiError('SIGNATURE_INVALID', 403); }
}
export function sessionTools(config: Config) {
  const mac = (value: string) => createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
  return {
    issue() {const value = Buffer.from(JSON.stringify({user: 'demo-user', exp: Date.now() + 3600000})).toString('base64url'); return `${value}.${mac(value)}`;},
    valid(token: string) {try {const [value, signature] = token.split('.'); return equal(mac(value), signature) && JSON.parse(Buffer.from(value, 'base64url').toString()).exp > Date.now();} catch {return false;}},
    csrf(token: string) {return mac(`csrf:${token}`);},
  };
}
