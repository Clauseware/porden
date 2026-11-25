import { afterEach, expect, test } from 'bun:test';
import { createPordenClient, getErrorMessage } from './delivery';
import { acceptedFixture, declinedFixture, unknownFixture, signedReceiptFixture } from './fixtures';
import { VerifiedReceipt } from '@porden/contracts';
const originalFetch = globalThis.fetch;
afterEach(() => {globalThis.fetch = originalFetch;});
test('fixtures expose valid UI outcomes', () => {
  expect(VerifiedReceipt.parse(acceptedFixture.receipt).verification).toBe('valid');
  expect(declinedFixture.status).toBe('cancelled');
  expect(unknownFixture.status).toBe('unknown');
});
test('missing model fails before consent, inference or state changes', async () => {
  let contacted=false;
  globalThis.fetch=Object.assign(async () => {contacted=true;throw Error('Unexpected request');}, {preconnect:originalFetch.preconnect});
  await expect(createPordenClient().transfer({transferId:signedReceiptFixture.claims.transferId,
    approvedFields:['orderReference','damageDescription'],confirm:async()=>true})).rejects.toThrow('MODEL_REQUIRED');
  expect(contacted).toBe(false);
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

test('SDK transport failures and invalid responses expose typed, safe errors',async()=>{
  for (const [fetcher,code] of [
    [async()=>{throw Error('private-secret');},'NETWORK_ERROR'],
    [async()=>new Response('<html>private-secret</html>'),'INVALID_RESPONSE'],
    [async()=>Response.json({wrong:'private-secret'}),'INVALID_RESPONSE'],
    [async()=>new Response('<html>private-secret</html>',{status:502}),'HTTP_ERROR'],
  ] as const) {
    globalThis.fetch=Object.assign(fetcher,{preconnect:originalFetch.preconnect});
    try {await createPordenClient().getConfig();throw Error('Expected failure');}
    catch (error) {
      expect(error).toMatchObject({code});
      expect(getErrorMessage(error)).not.toContain('private-secret');
    }
  }
});
test('SDK preserves known HTTP codes and diagnostic references without displaying upstream text',async()=>{
  const requestId=crypto.randomUUID();
  globalThis.fetch=Object.assign(async()=>Response.json({error:{code:'PROVIDER_RATE_LIMITED',message:'private-secret',requestId}},{status:429}),{preconnect:originalFetch.preconnect});
  try {await createPordenClient().getConfig();throw Error('Expected failure');}
  catch (error) {
    expect(error).toMatchObject({code:'PROVIDER_RATE_LIMITED',status:429,requestId});
    expect(getErrorMessage(error)).toContain(requestId);
    expect(getErrorMessage(error)).not.toContain('private-secret');
  }
});
test('invalid SDK inputs fail without network calls or raw schema errors',async()=>{
  let contacted=false;
  globalThis.fetch=Object.assign(async()=>{contacted=true;throw Error('Unexpected request');},{preconnect:originalFetch.preconnect});
  await expect(createPordenClient().getTransfer('not-an-id')).rejects.toMatchObject({code:'INVALID_INPUT',status:400});
  await expect(createPordenClient().signIn('')).rejects.toMatchObject({code:'INVALID_INPUT',status:400});
  expect(contacted).toBe(false);
});
