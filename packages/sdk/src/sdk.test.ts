import { afterEach, expect, test } from 'bun:test';
import { createPordenClient } from './index';
import { acceptedFixture, declinedFixture, unknownFixture, signedReceiptFixture } from './fixtures';
import { VerifiedReceipt } from '@porden/contracts';
const originalFetch = globalThis.fetch;
afterEach(() => {globalThis.fetch = originalFetch;});
test('fixtures expose valid UI outcomes', () => {
  expect(VerifiedReceipt.parse(acceptedFixture.receipt).verification).toBe('valid');
  expect(declinedFixture.status).toBe('cancelled');
  expect(unknownFixture.status).toBe('unknown');
});
test('cancelling customer consent performs no runtime or receiver fetch', async () => {
  const paths: string[] = [];
  const id = signedReceiptFixture.claims.transferId;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url); paths.push(path);
    if (path === `/api/v1/transfers/${id}`) return Response.json({id,recipientOrigin:'https://courier.example',caseType:'delivery_damage',
      data:{orderReference:'DEMO-1042',damageDescription:'Damaged parcel'},status:'draft',approvedFields:[],receipt:null,createdAt:'2026-11-23T00:00:00.000Z'});
    if (path === '/api/v1/session') return Response.json({customerId:'demo-user',csrf:'test'});
    expect(path).toBe(`/api/v1/transfers/${id}/outcome`);
    expect(JSON.parse(init?.body as string)).toEqual({status:'cancelled'});
    return Response.json({});
  }) as typeof fetch;
  const events: string[] = [];
  const client = createPordenClient({model:'test',onEvent:event => events.push(event.type)});
  expect(await client.transfer({transferId:id,approvedFields:['orderReference','damageDescription'],confirm:async () => false})).toEqual(declinedFixture);
  expect(paths.every(path => path.startsWith('/api/'))).toBe(true);
  expect(events).toEqual(['consent_required','cancelled']);
});
