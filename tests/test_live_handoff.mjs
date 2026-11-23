// Opt-in live inference using synthetic data and an isolated courier database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.mjs';

const { chromium } = await import(process.env.HANDOFF_PLAYWRIGHT_MODULE || 'playwright');
async function freePort() {
  const server = createServer().listen(0,'127.0.0.1');
  await once(server,'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('live free-model official-runtime handoff', {timeout:240000}, async () => {
  assert.ok(config.openrouterApiKey, 'Set OPENROUTER_API_KEY in .env');
  assert.ok(config.openrouterModel.endsWith(':free'), 'This live test requires an explicit :free model');
  const dir = await mkdtemp(join(tmpdir(),'handoff-live-'));
  const dbPath = join(dir,'cases.sqlite');
  const merchantPort = await freePort();
  const courierPort = await freePort();
  const origin = `http://localhost:${merchantPort}`;
  const proc = spawn(process.execPath,['server.mjs'], {env:{...process.env,
    HANDOFF_DB:dbPath,HANDOFF_SIGNING_KEY:join(dir,'key.pem'),
    HANDOFF_MERCHANT_PORT:String(merchantPort),HANDOFF_COURIER_PORT:String(courierPort)},
    windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs = '';
  proc.stdout.on('data', b => { logs += b; });
  proc.stderr.on('data', b => { logs += b; });
  let browser;
  let page;
  let failure;
  try {
    let ready = false;
    for (let i=0;i<100;i++) {
      if (proc.exitCode !== null) throw Error(logs);
      try { if ((await fetch(origin + '/api/config')).ok) {ready = true;break;} } catch {}
      await new Promise(resolve => setTimeout(resolve,50));
    }
    assert.ok(ready,'local server started');
    browser = await chromium.launch({headless:true,...(process.env.HANDOFF_CHROME ? {executablePath:process.env.HANDOFF_CHROME} : {})});
    page = await browser.newPage();
    page.setDefaultTimeout(180000);
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector('#server-openrouter').checked);
    await page.locator('#connect-consent').check();
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('dialog h2') || document.querySelector('#status').textContent.startsWith('Handoff stopped:'));
    assert.equal(await page.getByRole('heading',{name:'Review the approved courier transfer'}).count(),1,
      await page.locator('#status').textContent());
    await page.getByRole('button',{name:'Confirm actions',exact:true}).click();
    const opened = page.waitForEvent('popup');
    await page.getByRole('button',{name:'Open action site',exact:true}).click();
    const popup = await opened;
    await popup.getByRole('button',{name:'Confirm actions',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#proof').style.display === 'block' ||
      /Handoff stopped:|status UNKNOWN/.test(document.querySelector('#status').textContent));
    assert.match(await page.locator('#signature-status').textContent(),/PASS/,
      await page.locator('#status').textContent());
    const db = new DatabaseSync(dbPath,{readOnly:true});
    try {
      const cases = db.prepare('SELECT payload FROM cases').all();
      assert.equal(cases.length,1);
      assert.equal('deliveryAddress' in JSON.parse(cases[0].payload),false);
    } finally { db.close(); }
    const trace = await page.evaluate(() => window.__nsweb.trace.export());
    assert.ok(trace.events.some(e => e.kind === 'remote_call' && e.phase === 'end' && e.status === 'ok'));
    const calls = trace.events.filter(e => e.kind === 'model_call' && e.phase === 'end');
    assert.ok(calls.length >= 3 && calls.every(e => e.verifiedReal && !e.mock));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await mkdir('tmp/live-proof',{recursive:true});
    const trace = page ? await page.evaluate(() => window.__nsweb?.trace.export() || null).catch(() => null) : null;
    await writeFile('tmp/live-proof/result.json',JSON.stringify({
      model:config.openrouterModel,success:!failure,error:failure?.message,trace,
    },null,2));
    if (page) await page.screenshot({path:'tmp/live-proof/merchant.png',fullPage:true}).catch(() => {});
    await browser?.close();
    const exited = once(proc,'exit');
    proc.kill();
    await exited;
    await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
