import { ResearchError } from './research-core.ts';

// Crawl4AI Cloud is an opt-in alternative to Firecrawl for Phase 4.
// Self-hosted Crawl4AI does not offer the Cloud /search API; search needs
// Crawl4AI Cloud or a separately maintained search service.
const base = 'https://api.crawl4ai.com';
const apiKey = () => {
  const key = Deno.env.get('CRAWL4AI_API_KEY')?.trim();
  if (!key) throw new ResearchError('NOT_CONFIGURED', 'Set CRAWL4AI_API_KEY in research Edge Function secrets.', 503);
  return key;
};
async function request(path: string, init: RequestInit, timeout = 30000) {
  let response: Response;
  try {
    response = await fetch(base + path, {
      ...init, headers: { Authorization: `Bearer ${apiKey()}`, ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ResearchError('PROVIDER_UNAVAILABLE', 'Crawl4AI did not respond. The reserved request will not be repeated automatically.', 503);
  }
  if (response.status === 402) throw new ResearchError('CREDITS_EXHAUSTED', 'Crawl4AI credits are exhausted.', 402);
  if (response.status === 429) throw new ResearchError('PROVIDER_RATE_LIMIT', 'Crawl4AI rate limit reached.', 429);
  if (response.status === 401 || response.status === 403) throw new ResearchError('PROVIDER_AUTHENTICATION', 'Crawl4AI authentication or account permissions were rejected.', 503);
  if (!response.ok) throw new ResearchError('PROVIDER_UNAVAILABLE', `Crawl4AI returned HTTP ${response.status}.`, 503);
  try { return await response.json(); }
  catch { throw new ResearchError('PROVIDER_RESPONSE', 'Crawl4AI returned invalid JSON.', 502); }
}

export async function crawl4aiSearch(query: string) {
  const payload = await request('/search?q=' + encodeURIComponent(query.slice(0, 512)), { method: 'GET' });
  if (!Array.isArray(payload.results)) throw new ResearchError('PROVIDER_RESPONSE', 'Crawl4AI search results were missing.', 502);
  return payload.results.slice(0, 8).map((hit: Record<string, unknown>) => ({
    url: typeof hit.url === 'string' ? hit.url : '',
    title: typeof hit.title === 'string' ? hit.title : '',
    description: typeof hit.snippet === 'string' ? hit.snippet : '',
  }));
}

export async function crawl4aiScrape(url: string) {
  const payload = await request('/scrape', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, format: 'md' }),
  }, 45000);
  const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
  if (!markdown.trim()) throw new ResearchError('PROVIDER_RESPONSE', 'Crawl4AI returned an empty page.', 502);
  // Do not represent markdown as verified structured facts. The existing
  // Phase 4 verifier only accepts quoted, confirmed website fields.
  return { markdown, metadata: { url }, json: null };
}
