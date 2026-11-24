import { z } from 'zod';
import {
  CreateHandoff, VersionCommand, ProposeRevision, RevisionDecision, FinishHandoff,
  HandoffDetail, HandoffList, HandoffMutation, HandoffAuthorization, HandoffQuery,
  PlatformSignIn, PlatformSession, Organization, PendingApprovals, WorkflowHistory, ErrorResponse,
  RequestClarification, ResolveClarification, VerifyAuthorization, ReserveExecution, SettleExecution,
  HandoffReceiptClaims,
  canonicalize,
} from '@porden/contracts';
import { PordenError } from './error';

export class HandoffWriteUnknown extends PordenError {
  constructor(public operationId:string,options?:ErrorOptions,status=0,requestId?:string) {super('OUTCOME_UNKNOWN',status,requestId,options);}
}
export type HandoffClientOptions={baseUrl?:string;token?:string;fetch?:(input:string,init?:RequestInit)=>Promise<Response>};
export async function hashParameters(parameters:unknown) {
  let value:string;
  try {value=canonicalize(parameters);} catch(cause) {throw new PordenError('INVALID_INPUT',400,undefined,{cause});}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function createHandoffClient(options:HandoffClientOptions={}) {
  const base=(options.baseUrl||'/api/v2').replace(/\/$/,'');
  const fetcher=options.fetch||fetch;
  let csrf:string|undefined;
  function input<T extends z.ZodType>(schema:T,value:unknown):z.output<T> {
    const parsed=schema.safeParse(value);
    if (!parsed.success) throw new PordenError('INVALID_INPUT',400,undefined,{cause:parsed.error});
    return parsed.data;
  }
  async function request<T extends z.ZodType>(path:string,schema:T,body?:unknown,operationId?:string):Promise<z.output<T>> {
    if (body!==undefined&&!options.token&&!csrf&&path!=='/session') csrf=(await session()).csrf;
    const headers:Record<string,string>={};
    if (options.token) headers.Authorization=`Bearer ${options.token}`;
    if (body!==undefined) {headers['Content-Type']='application/json';if(csrf)headers['X-CSRF-Token']=csrf;}
    let response:Response;
    try {response=await fetcher(base+path,{method:body===undefined?'GET':'POST',credentials:'include',headers,body:body===undefined?undefined:JSON.stringify(body)});}
    catch(cause) {throw operationId ? new HandoffWriteUnknown(operationId,{cause}) : new PordenError('NETWORK_ERROR',0,undefined,{cause});}
    if (response.status===401) csrf=undefined;
    const reference=z.uuid().safeParse(response.headers.get('X-Request-Id'));
    const requestId=reference.success?reference.data:undefined;
    if (!response.ok) {
      if (operationId && response.status>=500) throw new HandoffWriteUnknown(operationId,undefined,response.status,requestId);
      const payload:unknown=await response.json().catch(()=>null);
      const error=ErrorResponse.safeParse(payload);
      throw new PordenError(error.success?error.data.error.code:'HTTP_ERROR',response.status,error.success?error.data.error.requestId:undefined);
    }
    let payload:unknown;
    try {payload=await response.json();}
    catch(cause) {throw operationId?new HandoffWriteUnknown(operationId,{cause},response.status,requestId):new PordenError('INVALID_RESPONSE',502,requestId,{cause});}
    const parsed=schema.safeParse(payload);
    if (!parsed.success) throw operationId?new HandoffWriteUnknown(operationId,{cause:parsed.error},response.status,requestId):new PordenError('INVALID_RESPONSE',502,requestId,{cause:parsed.error});
    return parsed.data;
  }
  async function session() {const value=await request('/session',PlatformSession);csrf=value.csrf;return value;}
  const id=(value:string)=>input(z.uuid(),value);
  function command<T extends z.ZodType<{requestId:string}>>(path:string,schema:T,value:unknown) {
    const body=input(schema,value);
    return request(path,HandoffMutation,body,body.requestId);
  }
  type Command<T> = Omit<T, 'requestId'> & {requestId?: string};
  const withId = <T extends {requestId?: string}>(value: T) => ({...value, requestId: value.requestId === undefined ? crypto.randomUUID() : value.requestId});
  return {
    session,
    async signIn(value:z.infer<typeof PlatformSignIn>) {csrf=undefined;const result=await request('/session',PlatformSession,input(PlatformSignIn,value));csrf=result.csrf;return result;},
    async signOut() {await request('/logout',z.strictObject({signedOut:z.literal(true)}),{});csrf=undefined;},
    organizations:()=>request('/organizations',z.strictObject({items:z.array(Organization)})),
    listHandoffs(value:z.input<typeof HandoffQuery>={}) {
      const params=new URLSearchParams();
      for (const [key,entry] of Object.entries(input(HandoffQuery,value))) params.set(key,String(entry));
      return request(`/handoffs?${params}`,HandoffList);
    },
    getHandoff:(value:string)=>request(`/handoffs/${id(value)}`,HandoffDetail),
    createHandoff:(value:Command<z.infer<typeof CreateHandoff>>)=>command('/handoffs',CreateHandoff,withId(value)),
    approveHandoff:(value:string,body:Command<z.infer<typeof VersionCommand>>)=>command(`/handoffs/${id(value)}/approve`,VersionCommand,withId(body)),
    acceptHandoff:(value:string,body:Command<z.infer<typeof VersionCommand>>)=>command(`/handoffs/${id(value)}/accept`,VersionCommand,withId(body)),
    rejectHandoff:(value:string,body:Command<z.infer<typeof VersionCommand>>)=>command(`/handoffs/${id(value)}/reject`,VersionCommand,withId(body)),
    cancelHandoff:(value:string,body:Command<z.infer<typeof VersionCommand>>)=>command(`/handoffs/${id(value)}/cancel`,VersionCommand,withId(body)),
    proposeRevision:(value:string,body:Command<z.infer<typeof ProposeRevision>>)=>command(`/handoffs/${id(value)}/revisions`,ProposeRevision,withId(body)),
    decideRevision:(value:string,revisionId:string,body:Command<z.infer<typeof RevisionDecision>>)=>command(`/handoffs/${id(value)}/revisions/${id(revisionId)}/decision`,RevisionDecision,withId(body)),
    finishHandoff:(value:string,body:Command<z.infer<typeof FinishHandoff>>)=>command(`/handoffs/${id(value)}/finish`,FinishHandoff,withId(body)),
    getAuthorization:(value:string,version:number)=>request(`/handoffs/${id(value)}/authorization?version=${input(z.number().int().positive(),version)}`,HandoffAuthorization),
    // Verification is a snapshot. Reserve before protected writes; settle only after their outcome is known.
    verifyAuthorization:(value:string,body:z.infer<typeof VerifyAuthorization>)=>request(`/handoffs/${id(value)}/authorization/verify`,HandoffAuthorization,input(VerifyAuthorization,body)),
    requestClarification:(value:string,body:Command<z.infer<typeof RequestClarification>>)=>command(`/handoffs/${id(value)}/clarifications`,RequestClarification,withId(body)),
    resolveClarification:(value:string,body:Command<z.infer<typeof ResolveClarification>>)=>command(`/handoffs/${id(value)}/clarifications/resolve`,ResolveClarification,withId(body)),
    reserveExecution:(value:string,body:Command<z.infer<typeof ReserveExecution>>)=>command(`/handoffs/${id(value)}/executions`,ReserveExecution,withId(body)),
    settleExecution:(value:string,body:Command<z.infer<typeof SettleExecution>>)=>command(`/handoffs/${id(value)}/executions/settle`,SettleExecution,withId(body)),
    async verifyReceipt(token:string) {
      try {
        const parts=token.split('.');
        if(parts.length!==3 || parts.some(part=>! /^[\w-]+$/.test(part))) throw Error('Malformed receipt');
        const decode=(part:string)=>Uint8Array.from(atob(part.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
        const header=z.strictObject({alg:z.literal('ES256'),typ:z.literal('porden-handoff-receipt+jwt'),kid:z.string()}).parse(JSON.parse(new TextDecoder().decode(decode(parts[0]))));
        const origin=new URL(base,typeof location==='undefined'?undefined:location.href).origin;
        const response=await fetcher(origin+'/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.timeout(5000)});
        if(!response.ok) throw Error('Receipt keys unavailable');
        const keys=z.object({keys:z.array(z.object({kid:z.string(),alg:z.literal('ES256'),kty:z.literal('EC'),crv:z.literal('P-256'),use:z.literal('sig'),x:z.string(),y:z.string()}))}).parse(await response.json());
        const jwk=keys.keys.find(key=>key.kid===header.kid);
        if(!jwk) throw Error('Unknown receipt key');
        const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
        if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]))) throw Error('Invalid receipt signature');
        return HandoffReceiptClaims.parse(JSON.parse(new TextDecoder().decode(decode(parts[1]))));
      } catch(cause) { throw new PordenError('SIGNATURE_INVALID',403,undefined,{cause}); }
    },
    listPendingApprovals:()=>request('/approvals',PendingApprovals),
    getWorkflowHistory:(value:string)=>request(`/workflows/${id(value)}`,WorkflowHistory),
    reconcileOperation:(value:string)=>request(`/operations/${id(value)}`,HandoffMutation),
  };
}
