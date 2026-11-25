import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends HTTPException {
  public readonly code: string;

  constructor(code: string, status: ContentfulStatusCode, message = code, options?: ErrorOptions) {
    super(status, { message, cause: options?.cause });
    this.code = code;
  }
}
