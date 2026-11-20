/**
 * Opt-in REAL Context.dev smoke without Supabase.
 * Strict ceilings: at most 1 map, 2 structured scrapes, 3 searches.
 * Search snippets are unverified candidates, never qualified or verified leads.
 * Context.dev charges by request/result; this is NOT a dollar-amount limit.
 */
import { contextMap, contextScrape, contextSearch } from '../supabase/functions/_shared/context-dev.ts';
import { buildProfile, companyUrl, domainOf, extractionFormat, selectPages } from '../supabase/functions/_shared/research-core.ts';
import { CAMPAIGN_MODEL, classifyCampaignCapabilities, generateRuleCampaigns } from '../supabase/functions/_shared/campaigns-rules.ts';
import type { CampaignProfile } from '../supabase/functions/_shared/campaigns-core.ts';

type Candidate = { title: string; url: string; description: string; verification: 'unverified_search_result' };
const report: Record<string, unknown> = {
  mode: 'manual-live-context-dev',
  generated_at: new Date().toISOString(),
  commit: Deno.env.get('GITHUB_SHA') || 'local',
  engine: CAMPAIGN_MODEL,
  limits: { map_requests: 1, structured_scrapes: 2, search_requests: 3 },
  caveats: [
    'This is a smoke of company extraction, rule-based campaigns and unverified competitor/buyer/person discovery search previews.',
    'It is NOT a full Supabase workflow or end-to-end company/person verification; no outreach or emails are sent.',
    'Actual provider credits may vary, especially for JSON extraction. This run has request-count limits, not a fixed price cap.',
  ],
  status: 'pending',
  warnings: [] as string[],
};

