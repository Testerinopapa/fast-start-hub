import { strict as assert } from 'node:assert';
import { buildProfile, isCompanySource, selectPages } from './research-core.ts';
import { collectCandidates, competitorFit, type CompanyProfile } from './competitor-core.ts';
import { CAMPAIGN_MODEL, classifyCampaignCapabilities, generateRuleCampaigns } from './campaigns-rules.ts';
import type { CampaignProfile } from './campaigns-core.ts';

const calendly = {
  company_name: 'Calendly',
  business_description: 'All the work around meetings, handled.',
  products: [
    { name: 'Calendly', description: 'Find time to connect', source_urls: ['https://calendly.com/'] },
    { name: 'Callie', description: 'AI scheduling assistant', source_urls: ['https://calendly.com/scheduling'] },
    { name: 'Payment Tools', description: 'Charge upfront for meetings and send invoices', source_urls: ['https://calendly.com/'] },
    { name: 'Free', description: 'One-on-one scheduling', source_urls: ['https://calendly.com/pricing'] },
    { name: 'Teams', description: 'Round-robin scheduling', source_urls: ['https://calendly.com/pricing'] },
  ],
  descriptions: [
    { text: 'Calendly is meeting scheduling software', source_urls: ['https://calendly.com/about'] },
    { text: 'Scheduling tool for appointments', source_urls: ['https://calendly.com/scheduling'] },
    { text: 'Calendly is a scheduling platform', source_urls: ['https://calendly.com/pricing'] },
  ],
  customers: [], source_urls: ['https://calendly.com/'], competitor_research: { results: [] }, campaign_plan: null,
} as unknown as CampaignProfile;

