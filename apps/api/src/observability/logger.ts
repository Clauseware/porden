import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'authorization',
      'cookie',
      'password',
      'secret',
      'token',
      'apiKey',
      'headers.authorization',
      'headers.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});

export function errorDiagnostics(error: unknown) {
  let systemCode: string | undefined,
    upstreamStatus: number | undefined,
    configurationField: string | undefined;
  for (
    let current: unknown = error, depth = 0;
    current && typeof current === 'object' && depth < 5;
    depth++
  ) {
    if ('errno' in current && typeof current.errno === 'string') systemCode = current.errno;
    else if ('code' in current && typeof current.code === 'string') systemCode = current.code;
    if ('upstreamStatus' in current && typeof current.upstreamStatus === 'number')
      upstreamStatus = current.upstreamStatus;
    if (
      'configurationField' in current &&
      typeof current.configurationField === 'string' &&
      /^[A-Z_]+$/.test(current.configurationField)
    )
      configurationField = current.configurationField;
    current = 'cause' in current ? current.cause : undefined;
  }
  return {
    systemCode:
      systemCode && /^(CONFIGURATION_INVALID|E[A-Z_]+|ERR_[A-Z_]+|[A-Z0-9]{5})$/.test(systemCode)
        ? systemCode
        : undefined,
    upstreamStatus,
    configurationField,
  };
}

export function reportError(operation: string, error: unknown, requestId?: string) {
  const frames =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 4)
      : undefined;
  logger.error(
    {
      event: 'application.error',
      operation,
      requestId,
      errorName: error instanceof Error ? error.name : 'NonError',
      ...errorDiagnostics(error),
      frames,
    },
    'Porden error',
  );
}

export function logRequest(fields: {
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
}) {
  logger.info({ event: 'http.request.completed', ...fields }, 'HTTP request completed');
}
