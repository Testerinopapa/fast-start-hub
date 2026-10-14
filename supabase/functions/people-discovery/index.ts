import { adminClient, authenticate, endpoint, json, readBody, type Admin } from '../_shared/backend.ts';
import { firecrawl } from '../_shared/firecrawl.ts';
import { isUuid, ResearchError } from '../_shared/research-core.ts';
import { eligibleCompanies, expired, extractPeople, freshPeople, peopleExtraction, peoplePages, peopleQuery,
  peopleSnapshot, resumable, savedCompanies, unfinished, type PeopleProfile, type PeopleState } from '../_shared/people-core.ts';

async function save(db: Admin, profile: PeopleProfile, campaignId: string, state: PeopleState) {
  const { data, error } = await db.rpc('autogtm_save_people', { p_job: profile.job_id, p_owner: profile.owner_id,
    p_campaign: campaignId, p_domain: state.domain, p_version: state.version, p_state: state });
  if (error) {
    if (error.message?.includes('COMPANY_SELECTION_CHANGED')) throw new ResearchError('SELECTION_CHANGED', 'The saved company selection changed. Reload Phase 4.', 409);
    if (error.message?.includes('PEOPLE_LIMIT')) throw new ResearchError('PEOPLE_LIMIT', 'The ten-company research limit has been reached. Reload saved contacts.', 409);
    throw new ResearchError('SAVE_FAILED', 'Could not save decision-maker research. Reload saved progress before trying again.', 503);
  }
  const result = data as { applied: boolean; state: PeopleState };
  profile.people_discovery[state.domain] = result.state;
  return result;
}
const notes = (state: PeopleState, values: string[]) => [...new Set([...state.warnings, ...values])].slice(-15);

export const handler = endpoint(async req => {
  const db = adminClient();
  const { ownerId } = await authenticate(req, db);
  const body = await readBody(req);
  if (!isUuid(body.job_id) || !isUuid(body.campaign_id)) throw new ResearchError('INVALID_REQUEST', 'A research job and saved campaign are required.');
  const jobId = body.job_id, campaignId = body.campaign_id;
  const action = body.action || 'load';
  if (!['load', 'advance', 'resume'].includes(String(action))) throw new ResearchError('INVALID_REQUEST', 'Unknown contact research action.');
  const { data, error } = await db.from('company_profiles').select('*').eq('job_id', jobId).eq('owner_id', ownerId).maybeSingle();
  if (error) throw new ResearchError('DATABASE_UNAVAILABLE', 'Could not load saved decision makers.', 503);
  if (!data) throw new ResearchError('NOT_FOUND', 'This research project was not found.', 404);
  if (!Object.hasOwn(data, 'people_discovery')) throw new ResearchError('NOT_DEPLOYED', 'The Phase 5 database migration has not been deployed.', 503);
  const profile = data as PeopleProfile;
  const { companies, target } = savedCompanies(profile, campaignId);
  const eligible = eligibleCompanies(profile, companies);
  if (action === 'load') return json(peopleSnapshot(profile, campaignId));
  const failed = eligible.find(company => profile.people_discovery[company.domain]?.status === 'failed');
  if (failed) {
    const previous = profile.people_discovery[failed.domain];
    if (action === 'resume') await save(db, profile, campaignId, { ...previous, working: false, error: null,
      status: resumable(previous) ? previous.searches_used < 1 ? 'searching' : 'researching' : 'completed',
      warnings: notes(previous, ['Continuing with the remaining budget; unsuccessful requests are not repeated.']) });
    return json(peopleSnapshot(profile, campaignId));
  }
  const company = eligible.find(company => unfinished(profile.people_discovery[company.domain]));
  if (!company) return json(peopleSnapshot(profile, campaignId));
  let state = profile.people_discovery[company.domain] || freshPeople(company.domain);
  if (state.working && !expired(state)) return json(peopleSnapshot(profile, campaignId));
  const searching = state.searches_used < 1;
  const url = state.urls[state.pages_attempted];
  if (!searching && !url) {
    await save(db, profile, campaignId, { ...state, status: 'completed', working: false,
      warnings: notes(state, state.working ? ['An interrupted request consumed its reservation and was not repeated.'] : []) });
    return json(peopleSnapshot(profile, campaignId));
  }
  // Reserve one provider request before sending it. Concurrent tabs and refreshes
  // cannot duplicate paid work; abandoned reservations consume their budget.
  const claim = await save(db, profile, campaignId, { ...state, working: true,
    warnings: notes(state, state.working ? ['An interrupted request was counted and not repeated.'] : []),
    searches_used: state.searches_used + Number(searching), pages_attempted: state.pages_attempted + Number(!searching) });
  if (!claim.applied) return json(peopleSnapshot(profile, campaignId));
  state = claim.state;
  try {
    if (searching) {
      const query = peopleQuery(company.domain);
      const response = await firecrawl('/search', { query, limit: 5, sources: ['web'] });
      if (!Array.isArray(response.data?.web)) throw new ResearchError('PROVIDER_RESPONSE', 'Contact page search returned an unreadable result.', 502);
      const urls = peoplePages(company.domain, response.data.web, [...company.source_urls, `https://${company.domain}/`]);
      console.info(JSON.stringify({ event: 'autogtm.people.search', domain: company.domain, query, result_count: response.data.web.length, pages_selected: urls.length }));
      await save(db, profile, campaignId, { ...state, urls, working: false, status: urls.length ? 'researching' : 'completed',
        warnings: notes(state, urls.length ? [] : ['No accessible company pages were discovered.']) });
    } else {
      const response = await firecrawl('/scrape', { url, onlyMainContent: true, formats: ['markdown', peopleExtraction], parsers: [], timeout: 30000 }, 45000);
      const extraction = extractPeople(state, url, response.data, target);
      const visited = state.urls.slice(0, state.pages_attempted);
      const remaining = peoplePages(company.domain, [...state.urls.slice(state.pages_attempted), ...extraction.links], [])
        .filter(link => !visited.includes(link));
      const urls = [...visited, ...remaining].slice(0, 2);
      console.info(JSON.stringify({ event: 'autogtm.people.page', domain: company.domain, url, contacts: extraction.results.length, warnings: extraction.warnings }));
      await save(db, profile, campaignId, { ...state, urls, results: extraction.results, working: false,
        status: state.pages_attempted >= urls.length ? 'completed' : 'researching', warnings: notes(state, extraction.warnings) });
    }
  } catch (error) {
    if (error instanceof ResearchError && ['SAVE_FAILED', 'SELECTION_CHANGED', 'PEOPLE_LIMIT'].includes(error.code)) throw error;
    const known = error instanceof ResearchError;
    const sourceBlocked = !searching && known && ['SOURCE_UNSUPPORTED', 'SOURCE_RESTRICTED'].includes(error.code);
    const message = known ? error.message : 'Decision-maker research was interrupted. Saved contacts remain available.';
    await save(db, profile, campaignId, { ...state, working: false,
      status: sourceBlocked ? state.pages_attempted >= state.urls.length ? 'completed' : 'researching' : 'failed',
      error: sourceBlocked ? null : message, warnings: notes(state, [`${searching ? 'Search' : url}: ${message}`]) });
  }
  return json(peopleSnapshot(profile, campaignId));
});
if (import.meta.main) Deno.serve(handler);