const hubspot = {
  company_name: 'HubSpot',
  business_description: 'HubSpot helps businesses grow.',
  products: [
    { name: 'SEO Marketing Software', description: 'SEO content strategies', source_urls: ['https://www.hubspot.com/products/marketing/seo'] },
    { name: 'Marketing Hub', description: 'Marketing software', source_urls: ['https://www.hubspot.com/pricing/marketing'] },
    { name: 'Sales Hub', description: 'Lead management and prospecting', source_urls: ['https://www.hubspot.com/products/sales/sales-leads'] },
    { name: 'Sales Reporting Software', description: 'Reporting for sales teams and CRM', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
    { name: 'Free Meeting Scheduler', description: 'Book more appointments', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
    { name: 'Sales Automation Tools', description: 'CRM sales automation', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
    { name: 'Contact Management Software', description: 'Keep CRM records', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
  ],
  descriptions: [
    { text: 'HubSpot provides marketing software for SEO', source_urls: ['https://www.hubspot.com/products/marketing/seo'] },
    { text: 'AI-powered lead management for sales teams', source_urls: ['https://www.hubspot.com/products/sales/sales-leads'] },
    { text: 'Sales reporting integrated into CRM', source_urls: ['https://www.hubspot.com/products/sales/sales-reports'] },
  ],
  customers: [], source_urls: ['https://hubspot.com/'], competitor_research: { results: [] }, campaign_plan: null,
} as unknown as CampaignProfile;

Deno.test('Calendly page selection excludes tenants and includes official research pages', () => {
  const pages = selectPages('https://calendly.com/', ['miecat', 'axisfinhealth', 'tracysoracle', 'dmurban/30min',
    'features/admin-management', 'integration', 'solutions/education', 'pricing'].map(path => ({ url: 'https://calendly.com/' + path })));
  assert.ok(pages.length <= 10);
  for (const path of ['/', '/scheduling', '/pricing', '/about', '/integration', '/solutions/sales'])
    assert.ok(pages.includes('https://calendly.com' + path), path);
  assert.ok(pages.every(isCompanySource));
  assert.ok(!pages.some(url => /miecat|axisfinhealth|tracysoracle|dmurban/.test(url)));
});

Deno.test('Profile merge rejects booking-tenant facts and redirects', () => {
  const urls = ['https://calendly.com/', 'https://calendly.com/miecat', 'https://calendly.com/pricing', 'https://calendly.com/about'];
  const saved = buildProfile([
    { metadata: { sourceURL: urls[0] }, json: { page_subject: 'company', company_name: 'Calendly', business_description: 'Scheduling software.' } },
    { metadata: { sourceURL: urls[1] }, json: { company_name: 'MIECAT', products: [{ name: 'Therapeutic arts' }] } },
    { metadata: { sourceURL: urls[2], url: 'https://calendly.com/axisfinhealth' }, json: { products: [{ name: 'Medicare review' }] } },
    { metadata: { sourceURL: urls[3] }, json: { page_subject: 'third_party_content', products: [{ name: 'Other business service' }] } },
  ], urls);
  assert.equal(saved.company_name, 'Calendly');
  assert.deepEqual(saved.products, []);
  assert.deepEqual(saved.source_urls, [urls[0]]);
});

Deno.test('Competitor matching still recognizes evidenced scheduling substitutes', () => {
  const candidates = collectCandidates(calendly as CompanyProfile, [], [{ url: 'https://www.zoom.com/en/products/appointment-scheduler/', title: 'Appointment scheduling software' }]);
  assert.equal(candidates[0].url, 'https://www.zoom.com/en/products/appointment-scheduler/');
  const fit = competitorFit(calendly as CompanyProfile, { description: 'The most customizable free online scheduling tool.', products: [], features: [], customers: [], pricing: [] });
  assert.equal(fit.relationship, 'direct');
});

Deno.test('Campaigns are generated locally without a model request or API key', () => {
  assert.equal(CAMPAIGN_MODEL, 'rules/v1');
  const matches = classifyCampaignCapabilities(calendly);
  assert.equal(matches[0].capability, 'scheduling');
  const generated = generateRuleCampaigns(calendly);
  assert.equal(generated.length, 6);
  assert.ok(generated.every(c => c.origin === 'suggested' && c.audience_basis === 'inferred'));
  assert.ok(generated.every(c => c.source_urls.length > 0 && c.keywords.length >= 2));
  assert.ok(generated.some(c => /clinic|health/i.test(c.target_audience)));
  assert.ok(generated.every(c => !/payments? processor|payment services company/i.test(c.target_audience)));
});

Deno.test('HubSpot produces CRM and marketing audiences, not scheduling companies', () => {
  const matches = classifyCampaignCapabilities(hubspot);
  assert.equal(matches[0].capability, 'crm');
  assert.ok(matches.some(m => m.capability === 'marketing'));
  const generated = generateRuleCampaigns(hubspot);
  assert.equal(generated.length, 6);
  assert.ok(generated.some(c => /sales|consulting|software/i.test(c.target_audience)));
  assert.ok(generated.some(c => /retail|marketing/i.test(c.target_audience)));
  assert.ok(generated.every(c => !/appoint|booking|tutor/i.test(c.name)));
});

Deno.test('Unsupported research is refused instead of fabricated', () => {
  const unsupported = { ...calendly, products: [], descriptions: [], business_description: 'An organization', source_urls: ['https://calendly.com/'] };
  assert.throws(() => generateRuleCampaigns(unsupported), /No supported business capability/);
});

Deno.test('Custom and edited campaigns are protected and enforce the twelve-item limit', () => {
  const existing = generateRuleCampaigns(calendly)[0];
  const protectedCampaign = { ...existing, id: crypto.randomUUID(), origin: 'customized' as const };
  const profile = { ...calendly, campaign_plan: { status: 'completed' as const, version: 1, campaigns: [protectedCampaign], selected_ids: [protectedCampaign.id], warnings: [] } };
  assert.ok(generateRuleCampaigns(profile).every(c => c.id !== protectedCampaign.id));
  const noSlots = { ...calendly, campaign_plan: { ...profile.campaign_plan, campaigns: Array.from({length: 9}, (_, i) => ({ ...protectedCampaign, id: 'custom-' + i })) } };
  assert.throws(() => generateRuleCampaigns(noSlots), /at most eight/);
});

const calendlyExport = Deno.env.get('AUTOGTM_CALENDLY_EXPORT');
Deno.test({ name: 'Replay exported company research without modifying it', ignore: !calendlyExport, fn: async () => {
  const report = JSON.parse(await Deno.readTextFile(calendlyExport!));
  const saved = report.profile as CampaignProfile;
  const original = JSON.stringify(saved);
  const generated = generateRuleCampaigns(saved);
  assert.equal(generated.length, 6);
  assert.equal(JSON.stringify(saved), original);
} });
