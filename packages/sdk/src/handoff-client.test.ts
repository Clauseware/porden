import { expect, test } from 'bun:test';
import { createHandoffClient, hashParameters, HandoffWriteUnknown } from './handoff-client';
import { PordenError } from './error';
import { generateKeyPairSync, sign } from 'node:crypto';
import { HandoffReceiptClaims } from '@porden/contracts';
test('new SDK rejects invalid input without network calls',async()=>{
  let calls=0;
  const client=createHandoffClient({token:'test-token',fetch:async()=>{calls++;throw Error('Must not fetch');}});
  expect(()=>client.getHandoff('invalid')).toThrow(PordenError);
  expect(calls).toBe(0);
});

test('action parameter hashes use canonical JSON and reject non-JSON values',async()=>{
  expect(await hashParameters({b:2,a:1})).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
  expect(await hashParameters({a:1,b:2})).toBe(await hashParameters({b:2,a:1}));
  await expect(hashParameters({unsupported:undefined})).rejects.toMatchObject({code:'INVALID_INPUT'});
});
test('uncertain writes retain operation identity without automatic retries',async()=>{
  let calls=0;const requestId=crypto.randomUUID();
  const client=createHandoffClient({token:'test-token',fetch:async()=>{calls++;throw Error('Connection lost');}});
  await expect(client.createHandoff({requestId,receiverOrganizationId:crypto.randomUUID(),terms:{goal:'Task',constraints:[],acceptanceCriteria:['Receipt']}})).rejects.toMatchObject({operationId:requestId,code:'OUTCOME_UNKNOWN'});
  expect(calls).toBe(1);
});
test('invalid write acknowledgements remain unknown while reads expose safe protocol errors',async()=>{
  const client=createHandoffClient({token:'test-token',fetch:async()=>Response.json({unexpected:'not a valid receipt'})});
  await expect(client.createHandoff({requestId:crypto.randomUUID(),receiverOrganizationId:crypto.randomUUID(),terms:{goal:'Task',constraints:[],acceptanceCriteria:['Receipt']}})).rejects.toBeInstanceOf(HandoffWriteUnknown);
  await expect(client.getHandoff(crypto.randomUUID())).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});
test('uncertain server failures preserve diagnostic references without exposing response bodies',async()=>{
  const requestId=crypto.randomUUID(),reference=crypto.randomUUID();
  const client=createHandoffClient({token:'test-token',fetch:async()=>Response.json({private:'must not surface'},{status:503,headers:{'X-Request-Id':reference}})});
  await expect(client.createHandoff({requestId,receiverOrganizationId:crypto.randomUUID(),terms:{goal:'Task',constraints:[],acceptanceCriteria:['Receipt']}})).rejects.toMatchObject({code:'OUTCOME_UNKNOWN',status:503,requestId:reference,operationId:requestId});
});

test('automatic operation IDs survive uncertain writes and supplied IDs are preserved',async()=>{
  const sent:string[]=[];
  const client=createHandoffClient({token:'test-token',fetch:async(_,init)=>{sent.push(JSON.parse(String(init?.body)).requestId);throw Error('Lost acknowledgement');}});
  await expect(client.acceptHandoff(crypto.randomUUID(),{version:1})).rejects.toMatchObject({operationId:expect.any(String),code:'OUTCOME_UNKNOWN'});
  expect(sent[0]).toMatch(/^[0-9a-f-]{36}$/);
  const supplied=crypto.randomUUID();
  await expect(client.acceptHandoff(crypto.randomUUID(),{version:1,requestId:supplied})).rejects.toMatchObject({operationId:supplied});
  expect(sent).toHaveLength(2);
  expect(sent[1]).toBe(supplied);
});

test('public receipt verification trusts configured keys and detects event tampering',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const claims=HandoffReceiptClaims.parse({receiptId:crypto.randomUUID(),handoffId:crypto.randomUUID(),workflowId:crypto.randomUUID(),principalId:crypto.randomUUID(),organizationId:crypto.randomUUID(),principalKind:'integration',requestId:crypto.randomUUID(),action:'completed',version:1,termsSha256:'a'.repeat(64),occurredAt:new Date().toISOString(),event:{type:'completion',criterionResults:[{criterionIndex:0,met:true}]}});
  const header=Buffer.from(JSON.stringify({alg:'ES256',typ:'porden-handoff-receipt+jwt',kid:'test'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const data=header+'.'+payload;
  const signature=sign('sha256',Buffer.from(data),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
  const client=createHandoffClient({baseUrl:'https://platform.example/api/v2',fetch:async url=>{
    expect(url).toBe('https://platform.example/.well-known/jwks.json');
    return Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'ES256',use:'sig'}]});
  }});
  expect(await client.verifyReceipt(data+'.'+signature)).toEqual(claims);
  const tampered=Buffer.from(JSON.stringify({...claims,event:{type:'completion',criterionResults:[{criterionIndex:0,met:false,reason:'Changed'}]}})).toString('base64url');
  await expect(client.verifyReceipt(header+'.'+tampered+'.'+signature)).rejects.toMatchObject({code:'SIGNATURE_INVALID'});
});
