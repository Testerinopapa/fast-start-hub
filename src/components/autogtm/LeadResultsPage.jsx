import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AutoGtmNavigation from './AutoGtmNavigation';
import useAuthSession from '../../hooks/useAuthSession';
import { useNavigation, PRODUCT_ROUTES } from '../../context/NavigationContext';
import { callLeads, leadsToCsv } from '../../lib/leadResults';

const STATUS_STYLES = {
  pending: 'bg-black/[0.05] text-gray-700',
  verified: 'bg-[#00FBBC]/25 text-[#05634b]',
  rejected: 'bg-red-50 text-red-700',
};
const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');
const Link = ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-[#05634b] underline underline-offset-2 break-all">{children}</a> : <span className="text-gray-400">—</span>;

function ImportCodePanel() {
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    setBusy(true); setError('');
    try { setCode(await callLeads({ action: 'create_import_code' })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-xl border border-black/[0.08] p-5 bg-white">
      <h2 className="text-lg font-semibold">Import the next discovery run</h2>
      <ol className="mt-2 list-decimal pl-5 space-y-1 text-base text-gray-700">
        <li>Click <strong>Create import code</strong>. It works once and expires in 2 hours.</li>
        <li>In GitHub, open Actions → <em>Explee OpenOutFind Lead QA</em> → Run workflow.</li>
        <li>Turn on <strong>run_live</strong> and paste the code into <strong>import_code</strong>.</li>
        <li>When the run finishes, refresh this page.</li>
      </ol>
      <p className="mt-2 text-sm text-gray-500">The code alone cannot read or change your leads; the server also requires the workflow's private key. Anyone who can see the workflow inputs could see the code, so only use it once.</p>
      <button type="button" onClick={create} disabled={busy} className="mt-4 rounded-lg bg-[#0a0a0a] px-4 py-2.5 text-base font-medium text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create import code'}</button>
      {error && <p role="alert" className="mt-3 text-base text-red-700">{error}</p>}
      {code && (
        <div className="mt-4 rounded-lg bg-[#00FBBC]/10 border border-[#00FBBC]/50 p-3">
          <p className="text-sm text-gray-700">Copy now — it will not be shown again. Expires {fmt(code.expires_at)}.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-base break-all">{code.import_code}</code>
            <button type="button" className="rounded-md border border-black/10 px-3 py-1.5 text-sm" onClick={() => navigator.clipboard?.writeText(code.import_code)}>Copy</button>
          </div>
        </div>
      )}
    </section>
  );
}

function LeadCard({ lead, onSaved }) {
  const [form, setForm] = useState({ review_status: lead.review_status, manual_score: lead.manual_score ?? '', manual_notes: lead.manual_notes ?? '', evidence_url: lead.evidence_url ?? '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const sightings = lead.lead_sightings || [];
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await callLeads({ action: 'review', lead_id: lead.id, review_status: form.review_status,
        manual_score: form.manual_score === '' ? null : Number(form.manual_score),
        manual_notes: form.manual_notes.trim() || null, evidence_url: form.evidence_url.trim() || null });
      setMsg('Saved'); onSaved();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <article className="rounded-xl border border-black/[0.08] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{lead.person_name || 'Unnamed candidate'}</h3>
          <p className="text-base text-gray-700">{[lead.title, lead.company].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-sm ${STATUS_STYLES[lead.review_status]}`}>{lead.review_status === 'verified' ? 'Verified by you' : lead.review_status}</span>
          {lead.needs_review ? <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-sm text-amber-800">Needs review · incomplete fields</span>
            : <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-sm text-gray-700">Complete fields · not verified</span>}
        </div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-base sm:grid-cols-2">
        <div><dt className="inline text-gray-500">LinkedIn: </dt><dd className="inline"><Link href={lead.professional_profile}>profile</Link></dd></div>
        <div><dt className="inline text-gray-500">Website: </dt><dd className="inline"><Link href={lead.company_website}>{lead.company_website}</Link></dd></div>
        <div><dt className="inline text-gray-500">Campaign: </dt><dd className="inline">{lead.campaign_name || '—'}</dd></div>
        <div><dt className="inline text-gray-500">Last run: </dt><dd className="inline">{lead.last_run_id} · {fmt(lead.last_seen_at)}</dd></div>
        <div><dt className="inline text-gray-500">Seen in runs: </dt><dd className="inline">{sightings.length}</dd></div>
        <div><dt className="inline text-gray-500">Reviewed: </dt><dd className="inline">{fmt(lead.reviewed_at)}</dd></div>
      </dl>
      <p className="mt-3 text-base"><span className="text-gray-500">AI reason (hypothesis, not verified): </span>{lead.qualification_reason || '—'}</p>
      <div className="mt-4 grid gap-3 border-t border-black/[0.06] pt-4 sm:grid-cols-[auto_auto_1fr]">
        <label className="text-sm text-gray-600">Status
          <select value={form.review_status} onChange={(e) => setForm({ ...form, review_status: e.target.value })} className="mt-1 block w-full rounded-md border border-black/10 px-2 py-2 text-base">
            <option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option>
          </select></label>
        <label className="text-sm text-gray-600">Fit score (0–100)
          <input type="number" min="0" max="100" value={form.manual_score} onChange={(e) => setForm({ ...form, manual_score: e.target.value })} className="mt-1 block w-28 rounded-md border border-black/10 px-2 py-2 text-base" /></label>
        <label className="text-sm text-gray-600">Evidence link (https, required for Verified)
          <input type="url" value={form.evidence_url} onChange={(e) => setForm({ ...form, evidence_url: e.target.value })} placeholder="https://…" className="mt-1 block w-full rounded-md border border-black/10 px-2 py-2 text-base" /></label>
        <label className="text-sm text-gray-600 sm:col-span-3">Notes
          <textarea rows={2} maxLength={2000} value={form.manual_notes} onChange={(e) => setForm({ ...form, manual_notes: e.target.value })} className="mt-1 block w-full rounded-md border border-black/10 px-2 py-2 text-base" /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-[#0a0a0a] px-4 py-2 text-base text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save review'}</button>
        {msg && <span role="status" className="text-base text-gray-700">{msg}</span>}
      </div>
    </article>
  );
}

export default function LeadResultsPage() {
  const { navigate } = useNavigation();
  const { session, loading } = useAuthSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ run: '', campaign: '', status: '' });
  const signedIn = session && !session.user?.is_anonymous;

  const load = useCallback(async () => {
    try { setError(''); setData(await callLeads({ action: 'list' })); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { if (!loading && signedIn) load(); }, [loading, signedIn, load]);

  const leads = data?.leads || [];
  const runs = data?.runs || [];
  const campaigns = [...new Set(leads.map((l) => l.campaign_name).filter(Boolean))];
  const shown = useMemo(() => leads.filter((l) =>
    (!filters.status || l.review_status === filters.status) &&
    (!filters.campaign || l.campaign_name === filters.campaign) &&
    (!filters.run || (l.lead_sightings || []).some((s) => s.run_id === filters.run))), [leads, filters]);
  const metric = (label, value) => <div className="rounded-xl border border-black/[0.08] p-4"><div className="text-2xl font-semibold">{value}</div><div className="text-sm text-gray-600">{label}</div></div>;

  const exportCsv = () => {
    const blob = new Blob([leadsToCsv(shown)], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lead-results.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-dvh w-full flex-col bg-white text-[#0a0a0a] overflow-hidden font-sans md:flex-row">
      <AutoGtmNavigation completedSteps={[]} userEmail={signedIn ? session.user.email : 'Not signed in'} />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-8 text-base">
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <h1 className="text-2xl font-semibold">Lead Results</h1>
            <p className="mt-1 text-base text-gray-600">Private to your account. Candidates come from OpenOutFind's AI qualification — a hypothesis until you verify them with evidence.</p>
          </header>
          {loading ? <p className="text-gray-500">Loading…</p> : !signedIn ? (
            <section className="rounded-xl border border-black/[0.08] p-6">
              <p className="text-base">Sign in with your Explee account to see your lead results.</p>
              <button type="button" onClick={() => navigate(PRODUCT_ROUTES.SIGN_IN)} className="mt-3 rounded-lg bg-[#0a0a0a] px-4 py-2.5 text-white">Sign in</button>
            </section>
          ) : (
            <>
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {metric('Candidates', leads.length)}
                {metric('Complete fields', leads.filter((l) => !l.needs_review).length)}
                {metric('Needs review', leads.filter((l) => l.needs_review).length)}
                {metric('Verified by you', leads.filter((l) => l.review_status === 'verified').length)}
                {metric('Imported runs', runs.length)}
              </div>
              <ImportCodePanel />
              {data && leads.length === 0 ? (
                <section className="rounded-xl border border-dashed border-black/15 p-6 text-gray-700">
                  <h2 className="text-lg font-semibold text-[#0a0a0a]">No saved leads yet</h2>
                  <p className="mt-1">Earlier discovery runs only produced summary counts; their candidate records were not saved and can't be recovered. Create an import code above and start a new GitHub run to save results here.</p>
                </section>
              ) : leads.length > 0 && (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    {[['run', 'Run', runs.map((r) => r.run_id)], ['campaign', 'Campaign', campaigns], ['status', 'Status', ['pending', 'verified', 'rejected']]].map(([k, label, opts]) => (
                      <label key={k} className="text-sm text-gray-600">{label}
                        <select value={filters[k]} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} className="mt-1 block rounded-md border border-black/10 px-2 py-2 text-base">
                          <option value="">All</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select></label>
                    ))}
                    <button type="button" onClick={exportCsv} className="ml-auto rounded-lg border border-black/10 px-4 py-2 text-base">Export CSV ({shown.length})</button>
                  </div>
                  <div className="space-y-4">{shown.map((l) => <LeadCard key={l.id} lead={l} onSaved={load} />)}</div>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
