/**
 * Explee Campaign Engine v1: local, deterministic, zero-credit audience suggestions.
 * Rules are intentionally visible/editable here. They never call an external AI API.
 */
import type { Campaign, CampaignProfile } from './campaigns-core.ts';
import { isCompanySource, ResearchError } from './research-core.ts';

export const CAMPAIGN_MODEL = 'rules/v1';
export type Generation = { status: 'running' | 'completed' | 'failed'; request_id: string; job_id: string;
  auto_attempted: boolean; attempts: number; started_at: string; error?: string | null; model?: string };
type Capability = 'crm' | 'marketing' | 'scheduling' | 'support' | 'commerce' | 'payments' | 'recruiting' | 'projects' | 'education' | 'analytics';
type Evidence = { id: string; urls: string[] };
type Hit = { capability: Capability; score: number; evidence: Evidence[] };
type Template = { name: string; industry: string; audience: string; keywords: string[] };

const patterns: Record<Capability, RegExp> = {
  crm: /\bcrm\b|customer relationship management|sales (?:hub|pipeline|automation|enablement|reporting)|lead (?:management|scoring|tracking)|prospecting|deal (?:management|pipeline)/i,
  marketing: /\bseo\b|\baeo\b|marketing (?:hub|software|automation|platform|campaign)|email marketing|digital marketing|content marketing|campaign management|search engine optimization|lead generation/i,
  scheduling: /schedul(?:ing|er|e)|appointment|booking|calendar|meeting coordination|book (?:a |more )?meeting/i,
  support: /customer (?:support|service|success)|help ?desk|ticketing|support (?:ticket|platform|software|desk)|knowledge base|contact center|live chat/i,
  commerce: /e.?commerce|online stor(?:e|efront)|shop(?:ping)? (?:platform|cart)|retail platform|point.of.sale|inventory management|checkout software/i,
  payments: /payment (?:process|collection|link|tools?|software|integration)|invoic(?:e|ing)|billing (?:system|software)|subscription billing|collect (?:upfront )?payments?/i,
  recruiting: /recruit(?:ing|ment)|applicant track|candidate management|talent acquisition|job posting|hiring platform|interview schedul/i,
  projects: /project management|task management|kanban|team collaboration|workflow management|project planning|work management/i,
  education: /learning management|\blms\b|online (?:learning|courses|classroom)|education (?:platform|software)|course (?:creator|management)|student management|tutoring platform/i,
  analytics: /business intelligence|\bbi platform\b|data (?:analytics|visualization|platform)|dashboard software|reporting platform|metrics platform|performance reporting/i,
};

