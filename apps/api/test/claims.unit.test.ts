import { expect, test } from 'bun:test';
import { canonicalize } from '@porden/contracts';
import {
  ClaimParameters,
  CourierClaimDecision,
  FileClaim,
} from '@porden/contracts/delivery-claims';
import { claimTerms, readClaimTerms } from '../src/services/claim-terms';
import { courierClaimPolicy, evaluateClaim } from '../src/services/courier-claim-policy';

const scope = { action: 'courier.create_case', parametersSha256: 'a'.repeat(64) };
const params = (
  overrides: Partial<ClaimParameters['claim']>,
  resolution: ClaimParameters['resolution'],
) =>
  ClaimParameters.parse({
    claim: {
      orderReference: 'DEMO-1042',
      parcelClass: 'standard',
      declaredValueMinor: 4_000,
      currency: 'USD',
      photoProvided: true,
      ...overrides,
    },
    resolution,
  });
const refund = (amountMinor: number) => ({
  remedy: 'full_refund' as const,
  amountMinor,
  currency: 'USD',
});

test('claim terms round-trip deterministically and reject any edited rendering', () => {
  const parameters = params({}, refund(4_000));
  const terms = claimTerms(parameters, scope);
  expect(canonicalize(claimTerms(parameters, scope))).toBe(canonicalize(terms));
  expect(readClaimTerms(terms)).toEqual({ parameters, caseScope: scope });
  expect(terms.budget).toEqual({ amountMinor: 4_000, currency: 'USD' });
  expect(readClaimTerms({ ...terms, constraints: terms.constraints.slice(0, 3) })).toBeUndefined();
  const edited = { ...terms, budget: { amountMinor: 9_000, currency: 'USD' } };
  expect(() => readClaimTerms(edited)).toThrow('SCOPE_MISMATCH');
  const wrongParameters = terms.constraints.map((item) => item.replace('4000', '9000'));
  expect(() => readClaimTerms({ ...terms, constraints: wrongParameters })).toThrow(
    'SCOPE_MISMATCH',
  );
  const otherScope = { ...terms, executionScopes: [{ ...scope, action: 'courier.other' }] };
  expect(() => readClaimTerms(otherScope)).toThrow('SCOPE_MISMATCH');
});

test('within-policy claims allow only acceptance (routine collaboration)', () => {
  expect(
    evaluateClaim(courierClaimPolicy, params({}, refund(4_000)), { photoReceived: false }),
  ).toEqual({
    findings: ['WITHIN_POLICY'],
    allowed: [{ decision: 'accept' }],
  });
  const small = params({ photoProvided: false }, refund(2_000));
  expect(evaluateClaim(courierClaimPolicy, small, { photoReceived: false }).allowed).toEqual([
    { decision: 'accept' },
  ]);
});

test('missing evidence requires clarification until a photo is received', () => {
  const claim = params({ photoProvided: false }, refund(4_000));
  expect(evaluateClaim(courierClaimPolicy, claim, { photoReceived: false })).toEqual({
    findings: ['PHOTO_REQUIRED'],
    allowed: [
      { decision: 'clarify', missingInformation: ['photo_of_damage'] },
      { decision: 'reject' },
    ],
  });
  expect(evaluateClaim(courierClaimPolicy, claim, { photoReceived: true }).allowed).toEqual([
    { decision: 'accept' },
  ]);
});

test('over-cover claims allow only server-computed counter-offers', () => {
  const fragile = params({ parcelClass: 'fragile', declaredValueMinor: 8_000 }, refund(8_000));
  expect(evaluateClaim(courierClaimPolicy, fragile, { photoReceived: false })).toEqual({
    findings: ['REFUND_EXCEEDS_COVER'],
    allowed: [
      {
        decision: 'counter',
        resolution: { remedy: 'partial_refund', amountMinor: 5_000, currency: 'USD' },
      },
      { decision: 'counter', resolution: { remedy: 'reship' } },
      { decision: 'reject' },
    ],
  });
  const electronics = params(
    { parcelClass: 'electronics', declaredValueMinor: 30_000 },
    { remedy: 'reship' },
  );
  expect(evaluateClaim(courierClaimPolicy, electronics, { photoReceived: false }).findings).toEqual(
    ['RESHIP_NOT_AVAILABLE'],
  );
  const euro = params({ currency: 'EUR' }, { remedy: 'reship' });
  expect(evaluateClaim(courierClaimPolicy, euro, { photoReceived: false }).allowed).toEqual([
    { decision: 'reject' },
  ]);
});

test('claim boundaries reject agent-supplied amounts and unknown fields', () => {
  const base = { requestId: crypto.randomUUID(), version: 1, reason: 'Over cover' };
  expect(
    CourierClaimDecision.safeParse({ ...base, decision: 'counter', remedy: 'partial_refund' })
      .success,
  ).toBe(true);
  expect(
    CourierClaimDecision.safeParse({
      ...base,
      decision: 'counter',
      remedy: 'partial_refund',
      amountMinor: 1,
    }).success,
  ).toBe(false);
  expect(
    FileClaim.safeParse({
      requestId: crypto.randomUUID(),
      data: { orderReference: 'DEMO-1042', damageDescription: 'Crushed box corner' },
      approvedFields: ['orderReference', 'damageDescription'],
      photoProvided: true,
      requestedResolution: { remedy: 'full_refund', amountMinor: 1 },
    }).success,
  ).toBe(false);
});
