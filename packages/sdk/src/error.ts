import { errorMessages } from '@porden/contracts';
export class PordenError extends Error {
  constructor(public code:string,public status:number,public requestId?:string,options?:ErrorOptions) {super(code,options);}
}

export function getErrorMessage(error: unknown) {
  if (!(error instanceof PordenError)) return errorMessages.HANDOFF_FAILED;
  const message=errorMessages[error.code] || errorMessages.HTTP_ERROR;
  return error.requestId ? `${message} Reference: ${error.requestId}.` : message;
}
