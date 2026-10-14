import type { CompanyProfile } from './competitor-core.ts';
import { businessDomain } from './competitor-core.ts';
import { ResearchError } from './research-core.ts';

export type Campaign = {
  id: string; name: string; target_audience: string; target_industry: string; ideal_customer: string;
  keywords: string[]; target_locations: string[]; reasoning: string; source_urls: string[];
  origin: 'suggested' | 'custom' | 'customized';
  audience_basis?: 'observed' | 'inferred'; evidence_summary?: string;
  pain_points?: string[]; criteria?: string[];
};
export type CampaignPlan = { status: 'completed'; version: number; campaigns: Campaign[]; selected_ids: string[];
  warnings: string[]; generation_version?: number; created_at?: string; updated_at?: string };
export type CampaignProfile = CompanyProfile & { campaign_plan: CampaignPlan | null };
const text = (value: unknown, max = 600) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const unique = (values: string[]) => [...new Map(values.filter(Boolean).map(v => [v.toLocaleLowerCase(), v])).values()];
const tokens = (value: string): string[] => text(value, 8000).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

export function campaignFields(input: unknown): Omit<Campaign, 'id' | 'origin' | 'source_urls'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ResearchError('INVALID_CAMPAIGN', 'Enter campaign details.');
  const value = input as Record<string, unknown>;
  const string = (field: string, max: number, required = true) => {
    if (typeof value[field] !== 'string' || (required && !(value[field] as string).trim()) || (value[field] as string).length > max) {
      throw new ResearchError('INVALID_CAMPAIGN', `Enter ${field.replaceAll('_', ' ')}${required ? '' : ' or leave it empty'} (up to ${max} characters).`);
    }
    return (value[field] as string).trim();
  };
  const list = (field: string, max: number, required = false) => {
    const items = value[field];
    if (!Array.isArray(items) || items.length > 10 || items.some(item => typeof item !== 'string' || !item.trim() || item.length > max)) {
      throw new ResearchError('INVALID_CAMPAIGN', `Use up to 10 ${field.replaceAll('_', ' ')}, each up to ${max} characters.`);
    }
    const result = unique(items.map(item => item.trim()));
    if (required && !result.length) throw new ResearchError('INVALID_CAMPAIGN', 'Add at least one targeting keyword.');
    return result;
  };
  return { name: string('name', 100), target_audience: string('target_audience', 160), target_industry: string('target_industry', 100, false),
    ideal_customer: string('ideal_customer', 600), keywords: list('keywords', 80, true), target_locations: list('target_locations', 80),
    reasoning: string('reasoning', 600, false) };
}

export function withoutCampaignTemplates(plan: CampaignPlan): CampaignPlan {
  const campaigns = plan.campaigns.filter(campaign => !(campaign.origin === 'suggested' &&
    campaign.reasoning.startsWith('Suggested fit: the researched offering includes ')));
  return { ...plan, campaigns, selected_ids: plan.selected_ids.filter(id => campaigns.some(c => c.id === id)) };
}

