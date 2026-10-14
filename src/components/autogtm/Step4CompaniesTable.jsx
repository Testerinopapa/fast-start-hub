import React, { useEffect, useState } from 'react';
import TableSkeleton from './TableSkeleton';

export default function Step4CompaniesTable({ campaigns = [], campaignId = '', onCampaignChange, discovery, onNext = null }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const { state, ready, busy, action, error, mutate, reload, inputs } = discovery;
  const starting = ready && Boolean(campaignId) && !state && !error;
  const running = starting || (state && !state.criteria_changed && ['searching', 'researching'].includes(state.status));
  const saved = new Set((state?.saved || []).map(row => row.domain));
  const diagnostics = state?.diagnostics || [];
  const rows = [...new Map([...(state?.results || []), ...(state?.saved || [])].map(row => [row.domain, row])).values()]
    .filter(row => !state?.removed_domains.includes(row.domain)).sort((a, b) => b.relevance_score - a.relevance_score);
  const filtered = rows.filter(row => (!savedOnly || saved.has(row.domain)) &&
    [row.name, row.domain, row.description, row.location, row.industry].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const currentRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const locked = busy || Boolean(running);
  const selectedVisible = selected.filter(domain => rows.some(row => row.domain === domain));
  const progress = starting ? 'Starting company discovery for this campaign…'
    : action === 'save' ? 'Saving discovered companies…'
    : !state ? '' : state.criteria_changed ? state.run >= 3 ? 'This campaign has reached its search limit.' : 'Starting a search with the updated campaign criteria…'
    : state.working && state.status === 'searching' ? `Searching ${state.searches_used} of ${state.queries.length} queries…`
    : state.status === 'searching' ? `Searched ${state.searches_used} of ${state.queries.length} queries…`
    : state.status === 'researching' ? `Checking website ${state.pages_attempted || 1} of ${state.candidates_count}…`
    : state.status === 'completed' ? `${state.results.length} companies discovered · ${state.results.filter(row => (row.research_status || 'verified') === 'verified').length} websites verified · ${saved.size} saved.`
    : 'Discovery paused. Discovered candidates and saved results are available.';
  useEffect(() => { setSelected([]); setSearch(''); setCurrentPage(1); setSavedOnly(false); }, [campaignId]);
  const changeSelection = domain => setSelected(values => values.includes(domain) ? values.filter(value => value !== domain) : [...values, domain]);
  const changeCompanies = async (action, domains) => { if (await mutate(action, { domains })) setSelected([]); };
  const button = 'px-2.5 py-1.5 rounded-md border border-black/10 bg-white text-xs disabled:opacity-40 hover:bg-gray-50';

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto bg-white rounded-2xl border border-black/[0.08] shadow-xs overflow-hidden animate-card-enter">
      <div className="px-4 py-3 border-b border-black/[0.06] bg-[#fafafa] flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-0 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          Campaign
          <select aria-label="Campaign to find companies for" value={campaignId} onChange={event => onCampaignChange(event.target.value)}
            className="block mt-1 w-full min-w-0 rounded-md border border-black/10 bg-white px-2.5 py-2 text-xs text-gray-900 normal-case tracking-normal">
            {!campaigns.length && <option value="">Choose a campaign in Phase 3</option>}
            {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || !error}
          onClick={reload} className="px-3 py-2 rounded-md bg-[#0d9467] text-white text-xs font-semibold hover:bg-[#0a7854] disabled:opacity-40">
          {error ? 'Retry discovery' : running || (state?.criteria_changed && state.run < 3) ? 'Finding companies…' : !ready ? 'Loading companies…' : 'Results loaded'}
        </button>
        {state?.status === 'failed' && state.can_resume && !state.criteria_changed && <button type="button" className={button} disabled={busy} onClick={() => mutate('resume')}>Resume remaining search</button>}
        <button type="button" className={button} disabled={busy} onClick={reload}>Reload saved results</button>
      </div>

      {state?.criteria_changed && <p role="status" className="px-4 pt-3 text-xs text-amber-800">
        Campaign criteria changed. These results belong to the previous criteria; the updated search keeps your saved companies.
        {state.run >= 3 && ' This campaign has reached its three-run limit.'}
      </p>}
      {(error || state?.error) && <p role="alert" className="px-4 pt-3 text-xs text-red-700">{error?.message || state.error}</p>}
      {progress && <p role="status" aria-live="polite" className="px-4 pt-3 text-xs text-gray-500">{progress}</p>}

      {!ready && !error && <TableSkeleton />}
      {ready && <>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <input aria-label="Filter discovered companies" placeholder="Search companies" value={search}
            onChange={event => { setSearch(event.target.value); setCurrentPage(1); }}
            className="min-w-0 flex-1 rounded-md border border-black/10 px-2.5 py-1.5 text-xs" />
          <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={savedOnly}
            onChange={event => { setSavedOnly(event.target.checked); setCurrentPage(1); }} />Saved ({saved.size})</label>
          <button type="button" className={button} disabled={locked || !selectedVisible.length} onClick={() => changeCompanies('save', selectedVisible)}>Save selected ({selectedVisible.length})</button>
          <button type="button" className={button} disabled={locked || !selectedVisible.length} onClick={() => changeCompanies('remove', selectedVisible)}>Remove selected</button>
        </div>
        {running && !state?.criteria_changed && !rows.length && !error && <TableSkeleton />}
        {(!running || rows.length > 0 || state?.criteria_changed || error) && <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead><tr className="border-b border-black/[0.08] bg-[#fafafa] text-gray-500 font-semibold text-[11px] uppercase tracking-wider">
              <th className="py-3 pl-4"><input type="checkbox" aria-label="Select all companies on this page" disabled={locked || !currentRows.length}
                checked={currentRows.length > 0 && currentRows.every(row => selected.includes(row.domain))}
                onChange={event => setSelected(values => event.target.checked ? [...new Set([...values, ...currentRows.map(row => row.domain)])] : values.filter(domain => !currentRows.some(row => row.domain === domain)))} /></th>
              <th className="py-3 px-4 min-w-[200px]">Company</th>
              <th className="py-3 px-4 min-w-[240px]">Description</th>
              <th className="py-3 px-4 min-w-[130px]">Location</th>
              <th className="py-3 px-4 min-w-[130px]">Industry</th>
              <th className="py-3 px-4 min-w-[220px]">Campaign relevance</th>
              <th className="py-3 px-4">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-black/[0.04]">
              {currentRows.map(row => <tr key={row.domain} className="hover:bg-[#fbfbfb] transition-colors">
                <td className="py-3 pl-4"><input type="checkbox" aria-label={`Select ${row.name || row.domain}`} disabled={locked}
                  checked={selected.includes(row.domain)} onChange={() => changeSelection(row.domain)} /></td>
                <td className="py-3 px-4"><div className="flex items-center gap-2.5">
                  <div className="size-6 rounded bg-gray-100 flex items-center justify-center shrink-0">
                    <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(row.domain)}&sz=32`} alt=""
                      className="size-3.5 rounded-xs" onError={event => { event.target.style.display = 'none'; }} />
                  </div>
                  <div className="min-w-0"><div className="font-semibold text-gray-900 text-[13px] break-words">{row.name || row.domain}</div>
                    <a href={row.website} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-gray-400 hover:text-[#0d9467] break-all">{row.domain}</a>
                    <span className={`block mt-1 text-[10px] font-semibold ${row.research_status === 'unverified' ? 'text-amber-700' : 'text-[#0d9467]'}`}
                      title={row.research_notes?.join('\n')}>
                      {row.research_status === 'unverified' ? 'Unverified' : 'Website verified'}
                      {row.enrichment_status === 'pending' ? ' · Research pending' : row.enrichment_status === 'unavailable' ? ' · Enrichment unavailable' : ''}
                    </span>
                    {saved.has(row.domain) && <span className="block mt-1 text-[10px] font-semibold text-[#0d9467]">Saved</span>}
                  </div></div></td>
                <td className="py-3 px-4"><p className="text-gray-600 text-xs leading-relaxed">{row.description || '—'}</p>
                  {row.field_sources?.description === 'search' && <span className="block mt-1 text-[10px] text-amber-700">Search snippet · unverified</span>}
                  <a href={row.source_urls[0]} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-[11px] text-[#0d9467]">Source</a></td>
                <td className="py-3 px-4 text-gray-700">{row.location || '—'}</td>
                <td className="py-3 px-4 text-gray-700">{row.industry || '—'}</td>
                <td className="py-3 px-4"><p className="font-semibold text-gray-800">{row.relevance}</p><p className="mt-1 text-[11px] text-gray-500 leading-relaxed">{row.match_reason}</p>
                  <p className="mt-1 text-[10px] text-gray-500 capitalize" title="Confidence in the available business evidence, not a probability of becoming a customer.">{row.confidence || 'medium'} research confidence</p>
                  {row.matched_criteria?.plan_version !== state.criteria.plan_version && <p className="mt-1 text-[10px] text-amber-800">Saved against earlier campaign criteria.</p>}</td>
                <td className="py-3 px-4"><div className="flex flex-col items-start gap-2">
                  <button type="button" className={button} disabled={locked || saved.has(row.domain)} onClick={() => changeCompanies('save', [row.domain])}>{saved.has(row.domain) ? 'Saved' : 'Save'}</button>
                  <button type="button" disabled={locked} className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-40" onClick={() => changeCompanies('remove', [row.domain])}>Remove</button>
                </div></td>
              </tr>)}
              {!currentRows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">
                {error ? error.message : !campaignId ? 'No saved campaign is available for company discovery.' : !state ? 'Loading company discovery…' : rows.length ? 'No companies match this filter.'
                  : state.status === 'completed' ? !state.candidates_count ? 'No company websites were found for the saved campaign audience, industry, and keywords.'
                    : state.warnings.length || diagnostics.length ? 'No plausible business candidates remain. See search notes for exclusions and rejection reasons.' : 'No companies remain in this campaign. Removed companies will not be saved again.'
                  : state.error || 'Waiting for company search results…'}
              </td></tr>}
            </tbody>
          </table>
        </div>}
        {!!(state?.warnings.length || diagnostics.length) && <details className="px-4 py-3 text-xs text-gray-500"><summary className="cursor-pointer">Search notes ({(state?.warnings.length || 0) + diagnostics.length})</summary>
          <ul className="mt-2 space-y-1 list-disc pl-4">
            {(state?.warnings || []).map(note => <li key={note}>{note}</li>)}
            {diagnostics.map((entry, index) => <li key={`${entry.at || ''}:${index}`}>
              {entry.query && <>Query: “{entry.query}”. </>}
              {entry.result_count != null && <>{entry.result_count} results returned; {entry.retained_count} candidate domains retained. </>}
              {entry.domain && <>{entry.domain}: </>}{entry.outcome}. {entry.reason}
            </li>)}
          </ul></details>}
        <div className="px-4 py-3 border-t border-black/[0.06] bg-[#fafafa] flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-gray-500 font-mono">Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} companies</div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <button type="button" disabled={page === 1} onClick={() => setCurrentPage(page - 1)} className={button}>Prev</button>
              <span className="text-xs text-gray-600 px-1 font-mono">{page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setCurrentPage(page + 1)} className={button}>Next</button>
            </div>
            {onNext && <button type="button" onClick={onNext} disabled={!inputs.length || busy || Boolean(running)}
              className="text-xs font-semibold text-[#0d9467] hover:text-[#096647] disabled:opacity-40">Continue to find people →</button>}
          </div>
        </div>
      </>}
    </div>
  );
}
