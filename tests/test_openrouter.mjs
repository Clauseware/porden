import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

async function port() {
  const server = createServer().listen(0,'127.0.0.1');
  await once(server,'listening');
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

test('server-side OpenRouter configuration and streaming', {timeout:15000}, async () => {
  const dir = await mkdtemp(join(tmpdir(),'handoff-openrouter-'));
  const merchantPort = await port();
  const courierPort = await port();
  const origin = `http://localhost:${merchantPort}`;
  const key = 'test-private-server-key';
  const mockFile = join(dir,'mock-openrouter.mjs');
  // Intercept only the child server's outbound request; the HTTP proxy runs unchanged.
  await writeFile(mockFile, `
import assert from 'node:assert/strict';
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(options.headers, {'Content-Type':'application/json',Authorization:'Bearer test-private-server-key'});
  assert.equal(options.redirect, 'error');
  const body = JSON.parse(options.body);
  if (body.model === 'test-error') return new Response('sensitive upstream detail', {status:429});
  if (body.model === 'test-disconnect') throw Error('private error with credential');
  assert.equal(body.model, 'test-model');
  assert.equal(body.stream, true);
  return new Response(new ReadableStream({start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"model":"test-model","choices":[]}\\n\\n'));
    setTimeout(() => {controller.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'));controller.close();},20);
  }}), {headers:{'content-type':'text/event-stream'}});
};
`);
  const proc = spawn(process.execPath,['--import',pathToFileURL(mockFile).href,'server.mjs'], {
    env:{...process.env,OPENROUTER_API_KEY:key,OPENROUTER_MODEL:'test-model',
      HANDOFF_DB:join(dir,'cases.sqlite'),HANDOFF_SIGNING_KEY:join(dir,'key.pem'),
      HANDOFF_MERCHANT_PORT:String(merchantPort),HANDOFF_COURIER_PORT:String(courierPort)},
    windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  let logs = '';
  proc.stdout.on('data',b => {logs += b;});
  proc.stderr.on('data',b => {logs += b;});
  try {
    let ready = false;
    for (let i=0;i<80;i++) {
      if (proc.exitCode !== null) throw Error(logs);
      try { if ((await fetch(origin + '/api/config')).ok) {ready = true;break;} } catch {}
      await new Promise(resolve => setTimeout(resolve,50));
    }
    assert.ok(ready,'server started');
    const settings = await (await fetch(origin + '/api/config')).json();
    assert.deepEqual(settings,{openrouterConfigured:true,openrouterModel:'test-model'});
    for (const path of ['/api/config','/agent-manifest.json']) {
      assert.equal((await (await fetch(origin + path)).text()).includes(key),false);
    }
    assert.equal((await fetch(origin + '/.env')).status,404);
    const complete = (model,requestOrigin=origin) => fetch(origin + '/api/llm/chat/completions', {
      method:'POST',headers:{'content-type':'application/json',Origin:requestOrigin,Authorization:'Bearer client-marker',Cookie:'private-browser-cookie'},
      body:JSON.stringify({model,messages:[{role:'user',content:'Test'}],stream:true}),
    });
    assert.equal((await complete('test-model','https://unapproved.example')).status,403);
    assert.equal((await fetch(origin + '/api/llm/chat/completions')).status,405);
    assert.equal((await complete('')).status,400);
    const response = await complete('test-model');
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/text\/event-stream/);
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    assert.match(await response.text(),/data: \[DONE\]/);
    const limited = await complete('test-error');
    assert.equal(limited.status,429);
    assert.deepEqual(await limited.json(),{error:'OpenRouter returned HTTP 429'});
    const failed = await complete('test-disconnect');
    assert.equal(failed.status,502);
    assert.deepEqual(await failed.json(),{error:'OpenRouter request failed'});
    assert.equal(logs.includes(key),false);
  } finally {
    const exited = once(proc,'exit');
    proc.kill();
    await exited;
    await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
