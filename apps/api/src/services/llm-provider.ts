import { ApiError } from '../application/errors';
import { logger, reportError } from '../observability/logger';
import type { Config } from '../config';
import type { Fetcher } from '../security';

// The proxy forwards one inference request and executes no tools. The browser runtime runs tools
// only after a complete response, so a switch made before any byte reaches the client cannot repeat
// a tool call. Once a response is streaming, it is never replaced.
type Provider = { name: 'openrouter' | 'groq'; url: string; key: string; model: string };
type Attempt =
  | { kind: 'response'; response: Response }
  | { kind: 'http'; status: number }
  | { kind: 'network'; timedOut: boolean; cause: unknown };

// Statuses that describe a busy, exhausted or briefly broken provider rather than a bad request.
const transientStatuses = new Set([402, 408, 429, 500, 502, 503, 504, 529]);
const upstreamErrors: Record<number, [string, ApiError['status']]> = {
  400: ['PROVIDER_REQUEST_REJECTED', 502],
  401: ['PROVIDER_AUTHENTICATION_FAILED', 502],
  403: ['PROVIDER_AUTHENTICATION_FAILED', 502],
  402: ['PROVIDER_CREDITS_EXHAUSTED', 503],
  404: ['PROVIDER_MODEL_UNAVAILABLE', 502],
  408: ['PROVIDER_TIMEOUT', 504],
  413: ['PROVIDER_REQUEST_REJECTED', 502],
  422: ['PROVIDER_REQUEST_REJECTED', 502],
  429: ['PROVIDER_RATE_LIMITED', 429],
  504: ['PROVIDER_TIMEOUT', 504],
};
// A primary that has not answered with headers in this time is treated as down.
const primaryHeaderTimeoutMs = 20_000;
// Groq's free tier enforces 7,000 input tokens per minute, one or two Porden agent calls, and
// answers 429 with a Retry-After of seconds. That Retry-After can be too short for a large request,
// so the turn keeps waiting while the total stays within this budget; a longer wait (for example
// the daily quota) fails fast. The budget plus the primary's header timeout stays under the API
// server's idle timeout. Inference has no side effects, so a retry repeats nothing; writes are
// never retried here.
const maxFallbackWaitMs = 90_000;

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

export function llmProvider(config: Config, fetcher: Fetcher) {
  const primary: Provider = {
    name: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: config.openrouterKey,
    model: config.model,
  };
  const fallback: Provider = {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: config.groq.key,
    model: config.groq.model,
  };
  // Providers that answered 429 are skipped until their Retry-After passes (bounded to 1 s – 5 min),
  // so a rate-limited provider is not hit again on every turn of an active session.
  const coolingUntil = new Map<Provider['name'], number>();

  async function attempt(
    provider: Provider,
    body: Record<string, unknown>,
    signal: AbortSignal,
    headerTimeoutMs?: number,
  ): Promise<Attempt> {
    const timeout = new AbortController();
    const timer =
      headerTimeoutMs === undefined
        ? undefined
        : setTimeout(
            () => timeout.abort(new DOMException('timeout', 'TimeoutError')),
            headerTimeoutMs,
          );
    try {
      const response = await fetcher(provider.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout.signal]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
        body: JSON.stringify({ ...body, model: provider.model }),
      });
      if (response.ok) return { kind: 'response', response };
      await response.body
        ?.cancel()
        .catch((cause) => reportError('provider response cleanup', cause));
      if (response.status === 429) {
        // A missing or non-numeric Retry-After rests the provider for 10 s.
        const seconds = Number(response.headers.get('retry-after') || Number.NaN);
        const waitMs = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 10, 1), 300) * 1000;
        coolingUntil.set(provider.name, Date.now() + waitMs);
      }
      return { kind: 'http', status: response.status };
    } catch (cause) {
      const timedOut =
        timeout.signal.aborted ||
        (cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name));
      return { kind: 'network', timedOut, cause };
    } finally {
      clearTimeout(timer);
    }
  }

  function failure(result: Exclude<Attempt, { kind: 'response' }>, provider: Provider) {
    if (result.kind === 'network')
      return new ApiError(
        result.timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_CONNECTION_FAILED',
        result.timedOut ? 504 : 502,
        undefined,
        { cause: Object.assign(new Error(provider.name), { cause: result.cause }) },
      );
    const [code, status] = upstreamErrors[result.status] || ['PROVIDER_UNAVAILABLE', 502];
    return new ApiError(code, status, undefined, {
      cause: { upstreamStatus: result.status, provider: provider.name },
    });
  }

  function reason(result: Exclude<Attempt, { kind: 'response' }>) {
    if (result.kind === 'network') return result.timedOut ? 'timeout' : 'network_error';
    return `http_${result.status}`;
  }

  function cooling(provider: Provider) {
    return (coolingUntil.get(provider.name) || 0) > Date.now();
  }

  return {
    async complete(
      body: Record<string, unknown>,
      signal: AbortSignal,
      requestId?: string,
    ): Promise<Response> {
      const switchTo = (fromReason: string) =>
        logger.warn(
          {
            event: 'llm.provider_fallback',
            requestId,
            fromProvider: primary.name,
            fromModel: primary.model,
            toProvider: fallback.name,
            toModel: fallback.model,
            reason: fromReason,
          },
          'LLM provider fallback',
        );
      if (!cooling(primary)) {
        const result = await attempt(primary, body, signal, primaryHeaderTimeoutMs);
        if (result.kind === 'response') return result.response;
        const retryable = result.kind === 'network' || transientStatuses.has(result.status);
        // A departed client (aborted signal) gets no fallback request spent on it.
        if (!retryable || signal.aborted) throw failure(result, primary);
        switchTo(reason(result));
      } else switchTo('primary_rate_limit_cooldown');
      // Groq requests repeat after each stated Retry-After until the total wait would exceed the budget.
      for (let waited = 0; ;) {
        const waitMs = (coolingUntil.get(fallback.name) || 0) - Date.now();
        if (waited + waitMs > maxFallbackWaitMs) {
          logger.warn(
            {
              event: 'llm.provider_fallback_failed',
              requestId,
              provider: fallback.name,
              model: fallback.model,
              reason: 'rate_limit_wait_budget_exceeded',
              waitedMs: waited,
              waitMs,
            },
            'LLM fallback provider failed',
          );
          throw new ApiError('PROVIDER_RATE_LIMITED', 429, undefined, {
            cause: { upstreamStatus: 429, provider: fallback.name },
          });
        }
        if (waitMs > 0) {
          logger.warn(
            {
              event: 'llm.provider_rate_limit_wait',
              requestId,
              provider: fallback.name,
              model: fallback.model,
              waitMs,
            },
            'LLM provider rate limit wait',
          );
          await pause(waitMs, signal);
          waited += waitMs;
          if (signal.aborted)
            throw failure({ kind: 'network', timedOut: true, cause: signal.reason }, fallback);
        }
        const result = await attempt(fallback, body, signal);
        if (result.kind === 'response') return result.response;
        // Every 429 sets a cooldown of at least 1 s, so each repeat adds to the bounded wait.
        if (result.kind === 'http' && result.status === 429 && !signal.aborted) continue;
        logger.warn(
          {
            event: 'llm.provider_fallback_failed',
            requestId,
            provider: fallback.name,
            model: fallback.model,
            reason: reason(result),
          },
          'LLM fallback provider failed',
        );
        throw failure(result, fallback);
      }
    },
  };
}