const errors: string[] = [];
const warnings = report.warnings as string[];
const shortError = (err: unknown) => err instanceof Error ? err.message.slice(0, 400) : 'Unknown provider error';
const rows = (value: { results: Array<{ title?: string; url?: string; description?: string }> }): Candidate[] =>
  value.results.filter(r => typeof r.url === 'string' && /^https?:\/\//.test(r.url))
    .map(r => ({ title: (r.title || '').slice(0, 200), url: r.url!, description: (r.description || '').slice(0, 500),
      verification: 'unverified_search_result' as const }));
const site = Deno.args[0] || 'https://calendly.com';
let root: URL | undefined;
try {
  if (Deno.env.get('EXPLEE_APPROVE_PAID_RUN') !== 'yes') throw new Error('Paid mode is not approved. Use the workflow manual live mode explicitly.');
  if (!Deno.env.get('CONTEXT_DEV_API_KEY')) throw new Error('CONTEXT_DEV_API_KEY GitHub Actions secret is missing.');
  root = companyUrl(site);
  root.pathname = '/'; root.search = ''; root.hash = '';
  report.website = root.href;
  report.status = 'running';
  const map = await contextMap(root.href, { retries: 0 });
  report.mapped_url_count = map.length;
  const selected = selectPages(root.href, map).slice(0, 2);
  report.selected_pages = selected;
  const pages = [];
  for (const url of selected) {
    try {
      const page = await contextScrape(url, extractionFormat, { retries: 0 });
      pages.push(page);
    } catch (error) {
      warnings.push('Scrape failed (' + url + '): ' + shortError(error));
    }
  }
  if (!pages.length) throw new Error('No pages could be extracted from the selected research URLs.');
  const built = buildProfile(pages, selected);
  const company = {
    company_name: built.company_name,
    business_description: built.business_description,
    source_urls: built.source_urls,
    products: built.products,
    descriptions: built.descriptions,
  };
  report.company = company;
  const profile = { ...built, competitor_research: { results: [] }, campaign_plan: null } as unknown as CampaignProfile;
  const capabilities = classifyCampaignCapabilities(profile);
  report.capabilities = capabilities.map(c => ({ capability: c.capability, score: c.score }));
  const generated = generateRuleCampaigns(profile);
  report.campaigns = generated.map(c => ({
    name: c.name, target_audience: c.target_audience, target_industry: c.target_industry,
    keywords: c.keywords, source_urls: c.source_urls, evidence_summary: c.evidence_summary,
    audience_basis: c.audience_basis,
  }));
  const competitorQuery = [built.company_name, capabilities[0]?.capability || 'software', 'business competitors alternatives official site'].filter(Boolean).join(' ').slice(0, 500);
  try {
    report.competitor_search = { query: competitorQuery,
      candidates: rows(await contextSearch(competitorQuery, { retries: 0, limit: 5 })) };
  } catch (error) { warnings.push('Competitor search failed: ' + shortError(error)); }
  const first = generated[0];
  const prospectQuery = (first.keywords.slice(0, 2).join(' OR ') + ' independent business official website').slice(0, 500);
  let potentialBuyers: Candidate[] = [];
  try {
    potentialBuyers = rows(await contextSearch(prospectQuery, { retries: 0, limit: 5 }));
    report.buyer_search = { campaign: first.name, query: prospectQuery, candidates: potentialBuyers };
  } catch (error) { warnings.push('Buyer search failed: ' + shortError(error)); }
  // Only a preview: a company's existence and a person's current employment
  // cannot be verified from a search result alone.
  const firstBuyer = potentialBuyers.find(row => {
    try {
      const domain = domainOf(new URL(row.url));
      return domain !== domainOf(root!) && !/(?:^|\.)(linkedin\.com|facebook\.com|wikipedia\.org|google\.com|g2\.com|clutch\.co)$/.test(domain);
    } catch { return false; }
  });
  if (firstBuyer) {
    const target = new URL(firstBuyer.url).hostname;
    const peopleQuery = ('site:' + target + ' founder CEO director leadership team').slice(0, 500);
    try {
      report.people_search = { website: target, query: peopleQuery,
        candidates: rows(await contextSearch(peopleQuery, { retries: 0, limit: 5 })) };
    } catch (error) { warnings.push('People search failed: ' + shortError(error)); }
  } else warnings.push('No candidate buyer website to preview person search.');
  report.status = 'completed_with_unverified_previews';
} catch (error) {
  errors.push(shortError(error));
  report.status = 'failed';
}
report.errors = errors;

await Deno.mkdir('artifacts', { recursive: true });
const markdown = [
  '# Explee live research smoke',
  '',
  '**Status:** ' + report.status,
  '**Website:** ' + (report.website || site),
  '**Commit:** `' + report.commit + '`',
  '',
  ...(report.caveats as string[]).map(text => '> ' + text),
  '',
  '## Company extracted',
  '',
  '```json',
  JSON.stringify(report.company || null, null, 2),
  '```',
  '',
  '## Suggested campaigns',
  '',
  '| Campaign | Potential buyer | Keywords |',
  '|---|---|---|',
  ...((report.campaigns || []) as Array<{ name: string; target_audience: string; keywords: string[] }>).map(c =>
    '| ' + c.name.replaceAll('|', '/') + ' | ' + c.target_audience.replaceAll('|', '/') + ' | ' + c.keywords.join(', ').replaceAll('|', '/') + ' |'),
  '',
  '## Search previews',
  '',
  'All competitor, buyer, and person search results below are **unverified candidates**; inspect cited websites before outreach.',
  '',
  ...(['competitor_search', 'buyer_search', 'people_search'] as const).flatMap(field => [
    '### ' + field.replaceAll('_', ' '),
    '```json',
    JSON.stringify(report[field] || null, null, 2),
    '```', '',
  ]),
  '## Warnings / errors',
  '',
  ...[...warnings, ...errors].map(v => '- ' + v),
  '',
].join('\n');
await Promise.all([
  Deno.writeTextFile('artifacts/pipeline-live.json', JSON.stringify(report, null, 2) + '\n'),
  Deno.writeTextFile('artifacts/pipeline-live.md', markdown + '\n'),
]);
console.log('Live pipeline smoke:', report.status, 'reports in artifacts/');
if (errors.length) Deno.exitCode = 1;