// Each row: segment name | industry | prospect-company description | searchable company types (comma-separated).
// Search keywords intentionally identify BUYERS rather than competing software sellers or articles.
const catalog: Record<Capability, string[]> = {
  crm: [
    'B2B Sales Organizations|B2B Sales|Companies with business-to-business sales teams|B2B services company,B2B sales organization,industrial supplier',
    'Professional Services Firms|Professional Services|Consulting and professional services firms managing client pipelines|management consulting firm,IT consulting company,accounting firm',
    'Technology Sales Teams|Technology|Software and technology companies managing sales pipelines|B2B SaaS company,enterprise software vendor,managed IT services provider',
    'Wholesale Distributors|Wholesale|Wholesalers managing repeat business customers|wholesale distributor,industrial equipment supplier,commercial materials supplier',
    'Commercial Real Estate Teams|Real Estate|Commercial property businesses managing sales inquiries|commercial real estate brokerage,office leasing firm,commercial property advisory',
    'Corporate Training Sales|Professional Training|Training firms managing company accounts and proposals|corporate training company,leadership development firm,employee training provider',
  ],
  marketing: [
    'E-commerce Retailers|E-commerce|Online retail companies marketing products to consumers|direct to consumer brand,online retail company,specialty ecommerce store',
    'B2B Marketing Departments|B2B Marketing|Business-to-business firms marketing services and solutions|B2B technology company,industrial services firm,business services company',
    'Multi-Location Service Providers|Local Services|Service businesses promoting multiple offices or territories|regional service provider,home maintenance company,multi location service company',
    'Private Training Providers|Education|Private training businesses attracting learner inquiries|professional training company,language training school,online course provider',
    'Hospitality and Travel Operators|Hospitality|Tour and hospitality companies promoting direct bookings|boutique hotel group,tour operator,travel experience provider',
    'Property Marketing Teams|Real Estate|Real estate companies generating buyer and tenant inquiries|real estate brokerage,property development company,real estate services firm',
  ],
  scheduling: [
    'Independent Consulting Practices|Professional Services|Independent consultants and coaching firms scheduling client sessions|independent consulting practice,executive coaching firm,career advisory service',
    'Private Healthcare Practices|Healthcare|Independent clinics and healthcare practices managing appointments|private medical clinic,dental practice,physiotherapy clinic',
    'Tutoring and Training Providers|Education|Tutoring centers and training businesses booking lessons|private tutoring center,language tutoring school,music lesson studio',
    'Creative and Digital Agencies|Creative Services|Agencies arranging client discovery calls and reviews|branding agency,web design studio,digital creative agency',
    'Beauty and Wellness Studios|Beauty and Wellness|Beauty and wellness businesses accepting appointments|hair salon business,beauty treatment studio,massage therapy clinic',
    'Recruitment Agencies|Recruitment|Recruitment firms coordinating candidate and employer interviews|recruitment agency,staffing firm,executive search practice',
  ],
  support: [
    'Software Customer Support|Software|Software providers handling recurring customer inquiries|SaaS platform provider,software solutions company',
    'E-commerce Customer Care|E-commerce|Online retailers handling customer and order questions|online retail company,direct to consumer brand',
    'IT Service Desks|IT Services|IT providers supporting multiple business clients|managed IT services company,technology support provider',
    'Hospitality Guest Services|Hospitality|Accommodation operators managing guest requests|hotel operator,hospitality group',
    'Financial Client Support|Financial Services|Financial service businesses handling account inquiries|insurance services company,financial advisory firm',
    'Education Support Teams|Education|Training providers handling learner enrollment and support|education services provider,professional training school',
  ],
  commerce: [
    'Specialty Retail Brands|Retail|Independent retail brands operating online shops|specialty retailer,direct to consumer brand',
    'Wholesale Suppliers|Wholesale|Wholesale businesses managing commercial product orders|wholesale supplier,trade distributor',
    'Home Goods Retailers|Home Goods|Home and lifestyle companies selling physical products online|home goods retailer,furniture ecommerce shop',
    'Independent Fashion Brands|Fashion|Apparel and accessories businesses selling through storefronts|independent clothing brand,fashion ecommerce store',
    'Beauty Product Retailers|Beauty Retail|Beauty product businesses selling directly to consumers|skincare ecommerce brand,beauty product retailer',
    'Artisan Product Sellers|Consumer Goods|Small producers selling handmade products online|artisan goods retailer,handmade products store',
  ],
  payments: [
    'Paid Consultation Providers|Professional Services|Consultancies collecting client session fees|fee based consulting practice,professional advisory firm',
    'Training Businesses|Education|Education firms collecting lesson and course payments|private training center,music lesson business',
    'Fitness and Wellness Services|Wellness|Wellness practices charging for sessions|fitness coaching studio,wellness services business',
    'Creative Service Firms|Creative Services|Creative companies invoicing client projects|design studio,creative services agency',
    'Home Service Contractors|Home Services|Home service companies collecting payments|home services contractor,residential maintenance company',
    'Event Service Providers|Events|Event businesses collecting service fees and deposits|event management company,wedding planning agency',
  ],
  recruiting: [
    'Staffing Agencies|Staffing|Staffing firms handling applicant and employer workflows|staffing agency,temporary employment company',
    'Executive Search Firms|Executive Search|Specialist recruiters managing senior-role searches|executive search firm,leadership recruitment company',
    'Hospitality Hiring Teams|Hospitality|Hospitality businesses hiring staff across locations|hotel group,hospitality operator',
    'Care Service Employers|Care Services|Care organizations hiring staff and practitioners|care services company,private healthcare operator',
    'Technology Hiring Teams|Technology|Technology companies recruiting technical staff|software development company,technology services company',
    'Industrial Employers|Industry|Industrial businesses hiring operational staff|manufacturing company,industrial services provider',
  ],
  projects: [
    'Software Delivery Teams|Technology|Software studios coordinating development engagements|software development agency,technology consultancy',
    'Creative Production Agencies|Creative Services|Creative agencies coordinating project deliverables|creative production company,branding agency',
    'Engineering Consultancies|Engineering|Engineering firms managing specialist project work|engineering consulting firm,technical design consultancy',
    'Construction Project Teams|Construction|Construction companies coordinating milestones|construction contractor,general contracting company',
    'Business Consulting Teams|Consulting|Advisory firms delivering multiple client projects|management consulting firm,business transformation consultancy',
    'Event Production Companies|Events|Event organizers managing vendor and project milestones|event production agency,conference management company',
  ],
  education: [
    'Professional Training Providers|Professional Training|Training companies delivering paid programs|professional training provider,vocational training center',
    'Language Education Providers|Language Education|Language schools coordinating classes and learners|language training school,English tutoring center',
    'Workplace Learning Teams|Corporate Learning|Corporate training firms delivering workforce education|corporate training company,workplace learning consultancy',
    'Online Course Businesses|Online Education|Education businesses publishing online courses|online education company,independent course business',
    'Tutoring Organizations|Tutoring|Tutoring centers managing student programs|tutoring company,after school tutoring center',
    'Specialist Skills Academies|Education|Academies teaching technical and professional skills|coding academy,design skills academy',
  ],
  analytics: [
    'Business Operations Teams|Business Services|Business services companies analyzing performance|business services provider,outsourced operations company',
    'Retail Operations|Retail|Retail companies comparing sales and operations|multi location retailer,online retail business',
    'Manufacturing Reporting Teams|Manufacturing|Manufacturers tracking production performance|manufacturing business,industrial production company',
    'Logistics Performance Teams|Logistics|Logistics providers reporting delivery performance|logistics services company,freight management company',
    'Professional Services Managers|Professional Services|Service firms measuring client and project results|professional services firm,business advisory company',
    'Hospitality Operations|Hospitality|Hospitality groups monitoring operational results|hospitality operator,hotel group',
  ],
};