export const CAMPAIGN_GENERATION_VERSION = 2;
// These are targeting hypotheses, activated by the offering's actual vocabulary.
// Each tuple supplies a distinct audience, use case, possible pain and search terms.
type AudienceIdea = [audience: string, goal: string, pain: string, keywords: string];
type AudienceFamily = { signal: RegExp; industry: string; ideas: AudienceIdea[] };
const audienceFamilies: AudienceFamily[] = [
  { signal: /\b(esl|efl|language learning|vocabulary|grammar|language teaching)\b|\benglish\b.{0,50}\b(learn\w*|teach\w*|courses?|lessons?|practice)\b/i, industry: 'Language education', ideas: [
    ['Language schools', 'add guided practice between lessons', 'Keeping learners engaged outside scheduled classes', 'language school,language courses'],
    ['ESL teachers', 'build vocabulary and speaking activities into lessons', 'Preparing varied exercises for learners at different levels', 'ESL teacher,English teaching'],
    ['Private language tutors', 'personalize practice for individual learners', 'Adapting homework to each learner without excessive preparation', 'English tutor,private language tuition'],
    ['Parents supporting language learning', 'support language practice at home', 'Finding practice that children will use consistently', 'parents,home language learning'],
    ['Independent language learners', 'practice language skills on a regular schedule', 'Maintaining motivation and choosing suitable exercises', 'self study,language learners'],
    ['Corporate language trainers', 'support workplace language practice', 'Fitting relevant practice around employees’ work schedules', 'business English,corporate language training'],
  ] },
  { signal: /\b(no[- ]code|low[- ]code|app builder|website builder|internal tools)\b|build.{0,70}(apps|applications|software)|software.{0,80}build/i, industry: 'Software development', ideas: [
    ['Startup founders', 'prototype and validate a digital product', 'Testing an idea before committing to a full development team', 'startup founders,MVP development'],
    ['Digital agencies', 'deliver client websites and applications', 'Balancing client revisions with limited delivery capacity', 'digital agency,web development agency'],
    ['Operations teams', 'create internal workflow applications', 'Replacing fragmented spreadsheets and repetitive manual processes', 'business operations,internal tools'],
    ['Product teams', 'turn product concepts into working prototypes', 'Obtaining useful feedback before a lengthy implementation cycle', 'product team,rapid prototyping'],
    ['Independent creators', 'build and launch their own digital products', 'Bringing an idea online with limited development resources', 'indie makers,independent creators'],
    ['Small business owners', 'build customer-facing digital tools', 'Improving digital services without a dedicated engineering team', 'small business,digital services'],
  ] },
  { signal: /\b(education|learning|teaching|courses|curriculum|training|tutoring)\b/i, industry: 'Education and training', ideas: [
    ['Independent teachers', 'adapt learning material for their lessons', 'Preparing relevant activities for different learner needs', 'teachers,lesson resources'],
    ['Training providers', 'support learners throughout a course', 'Maintaining participation between scheduled training sessions', 'training provider,professional courses'],
    ['Schools and educational institutions', 'support teaching across classes', 'Coordinating consistent learning resources across educators', 'schools,educational institutions'],
    ['Parents and home educators', 'support learning outside school', 'Choosing accessible practice for a child’s learning needs', 'home education,parents'],
    ['Self-directed learners', 'develop skills independently', 'Finding a manageable path through unfamiliar material', 'independent learning,self study'],
    ['Workplace learning teams', 'support employee skill development', 'Making training useful within day-to-day work', 'employee training,learning and development'],
  ] },
  { signal: /\b(ecommerce|e-commerce|online store|retail|merchants|shopping)\b/i, industry: 'Retail and commerce', ideas: [
    ['Independent online retailers', 'improve their online store operations', 'Managing a growing store with limited staff', 'online retailer,ecommerce store'],
    ['Direct-to-consumer brands', 'improve the customer buying experience', 'Coordinating customer experience across sales touchpoints', 'DTC brand,direct to consumer'],
    ['Local retailers selling online', 'connect in-store and online sales', 'Introducing digital processes alongside existing shop operations', 'local retailer,online shop'],
    ['Marketplace sellers', 'manage repeatable selling workflows', 'Keeping product and customer operations consistent', 'marketplace seller,online seller'],
    ['Commerce agencies', 'support clients’ commerce projects', 'Adapting processes to different merchants’ needs', 'ecommerce agency,commerce consultancy'],
    ['Retail operations teams', 'coordinate routine store processes', 'Reducing duplicated work across retail functions', 'retail operations,store management'],
  ] },
  { signal: /\b(marketing|advertising|campaigns|lead generation|content creation|seo)\b/i, industry: 'Marketing and communications', ideas: [
    ['Independent marketers', 'deliver campaigns for their clients', 'Managing research and execution with limited time', 'freelance marketer,marketing consultant'],
    ['Marketing agencies', 'coordinate campaign delivery across clients', 'Repeating manual campaign work across multiple accounts', 'marketing agency,digital agency'],
    ['In-house marketing teams', 'support ongoing marketing programs', 'Connecting campaign planning with practical execution', 'marketing team,brand marketing'],
    ['Content creators', 'support a consistent publishing process', 'Producing relevant material while managing other responsibilities', 'content creator,independent publisher'],
    ['Small business owners', 'manage customer acquisition activities', 'Running marketing without a dedicated specialist team', 'small business,customer acquisition'],
    ['Sales development teams', 'research and prioritize prospective customers', 'Spending time on prospects with unclear relevance', 'sales development,B2B prospecting'],
  ] },
];
const audienceWords = /\b(schools?|teachers?|tutors?|learners?|students?|parents?|families|consumers?|individuals?|creators?|developers?|founders?|owners?|teams?|agencies|providers?|retailers?|manufacturers?|clinics?|hospitals?|enterprises?|startups?|organizations?|institutions?|universities|professionals?|freelancers?|consultants?|businesses|companies|hobbyists?|children|adults|educators?)\b/i;

