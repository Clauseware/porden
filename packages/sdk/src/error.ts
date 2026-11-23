export class PordenError extends Error {
  constructor(public code:string,public status:number,public requestId?:string,options?:ErrorOptions) {super(code,options);}
}
