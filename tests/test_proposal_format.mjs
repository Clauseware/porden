import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseAgentResponse } from '../vendor/nsdeploy/nsdeploy/runtime/cruse.js';
import { ActionRegistry } from '../vendor/nsdeploy/nsdeploy/runtime/actions.js';

test('agent prompt examples use the exact official CRUSE fence and envelope', async () => {
  const args = {orderReference:'DEMO-1042',damageDescription:'The delivery box arrived damaged.'};
  const registry = new ActionRegistry();
  const ref = registry.register({base:'http://localhost:4200',network:'courier'}, {
    name:'create_damage_case',description:'Courier damage intake',effect:'write',
    inputSchema:{type:'object',properties:{orderReference:{type:'string'},damageDescription:{type:'string'}},
      required:['orderReference','damageDescription']},
    execute:() => { throw Error('A proposal must never execute a write.'); },
  });
  // This is the fence syntax observed in the failed live courier response.
  const malformed = '```cruse-ui version:1\n' + JSON.stringify({kind:'action',id:'create_damage_case',action:ref,arguments:args}) + '\n```';
  const rejected = parseAgentResponse(malformed);
  assert.equal(rejected.presentation,null);
  assert.ok(rejected.presentationIssues.includes('The presentation could not be parsed.'));
  for (const site of ['merchant','courier']) {
    const network = JSON.parse(await readFile(`public/${site}/${site}.network.json`,'utf8'));
    const prompt = network.tools[0].instructions;
    const example = prompt.match(/```cruse-ui\n(\{[^\n]+\})\n```/);
    assert.ok(example,`${site} needs a literal correctly fenced JSON example`);
    const envelope = JSON.parse(example[1]);
    assert.equal(envelope.version,1);
    assert.equal(envelope.components.length,1);
    envelope.components[0].action = ref;
    envelope.components[0].arguments = args;
    const result = parseAgentResponse('```cruse-ui\n' + JSON.stringify(envelope) + '\n```');
    registry.validatePresentation(result,new Set([ref]));
    assert.equal(result.presentation.components.length,1);
    assert.deepEqual(registry.prepare(result.presentation.components[0])[0].args,args);
  }
});
