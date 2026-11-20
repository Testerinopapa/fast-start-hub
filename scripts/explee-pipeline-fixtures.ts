/**
 * Offline, deterministic campaign-output report. No API keys, Supabase, or HTTP requests.
 * Inputs are documented synthetic research fixtures, not real-time company research.
 */
import { CAMPAIGN_MODEL, classifyCampaignCapabilities, generateRuleCampaigns } from '../supabase/functions/_shared/campaigns-rules.ts';
import type { CampaignProfile } from '../supabase/functions/_shared/campaigns-core.ts';

type Case = {
  label: string;
  expectedPrimary: string;
  forbiddenName: RegExp;
  profile: CampaignProfile;
};

const cases: Case[] = [
  {
    label: 'Calendly',
    expectedPrimary: 'scheduling',
    forbiddenName: /payment processor|payment services company/i,
    profile: {
      company_name: 'Calendly',
      business_description: 'All the work around meetings, handled.',
      products: [
        { name: 'Calendly', description: 'Find time to connect', source_urls: ['https://calendly.com/'] },
        { name: 'Callie', description: 'AI scheduling assistant', source_urls: ['https://calendly.com/scheduling'] },
        { name: 'Payment Tools', description: 'Charge upfront for meetings', source_urls: ['https://calendly.com/'] },
        { name: 'Free', description: 'One-on-one scheduling', source_urls: ['https://calendly.com/pricing'] },
      ],
      descriptions: [
        { text: 'Calendly is meeting scheduling software', source_urls: ['https://calendly.com/about'] },
        { text: 'Scheduling tool for appointments', source_urls: ['https://calendly.com/scheduling'] },
        { text: 'Calendly is a scheduling platform', source_urls: ['https://calendly.com/pricing'] },
      ],
      customers: [], source_urls: ['https://calendly.com/'],
      competitor_research: { results: [] }, campaign_plan: null,
    } as unknown as CampaignProfile,
  },
  {
    label: 'HubSpot',
    expectedPrimary: 'crm',
    forbiddenName: /appoint|booking|tutor/i,
    profile: {
      company_name: 'HubSpot',
      business_description: 'HubSpot helps businesses grow.',
      products: [
        { name: 'SEO Marketing Software', description: 'SEO content strategies', source_urls: ['https://www.hubspot.com/products/marketing/seo'] },
        { name: 'Marketing Hub', description: 'Marketing software', source_urls: ['https://www.hubspot.com/pricing/marketing'] },
        { name: 'Sales Hub', description: 'Lead management and prospecting', source_urls: ['https://www.hubspot.com/products/sales/sales-leads'] },
        { name: 'Sales Reporting Software', description: 'Reporting for sales teams and CRM', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
        { name: 'Sales Automation Tools', description: 'CRM sales automation', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
        { name: 'Contact Management Software', description: 'Keep CRM records', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
      ],
      descriptions: [
        { text: 'HubSpot provides marketing software for SEO', source_urls: ['https://www.hubspot.com/products/marketing/seo'] },
        { text: 'AI-powered lead management for sales teams', source_urls: ['https://www.hubspot.com/products/sales/sales-leads'] },
        { text: 'Sales reporting integrated into CRM', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
      ],
      customers: [], source_urls: ['https://www.hubspot.com/'],
      competitor_research: { results: [] }, campaign_plan: null,
    } as unknown as CampaignProfile,
  },
];

type TestResult = { name: string; passed: boolean; explanation: string };
const report: {
  mode: string; generated_at: string; commit: string; model: string;
  caveat: string; passed: boolean;
  cases: Array<{ company: string; top_capabilities: Array<{ capability: string; score: number }>;
    tests: TestResult[]; campaigns: Array<{ name: string; target_audience: string;
      target_industry: string; keywords: string[]; source_urls: string[]; evidence_summary: string }> }>;
  failures: string[];
} = {
  mode: 'offline-fixtures',
  generated_at: new Date().toISOString(),
  commit: Deno.env.get('GITHUB_SHA') || 'local',
  model: CAMPAIGN_MODEL,
  caveat: 'Synthetic saved-company profiles. Verifies local campaign logic, not live search quality, discovery, email delivery, or deployment.',
  passed: true,
  cases: [],
  failures: [],
};

for (const item of cases) {
  const tests: TestResult[] = [];
  const check = (name: string, passed: boolean, explanation: string) => {
    tests.push({ name, passed, explanation });
    if (!passed) report.failures.push(item.label + ': ' + name + ' — ' + explanation);
  };
  try {
    const scored = classifyCampaignCapabilities(item.profile);
    const suggestions = generateRuleCampaigns(item.profile);
    check('primary category', scored[0]?.capability === item.expectedPrimary,
      'Expected ' + item.expectedPrimary + ', received ' + (scored[0]?.capability || 'none'));
    check('campaign count', suggestions.length >= 4 && suggestions.length <= 6,
      'Generated ' + suggestions.length + ' suggested campaigns');
    check('audience hypotheses', suggestions.every(c => c.origin === 'suggested' && c.audience_basis === 'inferred'),
      'Suggested campaigns must not be represented as verified customers');
    check('first-party citations', suggestions.every(c => c.source_urls.length > 0 &&
      c.source_urls.every(url => new URL(url).hostname.replace(/^www\./, '') === new URL(item.profile.source_urls[0]).hostname.replace(/^www\./, ''))),
      'Campaign citations must point to the researched company');
    check('buyer-search keywords', suggestions.every(c => c.keywords.length >= 2),
      'Every campaign must include at least two buyer-company search keywords');
    check('no unsupported locations', suggestions.every(c => c.target_locations.length === 0),
      'Geography must be empty unless supplied by a person');
    check('no category leakage', suggestions.every(c => !item.forbiddenName.test(c.name)),
      'No inappropriate audience names for this company');
    report.cases.push({
      company: item.label, top_capabilities: scored.map(s => ({ capability: s.capability, score: s.score })),
      tests, campaigns: suggestions.map(c => ({
        name: c.name, target_audience: c.target_audience, target_industry: c.target_industry,
        keywords: c.keywords, source_urls: c.source_urls, evidence_summary: c.evidence_summary || '',
      })),
    });
  } catch (error) {
    const explanation = error instanceof Error ? error.message : String(error);
    check('generation exception', false, explanation);
    report.cases.push({ company: item.label, top_capabilities: [], tests, campaigns: [] });
  }
}
report.passed = report.failures.length === 0;

const safe = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
const md = [
  '# Explee offline campaign output',
  '',
  '**Result:** ' + (report.passed ? 'PASS' : 'FAIL'),
  '**Engine:** ' + CAMPAIGN_MODEL,
  '**Commit:** `' + report.commit + '`',
  '',
  '> ' + report.caveat,
  '',
  ...report.cases.flatMap(c => [
    '## ' + c.company,
    '',
    '**Capability ranking:** ' + c.top_capabilities.map(v => v.capability + ' (' + v.score + ')').join(', '),
    '',
    '| Check | Result | Detail |', '|---|---|---|',
    ...c.tests.map(t => '| ' + safe(t.name) + ' | ' + (t.passed ? 'PASS' : 'FAIL') + ' | ' + safe(t.explanation) + ' |'),
    '',
    '| Suggested campaign | Potential buyers | Search terms |', '|---|---|---|',
    ...c.campaigns.map(row => '| ' + safe(row.name) + ' | ' + safe(row.target_audience) + ' | ' + safe(row.keywords.join(', ')) + ' |'),
    '',
  ]),
  ...(report.failures.length ? ['## Failures', '', ...report.failures.map(f => '- ' + f), ''] : []),
].join('\n');
await Deno.mkdir('artifacts', { recursive: true });
await Promise.all([
  Deno.writeTextFile('artifacts/pipeline-fixtures.json', JSON.stringify(report, null, 2) + '\n'),
  Deno.writeTextFile('artifacts/pipeline-fixtures.md', md + '\n'),
]);
console.log('Offline campaign fixture report:', report.passed ? 'PASS' : 'FAIL');
for (const c of report.cases) console.log(c.company + ': ' + c.campaigns.length + ' campaigns, ' + c.tests.filter(t => t.passed).length + '/' + c.tests.length + ' checks');
if (!report.passed) Deno.exitCode = 1;
