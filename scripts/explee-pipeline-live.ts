/**
 * Opt-in REAL Context.dev smoke without Supabase.
 * Strict ceilings: at most 1 map, 3 structured scrapes, 3 searches.
 * Search snippets are unverified candidates, never qualified or verified leads.
 * Context.dev charges by request/result; this is NOT a dollar-amount limit.
 */
import { contextMap, contextScrape, contextSearch } from '../supabase/functions/_shared/context-dev.ts';
import { buildProfile, companyUrl, domainOf, extractionFormat, selectPages } from '../supabase/functions/_shared/research-core.ts';
import { CAMPAIGN_MODEL, classifyCampaignCapabilities, generateRuleCampaigns } from '../supabase/functions/_shared/campaigns-rules.ts';
import { competitorQueries } from '../supabase/functions/_shared/competitor-core.ts';
import { candidateResults, discoveryCandidates, discoveryExtraction, enrichCompany, newDiscovery, type DiscoveryCandidate, type DiscoveryEvent, type Target } from '../supabase/functions/_shared/discovery-core.ts';
import { freshPeople, peoplePages, peopleQuery, type PeopleDiagnostic } from '../supabase/functions/_shared/people-core.ts';
import type { CampaignProfile } from '../supabase/functions/_shared/campaigns-core.ts';
import { selectBuyerPreview } from './explee-pipeline-selection.ts';

type Candidate = { title: string; url: string; description: string; verification: 'unverified_search_result' };
const report: Record<string, unknown> = {
  mode: 'manual-live-context-dev',
  generated_at: new Date().toISOString(),
  commit: Deno.env.get('GITHUB_SHA') || 'local',
  engine: CAMPAIGN_MODEL,
  limits: { map_requests: 1, structured_scrapes: 3, search_requests: 3 },
  caveats: [
    'This smoke reuses production Phase 4 candidate ranking and website evidence verification. It does not persist leads or run the complete Phase 5 contact extractor.',
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
  const competitorQuery = competitorQueries(profile)[0];
  try {
    report.competitor_search = { query: competitorQuery,
      candidates: rows(await contextSearch(competitorQuery, { retries: 0, limit: 5 })) };
  } catch (error) { warnings.push('Competitor search failed: ' + shortError(error)); }

  const first = generated[0];
  const target: Target = {
    campaign_id: first.id, project_id: 'local-smoke', research_job_id: 'local-smoke', plan_version: 1,
    name: first.name, audience: first.target_audience, industry: first.target_industry,
    ideal_customer: first.ideal_customer, keywords: first.keywords,
    locations: first.target_locations, reasoning: first.reasoning,
    source_urls: first.source_urls, excluded_domains: [domainOf(root)],
  };
  const state = newDiscovery(target);
  const prospectQuery = state.queries[0];
  let candidates: DiscoveryCandidate[] = [];
  try {
    const response = await contextSearch(prospectQuery, { retries: 0, limit: 8 });
    const events: DiscoveryEvent[] = [];
    candidates = discoveryCandidates(state, response.results, events);
    const currentState = { ...state, candidates };
    report.buyer_search = {
      campaign: first.name, query: prospectQuery,
      candidates: candidateResults(currentState).map(company => ({
        domain: company.domain, website: company.website, search_title: company.search_title,
        relevance_score: company.relevance_score, research_status: 'unverified',
        classification: 'search_candidate_only',
      })),
      rejected: events.filter(event => event.outcome === 'rejected'),
    };
  } catch (error) { warnings.push('Buyer search failed: ' + shortError(error)); }

  // Never send decision-maker discovery to a random article, directory or
  // network membership page merely because its snippet mentions the audience.
  const buyer = selectBuyerPreview(candidates);
  if (!buyer) {
    report.buyer_enrichment = { status: 'skipped', reason: 'No sufficiently relevant business-looking page returned. Search candidates stay unverified.' };
    report.people_search = { status: 'skipped', reason: 'No website-verified candidate company. Refusing to look up unrelated people.' };
  } else {
    try {
      // This is a third and final structured scrape request.
      const websitePage = await contextScrape(buyer.url, discoveryExtraction, { retries: 0 });
      const stateForEnrichment = { ...state, candidates, results: candidateResults({ ...state, candidates }) };
      const { company, reason } = enrichCompany(stateForEnrichment, buyer, websitePage);
      report.buyer_enrichment = {
        candidate_domain: buyer.domain, requested_url: buyer.url, result: company ? {
          domain: company.domain, website: company.website, name: company.name,
          description: company.description, industry: company.industry,
          research_status: company.research_status, confidence: company.confidence,
          relevance: company.relevance, match_reason: company.match_reason,
          source_urls: company.source_urls, research_notes: company.research_notes,
        } : null, reason,
      };
      if (!company || company.research_status !== 'verified' || company.relevance === 'Fit unconfirmed') {
        report.people_search = { status: 'skipped', reason: 'Buyer company identity or audience fit was not sufficiently evidenced. No decision-maker search was made.' };
      } else {
        const query = peopleQuery(company, target, 0);
        try {
          const response = await contextSearch(query, { retries: 0, limit: 5 });
          const events: PeopleDiagnostic[] = [];
          const eligible = peoplePages(freshPeople(company.domain), response.results, company.source_urls, events);
          report.people_search = {
            status: 'unverified_source_preview', company: company.name, company_domain: company.domain,
            query, eligible_pages: eligible,
            rejections: events.filter(event => event.outcome === 'rejected'),
            note: 'Pages have not been scraped for quoted employment evidence; no named person is verified.',
          };
        } catch (error) { warnings.push('People search failed: ' + shortError(error)); }
      }
    } catch (error) {
      warnings.push('Buyer enrichment failed: ' + shortError(error));
      report.buyer_enrichment = { status: 'unavailable', candidate_domain: buyer.domain };
      report.people_search = { status: 'skipped', reason: 'Buyer website could not be verified.' };
    }
  }
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
  ...(['competitor_search', 'buyer_search', 'buyer_enrichment', 'people_search'] as const).flatMap(field => [
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
