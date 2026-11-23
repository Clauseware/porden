import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DrizzleQueryError } from 'drizzle-orm';
import { z } from 'zod';
import { errorMessages } from '@porden/contracts';
import { ApiError } from '../application/errors';
import { errorDiagnostics, reportError } from '../observability/logger';

export function errorResponse(error: unknown, requestId: string) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  const { systemCode } = errorDiagnostics(cause);
  let code = 'INTERNAL_ERROR';
  let status: ContentfulStatusCode = 500;
  if (error instanceof ApiError) {
    code = error.code;
    status = error.status;
  } else if (error instanceof z.ZodError || error instanceof SyntaxError) {
    code = 'INVALID_INPUT';
    status = 400;
  } else if (error instanceof HTTPException && error.status === 400) {
    code = 'INVALID_INPUT';
    status = 400;
  } else if (systemCode === '23505') {
    code = 'REQUEST_CONFLICT';
    status = 409;
  } else if (
    error instanceof DrizzleQueryError &&
    systemCode &&
    /^(08|53|57P|ECONN|ETIMEDOUT|ERR_POSTGRES_CONNECTION)/.test(systemCode)
  ) {
    code = 'DATABASE_UNAVAILABLE';
    status = 503;
  }
  if (status >= 500) reportError('http request', error, requestId);
  else if (status === 429) reportError('http request rate limited', error, requestId);
  return {
    status,
    body: {
      error: {
        code,
        message: errorMessages[code] || errorMessages.INTERNAL_ERROR,
        requestId,
      },
    },
  };
}

export function notFoundResponse(requestId: string) {
  return {
    error: {
      code: 'NOT_FOUND',
      message: errorMessages.NOT_FOUND,
      requestId,
    },
  };
}
