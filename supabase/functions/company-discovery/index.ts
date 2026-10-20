import { adminClient, authenticate, endpoint, json, readBody, secret, type Admin } from '../_shared/backend.ts';
import { contextSearch, contextScrape } from '../_shared/context-dev.ts';
import { isUuid, ResearchError } from '../_shared/research-core.ts';
import { canResume, candidateResults, discoveryCandidates, discoveryExtraction, discoverySnapshot, enrichCompany, newDiscovery, running, stale,
  targetFor, targetSignature, upgradeDiscovery, withDiagnostics, type Discovery, type DiscoveryEvent, type DiscoveryProfile } from '../_shared/discovery-core.ts';

async function save(db: Admin, profile: DiscoveryProfile, campaignId: string, version: number, state: Discovery) {
  const { data, error } = await db.rpc('autogtm_save_discovery', { p_job: profile.job_id, p_owner: profile.owner_id,
    p_campaign: campaignId, p_version: version, p_plan_version: profile.campaign_plan!.version, p_state: state });
  if (error) {
    if (error.message?.includes('CAMPAIGN_CHANGED')) throw new ResearchError('CAMPAIGN_CHANGED', 'The campaign changed in another tab. Reload its saved criteria.', 409);
    throw new ResearchError('SAVE_FAILED', 'Could not save company discovery. Reload saved progress before trying again.', 503);
  }
  return data as { applied: boolean; state: Discovery };
}
const warning = (state: Discovery, message: string) => [...new Set([...state.warnings, message])].slice(-10);

// One logical provider operation per advance. Reserve its budget before sending
// it; Context retries only explicit transient HTTP responses, not lost responses.
async function advance(db: Admin, profile: DiscoveryProfile, campaignId: string, state: Discovery): Promise<Discovery> {
  if (!running(state) || (state.working && !stale(state))) return state;
  secret('CONTEXT_DEV_API_KEY');
  const interrupted = state.working ? warning(state, 'An interrupted request was counted toward the limit and was not repeated.') : state.warnings;
  const search = state.searches_used < state.queries.length;
  const candidate = state.candidates[state.pages_attempted];
  if (!search && !candidate) return (await save(db, profile, campaignId, state.version, {
    ...state, status: 'completed', working: false, warnings: interrupted,
  })).state;
  const claim = await save(db, profile, campaignId, state.version, { ...state,
    status: search ? 'searching' : 'researching', working: true, warnings: interrupted,
    searches_used: state.searches_used + Number(search), pages_attempted: state.pages_attempted + Number(!search),
    error: null, error_code: null });
  if (!claim.applied) return claim.state;
  const query = state.queries[state.searches_used];
  state = claim.state;
  try {
    if (search) {
      const links = (await contextSearch(query)).results;
      if (!Array.isArray(links)) throw new ResearchError('PROVIDER_RESPONSE', 'Company search returned unreadable results.', 502);
      const events: DiscoveryEvent[] = [];
      const candidates = discoveryCandidates(state, links, events);
      const next = withDiagnostics({ ...state, candidates }, [
        { type: 'search', outcome: 'completed', query, result_count: links.length, retained_count: candidates.length,
          reason: 'Search completed; candidates are visible before website verification.' }, ...events,
      ]);
      return (await save(db, profile, campaignId, state.version, { ...next, results: candidateResults(next), working: false,
        status: state.searches_used < state.queries.length ? 'searching' : candidates.length ? 'researching' : 'completed' })).state;
    }
    const page = await contextScrape(candidate.url, discoveryExtraction);
    const { company, reason } = enrichCompany(state, candidate, page);
    const results = [...state.results.filter(row => row.domain !== candidate.domain), ...(company ? [company] : [])]
      .sort((a, b) => b.relevance_score - a.relevance_score || a.domain.localeCompare(b.domain));
    const next = withDiagnostics({ ...state, results,
      candidates: state.candidates.map(row => row.domain === candidate.domain && !company ? { ...row, rejection_reason: reason } : row),
    }, [{ type: 'enrichment', outcome: company?.research_status || 'rejected', domain: candidate.domain, url: candidate.url,
      reason: company?.research_notes?.join(' ') || reason }]);
    return (await save(db, profile, campaignId, state.version, { ...next, working: false,
      status: state.pages_attempted >= state.candidates.length ? 'completed' : 'researching',
      warnings: company ? state.warnings : warning(state, `${candidate.domain} was rejected: ${reason}`) })).state;
  } catch (error) {
    // A database failure leaves the reservation in place for safe recovery.
    if (error instanceof ResearchError && ['SAVE_FAILED', 'CAMPAIGN_CHANGED'].includes(error.code)) throw error;
    const known = error instanceof ResearchError;
    state = withDiagnostics({ ...state,
      results: search ? state.results : state.results.map(company => company.domain === candidate.domain ? { ...company,
        enrichment_status: 'unavailable', research_notes: [known ? error.message : 'Website enrichment was interrupted; search candidate retained.'] } : company),
    }, [{ type: 'provider', outcome: 'error', ...(search ? { query } : { domain: candidate.domain, url: candidate.url }),
      reason: known ? error.message : 'Provider request failed; previously discovered candidates remain available.' }]);
    if (!search && known && ['SOURCE_UNSUPPORTED', 'SOURCE_RESTRICTED'].includes(error.code)) {
      // A source-specific refusal consumes this page's reservation only. Keep
      // researching the remaining candidates without retrying the blocked site.
      return (await save(db, profile, campaignId, state.version, { ...state, working: false,
        status: state.pages_attempted >= state.candidates.length ? 'completed' : 'researching',
        error: null, error_code: null,
        warnings: warning(state, `${candidate.domain} enrichment was unavailable; its search candidate remains unverified. ${error.message}`) })).state;
    }
    return (await save(db, profile, campaignId, state.version, { ...state, status: 'failed', working: false,
      error: known ? `${search ? 'Company search' : candidate.domain}: ${error.message}` : 'Company discovery was interrupted. Your saved results remain available.',
      error_code: known ? error.code : 'DISCOVERY_FAILED',
      warnings: warning(state, 'The unsuccessful request was counted toward the run limit. Resuming uses only the remaining budget.') })).state;
  }
}

