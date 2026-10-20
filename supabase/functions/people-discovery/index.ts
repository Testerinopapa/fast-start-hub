import { adminClient, authenticate, endpoint, json, readBody, type Admin } from '../_shared/backend.ts';
import { contextSearch, contextScrape } from '../_shared/context-dev.ts';
import { isUuid, ResearchError } from '../_shared/research-core.ts';
import { diagnosticState, eligibleCompanies, expired, extractPeople, freshPeople, nextPeopleStatus, peopleExtraction, peoplePages, peopleQuery,
  peopleSnapshot, resumable, savedCompanies, unfinished, type PeopleDiagnostic, type PeopleProfile, type PeopleState } from '../_shared/people-core.ts';

async function save(db: Admin, profile: PeopleProfile, campaignId: string, state: PeopleState) {
  const { data, error } = await db.rpc('autogtm_save_people', { p_job: profile.job_id, p_owner: profile.owner_id,
    p_campaign: campaignId, p_domain: state.domain, p_version: state.version, p_state: state });
  if (error) {
    if (error.message?.includes('COMPANY_SELECTION_CHANGED')) throw new ResearchError('SELECTION_CHANGED', 'The saved company selection changed. Reload Phase 4.', 409);
    if (error.message?.includes('PEOPLE_LIMIT_OR_INVALID_CONTACT')) throw new ResearchError('SAVE_FAILED', 'Contact research exceeded the deployed database limits or returned an invalid record. Confirm the latest Phase 5 migration is deployed.', 503);
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
  // One bounded upgrade for old empty runs. Keep all consumed reservations and
  // old URLs; v2 gets only the unused portion of two searches/four total pages.
  for (const company of eligible) {
    const previous = profile.people_discovery[company.domain];
    if (!previous || previous.discovery_version === 2 || (previous.working && !expired(previous))) continue;
    const retryEmpty = previous.status === 'completed' && !previous.results.length && previous.searches_used < 2 && previous.pages_attempted < 4;
    await save(db, profile, campaignId, diagnosticState({ ...previous, discovery_version: 2,
      status: retryEmpty ? 'searching' : previous.status, working: retryEmpty ? false : previous.working,
    }, [{ stage: 'upgrade', outcome: retryEmpty ? 'broader_search_pending' : 'cached',
      reason: retryEmpty ? 'Legacy empty run reopened once for broader sources; previous requests remain counted. Historical raw responses and individual rejections were not retained.' : 'Existing results and consumed request counts preserved.' }]));
  }
  if (action === 'load') return json(peopleSnapshot(profile, campaignId));
  const failed = eligible.find(company => profile.people_discovery[company.domain]?.status === 'failed');
  if (failed) {
    const previous = profile.people_discovery[failed.domain];
    if (action === 'resume') await save(db, profile, campaignId, { ...previous, working: false, error: null,
      status: resumable(previous) ? previous.pages_attempted < previous.urls.length ? 'researching' : 'searching' : 'completed',
      warnings: notes(previous, ['Continuing with the remaining budget; unsuccessful requests are not repeated.']) });
    return json(peopleSnapshot(profile, campaignId));
  }
  const company = eligible.find(company => unfinished(profile.people_discovery[company.domain]));
  if (!company) return json(peopleSnapshot(profile, campaignId));
  let state = profile.people_discovery[company.domain] || freshPeople(company.domain);
  if (state.working && !expired(state)) return json(peopleSnapshot(profile, campaignId));
  const searching = state.searches_used < 1 || (state.status === 'searching' && state.searches_used < 2);
  const url = state.urls[state.pages_attempted];
  if (!searching && !url) {
    await save(db, profile, campaignId, { ...state, status: nextPeopleStatus(state), working: false,
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
      const query = peopleQuery(company, target, state.searches_used - 1);
      const response = await contextSearch(query, { limit: 5 });
      if (!Array.isArray(response.results)) throw new ResearchError('PROVIDER_RESPONSE', 'Contact page search returned an unreadable result.', 502);
      const events: PeopleDiagnostic[] = [];
      const pages = peoplePages(state, response.results, [...company.source_urls, `https://${company.domain}/`], events);
      const urls = [...state.urls.slice(0, state.pages_attempted), ...pages];
      const next = diagnosticState({ ...state, urls, working: false }, [{ stage: 'search', outcome: 'completed', query,
        result_count: response.results.length, accepted_count: pages.length, reason: 'Search responses ranked by source credibility and leadership relevance; retained public result titles and URLs.' }, ...events]);
      await save(db, profile, campaignId, { ...next, status: nextPeopleStatus(next),
        warnings: notes(state, pages.length ? [] : ['Search found no eligible unvisited source pages. See rejection reasons in Research notes.']) });
    } else {
      const page = await contextScrape(url, peopleExtraction(company));
      const extraction = extractPeople(state, url, page, target, company);
      const visited = state.urls.slice(0, state.pages_attempted);
      const events: PeopleDiagnostic[] = [];
      const enriched = { ...state, company_linked_sources: extraction.companyLinked };
      // Keep this search's two-page allowance; a fallback search can add two more.
      const remainingSlots = Math.max(0, state.urls.length - state.pages_attempted);
      const remaining = remainingSlots ? peoplePages(enriched, [...state.urls.slice(state.pages_attempted), ...extraction.links.slice(0, 40)], [], events).slice(0, remainingSlots) : [];
      const next = diagnosticState({ ...enriched, urls: [...visited, ...remaining], results: extraction.results, working: false,
        warnings: notes(state, extraction.warnings) }, [...events, ...extraction.events]);
      await save(db, profile, campaignId, { ...next, status: nextPeopleStatus(next) });
    }
  } catch (error) {
    if (error instanceof ResearchError && ['SAVE_FAILED', 'SELECTION_CHANGED', 'PEOPLE_LIMIT'].includes(error.code)) throw error;
    const known = error instanceof ResearchError;
    const sourceBlocked = !searching && known && ['SOURCE_UNSUPPORTED', 'SOURCE_RESTRICTED'].includes(error.code);
    const message = known ? error.message : 'Decision-maker research was interrupted. Saved contacts remain available.';
    const next = diagnosticState(state, [{ stage: 'provider', outcome: 'error',
      ...(searching ? { query: peopleQuery(company, target, state.searches_used - 1) } : { url }), reason: message }]);
    await save(db, profile, campaignId, { ...next, working: false,
      status: sourceBlocked ? nextPeopleStatus(state) : 'failed',
      error: sourceBlocked ? null : message, warnings: notes(state, [`${searching ? 'Search' : url}: ${message}`]) });
  }
  return json(peopleSnapshot(profile, campaignId));
});
if (import.meta.main) Deno.serve(handler);
