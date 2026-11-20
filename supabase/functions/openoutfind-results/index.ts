import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { AUTH_ISSUER, AUTH_PROJECT_PUBLISHABLE_KEY, AUTH_PROJECT_URL } from '../_shared/auth-project.ts';
import { createLeadResultsHandler, DEFAULT_REPOSITORY } from '../_shared/lead-results.ts';

// deno-lint-ignore no-explicit-any
let admin: any = null;
// deno-lint-ignore no-explicit-any
function db(): any {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('not configured');
  return admin ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
// deno-lint-ignore no-explicit-any
const must = (r: { data: any; error: unknown }) => { if (r.error) throw new Error('database'); return r.data; };
const authClient = createClient(AUTH_PROJECT_URL, AUTH_PROJECT_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(createLeadResultsHandler({
  proxyToken: () => Deno.env.get('OPENOUTFIND_PROXY_TOKEN'),
  repository: () => Deno.env.get('LEAD_IMPORT_REPOSITORY') || DEFAULT_REPOSITORY,
  // Only the existing Explee login service is trusted; guest (anonymous) sessions are refused.
  verifyUser: async (jwt) => {
    const { data, error } = await authClient.auth.getUser(jwt);
    if (error || !data.user || data.user.is_anonymous) return null;
    return { issuer: AUTH_ISSUER, subject: data.user.id };
  },
  ownerId: async ({ issuer, subject }) => (must(await db().from('lead_review_owners')
    .upsert({ auth_issuer: issuer, auth_subject: subject }, { onConflict: 'auth_issuer,auth_subject' }).select('id').single()) as { id: string }).id,
  activeCodes: async (owner) => (await db().from('lead_import_codes').select('code_hash', { count: 'exact', head: true })
    .eq('owner_id', owner).is('used_at', null).gt('expires_at', new Date().toISOString())).count ?? 0,
  storeCode: async (owner, hash, expires) => { must(await db().from('lead_import_codes').insert({ code_hash: hash, owner_id: owner, expires_at: expires.toISOString() })); },
  list: async (owner) => {
    const leads = must(await db().from('lead_results').select('id,person_name,title,company,company_website,professional_profile,qualification_reason,checks,needs_review,campaign_name,source,first_seen_at,last_seen_at,last_run_id,review_status,manual_score,manual_notes,evidence_url,reviewed_at,lead_sightings(run_id,campaign_name,complete,seen_at)')
      .eq('owner_id', owner).order('last_seen_at', { ascending: false }).limit(500));
    const runs = must(await db().from('lead_runs').select('run_id,campaign_name,research_company,source,returned_leads,complete_profiles,incomplete_profiles,imported_at')
      .eq('owner_id', owner).order('imported_at', { ascending: false }).limit(100));
    return { leads, runs };
  },
  review: async (owner, id, f) => (must(await db().from('lead_results').update(f).eq('id', id).eq('owner_id', owner).select('id')) as unknown[]).length === 1,
  ingest: async (hash, runId, payload) => must(await db().rpc('openoutfind_lead_ingest', { p_code_hash: hash, p_run_id: runId, p_payload: payload })) as { status: string },
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  now: () => new Date(),
}));
