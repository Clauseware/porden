// Scripted model responses; unmodified official agent loop, transport and popup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const { chromium } = await import(process.env.HANDOFF_PLAYWRIGHT_MODULE || 'playwright');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function rows(db) {
  const connection = new DatabaseSync(db, {readOnly:true});
  try { return connection.prepare('SELECT * FROM cases ORDER BY rowid').all(); }
  finally { connection.close(); }
}
async function waitFor(predicate, message) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await pause(50);
  }
  throw Error(message);
}

test('official runtime handoff', {timeout:120000}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-runtime-'));
  const db = join(dir, 'cases.sqlite');
  const merchantPort = await freePort();
  const courierPort = await freePort();
  const merchant = `http://localhost:${merchantPort}`;
  const courier = `http://localhost:${courierPort}`;
  const proc = spawn(process.execPath, ['server.mjs'], {env:{...process.env,
    OPENROUTER_API_KEY:'test-server-key-not-a-credential',OPENROUTER_MODEL:'',
    HANDOFF_DB:db,HANDOFF_MERCHANT_PORT:String(merchantPort),HANDOFF_COURIER_PORT:String(courierPort)},
    windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output = '';
  proc.stdout.on('data', b => { output += b; });
  proc.stderr.on('data', b => { output += b; });
  let browser;
  try {
    await waitFor(async () => {
      if (proc.exitCode !== null) throw Error(output);
      try { return (await fetch(merchant)).ok; } catch { return false; }
    }, 'server did not start: ' + output);
    browser = await chromium.launch({headless:true, ...(process.env.HANDOFF_CHROME ? {executablePath:process.env.HANDOFF_CHROME} : {})});

    async function prepare({address=false, mutateDelegation=false, mutateAction=false, serverOpenRouter=false} = {}) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const requests = [];
      const modelRequests = [];
      const errors = [];
      context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
      page.on('pageerror', e => errors.push(e.message));
      context.on('request', r => requests.push({url:r.url(),method:r.method(),body:r.postData(),headers:r.headers()}));
      await context.route('https://model.handoff.test/agent-manifest.json', route => route.fulfill({status:404,body:'{}'}));
      const modelResponse = async route => {
        const body = route.request().postDataJSON();
        modelRequests.push(body);
        const messages = body.messages;
        const child = messages.filter(m => m.role === 'tool');
        const user = messages.findLast(m => m.role === 'user').content;
        let delta;
        if (body.tools?.length && !child.length) {
          const approved = JSON.parse(user);
          if (mutateDelegation) approved.deliveryAddress = 'Unapproved model-invented address';
          delta = {tool_calls:[{index:0,id:'courier-delegation',type:'function',function:{
            name:body.tools[0].function.name,arguments:JSON.stringify({request:JSON.stringify(approved)})}}]};
        } else {
          let components;
          if (child.length) {
            try { components = JSON.parse(child[0].content).presentation?.components || []; }
            catch { components = []; }
          } else {
            const catalogLine = messages[0].content.split('CRUSE browser actions (proposals only; these are NOT tool calls):\n')[1]?.split('\n')[0];
            assert.ok(catalogLine, 'courier must receive its runtime action catalog');
            const catalog = JSON.parse(catalogLine);
            const args = JSON.parse(user);
            if (mutateAction) args.deliveryAddress = 'Unapproved model-invented address';
            components = [{id:'create_damage_case',kind:'action',label:'Submit approved case',
              action:catalog[0].ref,arguments:args}];
          }
          delta = {content:'Review this proposed transfer.\n```cruse-ui\n' + JSON.stringify({version:1,components}) + '\n```'};
        }
        await route.fulfill({status:200,headers:{'content-type':'text/event-stream',
          'access-control-allow-origin':'*','access-control-expose-headers':'X-Nsdeploy-LLM-Route','X-Nsdeploy-LLM-Route':'mock'},
          body:'data: ' + JSON.stringify({model:'handoff-scripted-test',choices:[{index:0,delta,finish_reason:delta.tool_calls?'tool_calls':'stop'}]}) + '\n\ndata: [DONE]\n\n'});
      };
      await context.route('https://model.handoff.test/v1/chat/completions', modelResponse);
      await context.route(merchant + '/api/llm/chat/completions', modelResponse);
      await page.goto(merchant);
      await page.locator('#ai-settings > summary').click();
      await page.waitForFunction(() => document.querySelector('#server-openrouter').checked);
      if (!serverOpenRouter) {
        await page.locator('#server-openrouter').uncheck();
        await page.locator('#router').fill('https://model.handoff.test/v1');
        await page.locator('#api-key').fill('test-key-not-a-credential');
      }
      await page.locator('#model').fill('handoff-scripted-test');
      if (address) await page.locator('#share-address').check();
      return {context,page,requests,modelRequests,errors};
    }
    async function proposal(page) {
      await page.locator('#connect-consent').check();
      await page.locator('#start').click();
      await page.waitForFunction(() => document.querySelector('dialog h2') || document.querySelector('#status').textContent.startsWith('Handoff stopped:'));
      assert.equal(await page.getByRole('heading', {name:'Review the approved courier transfer'}).count(), 1,
        await page.locator('#status').textContent());
    }
    async function popup(page) {
      await proposal(page);
      await page.getByRole('button', {name:'Confirm actions',exact:true}).click();
      const opened = page.waitForEvent('popup');
      await page.getByRole('button', {name:'Open action site',exact:true}).click();
      const pop = await opened;
      await pop.getByRole('button', {name:'Confirm actions',exact:true}).waitFor();
      return pop;
    }
    const posts = s => s.requests.filter(r => r.method === 'POST' && r.url === courier + '/api/cases');
    async function successful(s) {
      const pop = await popup(s.page);
      await pop.getByRole('button', {name:'Confirm actions',exact:true}).click();
      await s.page.locator('#proof').waitFor({state:'visible'});
      assert.match(await s.page.locator('#signature-status').textContent(), /PASS/);
      assert.equal(posts(s).length, 1);
      assert.deepEqual(s.errors, []);
      return rows(db).at(-1);
    }

    await t.test('no courier contact or writes before consent', async () => {
      const s = await prepare();
      assert.equal(await s.page.locator('#start').isDisabled(), true);
      assert.equal(s.requests.filter(r => r.url.startsWith(courier)).length, 0);
      assert.equal(s.modelRequests.length, 0);
      assert.equal(rows(db).length, 0);
      await s.context.close();
    });
    await t.test('both origins publish loadable runtime and discovery files without exposing private files', async () => {
      for (const [origin, network] of [[merchant,'merchant'],[courier,'courier']]) {
        for (const path of ['/agent-manifest.json',`/${network}.network.json`,'/links.json','/agent-mcp.json',
          '/.well-known/nsdeploy.json','/.well-known/nsdeploy-agent.json']) {
          const response = await fetch(origin + path);
          assert.equal(response.status, 200, origin + path);
          assert.equal(response.headers.get('access-control-allow-origin'), '*');
          await response.json();
        }
        const response = await fetch(origin + '/runtime/engine.js');
        assert.equal(await response.text(), await readFile('vendor/nsdeploy/nsdeploy/runtime/engine.js','utf8'));
        const worker = await fetch(origin + '/runtime/sandbox-worker.js');
        assert.match(worker.headers.get('content-security-policy'), /connect-src 'none'/);
        for (const path of ['/runtime/../../courier-signing-key.pem','/runtime/package.json','/vendor/nsdeploy/.git/config',
          '/courier-signing-key.pem','/handoff-demo.sqlite']) {
          assert.equal((await fetch(origin + path)).status, 404, origin + path);
        }
      }
    });
    await t.test('real runtime delegation, official popup, address omission and signed receipt', async () => {
      const s = await prepare();
      const record = await successful(s);
      const payload = JSON.parse(record.payload);
      assert.equal('deliveryAddress' in payload, false);
      assert.equal(JSON.stringify(s.modelRequests).includes('Example Street'), false);
      assert.equal(s.modelRequests.length, 3, 'merchant -> courier -> merchant model calls');
      const trace = await s.page.evaluate(() => window.__nsweb.trace.export());
      assert.ok(trace.events.some(e => e.kind === 'remote_fetch' && e.phase === 'end' && e.status === 'ok'));
      assert.ok(trace.events.some(e => e.kind === 'remote_call' && e.phase === 'end' && e.method === 'fetch-and-run-locally' && e.network === 'courier'));
      assert.ok(trace.events.filter(e => e.kind === 'model_call' && e.phase === 'end').every(e => e.mock && !e.verifiedReal));
      assert.equal(posts(s)[0].headers.origin, courier);
      assert.equal(posts(s)[0].headers.authorization, undefined, 'BYOK key never reaches courier API');
      assert.ok(posts(s)[0].headers['x-csrf-token']);
      assert.equal(s.requests.filter(r => r.url.startsWith(courier) && r.headers.authorization).length, 0);
      await mkdir('tmp/runtime-proof', {recursive:true});
      await writeFile('tmp/runtime-proof/trace.json', JSON.stringify(trace,null,2));
      await s.page.screenshot({path:'tmp/runtime-proof/merchant-receipt.png',fullPage:true});
      const verifyOpened = s.page.waitForEvent('popup');
      await s.page.locator('#verify').click();
      const verified = await verifyOpened;
      await verified.locator('#data').waitFor({state:'visible'});
      assert.match(await verified.locator('#data').textContent(), new RegExp(record.id));
      assert.match(await verified.locator('#state').textContent(), /persisted courier record/);
      await s.context.close();
    });
    await t.test('explicitly selected address reaches the courier', async () => {
      const s = await prepare({address:true});
      const record = await successful(s);
      assert.match(JSON.parse(record.payload).deliveryAddress, /Example Street/);
      await s.context.close();
    });
    await t.test('configured OpenRouter works without a browser key', async () => {
      const s = await prepare({serverOpenRouter:true});
      assert.equal(await s.page.locator('#api-key').inputValue(), '');
      assert.equal(await s.page.locator('#api-key').isDisabled(), true);
      await successful(s);
      assert.equal(s.requests.filter(r => r.url === merchant + '/api/llm/chat/completions').length, 3);
      assert.equal(JSON.stringify(s.requests).includes('test-server-key-not-a-credential'), false);
      await s.context.close();
    });
    await t.test('cancel merchant review creates no case', async () => {
      const before = rows(db).length;
      const s = await prepare();
      await proposal(s.page);
      await s.page.getByRole('button', {name:'Cancel',exact:true}).click();
      await s.page.waitForFunction(() => document.querySelector('#status').textContent.includes('cancelled merchant review'));
      assert.equal(posts(s).length, 0);
      assert.equal(rows(db).length, before);
      await s.context.close();
    });
    await t.test('decline courier confirmation creates no case', async () => {
      const before = rows(db).length;
      const s = await prepare();
      const pop = await popup(s.page);
      await pop.getByRole('button', {name:'Cancel',exact:true}).click();
      await s.page.waitForFunction(() => document.querySelector('#status').textContent.includes('User declined; action not started'));
      assert.equal(posts(s).length, 0);
      assert.equal(rows(db).length, before);
      await s.context.close();
    });
    await t.test('model cannot add unapproved fields to delegation', async () => {
      const before = rows(db).length;
      const s = await prepare({mutateDelegation:true});
      await s.page.locator('#connect-consent').check();
      await s.page.locator('#start').click();
      await s.page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Handoff stopped:'));
      assert.equal(s.requests.filter(r => r.url.startsWith(courier)).length, 0);
      assert.equal(rows(db).length, before);
      await s.context.close();
    });
    await t.test('model cannot add unapproved fields to the courier action', async () => {
      const before = rows(db).length;
      const s = await prepare({mutateAction:true});
      await s.page.locator('#connect-consent').check();
      await s.page.locator('#start').click();
      await s.page.waitForFunction(() => document.querySelector('#status').textContent.includes('Action differs from the approved'));
      assert.equal(posts(s).length, 0);
      assert.equal(rows(db).length, before);
      await s.context.close();
    });
    await t.test('iframe cannot bypass courier confirmation and other origins get no catalog', async () => {
      const before = rows(db).length;
      const s = await prepare();
      const result = await s.page.evaluate(async courier => {
        const {ActionBridgeClient} = await import('/runtime/action-transport.js');
        const client = new ActionBridgeClient(courier + '/action-bridge.html');
        try {
          await client.connect();
          const catalog = await client.request('catalog');
          try {
            await client.request('execute', {name:'create_damage_case',requestId:'forged:0',confirmed:true,
              args:{orderReference:'DEMO-1042',damageDescription:'The box was badly damaged.'}});
            return {catalog,failed:false};
          } catch (error) { return {catalog,error:error.message}; }
        } finally { client.dispose(); }
      }, courier);
      assert.equal(result.catalog.length, 1);
      assert.match(result.error, /own confirmation window/);
      await s.page.goto(`http://127.0.0.1:${merchantPort}`);
      const unauthorized = await s.page.evaluate(async courier => {
        const {ActionBridgeClient} = await import('/runtime/action-transport.js');
        const client = new ActionBridgeClient(courier + '/action-bridge.html');
        try { await client.connect(); return await client.request('catalog'); }
        finally { client.dispose(); }
      }, courier);
      assert.deepEqual(unauthorized, []);
      assert.equal(posts(s).length, 0);
      assert.equal(rows(db).length, before);
      await s.context.close();
    });
    await t.test('duplicate runtime submission and adapter replay persist exactly once', async () => {
      const before = rows(db).length;
      const s = await prepare();
      const record = await successful(s);
      const replay = await s.page.evaluate(async () => {
        const engine = window.__nsweb.engine;
        const [turnId, presentation] = [...engine.actionPresentations.entries()][0];
        return await engine.submitActions({turnId,componentId:presentation.components[0].id});
      });
      assert.equal(posts(s).length, 1, 'runtime must return the consumed submission without another popup or POST');
      const courierPage = await s.context.newPage();
      await courierPage.goto(courier + '/action-bridge.html');
      const payload = JSON.parse(record.payload);
      const retry = await courierPage.evaluate(async ({args,requestId}) => {
        const {registerActions} = await import('/actions.js');
        let action;
        await registerActions({register:definition => { action = definition; }});
        return await action.execute(args, {requestId});
      }, {args:Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'transferId')),requestId:replay[0].requestId});
      assert.equal(retry.idempotent, true);
      assert.equal(retry.receipt, replay[0].result.receipt);
      assert.equal(rows(db).length, before + 1);
      assert.equal(await s.page.locator('#start').isDisabled(), true);
      await s.context.close();
    });
    await t.test('tampered receipt fails cryptographic verification', async () => {
      const s = await prepare();
      await successful(s);
      const result = await s.page.evaluate(async () => {
        const {verifyJws} = await import('/merchant.js');
        const token = document.querySelector('#token').textContent;
        const parts = token.split('.');
        const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
        payload.status = 'refunded';
        parts[1] = btoa(JSON.stringify(payload)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
        return {valid:await verifyJws(token),tampered:await verifyJws(parts.join('.')),extraPart:await verifyJws(token + '.extra')};
      });
      assert.deepEqual(result, {valid:true,tampered:false,extraPart:false});
      await s.context.close();
    });
    await t.test('lost write acknowledgement is UNKNOWN with no automatic retry', async () => {
      const before = rows(db).length;
      const s = await prepare();
      await s.context.route(courier + '/api/cases', async route => {
        const response = await route.fetch();
        assert.equal(response.status(), 201, 'write commits before acknowledgement is lost');
        await route.abort('connectionfailed');
      });
      const pop = await popup(s.page);
      await pop.getByRole('button', {name:'Confirm actions',exact:true}).click();
      await s.page.waitForFunction(() => document.querySelector('#status').textContent.includes('status UNKNOWN'));
      assert.equal(posts(s).length, 1);
      assert.equal(rows(db).length, before + 1);
      assert.equal(await s.page.locator('#start').isDisabled(), true);
      await s.context.close();
    });
    await t.test('official action timeout stays UNKNOWN and consumes the submission', async () => {
      const before = rows(db).length;
      const s = await prepare();
      await proposal(s.page);
      const outcome = await s.page.evaluate(async () => {
        const engine = window.__nsweb.engine;
        // Use the documented minimum timeout on this caller-side test action.
        const ref = engine.actions.register({base:location.origin,network:'timeout_test'}, {
          name:'wait_for_ack',description:'Test uncertain acknowledgement',effect:'write',timeoutMs:100,
          inputSchema:{type:'object',properties:{}},execute:() => new Promise(() => {})});
        const component = {id:'timeout',kind:'action',action:ref,arguments:{}};
        engine.rememberActionPresentation({turnId:'timeout-test',presentation:{version:1,components:[component]}});
        engine.onActionConfirm = async () => true;
        const first = await engine.submitActions({turnId:'timeout-test',componentId:'timeout'});
        const second = await engine.submitActions({turnId:'timeout-test',componentId:'timeout'});
        return {first,second};
      });
      assert.equal(outcome.first[0].status, 'unknown');
      assert.match(outcome.first[0].error, /timed out/);
      assert.deepEqual(outcome.second, outcome.first);
      assert.equal(posts(s).length, 0);
      assert.equal(rows(db).length, before);
      await s.context.close();
    });
  } finally {
    await browser?.close();
    const exited = once(proc, 'exit');
    proc.kill();
    await exited;
    await rm(dir, {recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
