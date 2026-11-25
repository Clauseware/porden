// Real browser, three independent Next.js apps, central Hono API and isolated PostgreSQL schema.
// No inference provider or external task execution is used.
import assert from 'node:assert/strict';
import { SQL } from 'bun';
import { Hono } from 'hono';
import { agentRoutes } from '../apps/api/src/agents.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { CreateHandoff, HandoffMutation } from '../packages/contracts/src/handoffs.ts';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadPlatformConfig } from '../apps/api/src/platform-config.ts';
import { platformAuth } from '../apps/api/src/platform-auth.ts';
import { handoffService } from '../apps/api/src/services/handoffs.ts';
import { migratePlatform } from '../apps/api/src/db/platform-migrate.ts';
import { provisionPlatform } from '../apps/api/src/db/platform-provision.ts';
import { createPlatformApp } from '../apps/api/src/platform-app.ts';
import { signer } from '../apps/api/src/security.ts';
import { createHandoffClient } from '../packages/sdk/src/index.ts';

const url=process.env.PORDEN_TEST_DATABASE_URL;
assert.ok(url,'PORDEN_TEST_DATABASE_URL must name a disposable database with CREATE SCHEMA permission');
const {chromium}=await import(process.env.HANDOFF_PLAYWRIGHT_MODULE||'playwright');
const live=process.env.PORDEN_PLATFORM_LIVE==='1';
const schema='porden_platform_browser_'+crypto.randomUUID().replaceAll('-','');
const proof=resolve('tmp/platform-browser-proof',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(proof,{recursive:true});
const origins={a:'http://localhost:4100',b:'http://localhost:4200',dashboard:'http://localhost:4300'};
const orgA=crypto.randomUUID(),orgB=crypto.randomUUID(),orgC=crypto.randomUUID();
const password='platform-browser-password',tokenA='a'.repeat(40),tokenB='b'.repeat(40);
const admin=new SQL(url),processes=[],contexts=[],results=[],browserErrors=[],assetServers=[];
let database,server,browser;
const key=()=>({requestId:crypto.randomUUID()});
const terms={goal:'Purchase replacement supplies',constraints:['Do not exceed authorized budget'],acceptanceCriteria:['Provide a purchase receipt'],budget:{amountMinor:50000,currency:'USD'}};
let firstId,returnId;
async function run(name,fn){
  const started=Date.now();
  let failure;
  try{await fn();results.push({name,passed:true,milliseconds:Date.now()-started});console.log('PASS',name);}
  catch(error){failure=error;results.push({name,passed:false,error:String(error),milliseconds:Date.now()-started});console.error('FAIL',name,error);
    for(let index=0;index<contexts.length;index++)for(const page of contexts[index].pages())await page.screenshot({path:resolve(proof,`failure-${index}.png`),fullPage:true}).catch(()=>{});
  }
  writeFileSync(resolve(proof,'results.json'),JSON.stringify({inference:live,results},null,2));
  if(failure)throw failure;
}
async function page(){const context=await browser.newContext();contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>browserErrors.push(error.message));return page;}
async function consumerLogin(page,company,login){await page.goto(origins[company]+'/tasks');await page.getByLabel('Task login',{exact:true}).fill(login);await page.getByLabel('Task password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in to tasks',exact:true}).click();await page.getByRole('heading',{name:'Send a task',exact:true}).waitFor();}
async function dashboardLogin(page,login,id){await page.goto(origins.dashboard+(id?'/handoffs/'+id:''));await page.getByLabel('Login',{exact:true}).fill(login);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();}
async function selectTask(page,goal){await page.getByRole('button',{name:goal,exact:true}).click();await page.getByRole('region',{name:'Selected task'}).waitFor();}
async function status(page,value){await page.getByTestId('task-status').filter({hasText:new RegExp('^'+value+'$')}).waitFor();}
async function decide(page,id,version,approve=true){
  await page.goto(origins.dashboard+'/handoffs/'+id);
  const review=page.getByRole('checkbox',{name:new RegExp('I reviewed version '+version+',')});await review.check();
  await page.getByRole('button',{name:approve?'Approve version '+version:'Reject revision',exact:true}).click();
  await page.getByRole('status').filter({hasText:approve?new RegExp('Saved (authorized|revision_approved)'): /Saved revision_rejected/}).waitFor();
}
try{
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  database=new SQL({url,prepare:false,connection:{search_path:schema}});await migratePlatform(database);
  const keyPath=resolve(proof,'platform.pem');writeFileSync(keyPath,generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  const config=loadPlatformConfig({PORDEN_DATABASE_URL:url,PORDEN_PUBLIC_ORIGIN:origins.dashboard,PORDEN_ALLOWED_ORIGINS:Object.values(origins).join(','),PORDEN_SESSION_SECRET:'s'.repeat(40),PORDEN_SIGNING_KEY_PATH:keyPath});
  await provisionPlatform(database,{organizations:[{id:orgA,name:'Company A'},{id:orgB,name:'Company B'},{id:orgC,name:'Unrelated company'}],principals:[
    {id:crypto.randomUUID(),organizationId:orgA,name:'Company A operator',login:'a.member',kind:'human',role:'member',secret:password},
    {id:crypto.randomUUID(),organizationId:orgB,name:'Company B operator',login:'b.member',kind:'human',role:'member',secret:password},
    {id:crypto.randomUUID(),organizationId:orgA,name:'Company A approver',login:'a.approver',kind:'human',role:'approver',secret:password},
    {id:crypto.randomUUID(),organizationId:orgB,name:'Company B approver',login:'b.approver',kind:'human',role:'approver',secret:password},
    {id:crypto.randomUUID(),organizationId:orgC,name:'Unrelated approver',login:'c.approver',kind:'human',role:'approver',secret:password},
    {id:crypto.randomUUID(),organizationId:orgA,name:'Company A agent',login:'a.agent',kind:'integration',role:'member',secret:tokenA},
    {id:crypto.randomUUID(),organizationId:orgB,name:'Company B agent',login:'b.agent',kind:'integration',role:'member',secret:tokenB},
  ]});
  const signing=signer(config),app=createPlatformApp(config,handoffService(database,signing),platformAuth(database,config),signing);
  server=Bun.serve({hostname:'127.0.0.1',port:5300,fetch:app.fetch});
  for(const [role,origin,peerOrigin,port] of [['merchant',origins.a,origins.b,5100],['courier',origins.b,origins.a,5200]]){
    const assets=new Hono();agentRoutes(assets,loadConfig({ORGANIZATION_ROLE:role,PUBLIC_ORIGIN:origin,PEER_ORIGIN:peerOrigin,DATABASE_URL:url,SESSION_SECRET:'s'.repeat(32),PARTNER_SECRET:'p'.repeat(32),DEMO_PASSWORD:password,SIGNING_KEY_PATH:keyPath}));
    assetServers.push(Bun.serve({hostname:'127.0.0.1',port,fetch:assets.fetch}));
  }
  for(const [name,port] of [['merchant',4100],['courier',4200],['dashboard',4300]]){
    const proc=spawn('node',[resolve('node_modules/next/dist/bin/next'),'start',resolve(`apps/${name}-web`),'-p',String(port)],{windowsHide:true,stdio:'ignore'});processes.push(proc);
  }
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
    try{if((await Promise.all(Object.values(origins).map(origin=>fetch(origin+'/tasks')))).every(response=>response.status<500)){ready=true;break;}}catch{}
    if(processes.some(proc=>proc.exitCode!==null))throw Error('A Next.js process exited before readiness');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'Next.js apps did not become ready');
  browser=await chromium.launch({headless:true,...(process.env.HANDOFF_CHROME?{executablePath:process.env.HANDOFF_CHROME}:{})});
  const a=await page(),b=await page(),dashboardA=await page(),dashboardB=await page();
  const agentA=createHandoffClient({baseUrl:'http://127.0.0.1:5300/api/v2',token:tokenA}),agentB=createHandoffClient({baseUrl:'http://127.0.0.1:5300/api/v2',token:tokenB});
  await run('Company A creates a $500 task with safely rendered evidence',async()=>{
    const jwks=await (await fetch(origins.dashboard+'/.well-known/jwks.json')).json();assert.equal(jwks.keys[0].kid,config.keyId);
    await consumerLogin(a,'a','a.member');await consumerLogin(b,'b','b.member');
    await a.getByLabel('Receiver organization',{exact:true}).selectOption(orgB);
    await a.getByLabel('Evidence claim',{exact:true}).fill('Supplier offers replacements');
    await a.getByLabel('Source URL',{exact:true}).fill('https://example.com/supplies?exact=1#stock');
    await a.getByLabel('Source location',{exact:true}).fill('Stock table');
    await a.getByLabel('Source excerpt',{exact:true}).fill('<script>window.pordenInjected=true</script>');
    await a.getByRole('button',{name:'Create handoff',exact:true}).click();await status(a,'draft');
    const [row]=await database`SELECT id FROM handoffs ORDER BY created_at LIMIT 1`;firstId=row.id;
    await dashboardLogin(dashboardA,'a.approver',firstId);
    await dashboardA.getByText('<script>window.pordenInjected=true</script>',{exact:true}).first().waitFor();
    assert.equal(await dashboardA.evaluate(()=>window.pordenInjected),undefined);
    assert.equal(await dashboardA.getByRole('button',{name:'Approve version 1',exact:true}).isDisabled(),true);
    await decide(dashboardA,firstId,1);
    await selectTask(b,'Purchase replacement supplies');await status(b,'approved');
    await b.getByRole('button',{name:'Accept version 1',exact:true}).click();await status(b,'accepted');
  });
  await run('receiver clarification blocks execution until the sender supplies information',async()=>{
    await b.getByLabel('Missing information',{exact:true}).fill('Which depot should receive the parcel?');
    await b.getByLabel('Why execution is blocked',{exact:true}).fill('Cannot route without a destination depot');
    await b.getByRole('button',{name:'Request clarification',exact:true}).click();
    await b.getByRole('heading',{name:'Blocking clarification',exact:true}).waitFor();
    assert.equal((await agentB.getAuthorization(firstId,1)).reasonCode,'CLARIFICATION_REQUIRED');
    await a.getByLabel('Clarification response',{exact:true}).fill('Use the north depot; authorized terms are unchanged.');
    await a.getByRole('button',{name:'Resolve clarification',exact:true}).click();
    await b.getByText('Sender response: Use the north depot; authorized terms are unchanged.',{exact:true}).waitFor();
    assert.equal((await agentB.getAuthorization(firstId,1)).eligible,true);
  });
  async function bridgeCreate(args,requestId){
    await a.evaluate(async ({args,requestId})=>{
      const {ActionBridgeClient}=await import('/runtime/action-transport.js');
      window.__platformBridgeOutcome=undefined;
      const client=new ActionBridgeClient(location.origin+'/action-bridge.html');
      void (async()=>{try{await client.connect(true);const value=await client.request('execute',{name:'porden_handoff',args,requestId});window.__platformBridgeOutcome={value};}catch(error){window.__platformBridgeOutcome={error:String(error)};}finally{client.dispose();}})();
    },{args,requestId});
    const opened=a.waitForEvent('popup');await a.getByRole('button',{name:'Open action site',exact:true}).click();
    const popup=await opened;await popup.getByRole('button',{name:'Confirm actions',exact:true}).click();
    await a.waitForFunction(()=>window.__platformBridgeOutcome);
    const outcome=await a.evaluate(()=>window.__platformBridgeOutcome);
    assert.equal(outcome.error,undefined);return HandoffMutation.parse(outcome.value);
  }
  await run('official nsDeploy popup bridge creates and reconciles a platform handoff with runtime request IDs',async()=>{
    const args={operation:'create',receiverOrganizationId:orgB,terms:{...terms,goal:'Bridge integration proof'}};
    const requestId='official-platform:'+crypto.randomUUID()+':0';
    const result=await bridgeCreate(args,requestId);
    assert.equal(result.handoff.status,'draft');
    const reconciliation=await a.request.get(origins.a+'/api/v2/operations/'+result.receipt.requestId);
    assert.equal(reconciliation.status(),200);assert.equal((await reconciliation.json()).handoff.id,result.handoff.id);
    assert.deepEqual(await agentA.verifyReceipt(result.receipt.signedReceipt),Object.fromEntries(Object.entries(result.receipt).filter(([key])=>key!=='signedReceipt')));
    const replay=await bridgeCreate(args,requestId);assert.equal(replay.receipt.signedReceipt,result.receipt.signedReceipt);
  });
  if(live)await run('live model tool call executes through the official nsDeploy popup bridge',async()=>{
    const model=process.env.OPENROUTER_MODEL||process.env.openrouter_model||'',apiKey=process.env.OPENROUTER_API_KEY||process.env.openrouter_api_key||'';
    assert.ok(model.endsWith(':free')&&apiKey,'A configured free model and provider key are required');
    const catalog=await a.evaluate(async()=>{
      const {ActionBridgeClient}=await import('/runtime/action-transport.js');const client=new ActionBridgeClient(location.origin+'/action-bridge.html');
      try{await client.connect();return await client.request('catalog');}finally{client.dispose();}
    });
    const action=catalog.find(item=>item.name==='porden_handoff');assert.ok(action);
    // This test exercises creation; the shared multi-operation catalog cannot require terms globally.
    const parameters={...action.inputSchema,required:['operation','receiverOrganizationId','terms'],properties:{
      operation:{...action.inputSchema.properties.operation,enum:['create']},
      receiverOrganizationId:{...action.inputSchema.properties.receiverOrganizationId,enum:[orgB]},
      terms:action.inputSchema.properties.terms,
    }};
    const requestedAction={operation:'create',receiverOrganizationId:orgB,terms:{goal:'Live bridge integration proof',constraints:['No external task execution'],acceptanceCriteria:['Record a signed handoff receipt']}};
    const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'Call porden_handoff exactly once with this nested argument structure: '+JSON.stringify(requestedAction)+'. Keep goal, constraints, and acceptanceCriteria inside terms. This is synthetic validation; do not claim approval or completion.'}],tools:[{type:'function',function:{name:action.name,description:action.description,parameters}}],tool_choice:{type:'function',function:{name:action.name}}})});
    assert.ok(response.ok,'Provider returned HTTP '+response.status);
    const completion=await response.json(),calls=completion.choices?.[0]?.message?.tool_calls;
    assert.equal(calls?.length,1);assert.equal(calls[0].function.name,'porden_handoff');
    const args=JSON.parse(calls[0].function.arguments);assert.equal(args.operation,'create');assert.equal(args.receiverOrganizationId,orgB);
    CreateHandoff.parse({requestId:crypto.randomUUID(),receiverOrganizationId:orgB,terms:args.terms});
    const result=await bridgeCreate(args,'live-platform:'+crypto.randomUUID()+':0');
    assert.equal(result.handoff.status,'draft');assert.equal((await agentA.getAuthorization(result.handoff.id,1)).eligible,false);
    await agentA.verifyReceipt(result.receipt.signedReceipt);
    const [{count}]=await database`SELECT count(*)::int AS count FROM handoffs WHERE id=${result.handoff.id}`;assert.equal(count,1);
    writeFileSync(resolve(proof,'live-bridge-result.json'),JSON.stringify({model,inferenceCalls:1,handoffId:result.handoff.id,receiptId:result.receipt.receiptId,status:result.handoff.status},null,2));
  });
  await run('$550 proposal blocks execution and dashboard authorizes only the exact revision',async()=>{
    await b.getByRole('button',{name:'Propose revision',exact:true}).click();await status(b,'awaiting_approval');
    assert.equal((await agentB.getAuthorization(firstId,2)).eligible,false);
    await assert.rejects(agentB.finishHandoff(firstId,{...key(),version:2,status:'completed',criterionResults:[{criterionIndex:0,met:true}],note:'Must be blocked'}),error=>error.status===409);
    await dashboardA.getByRole('heading',{name:'Proposed terms · version 2',exact:true}).waitFor();
    await dashboardA.getByText('USD 550.00',{exact:false}).first().waitFor();
    await decide(dashboardA,firstId,2);await status(b,'approved');
    await b.getByRole('button',{name:'Accept version 2',exact:true}).click();await status(b,'accepted');
    await b.getByTestId('execution-authorization').filter({hasText:'Execution authorization: authorized'}).waitFor();
    await b.getByLabel('Criterion 1 result',{exact:true}).selectOption('met');
    await b.getByLabel('Outcome note',{exact:true}).fill('Purchased under the newly authorized $550 budget');await b.getByRole('button',{name:'Record outcome',exact:true}).click();await status(b,'completed');
    const row=await agentA.getHandoff(firstId);assert.equal(row.versions[0].terms.budget.amountMinor,50000);assert.equal(row.versions[1].terms.budget.amountMinor,55000);assert.equal(row.versions[0].terms.evidence[0].source.url,'https://example.com/supplies?exact=1#stock');
  });
  await run('Company B sends an independently approved linked handoff back to Company A',async()=>{
    await b.getByRole('button',{name:'Send linked return',exact:true}).click();await b.getByRole('heading',{name:'Send linked return handoff',exact:true}).waitFor();
    await b.getByRole('button',{name:'Create handoff',exact:true}).click();await status(b,'draft');
    const [row]=await database`SELECT id FROM handoffs WHERE previous_handoff_id=${firstId}`;returnId=row.id;
    await dashboardLogin(dashboardB,'b.approver',returnId);await decide(dashboardB,returnId,1);
    await selectTask(a,'Return purchase report');await status(a,'approved');await a.getByRole('button',{name:'Accept version 1',exact:true}).click();await status(a,'accepted');
    await a.getByTestId('execution-authorization').filter({hasText:'Execution authorization: authorized'}).waitFor();
    await a.getByLabel('Criterion 1 result',{exact:true}).selectOption('met');
    await a.getByLabel('Outcome note',{exact:true}).fill('Report received');await a.getByRole('button',{name:'Record outcome',exact:true}).click();await status(a,'completed');
    const history=await agentA.getWorkflowHistory((await agentA.getHandoff(firstId)).workflowId);assert.equal(history.items.length,2);assert.notEqual(history.items[0].receipts[0].receiptId,history.items[1].receipts[0].receiptId);
    await dashboardA.reload();await dashboardA.getByRole('heading',{name:'Linked workflow',exact:true}).waitFor();await dashboardA.getByRole('link',{name:/Company B → Company A: Return purchase report/}).waitFor();
  });
  await run('unrelated organization cannot inspect or decide a private handoff',async()=>{
    const stranger=await page();await dashboardLogin(stranger,'c.approver');await stranger.getByText('No handoffs match these filters.',{exact:true}).waitFor();
    await stranger.goto(origins.dashboard+'/handoffs/'+firstId);await stranger.getByRole('alert').filter({hasText:'The requested record was not found.'}).waitFor();
    assert.equal(await stranger.getByRole('heading',{name:'Exact current terms',exact:true}).count(),0);
    assert.equal(await stranger.getByRole('checkbox').count(),0);
    const session=await (await stranger.request.get(origins.dashboard+'/api/v2/session')).json();
    const forged=await stranger.request.post(origins.dashboard+'/api/v2/handoffs/'+firstId+'/approve',{headers:{Origin:origins.dashboard,'X-CSRF-Token':session.csrf},data:{...key(),version:1}});assert.equal(forged.status(),404);
  });
  await run('receiver refusal, sender cancellation and rejected revision stay explicit',async()=>{
    const refusal=(await agentA.createHandoff({...key(),receiverOrganizationId:orgB,terms:{...terms,goal:'Refuse this task'}})).handoff;await decide(dashboardA,refusal.id,1);
    await selectTask(b,'Refuse this task');await b.getByRole('button',{name:'Refuse handoff',exact:true}).click();await status(b,'rejected');
    const cancelled=(await agentA.createHandoff({...key(),receiverOrganizationId:orgB,terms:{...terms,goal:'Cancel this task'}})).handoff;await selectTask(a,'Cancel this task');a.once('dialog',dialog=>dialog.accept());await a.getByRole('button',{name:'Cancel task',exact:true}).click();await status(a,'cancelled');assert.equal((await agentA.getAuthorization(cancelled.id,1)).eligible,false);
    const rejected=(await agentA.createHandoff({...key(),receiverOrganizationId:orgB,terms:{...terms,goal:'Reject changed budget'}})).handoff;await decide(dashboardA,rejected.id,1);await agentB.acceptHandoff(rejected.id,{...key(),version:1});await agentB.proposeRevision(rejected.id,{...key(),version:1,terms:{...terms,goal:'Reject changed budget',budget:{amountMinor:60000,currency:'USD'}},reason:'Unapproved alternative'});await decide(dashboardA,rejected.id,2,false);
    await selectTask(b,'Reject changed budget');await status(b,'accepted');assert.equal((await agentB.getAuthorization(rejected.id,2)).eligible,false);assert.equal((await agentB.getAuthorization(rejected.id,1)).eligible,true);
  });
  await run('lost response survives reload and reconciles without a second write',async()=>{
    const [{count:before}]=await database`SELECT count(*)::int AS count FROM handoffs`;let writes=0;
    await a.route('**/api/v2/handoffs',async route=>{if(route.request().method()==='POST'){writes++;await route.fetch();await route.abort('failed');}else await route.continue();});
    await a.getByLabel('Task goal',{exact:true}).fill('Recover lost acknowledgement');await a.getByRole('button',{name:'Create handoff',exact:true}).click();await a.getByRole('heading',{name:'Write outcome unknown',exact:true}).waitFor();
    assert.equal(await a.getByRole('button',{name:'Create handoff',exact:true}).isDisabled(),true);
    await a.reload();await a.getByRole('button',{name:'Check operation receipt',exact:true}).click();await a.getByRole('status').filter({hasText:'no write was repeated'}).waitFor();
    const [{count:after}]=await database`SELECT count(*)::int AS count FROM handoffs`;assert.equal(after,before+1);assert.equal(writes,1);await a.unroute('**/api/v2/handoffs');
  });
  await run('malformed evidence, stale decisions and duplicate request conflicts fail predictably',async()=>{
    const input={...key(),receiverOrganizationId:orgB,terms:{...terms,goal:'Idempotent task'}};
    const [first,duplicate]=await Promise.all([agentA.createHandoff(input),agentA.createHandoff(input)]);assert.equal(first.receipt.signedReceipt,duplicate.receipt.signedReceipt);
    await assert.rejects(agentA.createHandoff({...input,terms:{...input.terms,evidence:[{claim:'Changed',source:{url:'https://example.com/changed'}}]}}),error=>error.status===409);
    const session=await (await dashboardA.request.get(origins.dashboard+'/api/v2/session')).json();
    const stale=await dashboardA.request.post(origins.dashboard+'/api/v2/handoffs/'+firstId+'/approve',{headers:{Origin:origins.dashboard,'X-CSRF-Token':session.csrf},data:{...key(),version:1}});assert.equal(stale.status(),409);
    const invalid=await a.request.post(origins.a+'/api/v2/handoffs',{headers:{Origin:origins.a,'X-CSRF-Token':(await (await a.request.get(origins.a+'/api/v2/session')).json()).csrf},data:{...key(),receiverOrganizationId:orgB,terms:{...terms,evidence:[{claim:'Bad URL',source:{url:'javascript:alert(1)'}}]}}});assert.equal(invalid.status(),400);
  });
  await run('dashboard filters, pagination, empty and transport error states use real contracts',async()=>{
    for(let i=0;i<11;i++)await agentA.createHandoff({...key(),receiverOrganizationId:orgB,terms:{...terms,goal:'Page task '+i}});
    await dashboardA.goto(origins.dashboard);await dashboardA.getByRole('button',{name:'Next page',exact:true}).click();await dashboardA.getByText(/Page 2 ·/).waitFor();
    await dashboardA.getByLabel('Status',{exact:true}).selectOption('completed');await dashboardA.getByText(/Page 1 · 2 handoffs/).waitFor();
    await dashboardA.getByLabel('Direction',{exact:true}).selectOption('received');await dashboardA.getByText(/Page 1 · 1 handoffs/).waitFor();
    await dashboardA.route('**/api/v2/handoffs?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'DATABASE_UNAVAILABLE',message:'private diagnostic should never appear'}})}));
    await dashboardA.getByLabel('Status',{exact:true}).selectOption('draft');await dashboardA.getByRole('alert').filter({hasText:'Case storage is unavailable.'}).waitFor();assert.equal(await dashboardA.getByText('private diagnostic should never appear').count(),0);await dashboardA.unroute('**/api/v2/handoffs?**');
  });
  await run('session expiry clears private task state and shows sign-in',async()=>{
    await database`UPDATE platform_sessions SET expires_at=now()-interval '1 second' WHERE principal_id IN (SELECT id FROM principals WHERE login='b.member')`;
    await b.getByRole('heading',{name:'Sign in to task integration',exact:true}).waitFor();assert.equal(await b.getByRole('region',{name:'Selected task'}).count(),0);
  });
  await run('an account change in another tab clears stale organization data',async()=>{
    const switcher=await dashboardA.context().newPage();switcher.setDefaultTimeout(20000);
    await switcher.goto(origins.dashboard);
    const switched=await switcher.request.post(origins.dashboard+'/api/v2/session',{headers:{Origin:origins.dashboard},data:{login:'c.approver',password}});assert.equal(switched.status(),200);
    await dashboardA.getByRole('heading',{name:'Sign in to Porden',exact:true}).waitFor();
    assert.equal(await dashboardA.getByRole('table').count(),0);
    await dashboardA.getByRole('alert').filter({hasText:'The signed-in account changed.'}).waitFor();
    await dashboardA.getByLabel('Login',{exact:true}).fill('a.approver');await dashboardA.getByLabel('Password',{exact:true}).fill(password);await dashboardA.getByRole('button',{name:'Sign in',exact:true}).click();await dashboardA.getByRole('button',{name:'Sign out',exact:true}).waitFor();await switcher.close();
  });
  await run('mobile layouts, keyboard controls and browser errors',async()=>{
    await dashboardA.goto(origins.dashboard+'/handoffs/'+firstId);await dashboardA.getByRole('heading',{name:'Receipts and audit history',exact:true}).waitFor();
    for(const [name,p] of [['dashboard',dashboardA],['company-a',a]]){
      await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' overflows');await p.screenshot({path:resolve(proof,name+'-mobile.png'),fullPage:true});
    }
    await b.getByLabel('Task login',{exact:true}).focus();await b.keyboard.press('Tab');assert.equal(await b.getByLabel('Task password',{exact:true}).evaluate(element=>element===document.activeElement),true);
    await b.screenshot({path:resolve(proof,'company-b-sign-in.png'),fullPage:true});assert.deepEqual(browserErrors,[]);
  });
}finally{
  await browser?.close();
  for(const proc of processes)if(proc.exitCode===null){const exited=once(proc,'exit');proc.kill();await exited;}
  for(const assets of assetServers)await assets.stop(true);
  await server?.stop(true);await database?.close();await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.close();
}
console.log(`${results.filter(result=>result.passed).length} passed; ${results.filter(result=>!result.passed).length} failed; evidence: ${proof}`);
assert.ok(results.length>0);if(results.some(result=>!result.passed))process.exitCode=1;
