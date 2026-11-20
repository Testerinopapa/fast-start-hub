import { supabase } from '../integrations/supabase/client';

// Lead Results lives on the Lovable Cloud project; the session comes from the Explee login service
// and is verified server-side. Only the public publishable key is used here.
const LEADS_FUNCTION_URL = 'https://emlggkmtbosahpzrxaul.supabase.co/functions/v1/openoutfind-results';
const CLOUD_PUBLISHABLE_KEY = 'sb_publishable_9pB5Iuh6ERnbH-div9g3SA_rOWuQWX6';

export async function callLeads(body) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw Object.assign(new Error('Sign in to view lead results.'), { code: 'UNAUTHORIZED' });
  let res;
  try {
    res = await fetch(LEADS_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CLOUD_PUBLISHABLE_KEY, Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch { throw new Error('Cannot reach Lead Results. Check your connection.'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error?.message || 'Lead Results is unavailable.'), { code: json.error?.code });
  return json;
}

const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
export function leadsToCsv(leads) {
  const cols = ['person_name', 'title', 'company', 'company_website', 'professional_profile', 'qualification_reason', 'needs_review', 'review_status', 'manual_score', 'manual_notes', 'evidence_url', 'reviewed_at', 'campaign_name', 'last_run_id', 'first_seen_at', 'last_seen_at'];
  return [cols.join(','), ...leads.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\n');
}
