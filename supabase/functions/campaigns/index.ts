import { adminClient, authenticate, endpoint, json, readBody, type Admin } from '../_shared/backend.ts';
import { campaignFields, campaignTargets, withoutCampaignTemplates, type Campaign, type CampaignPlan, type CampaignProfile } from '../_shared/campaigns-core.ts';
import { CAMPAIGN_MODEL, campaignApiKey, campaignContext, generateAiCampaigns, type Generation } from '../_shared/campaigns-ai.ts';
import { isUuid, ResearchError } from '../_shared/research-core.ts';

async function save(db: Admin, profile: CampaignProfile, version: number, plan: CampaignPlan) {
  const { data, error } = await db.rpc('autogtm_save_campaigns', { p_job: profile.job_id, p_owner: profile.owner_id, p_version: version, p_plan: plan });
  if (error) throw new ResearchError('SAVE_FAILED', 'Could not save campaigns. Retry to load the saved plan.', 503);
  return data as { applied: boolean; plan: CampaignPlan };
}
export const handler = endpoint(async (req) => {
  const db = adminClient();
  const { ownerId } = await authenticate(req, db);
  const body = await readBody(req);
  if (!isUuid(body.job_id)) throw new ResearchError('INVALID_REQUEST', 'A company research job ID is required.');
  const action = body.action || 'load';
  if (!['load', 'regenerate', 'create', 'update', 'delete', 'select'].includes(String(action))) throw new ResearchError('INVALID_REQUEST', 'Unknown campaign action.');
  const { data, error } = await db.from('company_profiles').select('*').eq('job_id', body.job_id).eq('owner_id', ownerId).maybeSingle();
  if (error) throw new ResearchError('DATABASE_UNAVAILABLE', 'Could not load campaigns.', 503);
  if (!data) throw new ResearchError('NOT_FOUND', 'Company research was not found for this project.', 404);
  if (!Object.hasOwn(data, 'campaign_plan')) throw new ResearchError('NOT_DEPLOYED', 'The Phase 3 database migration has not been deployed.', 503);
  const profile = data as CampaignProfile;
  if (profile.competitor_research?.status !== 'completed') throw new ResearchError('RESEARCH_PENDING', 'Finish competitor research before defining campaigns.', 409);
  const { data: job } = await db.from('research_jobs').select('status').eq('id', profile.job_id).eq('owner_id', ownerId).maybeSingle();
  if (job?.status !== 'completed') throw new ResearchError('RESEARCH_PENDING', 'Finish company research before defining campaigns.', 409);
  const { data: project, error: projectError } = await db.from('projects').select('*').eq('id', profile.project_id).eq('owner_id', ownerId).maybeSingle();
  if (projectError || !project) throw new ResearchError('DATABASE_UNAVAILABLE', 'Could not load campaign generation state.', 503);
  if (!Object.hasOwn(project, 'campaign_generation')) throw new ResearchError('NOT_DEPLOYED', 'The AI campaign generation migration has not been deployed.', 503);
  let generation = project.campaign_generation as Generation | null;
  let plan: CampaignPlan = profile.campaign_plan || { status: 'completed', version: 0, campaigns: [], selected_ids: [], warnings: [] };
  if (!profile.campaign_plan) plan = (await save(db, profile, 0, plan)).plan;
  const cleaned = withoutCampaignTemplates(plan);
  if (cleaned.campaigns.length !== plan.campaigns.length) {
    plan = withoutCampaignTemplates((await save(db, profile, plan.version, cleaned)).plan);
  }
  let generationError: string | null = null;
  const stale = generation?.status === 'running' && Date.now() - Date.parse(generation.started_at) > 120000;
  if (action === 'regenerate' || (action === 'load' && ((body.auto_generate === true && !generation?.auto_attempted) || stale))) {
    if (action === 'regenerate' && (!isUuid(body.request_id) || !Number.isInteger(body.version))) throw new ResearchError('INVALID_REQUEST', 'A regeneration request ID and saved version are required.');
    // Validate prerequisites before reserving; no provider request occurs for
    // missing configuration or an empty research profile.
    let key = '';
    try {
      if (!stale || action === 'regenerate') {
        key = campaignApiKey(); campaignContext(profile);
        if (plan.campaigns.filter(c => c.origin !== 'suggested').length > 8) throw new ResearchError('CAMPAIGN_LIMIT', 'Keep at most eight custom or edited campaigns to leave room for four suggestions.');
      }
      const { data: claim, error: claimError } = await db.rpc('autogtm_claim_campaign_generation', {
        p_job: profile.job_id, p_owner: ownerId, p_mode: action === 'regenerate' ? 'explicit' : 'auto',
        p_request: action === 'regenerate' ? body.request_id : crypto.randomUUID(),
        p_version: action === 'regenerate' ? body.version : plan.version, p_model: CAMPAIGN_MODEL,
      });
      if (claimError) {
        if (claimError.message.includes('CAMPAIGN_CONFLICT')) throw new ResearchError('CONFLICT', 'Campaigns changed in another tab. Reload before regenerating.', 409);
        if (claimError.message.includes('CAMPAIGN_LIMIT')) throw new ResearchError('CAMPAIGN_LIMIT', 'Keep at most eight custom campaigns to leave room for new suggestions.');
        throw new ResearchError('SAVE_FAILED', 'Could not reserve campaign generation. No model request was sent.', 503);
      }
      plan = claim.plan; generation = claim.generation;
      if (claim.claimed) {
        let campaigns: Campaign[] | null = null, failure: string | null = null;
        try { campaigns = await generateAiCampaigns({ ...profile, campaign_plan: plan }, key); }
        catch (error) { failure = error instanceof ResearchError ? error.message : 'Campaign generation was interrupted. Your saved campaigns are unchanged.'; }
        const { data: finished, error: finishError } = await db.rpc('autogtm_finish_campaign_generation', {
          p_job: profile.job_id, p_owner: ownerId, p_request: generation!.request_id, p_campaigns: campaigns, p_error: failure,
        });
        if (finishError) throw new ResearchError('SAVE_FAILED', 'Could not finish saving campaign generation. Reload saved progress; the model request will not be repeated automatically.', 503);
        plan = finished.plan; generation = finished.generation;
      }
    } catch (error) {
      generationError = error instanceof ResearchError ? error.message : 'Campaign generation is unavailable. Your saved campaigns are unchanged.';
    }
  }
  if (!['load', 'regenerate'].includes(String(action))) {
    if (!Number.isInteger(body.version) || body.version !== plan.version) throw new ResearchError('CONFLICT', 'Campaigns changed in another tab. Reload the latest plan before saving.', 409);
    let campaigns = plan.campaigns;
    let selected_ids = plan.selected_ids;
    if (action === 'create') {
      if (campaigns.length >= 12) throw new ResearchError('CAMPAIGN_LIMIT', 'Keep up to 12 campaigns per research project.');
      if (!isUuid(body.campaign_id)) throw new ResearchError('INVALID_REQUEST', 'A unique campaign ID is required.');
      if (campaigns.some(c => c.id === body.campaign_id)) throw new ResearchError('CONFLICT', 'This campaign already exists. Reload the saved plan.', 409);
      const campaign: Campaign = { ...campaignFields(body.campaign), id: body.campaign_id, origin: 'custom', source_urls: [] };
      campaigns = [...campaigns, campaign];
    } else if (action === 'update' || action === 'delete') {
      const current = campaigns.find(c => c.id === body.campaign_id);
      if (!current) throw new ResearchError('NOT_FOUND', 'This campaign is no longer in the project.', 404);
      if (action === 'update') campaigns = campaigns.map(c => c.id === current.id ? { ...c, ...campaignFields(body.campaign),
        origin: 'customized', audience_basis: undefined, evidence_summary: undefined } : c);
      else { campaigns = campaigns.filter(c => c.id !== current.id); selected_ids = selected_ids.filter(id => id !== current.id); }
    } else if (action === 'select') {
      if (!Array.isArray(body.selected_ids) || body.selected_ids.length > 12 || body.selected_ids.some(id => !campaigns.some(c => c.id === id))) {
        throw new ResearchError('INVALID_CAMPAIGN', 'Select only campaigns belonging to this project.');
      }
      selected_ids = [...new Set(body.selected_ids as string[])];
    }
    const result = await save(db, profile, plan.version, { ...plan, campaigns, selected_ids });
    if (!result.applied) throw new ResearchError('CONFLICT', 'Campaigns changed in another tab. Reload the latest plan before saving.', 409);
    plan = result.plan;
  }
  const generationNotice = generation?.job_id !== profile.job_id && generation?.auto_attempted
    ? 'Automatic generation was already used for this project. Regenerate explicitly to use this research.' : null;
  return json({ job_id: profile.job_id, project_id: profile.project_id, plan, targets: campaignTargets(profile, plan), generation,
    generation_error: generationError || (generation?.status === 'failed' ? generation.error : null), generation_notice: generationNotice });
});
if (import.meta.main) Deno.serve(handler);
