import ContextDev from 'npm:context.dev@3.12.0';
import { companyUrl, ResearchError, type ScrapedPage } from './research-core.ts';

type Options = { apiKey?: string; fetch?: typeof fetch; retries?: number; sleep?: (ms: number) => Promise<void>; timeout?: number };
type Extraction = { schema: Record<string, unknown>; prompt?: string };

// Server-only boundary. Do not import from src/ or expose provider errors to clients.
async function request<T>(operation: (client: ContextDev) => PromiseLike<T>, options: Options = {}): Promise<T> {
  const apiKey = options.apiKey ?? Deno.env.get('CONTEXT_DEV_API_KEY');
  if (!apiKey) throw new ResearchError('NOT_CONFIGURED', 'Context.dev is not configured on the server.', 503);
  const client = new ContextDev({ apiKey, baseURL: 'https://api.context.dev/v1', maxRetries: 0,
    timeout: options.timeout ?? 20000, logLevel: 'off', ...(options.fetch ? { fetch: options.fetch } : {}) });
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(client);
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
      if (status === 400 || status === 409 || status === 422) throw new ResearchError('PROVIDER_REQUEST_REJECTED', 'Context.dev rejected the research request. Check the server integration configuration.', 502);
      if (status === 404 || status === 410) throw new ResearchError('RESULT_EXPIRED', 'The Context.dev resource is unavailable or expired.', 410);
      throw new ResearchError('PROVIDER_UNAVAILABLE', 'Context.dev is temporarily unavailable.', 503);
    }
  }
}

export async function contextSearch(query: string, options: Options & { limit?: number } = {}) {
  const limit = options.limit ?? 8;
  if (!query.trim() || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new ResearchError('INVALID_REQUEST', 'Search requires 1–500 characters and at most eight results.');
  }
  // Metadata only. Search does not support a top-level maxAgeMs.
  const result = await request(client => client.web.search({ query: query.trim(), numResults: limit }), options);
  if (!Array.isArray(result.results)) throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev returned unreadable search results.', 502);
  return { ...result, results: result.results.slice(0, limit).map(row => ({ url: row.url, title: row.title, description: row.description })) };
}

export async function contextMap(url: string, options: Options = {}) {
  const result = await request(client => client.web.mapUrls({ domain: companyUrl(url).hostname, maxLinks: 100, includeSubdomains: false }), options);
  if (!Array.isArray(result.urls)) throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev returned unreadable website URLs.', 502);
  return result.urls.slice(0, 100);
}

const scrapeParams = (extraction: Extraction) => ({
  formats: { markdown: true, json: true },
  jsonParams: { schema: extraction.schema, instructions: extraction.prompt },
  sharedParams: { mainContentOnly: true },
  timeoutOpts: { milliseconds: 30000, behavior: 'fail' as const },
  maxAgeMs: 86400000,
});
type Output = { success?: boolean | null; data?: unknown; error_code?: string };
type Page = { url?: string; markdown?: Output; json?: Output; metadata?: { sourceUrl?: string; finalUrl?: string; title?: string } };
export function contextPage(result: Page, source: string): ScrapedPage {
  return { metadata: { sourceURL: source, url: result.metadata?.finalUrl || result.url || source, title: result.metadata?.title },
    markdown: result.markdown?.success === true && typeof result.markdown.data === 'string' ? result.markdown.data : undefined,
    json: result.json?.success === true && result.json.data && typeof result.json.data === 'object' && !Array.isArray(result.json.data)
      ? result.json.data as Record<string, unknown> : undefined };
}
export async function contextScrape(url: string, extraction: Extraction, options: Options = {}) {
  const source = companyUrl(url).href;
  const result = await request(client => client.web.scrape({ url: source, ...scrapeParams(extraction) }), { timeout: 45000, ...options });
  if (result.markdown?.success !== true && result.json?.success !== true) {
    const code = result.markdown?.error_code || result.json?.error_code;
    if (code === 'UNSUPPORTED_CONTENT') throw new ResearchError('SOURCE_UNSUPPORTED', 'Context.dev cannot read this content type.', 422);
    if (code === 'WEBSITE_BLOCKED') throw new ResearchError('SOURCE_RESTRICTED', 'This website blocks access to its content.', 422);
    throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev returned no usable page outputs.', 502);
  }
  return contextPage(result, source);
}

// Prefix stored IDs so pre-migration jobs never get sent to the new provider.
export const contextBatchId = (value: unknown): value is string => typeof value === 'string' && /^context:[A-Za-z0-9_-]{1,160}$/.test(value);
export async function contextSubmit(urls: string[], extraction: Extraction, key: string, options: Options = {}) {
  if (!urls.length || urls.length > 10) throw new ResearchError('INVALID_REQUEST', 'Research requires one to ten pages.');
  const result = await request(client => client.batch.submit({
    input: { mode: 'scrape', data: { ...scrapeParams(extraction), urls: urls.map((url, index) => ({ url: companyUrl(url).href, itemId: String(index) })) } },
    'Idempotency-Key': key,
  }), options);
  const id = `context:${result.id}`;
  if (!result.id || !contextBatchId(id)) throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev did not confirm the batch.', 502);
  return { id };
}
export async function contextBatchStatus(id: string, options: Options = {}) {
  if (!contextBatchId(id)) throw new ResearchError('PROVIDER_CHANGED', 'This unfinished job uses the retired provider. Start new research with Context.dev.', 409);
  const rawId = id.slice('context:'.length);
  const batch = await request(client => client.batch.retrieve(rawId), options);
  const completed = Math.min(10, Math.max(0, Number(batch.progress?.succeeded) || 0));
  const status = ['queued', 'running', 'cancelling'].includes(batch.status) ? 'scraping' : batch.status;
  const data: { index: number; page: ScrapedPage }[] = [];
  if (status === 'completed') {
    let cursor: string | undefined;
    const visited = new Set<string>();
    let records = 0;
    do {
      const page = await request(client => client.batch.getResults(rawId, { limit: 10, ...(cursor ? { cursor } : {}) }), options);
      if (!Array.isArray(page.data)) throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev returned unreadable batch results.', 502);
      records += page.data.length;
      if (records > 10) throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev batch exceeded the page limit.', 502);
      for (const row of page.data) if (row.status === 'ok' && row.result) {
        data.push({ index: /^\d+$/.test(row.itemId || '') ? Number(row.itemId) : data.length, page: contextPage(row.result, row.url) });
      }
      if (!page.has_more) break;
      cursor = page.next_cursor || undefined;
      if (!cursor || visited.has(cursor) || visited.size >= 10) throw new ResearchError('PROVIDER_RESPONSE', 'Context.dev returned invalid batch pagination.', 502);
      visited.add(cursor);
    } while (cursor);
  }
  return { status, completed, data: data.sort((a, b) => a.index - b.index).map(row => row.page) };
}
