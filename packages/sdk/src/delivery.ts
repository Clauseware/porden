import { z } from 'zod';
import { PordenError } from './error';
export { getErrorMessage } from './error';
export { PordenError } from './error';
import { Approval, CaseResponse, CreateDraft, Draft, Fields, VerifiedReceipt, canonicalize,
  Session, PublicConfig, ReceivedCase, SignIn, ErrorResponse, errorMessages, type DamageData, type TransferReview, type ActionArguments, type PordenEvent, type TransferOutcome } from '@porden/contracts';

export type Runtime = {
  trace: {events: Array<{kind: string; phase: string; status?: string; network?: string; peerOrigin?: string}>};
  onConsent?: (info: {kind: string; peerOrigin: string; requestText: string}) => Promise<string>;
  onActionConfirm?: (items: Array<{origin: string; action: string; effect: string; arguments: unknown}>) => Promise<unknown>;
  runTurn(text: string): Promise<{turnId: string; presentation?: {components: Array<{id: string}>}}>;
  submitActions(input: {turnId: string; componentId: string; values: unknown}): Promise<Array<{status: string; requestId: string; result: unknown; error?: string}> | null>;
};
type RuntimeModule = {Engine: new (options: Record<string, unknown>) => Runtime};
type BindingsModule = {actionBindings(component: unknown): Array<{action: string; arguments: unknown}>};
type ReviewModule = {reviewActions(items: unknown, title: string): Promise<unknown>};
export type ClientOptions = {
  senderApiBaseUrl?: string;
  runtimeAssetBaseUrl?: string;
  model?: string;
  onEvent?: (event: PordenEvent) => void;
};
function runtimeError(error: unknown): PordenError {
  if (error instanceof PordenError) return error;
  // The pinned runtime wraps non-2xx inference responses as "LLM HTTP <status>: <body>".
  const match=error instanceof Error ? /^LLM HTTP (\d{3}): (.*)$/s.exec(error.message) : null;
  if (match) {
    let payload: unknown;
    try {payload=JSON.parse(match[2]);} catch {return new PordenError('INVALID_RESPONSE',Number(match[1]),undefined,{cause:error});}
    const parsed=ErrorResponse.safeParse(payload);
    if (parsed.success) return new PordenError(parsed.data.error.code,Number(match[1]),parsed.data.error.requestId,{cause:error});
    return new PordenError('HTTP_ERROR',Number(match[1]),undefined,{cause:error});
  }
  return new PordenError('HANDOFF_FAILED',500,undefined,{cause:error});
}
function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result=schema.safeParse(value);
  if (!result.success) throw new PordenError('INVALID_INPUT',400,undefined,{cause:result.error});
  return result.data;
}
function parseResponse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result=schema.safeParse(value);
  if (!result.success) throw new PordenError('INVALID_RESPONSE',502,undefined,{cause:result.error});
  return result.data;
}
export function createPordenClient(options: ClientOptions = {}) {
  const base = (options.senderApiBaseUrl || '/api').replace(/\/$/, '');
  const runtimeBase = (options.runtimeAssetBaseUrl || '/runtime').replace(/\/$/, '');
  let csrf: string | undefined;
  const inFlight = new Set<string>();
  const emit = (type: PordenEvent['type'], transferId: string) => options.onEvent?.({type, transferId});
  async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    const response=await fetch(url,init).catch(cause => {throw new PordenError('NETWORK_ERROR',0,undefined,{cause});});
    if (response.status===401) csrf=undefined;
    const payload: unknown=await response.json().catch(cause => {
      throw new PordenError(response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',response.status,undefined,{cause});
    });
    if (!response.ok) {
      const parsed=ErrorResponse.safeParse(payload);
      throw new PordenError(parsed.success ? parsed.data.error.code : 'HTTP_ERROR',response.status,
        parsed.success ? parsed.data.error.requestId : undefined);
    }
    return payload;
  }
  async function request(path: string, body?: unknown): Promise<unknown> {
    if (body !== undefined && !csrf) {
      const session = parseResponse(Session,await request('/v1/session'));
      csrf = session.csrf;
    }
    return fetchJson(base + path, {method: body === undefined ? 'GET' : 'POST', credentials: 'include',
      headers: body === undefined ? {} : {'Content-Type': 'application/json', 'X-CSRF-Token': csrf!},
      body: body === undefined ? undefined : JSON.stringify(body)});
  }
  async function mark(id: string, status: 'cancelled' | 'unknown', reasonCode = 'OUTCOME_UNKNOWN'): Promise<TransferOutcome> {
    await request(`/v1/transfers/${id}/outcome`, {status});
    emit(status === 'unknown' ? 'outcome_unknown' : 'cancelled', id);
    return status === 'unknown' ? {status, transferId: id, reasonCode} : {status, transferId: id};
  }
  return {
    async signIn(password: string) {
      const payload = await fetchJson(base + '/v1/session', {method: 'POST', credentials: 'include',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify(parseInput(SignIn,{password}))});
      csrf = parseResponse(Session,payload).csrf;
    },
    async getSession() {
      const session = parseResponse(Session,await request('/v1/session'));
      csrf = session.csrf;
      return session;
    },
    async getConfig() {
      return parseResponse(PublicConfig,await fetchJson(`${base}/config`));
    },
    async getReceipt(id: string) {return parseResponse(ReceivedCase,await request(`/v1/receipts/${parseInput(z.uuid(),id)}`));},
    async createDraft(input: z.infer<typeof CreateDraft>) {
      const draft = parseResponse(Draft,await request('/v1/transfers', parseInput(CreateDraft,input)));
      emit('draft_created', draft.id);
      return draft;
    },
    async getTransfer(id: string) {return parseResponse(Draft,await request(`/v1/transfers/${parseInput(z.uuid(),id)}`));},
    async reconcile(id: string) {
      const draft = parseResponse(Draft,await request(`/v1/transfers/${parseInput(z.uuid(),id)}/reconcile`, {}));
      if (draft.status === 'accepted') emit('receipt_verified', id);
      else emit('outcome_unknown', id);
      return draft;
    },
    async cancel(id: string) {return mark(parseInput(z.uuid(),id), 'cancelled');},
    async transfer(input: {transferId: string; approvedFields: z.infer<typeof Fields>;
      confirm: (review: TransferReview) => Promise<boolean>}): Promise<TransferOutcome> {
      const id = parseInput(z.uuid(),input.transferId);
      if (!options.model?.trim()) throw new PordenError('MODEL_REQUIRED', 400);
      const fields=parseInput(Fields,input.approvedFields);
      if (inFlight.has(id)) throw new PordenError('REQUEST_CONFLICT', 409);
      inFlight.add(id);
      let submitted = false;
      try {
        const draft = parseResponse(Draft,await request(`/v1/transfers/${id}`));
        if (draft.status !== 'draft') throw new PordenError('REQUEST_CONFLICT', 409);
        if (fields.includes('deliveryAddress') && draft.data.deliveryAddress === undefined) throw new PordenError('CONSENT_SCOPE_MISMATCH', 400);
        const data: DamageData = {orderReference: draft.data.orderReference, damageDescription: draft.data.damageDescription,
          ...(fields.includes('deliveryAddress') ? {deliveryAddress: draft.data.deliveryAddress} : {})};
        emit('consent_required', id);
        if (!await input.confirm({recipientOrigin: draft.recipientOrigin, caseType: draft.caseType, data})) return await mark(id, 'cancelled');
        const approval = parseResponse(Approval,await request(`/v1/transfers/${id}/approve`, {approvedFields: fields}));
        if (canonicalize(approval.arguments.data) !== canonicalize(data)) throw new PordenError('CONSENT_SCOPE_MISMATCH', 403);
        emit('consent_approved', id);
        // Dynamic URL imports preserve upstream ESM and worker paths, including when consumed by Next.js.
        const load = (file: string) => import(/* webpackIgnore: true */ /* @vite-ignore */ `${runtimeBase}/${file}`);
        const {Engine} = await load('engine.js') as RuntimeModule;
        const {actionBindings} = await load('actions.js') as BindingsModule;
        const {reviewActions} = await load('action-transport.js') as ReviewModule;
        const courierUrl = `${draft.recipientOrigin}/courier`, approved: ActionArguments = approval.arguments;
        const engine = new Engine({originUrl: location.origin, byokKey: 'server-openrouter',
          routerOverride: new URL(`${base}/llm`, location.origin).href, modelOverride: options.model});
        engine.onConsent = async info => {
          if (info.kind !== 'network' || info.peerOrigin !== new URL(draft.recipientOrigin).host ||
            canonicalize(JSON.parse(info.requestText)) !== canonicalize(approved)) throw new PordenError('CONSENT_SCOPE_MISMATCH', 403);
          return 'allow';
        };
        engine.onActionConfirm = async items => {
          if (items.length !== 1 || items[0].origin !== draft.recipientOrigin || items[0].action !== 'create_damage_case' ||
            items[0].effect !== 'write' || canonicalize(items[0].arguments) !== canonicalize(approved)) throw new PordenError('CONSENT_SCOPE_MISMATCH', 403);
          // This is the official merchant dialog. The receiver popup separately asks for write approval.
          return reviewActions(items, 'Review the approved courier transfer');
        };
        emit('delegating', id);
        const result = await engine.runTurn(JSON.stringify(approved));
        if (!engine.trace.events.some(event => event.kind === 'remote_call' && event.phase === 'end' && event.status === 'ok' &&
          event.network === 'courier' && event.peerOrigin === new URL(draft.recipientOrigin).host)) throw new PordenError('DELEGATION_FAILED', 502);
        emit('recipient_discovered', id);
        const components = result.presentation?.components.filter(component => actionBindings(component).length) || [];
        if (components.length !== 1) throw new PordenError('INVALID_PROPOSAL', 502);
        const bindings = actionBindings(components[0]);
        if (bindings.length !== 1 || bindings[0].action !== `${courierUrl}#create_damage_case`) throw new PordenError('INVALID_PROPOSAL', 502);
        if (canonicalize(bindings[0].arguments) !== canonicalize(approved)) throw new PordenError('CONSENT_SCOPE_MISMATCH', 403);
        await request(`/v1/transfers/${id}/submit`, {});
        submitted = true;
        emit('submitted', id);
        const receipts = await engine.submitActions({turnId: result.turnId, componentId: components[0].id, values: approved});
        if (!receipts) return await mark(id, 'cancelled');
        if (receipts.length !== 1 || receipts[0].status !== 'succeeded') return await mark(id, 'unknown',
          receipts.length === 1 && receipts[0].error === 'User declined; action not started.' ? 'RECEIVER_DECLINED' : 'OUTCOME_UNKNOWN');
        const resultValue = parseResponse(CaseResponse,receipts[0].result);
        if (resultValue.transferId !== id || resultValue.requestId !== receipts[0].requestId) return await mark(id, 'unknown');
        const receipt = parseResponse(VerifiedReceipt,await request(`/v1/transfers/${id}/receipts`, {receipt: resultValue.receipt, requestId: receipts[0].requestId}));
        emit('receipt_verified', id);
        return {status: 'accepted', transferId: id, receipt};
      } catch (error) {
        // A response may be lost after either write commits. Never retry a submitted action.
        if (submitted) {
          // Receipt acknowledgement itself can be lost after the sender has verified it.
          try {
            const current = parseResponse(Draft,await request(`/v1/transfers/${id}`));
            if (current.status === 'accepted' && current.receipt) return {status: 'accepted', transferId: id, receipt: current.receipt};
            return await mark(id, 'unknown');
          } catch {
            emit('outcome_unknown', id);
            return {status: 'unknown', transferId: id, reasonCode: 'OUTCOME_UNKNOWN'};
          }
        }
        throw runtimeError(error);
      } finally {inFlight.delete(id);}
    },
  };
}
