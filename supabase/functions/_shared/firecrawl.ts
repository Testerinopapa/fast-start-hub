import { ResearchError, safeNextPage, type ScrapedPage } from './research-core.ts';
import { secret } from './backend.ts';

export async function firecrawl(path: string, body?: unknown, timeout = 20000) {
  let response: Response;
  try {
    response = await fetch(`https://api.firecrawl.dev/v2${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${secret('FIRECRAWL_API_KEY')}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError('PROVIDER_UNAVAILABLE', 'The research provider did not respond. Check this job again before starting another.', 503);
  }
  if (!response.ok) {
    if (response.status === 402) throw new ResearchError('CREDITS_EXHAUSTED', 'The Firecrawl credit allowance is exhausted. Research can resume when credits are available.', 402);
    if (response.status === 429) throw new ResearchError('PROVIDER_RATE_LIMIT', 'Firecrawl is busy. Please wait before trying again.', 429);
    if (response.status === 401) throw new ResearchError('PROVIDER_AUTHENTICATION', 'Firecrawl rejected the configured API key (401). Check FIRECRAWL_API_KEY in the research project’s Supabase secrets.', 503);
    if (response.status === 403) {
      // Firecrawl also uses 403 for unsupported/blocked sources. Never expose
      // its raw error body, and never mislabel every forbidden request as a bad key.
      const detail = await response.json().catch(() => null);
      const providerCode = typeof detail?.code === 'string' ? detail.code : '';
      const providerMessage = typeof detail?.error === 'string' ? detail.error : '';
      if (providerCode === 'UNSUPPORTED_SITE' || /we do not support this site/i.test(providerMessage)) {
        throw new ResearchError('SOURCE_UNSUPPORTED', 'Firecrawl does not support scraping this website.', 422);
      }
      if (['THIRD_PARTY_DATA_NOT_ENABLED', 'THIRD_PARTY_DATA_ENRICHMENT_NOT_ENABLED', 'THIRD_PARTY_DATA_TERMS_REQUIRED',
        'SCRAPE_PROMPT_INJECTION_DETECTED'].includes(providerCode)) {
        throw new ResearchError('SOURCE_RESTRICTED', 'Firecrawl restricts access to this website under the current provider settings.', 422);
      }
      throw new ResearchError('PROVIDER_FORBIDDEN', 'Firecrawl refused this request (403). Check the failed request in Firecrawl for website or feature restrictions; this does not necessarily mean the API key is invalid.', 503);
    }
    if (response.status === 404) throw new ResearchError('RESULT_EXPIRED', 'The provider result is no longer available. Start a new research job.', 410);
    throw new ResearchError('PROVIDER_UNAVAILABLE', 'The research provider is temporarily unavailable.', 503);
  }
  const result = await response.json();
  if (result.success === false) throw new ResearchError('PROVIDER_RESPONSE', 'The research provider could not process this website.', 502);
  return result;
}

export async function batchStatus(id: string) {
  const path = `/batch/scrape/${encodeURIComponent(id)}`;
  const result = await firecrawl(path, undefined, 6000);
  const pages: ScrapedPage[] = Array.isArray(result.data) ? result.data.slice(0, 10) : [];
  // Firecrawl also supplies `next` during scraping; paginate only terminal results.
  let next = result.status === 'completed' ? result.next : null;
  const visited = new Set<string>();
  while (next && pages.length < 10) {
    if (visited.has(next) || visited.size >= 10) throw new ResearchError('PROVIDER_RESPONSE', 'Unable to retrieve all company pages.', 502);
    visited.add(next);
    const page = await firecrawl(safeNextPage(next, id).replace(/^\/v2/, ''), undefined, 6000);
    if (Array.isArray(page.data)) pages.push(...page.data.slice(0, 10 - pages.length));
    next = page.next;
  }
  return { ...result, data: pages };
}