export function generateCampaigns(profile: CampaignProfile): CampaignPlan {
  const products = (profile.products || []).filter(p => text(p.name));
  const productText = `${profile.business_description || ''} ${products.map(p => `${p.name} ${p.description || ''}`).join(' ')}`.trim();
  const offering = text(profile.company_name, 80) || text(products[0]?.name, 80) || 'the researched offering';
  const context = text(profile.business_description || products.map(p => p.description || p.name).join('; '), 240);
  const sourceUrls = unique(profile.source_urls || []).slice(0, 10);
  const productKeywords = unique(products.map(p => text(p.name, 80))).slice(0, 3);
  const candidates: (Campaign & { score: number })[] = [];
  const family = audienceFamilies.find(rule => rule.signal.test(profile.business_description || '')) ||
    audienceFamilies.find(rule => rule.signal.test(productText));
  const add = (idea: AudienceIdea, industry: string, basis: 'observed' | 'inferred', evidence: string, sources: string[], score: number) => {
    if (!productText) return;
    const [audience, goal, pain, keywords] = idea;
    candidates.push({ id: crypto.randomUUID(), name: text(audience, 100), target_audience: text(audience, 160), target_industry: industry,
      ideal_customer: text(`${audience} looking to ${goal}. Evaluate ${offering} against this need. Researched offering: ${context}`),
      keywords: unique([...keywords.split(','), ...productKeywords].map(value => text(value, 80))).slice(0, 10), target_locations: [],
      reasoning: text(`${basis === 'observed' ? 'Audience observed in company research.' : 'Inferred audience suggestion; not a confirmed customer segment.'} ${evidence} The proposed use case and pain point need validation.`),
      source_urls: unique(sources).slice(0, 15), origin: 'suggested', audience_basis: basis, evidence_summary: text(evidence),
      pain_points: [`Potential pain to validate: ${pain}.`],
      criteria: [`Audience: ${audience}`, `Use case to validate: ${goal}`, `Evaluate fit with ${offering}'s researched products`], score });
  };
  // Named customer logos are evidence, not customer segments. Consumers and
  // individuals are valid audiences; no business-only exclusion is applied.
  for (const audience of (profile.customers || [])) {
    if (!audienceWords.test(audience.name)) continue;
    const sources = audience.source_urls?.length ? audience.source_urls : sourceUrls;
    const matched = family?.ideas.find(idea => tokens(idea[0]).some(word => tokens(audience.name).includes(word)));
    const idea: AudienceIdea = matched ? [audience.name, matched[1], matched[2], matched[3]] :
      [audience.name, `address the needs described for ${audience.name.toLowerCase()}`,
        `Choosing an offering suited to ${text(audience.description || audience.name, 160)}`, audience.name];
    add(idea, family?.industry || '', sources.length ? 'observed' : 'inferred',
      `Saved audience evidence: ${text(audience.description || audience.name, 220)}.`, sources, 30);
  }
  const competitors = (profile.competitor_research?.results || []).filter(c => c.relationship === 'direct').slice(0, 5);
  for (const competitor of competitors) {
    for (const audience of (competitor.customers || [])) {
      if (!audienceWords.test(audience.name)) continue;
      add([audience.name, `evaluate an alternative to ${competitor.name || competitor.domain}`,
        'Assessing whether an alternative better fits their needs', audience.name], '', 'inferred',
      `This audience appears in saved research for direct competitor ${competitor.domain}: ${text(audience.description || audience.name, 180)}.`,
      [...sourceUrls, ...(audience.source_urls || competitor.source_urls)], 25);
    }
  }
  for (const idea of family?.ideas || []) {
    add(idea, family!.industry, 'inferred', `Suggested from the researched offering: ${context}`, sourceUrls, 20);
  }
  // Unknown categories still get offering-specific hypotheses rather than an
  // unrelated industry template. These are explicitly proposed buying contexts.
  const topic = text(products[0]?.name, 55) || text(profile.company_name, 55) || 'this offering';
  const fallback: AudienceIdea[] = [
    [`First-time buyers of ${topic}`, `evaluate ${topic} for a first purchase`, 'Understanding fit and setup before committing', `${topic},getting started`],
    [`Experienced users of ${topic}`, `improve their existing use of ${topic}`, 'Finding a better fit for an established need', `${topic},advanced use`],
    [`People evaluating alternatives to ${topic}`, `compare approaches to the needs served by ${topic}`, 'Comparing suitability and switching effort', `${topic},alternatives`],
    [`Advisers evaluating ${topic}`, `help others assess ${topic}`, 'Explaining tradeoffs for different user needs', `${topic},consulting`],
  ];
  for (const idea of fallback) add(idea, '', 'inferred', `Buying-context hypothesis based on: ${context}`, sourceUrls, 1);
  const seen = new Set<string>();
  const campaigns = candidates.sort((a, b) => b.score - a.score).filter(candidate => {
    const key = tokens(candidate.target_audience).join(' ').replace(/s\b/g, '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 6).map(({ score: _score, ...campaign }) => campaign);
  return { status: 'completed', version: 0, generation_version: CAMPAIGN_GENERATION_VERSION,
    campaigns, selected_ids: campaigns.length ? [campaigns[0].id] : [],
    warnings: campaigns.length ? [] : ['The saved research contains no product or business description to support campaign suggestions.'] };
}

export function campaignTargets(profile: CampaignProfile, plan: CampaignPlan) {
  const excluded_domains = unique([...profile.source_urls, ...profile.competitor_research.results.flatMap(c => c.source_urls)]
    .flatMap(url => { try { return [businessDomain(url)]; } catch { return []; } }));
  const saved = withoutCampaignTemplates(plan);
  return saved.campaigns.filter(campaign => saved.selected_ids.includes(campaign.id)).map(campaign => ({
    campaign_id: campaign.id, project_id: profile.project_id, research_job_id: profile.job_id, plan_version: plan.version,
    name: campaign.name, audience: campaign.target_audience, industry: campaign.target_industry || null,
    ideal_customer: campaign.ideal_customer, keywords: campaign.keywords, locations: campaign.target_locations,
    reasoning: campaign.reasoning, source_urls: campaign.source_urls, excluded_domains,
  }));
}