const copy = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const ownUrls = (urls: unknown): string[] => Array.isArray(urls)
  ? [...new Set(urls.filter((url): url is string => typeof url === 'string' && isCompanySource(url)))].slice(0, 10) : [];

/** Competition research is never used as proof of the seller's offerings. */
export function classifyCampaignCapabilities(profile: CampaignProfile): Hit[] {
  const companyUrls = ownUrls(profile.source_urls);
  const results: Hit[] = [];
  for (const capability of Object.keys(patterns) as Capability[]) {
    const re = patterns[capability];
    const evidence: Evidence[] = [];
    let nameScore = 0, detailScore = 0;
    for (const [index, product] of (profile.products || []).slice(0, 60).entries()) {
      const statedUrls = ownUrls(product.source_urls);
      if (product.source_urls?.length && !statedUrls.length) continue;
      // Product evidence should belong to the researched company, not a third-party domain.
      const companyHost = companyUrls.length ? new URL(companyUrls[0]).hostname.replace(/^www\./, '') : '';
      if (companyHost && statedUrls.some(url => new URL(url).hostname.replace(/^www\./, '') !== companyHost)) continue;
      const nameMatch = re.test(copy(product.name));
      const detailMatch = re.test(copy(product.description));
      if (!nameMatch && !detailMatch) continue;
      if (nameMatch) nameScore += 7;
      else detailScore += 2;
      if (evidence.length < 6) evidence.push({ id: 'company:product:' + index, urls: statedUrls.length ? statedUrls : companyUrls });
    }
    // Multiple independent first-party descriptions can establish a primary capability
    // even when product names are generic (e.g. product plans called Free or Teams).
    let descriptionsScore = 0;
    for (const [index, description] of (profile.descriptions || []).slice(0, 12).entries()) {
      const urls = ownUrls(description.source_urls);
      if (!urls.length || (companyUrls.length && urls.some(url => new URL(url).hostname.replace(/^www\./, '') !== new URL(companyUrls[0]).hostname.replace(/^www\./, '')))) continue;
      if (!re.test(copy(description.text))) continue;
      descriptionsScore += 5;
      if (evidence.length < 6) evidence.push({ id: 'company:description:' + index, urls });
    }
    const offeringMatch = !!copy(profile.business_description) && re.test(copy(profile.business_description));
    if (offeringMatch) evidence.unshift({ id: 'company:offering', urls: companyUrls });
    const score = Math.min(nameScore, 35) + Math.min(detailScore, 6) + Math.min(descriptionsScore, 15) + (offeringMatch ? 9 : 0);
    if (score >= 9 && evidence.length) results.push({ capability, score, evidence: evidence.slice(0, 6) });
  }
  return results.sort((a, b) => b.score - a.score || a.capability.localeCompare(b.capability));
}

