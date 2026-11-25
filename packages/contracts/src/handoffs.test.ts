import { expect, test } from 'bun:test';
import { CreateHandoff, EvidenceReference, FinishHandoff, HandoffContext, TaskTerms } from './handoffs';
const terms={goal:'Purchase supplies',constraints:[],acceptanceCriteria:['Return receipt']};

test('completion requires an explicit criterion report and reasons for unmet criteria',()=>{
  const command={requestId:crypto.randomUUID(),version:1,status:'completed',note:'Agent-reported result'};
  expect(FinishHandoff.safeParse(command).success).toBe(false);
  expect(FinishHandoff.safeParse({...command,criterionResults:[{criterionIndex:0,met:false}]}).success).toBe(false);
  expect(FinishHandoff.safeParse({...command,criterionResults:[{criterionIndex:0,met:true}]}).success).toBe(true);
});
test('task terms require explicit context and bound optional untrusted evidence',()=>{
  expect(TaskTerms.parse(terms)).toEqual(terms);
  expect(TaskTerms.safeParse({goal:'Incomplete'}).success).toBe(false);
  expect(TaskTerms.safeParse({...terms,evidence:[{claim:'Untrusted',source:{url:'javascript:alert(1)'}}]}).success).toBe(false);
  expect(TaskTerms.safeParse({...terms,evidence:[{claim:'Untrusted',source:{url:'https://example.com',excerpt:'x'.repeat(4001)}}]}).success).toBe(false);
  expect(TaskTerms.safeParse({...terms,budget:{amountMinor:500.5,currency:'USD'}}).success).toBe(false);
});
test('task boundary forbids client-supplied authorization claims',()=>{
  expect(CreateHandoff.safeParse({requestId:crypto.randomUUID(),receiverOrganizationId:crypto.randomUUID(),terms,approvedBy:'forged'}).success).toBe(false);
  const source={claim:'Source claim',source:{url:'https://example.com/a?b=1#c',locator:'Exact locator',excerpt:'<strong>Text only</strong>'}};
  expect(TaskTerms.parse({...terms,evidence:[source]}).evidence?.[0]).toEqual(source);
});
test('optional structured context accepts legacy and current evidence shapes',()=>{
  const context={
    completedWork:['Quote received'],
    remainingWork:['Inspect delivery'],
    openQuestions:['Confirm delivery date'],
    nextStep:'Wait for shipment',
    evidence:[
      {claim:'Legacy source',source:{url:'https://example.com/legacy',locator:'Table 1'}},
      {sourceUrl:'https://example.com/current',excerpt:'Synthetic reference'},
      {claim:'Text-only note'},
    ],
  };
  expect(HandoffContext.parse(context)).toEqual(context);
  expect(TaskTerms.parse({...terms,...context})).toEqual({...terms,...context});
  expect(EvidenceReference.safeParse({}).success).toBe(false);
  expect(EvidenceReference.safeParse({sourceUrl:'javascript:alert(1)'}).success).toBe(false);
  expect(HandoffContext.safeParse({remainingWork:['x'.repeat(1001)]}).success).toBe(false);
  expect(HandoffContext.safeParse({nextStep:'x'.repeat(1001)}).success).toBe(false);
});
