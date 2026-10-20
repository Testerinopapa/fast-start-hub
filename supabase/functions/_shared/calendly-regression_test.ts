import { strict as assert } from 'node:assert';
import { buildProfile, isCompanySource, selectPages } from './research-core.ts';
import { businessFacts, collectCandidates, competitorFit, competitorQueries, type CompanyProfile } from './competitor-core.ts';
import { campaignContext, campaignSchema, generateAiCampaigns, validateCampaigns, type CampaignDiagnostic } from './campaigns-ai.ts';
import type { CampaignProfile } from './campaigns-core.ts';

const profile = { company_name: 'Calendly', business_description: 'Appointment scheduling software for booking meetings.',
  products: [{ name: 'Scheduling', description: 'Team scheduling and booking pages', source_urls: ['https://calendly.com/scheduling'] }],
  customers: [], source_urls: ['https://calendly.com/'], competitor_research: { results: [] }, campaign_plan: null } as unknown as CampaignProfile;

Deno.test('Calendly page selection excludes tenants and includes official research categories within ten pages', () => {
  const pages = selectPages('https://calendly.com/', ['miecat', 'axisfinhealth', 'tracysoracle', 'dmurban/30min',
    'features/admin-management', 'integration', 'solutions/education', 'pricing'].map(path => ({ url: `https://calendly.com/${path}` })));
  assert.ok(pages.length <= 10);
  for (const path of ['/', '/scheduling', '/pricing', '/about', '/integration', '/solutions/sales'])
    assert.ok(pages.includes(`https://calendly.com${path}`), path);
  assert.ok(pages.every(isCompanySource));
  assert.ok(!pages.some(url => /miecat|axisfinhealth|tracysoracle|dmurban/.test(url)));
});

Deno.test('profile merge rejects booked services and redirects even if old selection contains them', () => {
  const urls = ['https://calendly.com/', 'https://calendly.com/miecat', 'https://calendly.com/pricing', 'https://calendly.com/about'];
  const saved = buildProfile([
    { metadata: { sourceURL: urls[0] }, json: { page_subject: 'company', company_name: 'Calendly', business_description: 'Scheduling software.' } },
    { metadata: { sourceURL: urls[1] }, json: { company_name: 'MIECAT', products: [{ name: 'Therapeutic arts' }], locations: [{ name: 'Australia' }] } },
    { metadata: { sourceURL: urls[2], url: 'https://calendly.com/axisfinhealth' }, json: { products: [{ name: 'Medicare review' }] } },
    { metadata: { sourceURL: urls[3] }, json: { page_subject: 'third_party_content', products: [{ name: 'Other business service' }] } },
  ], urls);
  assert.equal(saved.company_name, 'Calendly');
  assert.deepEqual(saved.products, []);
  assert.deepEqual(saved.locations, []);
  assert.deepEqual(saved.source_urls, [urls[0]]);
});

Deno.test('retain competitor product URL and classify evidenced scheduling substitutes without audience lists', () => {
  const candidates = collectCandidates(profile, [], [{ url: 'https://www.zoom.com/en/products/appointment-scheduler/', title: 'Appointment scheduling software' }]);
  assert.equal(candidates[0].url, 'https://www.zoom.com/en/products/appointment-scheduler/');
  const fit = competitorFit(profile, { description: 'The most customizable free online scheduling tool.', products: [], features: [], customers: [], pricing: [] });
  assert.equal(fit.relationship, 'direct');
  assert.ok(fit.ranking_reason.includes('Customer overlap is unknown'));
  assert.equal(competitorFit(profile, { description: 'Save time and improve productivity.', products: [], features: [], customers: [], pricing: [] }).supported, false);
});

const suggestions = () => ({ campaigns: ['Recruiting agencies', 'Financial advisers', 'Software consultancies', 'Training providers'].map(name => ({
  name, target_audience: name, target_industry: 'Professional services', ideal_customer: `${name} that regularly arrange client appointments.`,
  pain_points: ['Manual appointment coordination'], criteria: ['Offers scheduled client consultations'], keywords: [name.toLowerCase(), `${name.toLowerCase()} services`],
  target_locations: [], reasoning: 'Scheduling software may reduce appointment coordination for this business type.', source_fact_ids: ['company:offering'],
})) });

Deno.test('campaign schema uses Claude-supported constraints and validation retains precise data requirements', () => {
  const context = campaignContext(profile);
  const generated = validateCampaigns(suggestions(), context, 6);
  assert.equal(generated.length, 4);
  assert.ok(generated.every(c => c.audience_basis === 'inferred' && c.source_urls.length));
  assert.ok(!/"(?:maxItems|minItems|maxLength|minLength)"/.test(JSON.stringify(campaignSchema)));
  const bad = suggestions(); bad.campaigns[1].keywords = ['one'];
  assert.throws(() => validateCampaigns(bad, context, 6), /campaigns\[1\]\.keywords/);
  bad.campaigns[1].keywords = ['one', 'two']; bad.campaigns[1].source_fact_ids = ['invented'];
  assert.throws(() => validateCampaigns(bad, context, 6), /campaigns\[1\]\.source_fact_ids/);
  bad.campaigns[1].source_fact_ids = ['company:offering']; bad.campaigns[1].reasoning = 'There are 5000 potential customers and 50 companies.';
  assert.throws(() => validateCampaigns(bad, context, 6), /Numerical/);
});

Deno.test('retain the exact bounded model content and failure path without retrying the provider', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const bad = suggestions(); bad.campaigns[2].pain_points = [];
  const content = JSON.stringify(bad);
  let recorded: CampaignDiagnostic | undefined;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ id: 'fixture-response', choices: [{ finish_reason: 'stop', message: { content } }] })));
  }) as typeof fetch;
  try {
    await assert.rejects(generateAiCampaigns(profile, 'test-fixture-key', async diagnostic => { recorded = diagnostic; }), /campaigns\[2\]\.pain_points/);
    assert.equal(calls, 1);
    assert.equal(recorded?.response_content, content);
    assert.equal(recorded?.provider_response_id, 'fixture-response');
    assert.ok(recorded?.validation.includes('campaigns[2].pain_points'));
  } finally { globalThis.fetch = original; }
});

const exportPath = Deno.env.get('AUTOGTM_CALENDLY_EXPORT');
Deno.test({ name: 'replay the actual Calendly export without changing saved records', ignore: !exportPath, fn: async () => {
  const report = JSON.parse(await Deno.readTextFile(exportPath!));
  const saved = report.profile as CompanyProfile;
  const before = JSON.stringify(saved);
  assert.equal(businessFacts(saved.products).length, 4);
  assert.equal(businessFacts(report.profile.locations).length, 0);
  const context = campaignContext({ ...saved, campaign_plan: report.profile.campaign_plan });
  assert.ok(!JSON.stringify(context).match(/Medicare|Sound Healing|Therapeutic Arts|axisfinhealth|miecat/i));
  assert.ok(!competitorQueries(saved).join(' ').match(/rbl|pua|pakele|medicare/i));
  for (const domain of ['timetics.ai', 'youcanbook.me']) {
    const company = saved.competitor_research.results.find(c => c.domain === domain)!;
    assert.equal(competitorFit(saved, company).relationship, 'direct', domain);
  }
  assert.equal(JSON.stringify(saved), before);
  assert.equal(report.profile.campaign_plan.campaigns.length, 0);
}});