export const handler = endpoint(async req => {
  const db = adminClient();
  const { ownerId } = await authenticate(req, db);
  const body = await readBody(req);
  // Older frontends label every returned row as verified. Require the client
  // that understands research status before returning unverified candidates.
  if (body.data_version !== 2) throw new ResearchError('CLIENT_UPDATE_REQUIRED', 'Company discovery has been updated. Refresh this page to load company research statuses.', 409);
  if (!isUuid(body.job_id)) throw new ResearchError('INVALID_REQUEST', 'A research job ID is required.');
  const action = body.action || 'load';
  if (!['load', 'start', 'advance', 'resume', 'save', 'remove'].includes(String(action))) throw new ResearchError('INVALID_REQUEST', 'Unknown company discovery action.');
  const { data, error } = await db.from('company_profiles').select('*').eq('job_id', body.job_id).eq('owner_id', ownerId).maybeSingle();
  if (error) throw new ResearchError('DATABASE_UNAVAILABLE', 'Could not load company discovery.', 503);
  if (!data) throw new ResearchError('NOT_FOUND', 'Company research was not found in this project.', 404);
  if (!Object.hasOwn(data, 'company_discovery')) throw new ResearchError('NOT_DEPLOYED', 'The Phase 4 database migration has not been deployed.', 503);
  const profile = data as DiscoveryProfile;
  if (action === 'load') {
    for (const [id, existing] of Object.entries(profile.company_discovery)) {
      if (existing.discovery_version === 2 || (existing.working && !stale(existing)) ||
          !profile.campaign_plan?.campaigns.some(campaign => campaign.id === id)) continue;
      profile.company_discovery[id] = (await save(db, profile, id, existing.version, upgradeDiscovery(existing))).state;
    }
    return json(discoverySnapshot(profile));
  }
  if (!isUuid(body.campaign_id)) throw new ResearchError('INVALID_REQUEST', 'Choose a saved campaign.');
  const campaignId = body.campaign_id;
  const target = targetFor(profile, campaignId);
  let state = profile.company_discovery[campaignId];
  if (!Number.isInteger(body.version) || body.version !== (state?.version || 0)) {
    throw new ResearchError('CONFLICT', 'Company results changed in another tab. Reload saved results.', 409);
  }
  if (state && state.discovery_version !== 2) {
    if (state.working && !stale(state)) throw new ResearchError('BUSY', 'A website request is still running. Saved progress will refresh shortly.', 409);
    const upgraded = await save(db, profile, campaignId, state.version, upgradeDiscovery(state));
    if (!upgraded.applied) throw new ResearchError('CONFLICT', 'Company results changed in another tab. Reload saved results.', 409);
    state = upgraded.state;
  }
  if (action === 'start') {
    // Opening a completed campaign or pressing Find twice only reads its cache.
    if (!state || state.signature !== targetSignature(target)) {
      if (state?.working && !stale(state)) throw new ResearchError('BUSY', 'A website request is still running. Wait before searching updated criteria.', 409);
      state = (await save(db, profile, campaignId, state?.version || 0, newDiscovery(target, state))).state;
    }
  } else {
    if (!state) throw new ResearchError('NOT_STARTED', 'Click Find Companies to start this campaign.', 409);
    if (action === 'advance' || action === 'resume') {
      if (state.signature !== targetSignature(target)) throw new ResearchError('CAMPAIGN_CHANGED', 'Campaign criteria changed. Start a search using the updated criteria.', 409);
      if (action === 'resume' && canResume(state)) state = (await save(db, profile, campaignId, state.version, {
        ...state, status: state.searches_used < state.queries.length ? 'searching' : 'researching', error: null, error_code: null,
      })).state;
      if (action === 'advance') state = await advance(db, profile, campaignId, state);
    } else {
      if (running(state) && (state.signature === targetSignature(target) || (state.working && !stale(state)))) {
        throw new ResearchError('BUSY', 'Wait for the current website request to finish before changing saved companies.', 409);
      }
      const domains = body.domains;
      if (!Array.isArray(domains) || !domains.length || domains.length > 30 || domains.some(domain => typeof domain !== 'string')) {
        throw new ResearchError('INVALID_REQUEST', 'Select up to 30 companies from these results.');
      }
      const available = new Map([...state.results, ...state.saved].filter(row => !state.removed_domains.includes(row.domain)).map(row => [row.domain, row]));
      if (domains.some(domain => !available.has(domain))) throw new ResearchError('INVALID_REQUEST', 'Select only companies returned for this campaign.');
      const selected = new Set(domains as string[]);
      const saved = action === 'save'
        ? [...new Map([...state.saved, ...domains.map(domain => available.get(domain)!)].map(row => [row.domain, row])).values()]
        : state.saved.filter(row => !selected.has(row.domain));
      if (saved.length > 30) throw new ResearchError('SAVE_LIMIT', 'Keep up to 30 saved companies per campaign.');
      const result = await save(db, profile, campaignId, state.version, { ...state, saved,
        removed_domains: action === 'remove' ? [...new Set([...state.removed_domains, ...domains])] : state.removed_domains });
      if (!result.applied) throw new ResearchError('CONFLICT', 'Company results changed in another tab. Reload saved results.', 409);
      state = result.state;
    }
  }
  profile.company_discovery[campaignId] = state;
  return json(discoverySnapshot(profile));
});
if (import.meta.main) Deno.serve(handler);
