// Earlier generated plans could contain the fixed language-learning template.
// Keep researched audiences and user-created/edited campaigns only.
export function withoutCampaignTemplates(plan) {
  if (!plan) return plan;
  const campaigns = (plan.campaigns || []).filter(campaign => campaign && campaign.id && campaign.name &&
    campaign.target_audience && campaign.ideal_customer &&
    !(campaign.origin === 'suggested' && campaign.reasoning?.startsWith('Suggested fit: the researched offering includes ')));
  const ids = new Set(campaigns.map(campaign => campaign.id));
  return { ...plan, campaigns, selected_ids: (plan.selected_ids || []).filter(id => ids.has(id)) };
}

export function campaignSegments(plan) {
  const saved = withoutCampaignTemplates(plan);
  return (saved?.campaigns || []).map(campaign => ({
    id: campaign.id, label: campaign.name, dataSource: 'research',
    icon: /education|tutor|language/i.test(campaign.target_industry) ? 'graduation-cap' : 'building',
    useCase: campaign.ideal_customer, pain: campaign.reasoning,
    criteria: [campaign.target_audience, campaign.target_industry,
      campaign.target_locations?.length ? `Locations: ${campaign.target_locations.join(', ')}` : '',
    ].filter(Boolean),
    keywords: campaign.keywords || [], exampleClients: [], sourceUrls: campaign.source_urls || [],
    selected: saved.selected_ids.includes(campaign.id), count: '—', percentage: null, estimatedCompanies: null,
  }));
}