const context: Record<Capability, { pains: string[]; criteria: string[]; benefit: string }> = {
  crm: { pains: ['Disconnected prospect and customer records', 'Manual follow-ups across sales conversations'], criteria: ['Manages business customer inquiries', 'Uses a multi-stage sales or account process'], benefit: 'sales relationship and pipeline management' },
  marketing: { pains: ['Marketing channels and performance reports are disconnected', 'Lead generation requires manual follow-up'], criteria: ['Markets products or services through digital channels', 'Has an identifiable marketing acquisition workflow'], benefit: 'marketing campaigns and lead generation' },
  scheduling: { pains: ['Appointments take time to coordinate manually', 'Rescheduling interrupts client-facing work'], criteria: ['Offers scheduled client or customer appointments', 'Publishes services requiring meetings or consultations'], benefit: 'appointment and meeting scheduling' },
  support: { pains: ['Customer requests arrive through disconnected channels', 'Customer issues are hard to track consistently'], criteria: ['Handles recurring customer service requests', 'Provides ongoing customer support'], benefit: 'support request organization' },
  commerce: { pains: ['Online product listings and sales need coordination', 'Customers encounter friction while placing orders'], criteria: ['Sells products through a digital storefront', 'Has identifiable product categories'], benefit: 'online product selling' },
  payments: { pains: ['Invoices or service fees require manual collection', 'Tracking payment status takes extra administration'], criteria: ['Charges customers for products or services', 'Uses invoices, bookings or checkout flows'], benefit: 'payment collection' },
  recruiting: { pains: ['Applications and interviews are difficult to coordinate', 'Hiring teams lose visibility into candidate progress'], criteria: ['Recruits staff or places candidates', 'Uses a repeated hiring process'], benefit: 'candidate and hiring workflows' },
  projects: { pains: ['Project updates and task ownership are fragmented', 'Deadlines and handoffs require repeated coordination'], criteria: ['Delivers projects involving multiple steps', 'Coordinates tasks across a team or vendors'], benefit: 'project and task management' },
  education: { pains: ['Course participation and learner progress are tracked manually', 'Class scheduling and enrollment take administrative time'], criteria: ['Delivers structured lessons or courses', 'Manages learners or training programs'], benefit: 'course and learner administration' },
  analytics: { pains: ['Reports are spread across different tools', 'Operational decisions rely on manual metrics collection'], criteria: ['Tracks recurring operational or commercial metrics', 'Uses performance reporting'], benefit: 'performance analysis and reporting' },
};

export function generateRuleCampaigns(profile: CampaignProfile): Campaign[] {
  const protectedCampaigns = (profile.campaign_plan?.campaigns || []).filter(c => c.origin !== 'suggested');
  const count = Math.min(6, 12 - protectedCampaigns.length);
  if (count < 4) throw new ResearchError('CAMPAIGN_LIMIT', 'Keep at most eight custom or edited campaigns to leave room for four new suggestions.');
  const scores = classifyCampaignCapabilities(profile);
  if (!scores.length) throw new ResearchError('UNSUPPORTED_RESEARCH', 'No supported business capability could be verified from saved products. Edit the research or create a custom campaign. No generic suggestions were invented.', 422);
  const top = scores[0].score;
  let relevant = scores.filter(m => m.score >= Math.max(12, top * 0.42)).slice(0, 3);
  // Scheduling products that collect fees are not necessarily payment processors.
  const scheduling = relevant.find(m => m.capability === 'scheduling');
  const payments = relevant.find(m => m.capability === 'payments');
  if (scheduling && payments && scheduling.score >= payments.score) relevant = relevant.filter(m => m.capability !== 'payments');
  const already = new Set(protectedCampaigns.map(c => c.target_audience.trim().toLowerCase()));
  const suggestions: Campaign[] = [];
  for (let index = 0; index < 6 && suggestions.length < count; index++) {
    for (const match of relevant) {
      const raw = catalog[match.capability][index];
      if (!raw) continue;
      const [name, industry, audience, terms] = raw.split('|');
      if (already.has(audience.toLowerCase())) continue;
      const details = context[match.capability];
      const urls = [...new Set(match.evidence.flatMap(e => e.urls))].slice(0, 15);
      const ids = match.evidence.slice(0, 4).map(e => e.id);
      suggestions.push({
        id: crypto.randomUUID(), origin: 'suggested', audience_basis: 'inferred',
        name, target_audience: audience, target_industry: industry,
        ideal_customer: audience + '. These prospective customers may benefit from ' + details.benefit + '. Confirm need and fit before outreach.',
        pain_points: details.pains, criteria: details.criteria,
        keywords: terms.split(',').filter(Boolean), target_locations: [],
        reasoning: 'This prospective customer type could use the researched ' + details.benefit + ' capabilities. The relationship is inferred, not verified.',
        evidence_summary: 'Rule-based hypothesis grounded in saved company facts: ' + ids.join(', ') + '. Not a verified customer segment.',
        source_urls: urls,
      });
      if (suggestions.length >= count) break;
    }
  }
  if (suggestions.length < 4) throw new ResearchError('UNSUPPORTED_RESEARCH', 'Not enough distinct supported audiences. Saved campaigns are unchanged.', 422);
  return suggestions;
}
