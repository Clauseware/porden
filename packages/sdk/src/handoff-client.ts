import { z } from 'zod';
import {
  CreateHandoff, VersionCommand, ProposeRevision, RevisionDecision, FinishHandoff,
  HandoffDetail, HandoffList, HandoffMutation, HandoffAuthorization, HandoffQuery,
  PlatformSignIn, PlatformSession, Organization, PendingApprovals, WorkflowHistory, ErrorResponse,
} from '@porden/contracts';
import { PordenError } from './error';

export class HandoffWriteUnknown extends PordenError {
  constructor(public operationId:string,options?:ErrorOptions,status=0,requestId?:string) {super('OUTCOME_UNKNOWN',status,requestId,options);}
}
export type HandoffClientOptions={baseUrl?:string;token?:string;fetch?:(input:string,init?:RequestInit)=>Promise<Response>};
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
    createHandoff:(value:z.infer<typeof CreateHandoff>)=>command('/handoffs',CreateHandoff,value),
    approveHandoff:(value:string,body:z.infer<typeof VersionCommand>)=>command(`/handoffs/${id(value)}/approve`,VersionCommand,body),
    acceptHandoff:(value:string,body:z.infer<typeof VersionCommand>)=>command(`/handoffs/${id(value)}/accept`,VersionCommand,body),
    rejectHandoff:(value:string,body:z.infer<typeof VersionCommand>)=>command(`/handoffs/${id(value)}/reject`,VersionCommand,body),
    cancelHandoff:(value:string,body:z.infer<typeof VersionCommand>)=>command(`/handoffs/${id(value)}/cancel`,VersionCommand,body),
    proposeRevision:(value:string,body:z.infer<typeof ProposeRevision>)=>command(`/handoffs/${id(value)}/revisions`,ProposeRevision,body),
    decideRevision:(value:string,revisionId:string,body:z.infer<typeof RevisionDecision>)=>command(`/handoffs/${id(value)}/revisions/${id(revisionId)}/decision`,RevisionDecision,body),
    finishHandoff:(value:string,body:z.infer<typeof FinishHandoff>)=>command(`/handoffs/${id(value)}/finish`,FinishHandoff,body),
    getAuthorization:(value:string,version:number)=>request(`/handoffs/${id(value)}/authorization?version=${input(z.number().int().positive(),version)}`,HandoffAuthorization),
    listPendingApprovals:()=>request('/approvals',PendingApprovals),
    getWorkflowHistory:(value:string)=>request(`/workflows/${id(value)}`,WorkflowHistory),
    reconcileOperation:(value:string)=>request(`/operations/${id(value)}`,HandoffMutation),
  };
}
