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
const unique = (values: string[]) => [...new Map(values.filter(Boolean).map(v => [v.toLocaleLowerCase(), v])).values()];

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

export function isGenericCampaignAudience(value: string): boolean {
  return /^(?:first[- ]time buyers of|experienced users of|people evaluating alternatives (?:to|of)|advisers evaluating(?: of)?)\s+/i.test(value.trim());
}

export function withoutCampaignTemplates(plan: CampaignPlan): CampaignPlan {
  const campaigns = plan.campaigns.filter(campaign => !(campaign.origin === 'suggested' &&
    (campaign.reasoning.startsWith('Suggested fit: the researched offering includes ') ||
      isGenericCampaignAudience(campaign.name) || isGenericCampaignAudience(campaign.target_audience))));
  return { ...plan, campaigns, selected_ids: plan.selected_ids.filter(id => campaigns.some(c => c.id === id)) };
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

