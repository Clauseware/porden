import { expect, test } from 'bun:test';
import { createHandoffClient, HandoffWriteUnknown } from './handoff-client';
import { PordenError } from './error';
test('new SDK rejects invalid input without network calls',async()=>{
  let calls=0;
  const client=createHandoffClient({token:'test-token',fetch:async()=>{calls++;throw Error('Must not fetch');}});
  expect(()=>client.getHandoff('invalid')).toThrow(PordenError);
  expect(calls).toBe(0);
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
