import { firecrawl } from './firecrawl.ts';
import { businessDomain } from './competitor-core.ts';
import { companyUrl, ResearchError } from './research-core.ts';

// Phase 4 provider-backed enrichment. Explicitly off by default, and never
// invoked for anonymous guests. All paid requests must be reserved and capped
// by the calling Edge Function before enabling this integration.
export const alexandriaEnabled = () => Deno.env.get('AUTOGTM_ALEXANDRIA_ENABLED') === 'true';
export type AlexandriaCompany = {
  domain: string;
  name: string | null;
  description: string | null;
  industry: string | null;
  employee_count: number | null;
  source: 'apollo';
};
const str = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 400) : null;
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

// Use an exact published capability, never a guessed "companies/search"
// contract. This enriches known candidate domains and does not discover them.
export async function enrichKnownDomains(domains: string[]): Promise<AlexandriaCompany[]> {
  if (!alexandriaEnabled()) throw new ResearchError('NOT_CONFIGURED', 'Structured company enrichment has not been enabled.', 409);
  if (domains.length < 1 || domains.length > 3) throw new ResearchError('INVALID_REQUEST', 'Enrich between one and three company domains.');
  const safe = [...new Set(domains.map(domain => businessDomain(companyUrl('https://' + domain).href)))];
  if (safe.length !== domains.length) throw new ResearchError('INVALID_REQUEST', 'Duplicate company domains were provided.');
  const result = await firecrawl('/scrape', { alexandria: {
    provider: 'apollo',
    capability: 'companies/bulk-enrich',
    options: { 'domains[]': safe },
  } }, 30000);
  const data = Array.isArray(result.alexandria) ? result.alexandria[0]?.data : null;
  if (!data || !Array.isArray(data.organizations)) throw new ResearchError('PROVIDER_RESPONSE', 'The company provider returned an unreadable result.', 502);
  return data.organizations.slice(0, 3).flatMap((organization: Record<string, unknown>) => {
    const domain = str(organization.primary_domain || organization.domain || organization.website_url);
    if (!domain) return [];
    let normalized: string;
    try { normalized = businessDomain(companyUrl(domain.includes('://') ? domain : 'https://' + domain).href); }
    catch { return []; }
    if (!safe.includes(normalized)) return [];
    return [{ domain: normalized, name: str(organization.name),
      description: str(organization.short_description || organization.description),
      industry: str(organization.industry), employee_count: count(organization.estimated_num_employees),
      source: 'apollo' as const }];
  });
}
