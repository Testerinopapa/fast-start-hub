import ContextDev from 'npm:context.dev@3.12.0';
import { ResearchError } from './research-core.ts';

type Options = { apiKey?: string; fetch?: typeof fetch; retries?: number; sleep?: (ms: number) => Promise<void> };

// Server-only boundary. Do not import from src/ or expose provider errors to clients.
export async function contextSearch(query: string, options: Options = {}) {
  const apiKey = options.apiKey ?? Deno.env.get('CONTEXT_DEV_API_KEY');
  if (!apiKey) throw new ResearchError('NOT_CONFIGURED', 'Context.dev search is not configured on the server.', 503);
  if (!query.trim() || query.length > 500) throw new ResearchError('INVALID_REQUEST', 'Search requires 1–500 characters.');
  const client = new ContextDev({ apiKey, baseURL: 'https://api.context.dev/v1', maxRetries: 0,
    timeout: 20000, logLevel: 'off', ...(options.fetch ? { fetch: options.fetch } : {}) });
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      // Metadata only: existing enrichment verifies website facts separately.
      // Search has no top-level maxAgeMs; accept provider caching for discovery.
      const result = await client.web.search({ query: query.trim(), numResults: 8 });
      if (!Array.isArray(result.results)) throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev returned unreadable search results.', 502);
      return { ...result, results: result.results.slice(0, 8).map(row => ({
        url: row.url, title: row.title, description: row.description,
      })) };
    } catch (error) {
      if (error instanceof ResearchError) throw error;
      const status = error instanceof ContextDev.APIError ? error.status : undefined;
      const retryable = status === 408 || status === 429 || (status !== undefined && status >= 500);
      const header = error instanceof ContextDev.APIError ? error.headers?.get('retry-after') : null;
      const delay = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 500 * 2 ** attempt;
      // Never shorten Retry-After. If it exceeds the edge request budget, surface
      // the rate limit instead of issuing an early retry.
      if (retryable && attempt < (options.retries ?? 2) && Number.isFinite(delay) && delay <= 10000) {
        await sleep(Math.max(0, delay));
        continue;
      }
      if (status === 402) throw new ResearchError('CREDITS_EXHAUSTED', 'Context.dev credits are exhausted.', 402);
      if (status === 429) throw new ResearchError('PROVIDER_RATE_LIMIT', 'Context.dev is busy. Wait before trying again.', 429);
      if (status === 401 || status === 403) throw new ResearchError('PROVIDER_AUTHENTICATION', 'Check the server Context.dev API key and permissions.', 503);
      throw new ResearchError('PROVIDER_UNAVAILABLE', 'Context.dev search is temporarily unavailable.', 503);
    }
  }
}
