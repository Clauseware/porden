// Real Next.js sites, SDK, official runtime, Hono HTTP APIs, and separate PostgreSQL credentials.
// Only inference is scripted unless PORDEN_LIVE=1. All fixtures are synthetic.
import assert from 'node:assert/strict';
import { SQL } from 'bun';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadConfig } from '../apps/api/src/config.ts';
import { createApp } from '../apps/api/src/app.ts';
import { store } from '../apps/api/src/db/store.ts';
import { migrate } from '../apps/api/src/db/migrate.ts';
import { signer } from '../apps/api/src/security.ts';

const { chromium } = await import(process.env.HANDOFF_PLAYWRIGHT_MODULE || 'playwright');
const live = process.argv.includes('--live') || process.env.PORDEN_LIVE === '1';
const runs = Number(process.env.PORDEN_RUNS || (live ? '1' : '3'));
assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 20, 'PORDEN_RUNS must be 1..20');
const model = live ? (process.env.OPENROUTER_MODEL || process.env.openrouter_model || '') : 'porden-scripted-test';
if (live) {
  assert.ok(model.endsWith(':free'), 'Live tests require an explicitly configured :free model');
  assert.ok(process.env.OPENROUTER_API_KEY || process.env.openrouter_api_key, 'Live provider key required');
}
const urls = {
  merchant: process.env.PORDEN_MERCHANT_DATABASE_URL || 'postgres://porden_merchant:local-merchant-only@127.0.0.1:54329/porden_merchant',
  courier: process.env.PORDEN_COURIER_DATABASE_URL || 'postgres://porden_courier:local-courier-only@127.0.0.1:54329/porden_courier',
};
const origins = {merchant:'http://localhost:4100',courier:'http://localhost:4200'};
const ports = {merchant:5100,courier:5200};
const schema = 'porden_browser_' + crypto.randomUUID().replaceAll('-','');
const proof = resolve(live ? 'tmp/porden-live-proof' : 'tmp/porden-browser-proof',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(proof,{recursive:true});
const databases = {}, admins = {}, servers = [], processes = [], results = [];
let browser;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function run(name, fn) {
  if (process.env.PORDEN_SCENARIO && !name.includes(process.env.PORDEN_SCENARIO)) return;
  const start = Date.now();
  try {await fn(); results.push({name,passed:true,milliseconds:Date.now()-start}); console.log('PASS',name);}
  catch (error) {results.push({name,passed:false,error:error.stack,milliseconds:Date.now()-start}); console.error('FAIL',name,error);}
  writeFileSync(resolve(proof,'results.json'),JSON.stringify({live,model,results},null,2));
}
async function count() {return (await databases.courier`SELECT count(*)::int AS count FROM cases`)[0].count;}
async function waitForSites() {
  for (let i=0;i<120;i++) {
    try {if ((await fetch(origins.merchant)).ok && (await fetch(origins.courier)).ok) return;} catch {}
    if (processes.some(proc => proc.exitCode !== null)) throw Error('Next.js exited before readiness');
    await sleep(250);
  }
  throw Error('Next.js did not start');
}
async function prepare({mutateDelegation=false,mutateAction=false,address=false,lostAck=false,tamperWrite=false,brokenReceipt=false}={}) {
  const context=await browser.newContext();
  const page=await context.newPage();
  page.setDefaultTimeout(live ? 120000 : 15000);
  const modelRequests=[],requests=[],errors=[];
  context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
  context.on('request',request=>requests.push({url:request.url(),method:request.method(),body:request.postData()}));
  if (!live) await context.route(origins.merchant+'/api/llm/chat/completions',async route=>{
    const body=route.request().postDataJSON();modelRequests.push(body);
    const messages=body.messages,child=messages.filter(message=>message.role==='tool');
    const user=messages.findLast(message=>message.role==='user').content;
    let delta;
    if (body.tools?.length && !child.length) {
      const approved=JSON.parse(user);
      if (mutateDelegation) approved.data.deliveryAddress='Unapproved model address';
      delta={tool_calls:[{index:0,id:'porden-delegation',type:'function',function:{name:body.tools[0].function.name,arguments:JSON.stringify({request:JSON.stringify(approved)})}}]};
    } else {
      let components;
      if (child.length) components=child[0].content.startsWith('Error from tool ') ? [] : JSON.parse(child[0].content).presentation?.components || [];
      else {
        const catalog=JSON.parse(messages[0].content.split('CRUSE browser actions (proposals only; these are NOT tool calls):\n')[1].split('\n')[0]);
        const args=JSON.parse(user);
        if (mutateAction) args.data.deliveryAddress='Unapproved model address';
        components=[{id:'create_damage_case',kind:'action',label:'Submit approved case',action:catalog[0].ref,arguments:args}];
      }
      delta={content:'Review the proposed transfer.\n```cruse-ui\n'+JSON.stringify({version:1,components})+'\n```'};
    }
    await route.fulfill({status:200,headers:{'content-type':'text/event-stream','X-Nsdeploy-LLM-Route':'mock'},
      body:'data: '+JSON.stringify({model,choices:[{index:0,delta,finish_reason:delta.tool_calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n'});
  });
  if (lostAck || tamperWrite || brokenReceipt) await context.route(origins.courier+'/api/v1/cases',async route=>{
    if (tamperWrite) {
      const body=route.request().postDataJSON();body.data.deliveryAddress='Unapproved write address';
      return route.continue({postData:JSON.stringify(body)});
    }
    const response=await route.fetch();
    assert.equal(response.status(),201);
    if (lostAck) return route.abort('failed');
    const body=await response.json();body.receipt=body.receipt.slice(0,-5)+'AAAAA';
    return route.fulfill({response,json:body});
  });
  const courier=await context.newPage();
  await courier.goto(origins.courier);
  await courier.getByLabel('Courier demo password').fill('browser-test-password');
  await courier.getByRole('button',{name:'Sign in to courier',exact:true}).click();
  await courier.getByText('Signed in. You can now approve a courier case.',{exact:true}).waitFor();
  await page.goto(origins.merchant);
  await page.getByLabel('Merchant demo password').fill('browser-test-password');
  await page.getByRole('button',{name:'Sign in to merchant',exact:true}).click();
  await page.getByLabel('What happened?').waitFor();
  // Observe the actual engine trace without adding a production SDK debugging API.
  await page.evaluate(async ()=>{
    const {Engine}=await import('/runtime/engine.js');
    const run=Engine.prototype.runTurn;
    Engine.prototype.runTurn=async function(...args){window.__pordenEngine=this;return run.apply(this,args);};
  });
  if (address) {await page.getByLabel('Include my delivery address').check();await page.getByLabel('Delivery address',{exact:true}).fill('12 Synthetic Lane, Test City');}
  return {context,page,courier,modelRequests,requests,errors};
}
async function begin(s) {
  await s.page.getByRole('button',{name:'Review sharing details',exact:true}).click();
  await s.page.getByRole('heading',{name:'Share these details with the courier?',exact:true}).waitFor();
}
async function proposal(s) {
  await begin(s);await s.page.getByRole('button',{name:'Approve sharing',exact:true}).click();
  await s.page.waitForFunction(()=>document.querySelector('dialog h2') || document.querySelector('.notice[role="alert"]'));
  if (!await s.page.getByRole('heading',{name:'Review the approved courier transfer',exact:true}).count())
    throw Error(await s.page.locator('.notice[role="alert"]').textContent());
}
async function popup(s) {
  await proposal(s);
  await s.page.getByRole('button',{name:'Confirm actions',exact:true}).click();
  const opened=s.page.waitForEvent('popup');
  await s.page.getByRole('button',{name:'Open action site',exact:true}).click();
  const popup=await opened;await popup.getByRole('button',{name:'Confirm actions',exact:true}).waitFor();return popup;
}
async function accepted(s) {
  const pop=await popup(s);await pop.getByRole('button',{name:'Confirm actions',exact:true}).click();
  await s.page.locator('[data-status="accepted"]').waitFor();
  assert.deepEqual(s.errors,[]);
  const trace=await s.page.evaluate(()=>window.__pordenEngine.trace.export());
  assert.ok(trace.events.some(e=>e.kind==='remote_call' && e.phase==='end' && e.status==='ok'));
  assert.ok(trace.events.some(e=>e.kind==='remote_fetch'));
  if (live) {
    const calls=trace.events.filter(e=>e.kind==='model_call' && e.phase==='end');
    assert.ok(calls.length>=3 && calls.every(e=>e.verifiedReal && !e.mock),'Real-model trace must verify all calls');
  }
  writeFileSync(resolve(proof,'trace.json'),JSON.stringify(trace,null,2));
  return trace;
}
try {
  for (const role of ['merchant','courier']) {
    admins[role]=new SQL(urls[role]);
    await admins[role].unsafe(`CREATE SCHEMA ${schema}`);
    databases[role]=new SQL({url:urls[role],prepare:false,connection:{search_path:schema}});
    await migrate(databases[role],role);
    const keyPath=resolve(proof,`${role}.pem`);
    writeFileSync(keyPath,generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
    const config=loadConfig({...process.env,ORGANIZATION_ROLE:role,PUBLIC_ORIGIN:origins[role],PEER_ORIGIN:origins[role==='merchant'?'courier':'merchant'],
      DATABASE_URL:urls[role],SESSION_SECRET:role.repeat(32),PARTNER_SECRET:'test-partner-secret-'.repeat(3),DEMO_PASSWORD:'browser-test-password',SIGNING_KEY_PATH:keyPath,
      OPENROUTER_API_KEY:live ? (process.env.OPENROUTER_API_KEY || process.env.openrouter_api_key) : 'scripted-not-a-key',OPENROUTER_MODEL:model});
    const signing=signer(config),db=store(databases[role],config,signing);
    await db.ready();
    const app=createApp(config,db,signing);
    servers.push(Bun.serve({hostname:'127.0.0.1',port:ports[role],fetch:app.fetch}));
    const proc=spawn('node',[resolve('node_modules/next/dist/bin/next'),'start',resolve(`apps/${role}-web`),'-p',new URL(origins[role]).port],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    proc.stdout.on('data',()=>{});proc.stderr.on('data',data=>console.error(`${role}:`,String(data)));processes.push(proc);
  }
  await waitForSites();
  browser=await chromium.launch({headless:true,...(process.env.HANDOFF_CHROME?{executablePath:process.env.HANDOFF_CHROME}:{})});
  await run('organization permissions and database isolation',async()=>{
    for (const role of ['merchant','courier']) {
      const other=role==='merchant'?'courier':'merchant';
      const own=await databases[role]`SELECT current_user AS name`;
      assert.equal(own[0].name,`porden_${role}`);
      const crossed=new URL(urls[role]);crossed.pathname=new URL(urls[other]).pathname;
      const client=new SQL(crossed.href);
      try {await assert.rejects(async()=>{await client`SELECT 1`;},error=>error.errno==='42501');} finally {await client.close();}
      await assert.rejects(async()=>{await databases[role].unsafe(`SET ROLE porden_${other}`);},error=>error.errno==='42501');
    }
  });
  if (!live) {
    await run('expired sessions offer sign-in without losing case details',async()=>{
      const before=await count(),s=await prepare();
      try {
        const description='Keep this synthetic damage description during sign-in.';
        await s.page.getByLabel('What happened?').fill(description);
        await s.context.clearCookies({name:'porden_merchant_session'});
        await s.page.getByRole('button',{name:'Review sharing details',exact:true}).click();
        await s.page.getByRole('button',{name:'Sign in to merchant',exact:true}).waitFor();
        await s.page.getByLabel('Merchant demo password').fill('browser-test-password');
        await s.page.getByRole('button',{name:'Sign in to merchant',exact:true}).click();
        await s.page.getByLabel('What happened?').waitFor();
        assert.equal(await s.page.getByLabel('What happened?').inputValue(),description);
        assert.equal(await count(),before);
      } finally {await s.context.close();}
    });
    await run('configuration failures show a handled UI error',async()=>{
      const context=await browser.newContext(),page=await context.newPage();
      try {
        await context.route(origins.merchant+'/api/config',route=>route.fulfill({status:502,contentType:'text/html',body:'<html>Unexpected gateway response</html>'}));
        await page.goto(origins.merchant);
        await page.locator('.notice[role="alert"]').waitFor();
        assert.ok((await page.locator('.notice[role="alert"]').textContent()).includes('The service could not complete the request'));
      } finally {await context.close();}
    });
    await run('provider HTTP failures are shown without raw provider text',async()=>{
      const before=await count(),s=await prepare();
      try {
        await s.context.route(origins.merchant+'/api/llm/chat/completions',route=>route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:{code:'PROVIDER_RATE_LIMITED',message:'private-provider-text',requestId:crypto.randomUUID()}})}));
        await begin(s);await s.page.getByRole('button',{name:'Approve sharing',exact:true}).click();
        await s.page.locator('.notice[role="alert"]').waitFor();
        assert.ok((await s.page.locator('.notice[role="alert"]').textContent()).includes('The AI provider is busy.'));
        assert.ok(!(await s.page.locator('.notice[role="alert"]').textContent()).includes('private-provider-text'));
        assert.equal(await count(),before);
      } finally {await s.context.close();}
    });
    await run('no inference or courier contact before customer consent',async()=>{
      const s=await prepare();try {const baseline=s.requests.length;await begin(s);assert.equal(s.modelRequests.length,0);assert.equal(s.requests.slice(baseline).filter(r=>r.url.startsWith(origins.courier)).length,0);await s.page.getByRole('button',{name:'Cancel transfer',exact:true}).click();await s.page.locator('[data-status="cancelled"]').waitFor();} finally {await s.context.close();}
    });
    await run('merchant action review cancellation creates no case',async()=>{
      const before=await count(),s=await prepare();try {await proposal(s);await s.page.getByRole('button',{name:'Cancel',exact:true}).click();await s.page.locator('[data-status="cancelled"]').waitFor();assert.equal(await count(),before);} finally {await s.context.close();}
    });
    await run('courier refusal is unknown and creates no case',async()=>{
      const before=await count(),s=await prepare();try {const pop=await popup(s);await pop.getByRole('button',{name:'Cancel',exact:true}).click();await s.page.getByRole('heading',{name:'Courier approval declined',exact:true}).waitFor();assert.equal(await count(),before);await s.page.getByRole('button',{name:'Check courier receipt',exact:true}).click();await s.page.locator('[data-status="unknown"]').waitFor();assert.equal(await count(),before);} finally {await s.context.close();}
    });
    for (const option of ['mutateDelegation','mutateAction']) await run(`${option} rejected without courier write`,async()=>{
      const before=await count(),s=await prepare({[option]:true});try {await begin(s);await s.page.getByRole('button',{name:'Approve sharing',exact:true}).click();await s.page.locator('.notice[role="alert"]').waitFor();assert.equal(await count(),before);} finally {await s.context.close();}
    });
    await run('receiver rejects tampered write payload',async()=>{
      const before=await count(),s=await prepare({tamperWrite:true});try {const pop=await popup(s);await pop.getByRole('button',{name:'Confirm actions',exact:true}).click();await s.page.locator('[data-status="unknown"]').waitFor();assert.equal(await count(),before);} finally {await s.context.close();}
    });
    for (const option of ['lostAck','brokenReceipt']) await run(`${option} reconciles without a second write`,async()=>{
      const before=await count(),s=await prepare({[option]:true});try {const pop=await popup(s);await pop.getByRole('button',{name:'Confirm actions',exact:true}).click();await s.page.locator('[data-status="unknown"]').waitFor();assert.equal(await count(),before+1);assert.equal(await s.page.getByRole('button',{name:'Review sharing details',exact:true}).isDisabled(),true);await s.page.getByRole('button',{name:'Check courier receipt',exact:true}).click();await s.page.locator('[data-status="accepted"]').waitFor();assert.equal(await count(),before+1);assert.equal(s.requests.filter(r=>r.url===origins.courier+'/api/v1/cases'&&r.method==='POST').length,1);} finally {await s.context.close();}
    });
  }
  for (let i=0;i<runs;i++) await run(`${live?'real-model':'scripted'} successful transfer ${i+1}/${runs}`,async()=>{
    const before=await count(),s=await prepare({address:i===1});
    try {
      const trace=await accepted(s);assert.equal(await count(),before+1);
      writeFileSync(resolve(proof,`trace-${i+1}.json`),JSON.stringify(trace,null,2));
      const [row]=await databases.courier`SELECT case_data FROM cases ORDER BY created_at DESC LIMIT 1`;
      assert.equal('deliveryAddress' in row.case_data,i===1);
      if (!live && i!==1) assert.ok(s.modelRequests.every(body=>!JSON.stringify(body).includes('Synthetic Lane')));
      const link=await s.page.getByRole('link',{name:'View the courier-owned record'}).getAttribute('href');
      await s.courier.goto(link);await s.courier.getByLabel('Courier demo password').fill('browser-test-password');await s.courier.getByRole('button',{name:'Sign in to courier',exact:true}).click();await s.courier.getByRole('heading',{name:'Courier-owned case record',exact:true}).waitFor();
      if (i===0) {
        await s.page.screenshot({path:resolve(proof,'merchant-desktop.png'),fullPage:true});
        await s.courier.screenshot({path:resolve(proof,'courier-desktop.png'),fullPage:true});
        await s.page.setViewportSize({width:390,height:844});await s.page.screenshot({path:resolve(proof,'merchant-mobile.png'),fullPage:true});
        assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile page must not overflow');
        await s.courier.setViewportSize({width:390,height:844});await s.courier.screenshot({path:resolve(proof,'courier-mobile.png'),fullPage:true});
        assert.equal(await s.courier.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Courier mobile page must not overflow');
      }
    } catch (error) {
      await s.page.screenshot({path:resolve(proof,`failure-${i+1}.png`),fullPage:true});
      const trace=await s.page.evaluate(()=>window.__pordenEngine?.trace.export() || null);
      writeFileSync(resolve(proof,`failure-${i+1}.json`),JSON.stringify(trace,null,2));
      throw error;
    } finally {await s.context.close();}
  });
} finally {
  await browser?.close();
  for (const proc of processes) {if (proc.exitCode===null) {const exited=once(proc,'exit');proc.kill();await exited;}}
  for (const server of servers) await server.stop(true);
  for (const role of ['merchant','courier']) {
    await databases[role]?.close();
    if (admins[role]) {await admins[role].unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admins[role].close();}
  }
}
assert.ok(results.length>0,'No scenarios matched');
const failures=results.filter(result=>!result.passed);
console.log(`${results.length-failures.length} passed; ${failures.length} failed; evidence: ${proof}`);
if (failures.length) process.exitCode=1;
