import { HandoffReceiptClaims, ReceiptClaims, type ReceiptVerification } from '@porden/contracts';
import { z } from 'zod';
import type { Config } from '../config';
import { ApiError } from '../application/errors';
import { verifyToken, type Fetcher } from '../security';

const kinds = {
  'porden-receipt+jwt': 'delivery_case',
  'porden-handoff-receipt+jwt': 'handoff',
} as const;
const Header = z.object({
  typ: z.enum(['porden-receipt+jwt', 'porden-handoff-receipt+jwt']),
  kid: z.string(),
});
// Read before verification only to pick a trusted issuer; it is re-checked after verification.
const UnverifiedIssuer = z.object({ issuer: z.string().optional() });

function decode(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString());
  } catch {
    return undefined;
  }
}

/**
 * Verifies a Porden-signed receipt for anyone who submits it. The issuer must be one this site
 * already trusts (itself, its configured partner, or its Porden platform), so a submitted token
 * can never make the server fetch keys from an arbitrary origin. A receipt proves what the issuer
 * signed; it does not prove that the work it describes was completed or is correct.
 */
export async function checkReceipt(
  config: Config,
  fetcher: Fetcher,
  token: string,
): Promise<ReceiptVerification> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[\w-]+$/.test(part)))
    return { valid: false, reasonCode: 'MALFORMED' };
  const rawHeader = decode(parts[0]),
    rawPayload = decode(parts[1]);
  if (rawHeader === undefined || rawPayload === undefined)
    return { valid: false, reasonCode: 'MALFORMED' };
  const parsedHeader = Header.safeParse(rawHeader);
  if (!parsedHeader.success) return { valid: false, reasonCode: 'UNSUPPORTED_TYPE' };
  const header = parsedHeader.data;
  const unverified = UnverifiedIssuer.safeParse(rawPayload);
  const kind = kinds[header.typ];
  const trusted =
    kind === 'handoff' ? [config.platform?.origin] : [config.origin, config.peerOrigin];
  const issuer = kind === 'handoff' ? config.platform?.origin : unverified.data?.issuer;
  if (typeof issuer !== 'string' || !trusted.includes(issuer))
    return { valid: false, reasonCode: 'UNTRUSTED_ISSUER' };
  let payload: unknown;
  try {
    payload = await verifyToken(token, issuer, header.typ, fetcher);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'SIGNATURE_INVALID')
      return { valid: false, reasonCode: 'SIGNATURE_INVALID' };
    throw new ApiError('VERIFICATION_UNAVAILABLE', 502, undefined, { cause: error });
  }
  if (kind === 'handoff') {
    const claims = HandoffReceiptClaims.safeParse(payload);
    if (!claims.success) return { valid: false, reasonCode: 'CLAIMS_INVALID' };
    return { valid: true, issuer, keyId: header.kid, receipt: { kind, claims: claims.data } };
  }
  const claims = ReceiptClaims.safeParse(payload);
  if (!claims.success || claims.data.issuer !== issuer)
    return { valid: false, reasonCode: 'CLAIMS_INVALID' };
  return { valid: true, issuer, keyId: header.kid, receipt: { kind, claims: claims.data } };
}
