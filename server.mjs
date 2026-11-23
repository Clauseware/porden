import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, generateKeyPairSync, createPrivateKey, createPublicKey, sign, createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MERCHANT_PORT = Number(process.env.HANDOFF_MERCHANT_PORT) || 4100;
const COURIER_PORT = Number(process.env.HANDOFF_COURIER_PORT) || 4200;
const MERCHANT = `http://localhost:${MERCHANT_PORT}`;
const COURIER = `http://localhost:${COURIER_PORT}`;
const DB_PATH = process.env.HANDOFF_DB || join(ROOT, 'handoff-demo.sqlite');
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL UNIQUE,
  courier_customer_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  signed_receipt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shipments (order_reference TEXT PRIMARY KEY, customer_id TEXT NOT NULL);
INSERT OR IGNORE INTO shipments (order_reference,customer_id) VALUES ('DEMO-1042','demo-user');`);
// Developer-only signing key persists alongside SQLite so earlier receipts survive restarts.
// Production should keep the private key in managed key storage instead.
const KEY_PATH=process.env.HANDOFF_SIGNING_KEY || join(dirname(DB_PATH),'courier-signing-key.pem');
let privateKey;
if (existsSync(KEY_PATH)) { privateKey=createPrivateKey(readFileSync(KEY_PATH)); }
else {
  privateKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey;
  writeFileSync(KEY_PATH,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
}
const publicKey=createPublicKey(privateKey);
const pub = publicKey.export({ format: 'jwk' });
const jwk = { ...pub, kid: 'ephemeral-demo-key', alg: 'ES256', use: 'sig' };
const sessionId = randomBytes(24).toString('hex');
const csrfToken = randomBytes(24).toString('hex');
const RUNTIME = join(ROOT, 'vendor/nsdeploy/nsdeploy/runtime');
if (!existsSync(join(RUNTIME, 'engine.js'))) throw Error('Official runtime missing. Clone cognizant-ai-lab/nsdeploy into vendor/nsdeploy.');
const runtimeFiles = new Set(['engine.js', 'actions.js', 'action-transport.js', 'action-bridge.js',
  'byok.js', 'cruse.js', 'cruse-render.js', 'discovered-actions.js', 'execution-stream.js',
  'form-actions.js', 'hocon.js', 'kernel.js', 'llm.js', 'mcp.js', 'model.js', 'provider-error.js',
  'remote.js', 'runner.js', 'sandbox.js', 'sandbox-worker.js', 'trace.js', 'turn-control.js',
  'turn-status.js', 'web-crypto.js', 'generated/graph.gen.mjs', 'generated/validation.gen.mjs',
  'generated/sly_data.gen.mjs']);
function agentFiles(req, res, path, site) {
  if (path.startsWith('/runtime/')) {
    const file = path.slice('/runtime/'.length);
    if (!runtimeFiles.has(file)) { send(res,404,{error:'not found'}); return true; }
    const headers = {'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'};
    if (file === 'sandbox-worker.js') headers['Content-Security-Policy'] = "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'";
    res.writeHead(200,headers);res.end(readFileSync(join(RUNTIME,file)));return true;
  }
  const base = site === 'merchant' ? MERCHANT : COURIER;
  const front = site === 'merchant' ? 'merchant_front' : 'courier_front';
  const links = site === 'merchant' ? {courier: `${COURIER}/courier`} : {};
  const linking = {protocol:'nsdeploy-link/v1',site:base,exports:[{network:site,front_man:front,aliases:[site,front],url:`${base}/${site}`}],
    imports:site === 'merchant' ? [{network:site,reference:'courier',callers:[front],status:'linked',target:links.courier}] : [],link_updates:{mode:'browser-local'}};
  const mcp = {protocol:'nsdeploy-agent-mcp/v1',network:site,front_man:front,available:false,reason:'Browser fetch-and-run deployment; no public MCP facade.'};
  const manifest = {name:`demo-${site}`,brand:`Demo ${site}`,front_man:front,
    networks:[{name:site,front_man:front,hocon:`./${site}.network.json`,description:`Customer-approved ${site} damage-case handoff`}],
    llm_router:{base_url:'https://openrouter.ai/api/v1',byok_router:'https://openrouter.ai/api/v1',mock:false},
    allowed_peers:site === 'merchant' ? [COURIER] : [],
    deployment:{mode:'static',self_contained_runtime:true,browser_mock:false,direct_byok:true,public_mcp_facade:false},
    linking,agent_mcp:mcp,
    ...(site === 'courier' ? {actions:{version:1,bridge:'./action-bridge.html',module:'./actions.js'}} : {})};
  const files = {'/agent-manifest.json':manifest,'/links.json':{version:1,networks:{[site]:links}},
    '/.well-known/nsdeploy.json':linking,'/agent-mcp.json':mcp,'/.well-known/nsdeploy-agent.json':mcp};
  if (Object.hasOwn(files,path)) {send(res,200,files[path],{'Access-Control-Allow-Origin':'*'});return true;}
  if (site === 'courier' && path === '/action-policy.json') {send(res,200,{callerOrigins:[MERCHANT]});return true;}
  if (path === `/${site}.network.json`) {
    res.setHeader('Access-Control-Allow-Origin','*');safeStatic(res,`${site}/${site}.network.json`,'application/json');return true;
  }
  if (site === 'courier' && path === '/action-bridge.html') {
    // The development login stays on the courier origin, including the official popup.
    res.setHeader('Set-Cookie',`sid=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
    safeStatic(res,'courier/action-bridge.html');return true;
  }
  return false;
}
function send(res,status,body,headers={}) { res.writeHead(status,{ 'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers });res.end(JSON.stringify(body)); }
function safeStatic(res,file,kind='text/html') { try {const data=readFileSync(join(ROOT,'public',file)); res.writeHead(200,{'content-type':kind,'cache-control':'no-store'});res.end(data);}catch{send(res,404,{error:'not found'});} }
function hasSession(req) {return req.headers.cookie?.split('; ').includes('sid='+sessionId) || false; }
function hashPayload(obj) {return createHash('sha256').update(JSON.stringify(obj)).digest('hex');}
function jws(payload) {
  const header = Buffer.from(JSON.stringify({alg:'ES256',typ:'JWT',kid:'ephemeral-demo-key'})).toString('base64url');
  const middle = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${middle}`;
  const sig = sign('sha256',Buffer.from(data),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return `${data}.${sig}`;
}
async function readBody(req) {
  let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error('payload too large');}
  return JSON.parse(text);
}
function validateCase(payload) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return 'invalid request';
  const expected = ['transferId','orderReference','damageDescription','deliveryAddress'];
  if(Object.keys(payload).some(k=>!expected.includes(k)))return 'unexpected field';
  if(!/^[\w-]{8,100}$/.test(payload.transferId||''))return 'invalid transfer ID';
  if(payload.orderReference!=='DEMO-1042')return 'unknown shipment';
  if(typeof payload.damageDescription!=='string'||payload.damageDescription.trim().length<8||payload.damageDescription.length>500)return 'invalid damage description';
  if('deliveryAddress' in payload&&(typeof payload.deliveryAddress!=='string'||payload.deliveryAddress.length>250||payload.deliveryAddress.trim().length<5))return 'invalid address';
  return null;
}
function withOrigin(req,res) {
  // Auth and origin checks here are demo constraints, not production identity verification.
  if (req.headers.origin!==COURIER){send(res,403,{error:'wrong origin'});return false;}
  if (!hasSession(req)){send(res,401,{error:'courier login required'});return false;}
  if (req.headers['x-csrf-token']!==csrfToken){send(res,403,{error:'CSRF token mismatch'});return false;}
  return true;
}
async function merchantHandler(req,res) {
 const path=new URL(req.url,MERCHANT).pathname;
 if(path==='/api/config'&&req.method==='GET')return send(res,200,{
  openrouterConfigured:Boolean(config.openrouterApiKey),openrouterModel:config.openrouterModel,
 });
 if(path==='/api/llm/chat/completions'){
  if(req.method!=='POST')return send(res,405,{error:'POST required'});
  if(req.headers.origin!==MERCHANT)return send(res,403,{error:'wrong origin'});
  if(!config.openrouterApiKey)return send(res,503,{error:'OPENROUTER_API_KEY is not configured'});
  let body;try{body=await readBody(req);}catch{return send(res,400,{error:'bad JSON'});}
  if(!body||typeof body.model!=='string'||!body.model.trim()||!Array.isArray(body.messages))return send(res,400,{error:'model and messages are required'});
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  res.once('close',cancel);
  try{
   const upstream=await fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',redirect:'error',signal:controller.signal,
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.openrouterApiKey}`},
    body:JSON.stringify(body),
   });
   if(!upstream.ok){await upstream.body?.cancel();return send(res,upstream.status,{error:`OpenRouter returned HTTP ${upstream.status}`});}
   res.writeHead(200,{'content-type':upstream.headers.get('content-type')||'text/event-stream','cache-control':'no-store'});
   await pipeline(Readable.fromWeb(upstream.body),res);
  }catch{
   if(!res.headersSent)send(res,502,{error:'OpenRouter request failed'});
   else res.destroy();
  }finally{res.removeListener('close',cancel);}
  return;
 }
 if(agentFiles(req,res,path,'merchant'))return;
 if(path==='/'||path==='/index.html')return safeStatic(res,'merchant/index.html');
 if(path==='/merchant.js')return safeStatic(res,'merchant/merchant.js','text/javascript; charset=utf-8');
 send(res,404,{error:'not found'});
}
async function courierHandler(req,res) {
 const path=new URL(req.url,COURIER).pathname;
 if(agentFiles(req,res,path,'courier'))return;
 if(path==='/'||path==='/index.html')return safeStatic(res,'courier/index.html');
 if(path==='/bridge.html') {
  res.setHeader('Set-Cookie',`sid=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
  return safeStatic(res,'courier/bridge.html');
 }
 if(path==='/bridge.js')return safeStatic(res,'courier/bridge.js','text/javascript; charset=utf-8');
 if(path==='/actions.js')return safeStatic(res,'courier/actions.js','text/javascript; charset=utf-8');
 if(path.startsWith('/verify/')){
  res.setHeader('Set-Cookie',`sid=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
  return safeStatic(res,'courier/verify.html');
 }
 if(path==='/.well-known/jwks.json')return send(res,200,{keys:[jwk]},{'Access-Control-Allow-Origin':'*'});
 if(path==='/api/session'&&req.method==='GET')return hasSession(req)?send(res,200,{csrf:csrfToken,customerId:'demo-user'}):send(res,401,{error:'login needed'});
 if(path.startsWith('/api/receipts/')&&req.method==='GET'){
  if(!hasSession(req))return send(res,401,{error:'courier login required'});
  const id=path.slice('/api/receipts/'.length);
  const record=db.prepare('SELECT * FROM cases WHERE receipt_id=?').get(id);
  return record?send(res,200,{receipt:record.signed_receipt,case:{id:record.id,transferId:record.transfer_id,status:'received',payload:JSON.parse(record.payload),createdAt:record.created_at}}):send(res,404,{error:'no such receipt'});
 }
 if(path==='/api/cases'&&req.method==='POST'){
  if(!withOrigin(req,res))return;
  let payload;try{payload=await readBody(req);}catch{return send(res,400,{error:'bad JSON'});}
  const err=validateCase(payload);if(err)return send(res,400,{error:err});
  const shipment=db.prepare('SELECT customer_id FROM shipments WHERE order_reference=?').get(payload.orderReference);
  if(shipment?.customer_id!=='demo-user')return send(res,403,{error:'shipment unauthorized'});
  const existing=db.prepare('SELECT * FROM cases WHERE transfer_id=?').get(payload.transferId);
  if(existing){
   if(hashPayload(JSON.parse(existing.payload))!==hashPayload(payload))return send(res,409,{error:'same transfer ID, different payload'});
   return send(res,200,{caseId:existing.id,receiptId:existing.receipt_id,receipt:existing.signed_receipt,idempotent:true});
  }
  const caseId='COU-'+randomUUID().slice(0,8).toUpperCase();
  const receiptId='RCT-'+randomUUID().slice(0,12);
  const createdAt=new Date().toISOString();
  const approvedFields=['orderReference','damageDescription',...('deliveryAddress' in payload?['deliveryAddress']:[])];
  const receipt={issuer:COURIER,caseId,receiptId,transferId:payload.transferId,approvedFields,status:'received',receivedAt:createdAt};
  const signature=jws(receipt);
  db.prepare('INSERT INTO cases VALUES (?,?,?,?,?,?,?)').run(caseId,payload.transferId,'demo-user',JSON.stringify(payload),receiptId,signature,createdAt);
  return send(res,201,{caseId,receiptId,receipt:signature,idempotent:false});
 }
 send(res,404,{error:'not found'});
}
const merchant=http.createServer((req,res)=>{merchantHandler(req,res).catch(e=>{console.error(e);if(!res.headersSent)send(res,500,{error:'internal'});});});
const courier=http.createServer((req,res)=>{courierHandler(req,res).catch(e=>{console.error(e);if(!res.headersSent)send(res,500,{error:'internal'});});});
merchant.listen(MERCHANT_PORT,'127.0.0.1',()=>console.log('merchant '+MERCHANT));
courier.listen(COURIER_PORT,'127.0.0.1',()=>console.log('courier '+COURIER));
function shutdown() {
  merchant.close();
  courier.close();
  db.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
