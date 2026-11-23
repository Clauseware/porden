import { Engine } from '/runtime/engine.js';
import { actionBindings } from '/runtime/actions.js';
import { reviewActions } from '/runtime/action-transport.js';

const $ = id => document.getElementById(id);
let busy = false;
let consumed = false;
let courierOrigin;
const setup = fetch('/api/config').then(async response => {
  if (!response.ok) throw Error('AI configuration unavailable');
  const settings = await response.json();
  if (settings.openrouterConfigured) {
    $('server-openrouter-option').style.display = 'block';
    $('server-openrouter').checked = true;
    if (settings.openrouterModel) $('model').value = settings.openrouterModel;
    updateProvider();
  }
}).catch(error => { status(error.message); throw error; });
// Report setup errors immediately without an unhandled rejection before a click.
setup.catch(() => {});
function updateProvider() {
  const useServer = $('server-openrouter').checked;
  $('router').disabled = useServer;
  $('api-key').disabled = useServer;
}
$('server-openrouter').addEventListener('change', updateProvider);
$('connect-consent').addEventListener('change', () => {
  $('start').disabled = busy || consumed || !$('connect-consent').checked;
});
function status(message) { $('status').textContent = message; }
function b64urlToBytes(v) {
  const s = v.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function equalCase(actual, approved) {
  return actual && Object.keys(actual).length === Object.keys(approved).length &&
    Object.entries(approved).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
}
export async function verifyJws(jws) {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3 || parts.some(p => !p)) return false;
    const [h, p, s] = parts;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    if (!courierOrigin) return false;
    const response = await fetch(courierOrigin + '/.well-known/jwks.json');
    if (!response.ok) return false;
    const jwks = await response.json();
    const jwk = jwks.keys.find(k => k.kid === header.kid);
    if (!jwk || header.alg !== 'ES256' || jwk.alg !== 'ES256') return false;
    const key = await crypto.subtle.importKey('jwk', jwk, {name:'ECDSA', namedCurve:'P-256'}, false, ['verify']);
    return await crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch { return false; }
}

$('start').addEventListener('click', async () => {
  if (busy || consumed || !$('connect-consent').checked) return;
  busy = true;
  $('start').disabled = true;
  $('proof').style.display = 'none';
  const approved = {orderReference:$('order').value.trim(), damageDescription:$('damage').value.trim()};
  if ($('share-address').checked) approved.deliveryAddress = $('address').value.trim();
  try {
    await setup;
    const useServer = $('server-openrouter').checked;
    const router = new URL(useServer ? location.origin + '/api/llm' : $('router').value.trim());
    if (router.protocol !== 'https:' && !(router.protocol === 'http:' && ['localhost','127.0.0.1'].includes(router.hostname))) {
      throw Error('Use HTTPS for the AI provider, or HTTP localhost for a local test provider.');
    }
    if (!$('model').value.trim()) throw Error('Enter a tool-calling model in AI settings, or set OPENROUTER_MODEL and restart.');
    if (!useServer && !$('api-key').value.trim()) throw Error('Enter your AI provider key in AI settings first.');
    const response = await fetch('/links.json');
    if (!response.ok) throw Error('Merchant peer configuration unavailable');
    const links = await response.json();
    const courierUrl = new URL(links.networks.merchant.courier);
    courierOrigin = courierUrl.origin;
    $('courier-origin').textContent = `Demo Courier (${courierUrl.host})`;
    // nsDeploy requires a nonempty credential; this public marker is not the server key.
    const engine = new Engine({originUrl:location.origin, byokKey:useServer ? 'server-openrouter' : $('api-key').value.trim(),
      routerOverride:router.href.replace(/\/$/, ''), modelOverride:$('model').value.trim()});
    // The form is the authority for fields and values, including model-generated delegation.
    engine.onConsent = async info => {
      if (!$('connect-consent').checked || info.kind !== 'network' || info.peerOrigin !== courierUrl.host ||
          !equalCase(JSON.parse(info.requestText), approved)) {
        throw Error('Delegation differs from the approved recipient or fields. No courier action authorized.');
      }
      return 'allow';
    };
    engine.onActionConfirm = async items => {
      if (!$('connect-consent').checked || items.length !== 1 || items[0].origin !== courierOrigin ||
          items[0].action !== 'create_damage_case' || items[0].effect !== 'write' || !equalCase(items[0].arguments, approved)) {
        throw Error('Action differs from the approved recipient or fields. No courier action authorized.');
      }
      return await reviewActions(items, 'Review the approved courier transfer');
    };
    window.__nsweb = {engine, trace:engine.trace};
    status('Running the merchant agent and delegating the approved fields through nsDeploy...');
    const result = await engine.runTurn(JSON.stringify(approved));
    const remoteCall = engine.trace.events.find(e => e.kind === 'remote_call' && e.phase === 'end' &&
      e.status === 'ok' && e.network === 'courier' && e.peerOrigin === courierUrl.host);
    if (!remoteCall) throw Error('No successful official courier-agent invocation. No case submitted.');
    const components = result.presentation?.components.filter(c => actionBindings(c).length) || [];
    if (components.length !== 1) throw Error('Courier did not return exactly one valid action proposal. No case submitted.');
    const component = components[0];
    const bindings = actionBindings(component);
    if (bindings.length !== 1 || bindings[0].action !== `${courierUrl.href}#create_damage_case`) {
      throw Error('Unexpected courier action proposal. No case submitted.');
    }
    status('Official courier-agent proposal received. Review the transfer, then authorize it on the courier origin.');
    const receipts = await engine.submitActions({turnId:result.turnId, componentId:component.id, values:approved});
    if (!receipts) { status('Customer cancelled merchant review. No case submitted.'); return; }
    consumed = true;
    const receipt = receipts[0];
    if (receipt.status !== 'succeeded') {
      status(`Courier action status UNKNOWN: ${receipt.error}. Check courier records before starting another transfer.`);
      return;
    }
    const value = receipt.result;
    if (!await verifyJws(value.receipt)) throw Error('Courier receipt signature verification failed. Check courier records.');
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(value.receipt.split('.')[1])));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(receipt.requestId));
    const transferId = 'handoff_' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const fields = Object.keys(approved).sort();
    if (data.issuer !== courierOrigin || data.transferId !== transferId || value.transferId !== transferId ||
        data.caseId !== value.caseId || data.receiptId !== value.receiptId || data.status !== 'received' ||
        JSON.stringify(data.approvedFields?.slice().sort()) !== JSON.stringify(fields)) {
      throw Error('Signed receipt does not match this approved transfer. Check courier records.');
    }
    $('proof').style.display = 'block';
    $('details').textContent = `Case: ${data.caseId} | Receipt: ${data.receiptId} | Status: ${data.status}`;
    $('token').textContent = value.receipt;
    $('verify').href = courierOrigin + '/verify/' + encodeURIComponent(data.receiptId);
    $('signature-status').textContent = 'Cryptographic verification: PASS (issuer, request ID and approved fields matched)';
    status('Courier case accepted through the official runtime and signed receipt verified.');
  } catch (error) {
    status('Handoff stopped: ' + error.message);
  } finally {
    busy = false;
    $('start').disabled = consumed || !$('connect-consent').checked;
  }
});
