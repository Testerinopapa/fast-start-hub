import React, { useEffect, useState } from 'react';
import PeopleSkeleton from './PeopleSkeleton';

export default function Step5PeopleTable({ discovery, canContinue = false, onNext = null }) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const { state, ready, busy, error, reload, resume } = discovery;
  const rows = state?.results || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const currentRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const running = !error && (!ready || state.status === 'researching');
  useEffect(() => setCurrentPage(1), [state?.campaign_id]);

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto bg-white rounded-2xl border border-black/[0.08] shadow-xs overflow-hidden animate-card-enter">
      <div className="px-4 py-3 border-b border-black/[0.06] bg-[#fafafa] text-xs text-gray-500">
        <p role="status" aria-live="polite">{!ready ? 'Loading saved decision makers…'
          : running ? `Researching company teams · ${state.companies_completed} of ${state.companies_total} companies · ${rows.length} contacts identified`
          : `${rows.length} publicly identified contacts · ${state.companies_completed} of ${state.companies_total} companies researched`}</p>
        <p className="mt-1 text-[11px]">Public professional sources. Current employment and email/phone details are not verified.</p>
        {Boolean(state?.company_domains?.length) && <p className="mt-1 text-[11px]">Researching saved Phase 4 companies: {state.company_domains.join(', ')}</p>}
        {(error || state?.error) && <p role="alert" className="mt-2 text-red-700">{error?.message || state.error}</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          {(error || state?.status === 'failed') && <button type="button" disabled={busy} onClick={error ? reload : resume}
            className="px-2.5 py-1 rounded border border-black/10 bg-white text-xs disabled:opacity-40">
            {error ? 'Reload saved progress' : state.can_resume ? 'Resume remaining research' : 'Continue with saved results'}
          </button>}
        </div>
      </div>
      {running && !rows.length && <PeopleSkeleton />}
      {(!running || rows.length > 0) && <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-black/[0.08] bg-[#fafafa] text-gray-500 font-semibold text-[11px] uppercase tracking-wider">
              <th className="py-3 px-4 w-[280px]">Name</th>
              <th className="py-3 px-4 w-[240px]">
                <div className="flex items-center gap-1.5">
                  <span>Job Title</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </div>
              </th>
              <th className="py-3 px-4 min-w-[200px]">Company</th>
              <th className="py-3 px-4 w-[180px]">
                <div className="flex items-center gap-1.5">
                  <span>Geo</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </div>
              </th>
              <th className="py-3 px-3 w-[40px] text-center text-gray-400 font-normal">+</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {currentRows.map(person => {
              const fullName = person.name;
              const initials = fullName.split(/\s+/).map(part => part.charAt(0)).slice(0, 2).join('').toUpperCase();

              return (
                <tr key={person.id} className="hover:bg-[#fbfbfb] transition-colors">
                  {/* Name with initials and LinkedIn icon */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="size-6 rounded-full bg-gray-100 border border-black/[0.06] text-gray-700 flex items-center justify-center font-semibold text-[10px] shrink-0">
                        {initials}
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-gray-900 truncate text-[13px]">
                          {fullName}
                        </span>
                        {person.profile_url && <a href={person.profile_url} target="_blank" rel="noopener noreferrer" aria-label={`Professional profile for ${fullName}`}>
                        {new URL(person.profile_url).hostname.replace(/^www\./, '') === 'linkedin.com' ? <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="text-[#0a66c2] shrink-0"
                        >
                          <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
                        </svg> : <span className="text-[#0d9467]">↗</span>}</a>}
                      </div>
                    </div>
                    <a href={person.source_urls[0]} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 text-[10px] text-[#0d9467]"
                      title={person.evidence?.association}>Publicly identified · Source</a>
                    <span className="block text-[10px] text-gray-400">Found {new Date(person.identified_at).toLocaleDateString()}</span>
                    {person.source_published_at && <span className="block text-[10px] text-gray-400">Source published {new Date(person.source_published_at).toLocaleDateString()}</span>}
                  </td>

                  {/* Job Title */}
                  <td className="py-3 px-4">
                    <span className="text-gray-700 truncate block text-xs">
                      {person.title || '—'}
                    </span>
                    <span className="block mt-1 text-[10px] leading-relaxed text-gray-500">{person.relevance?.reason}</span>
                  </td>

                  {/* Company */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="size-4 rounded-xs bg-gray-200 shrink-0" />
                      <span className="font-mono text-gray-600 text-xs truncate">
                        {person.company_domain || '—'}
                      </span>
                    </div>
                    {person.company_research_status === 'unverified' && <span className="block mt-1 text-[10px] text-amber-700">Company candidate · unverified</span>}
                  </td>

                  {/* Geo */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <span className="truncate">
                        {person.location || '—'}
                      </span>
                    </div>
                  </td>

                  <td className="py-3 px-3 text-center text-gray-300"></td>
                </tr>
              );
            })}
            {!running && !rows.length && <tr><td colSpan={5} className="py-12 px-4 text-center text-gray-500">
              {error || state?.error ? 'Contact research could not finish. Saved progress is retained.'
                : 'No supported contacts were found for the saved companies listed above. Research notes show the searched sources, exclusions and page outcomes. No names or roles have been inferred.'}
            </td></tr>}
          </tbody>
        </table>
      </div>}
      {Boolean(state?.warnings?.length || state?.diagnostics?.length) && <details className="px-4 py-3 text-xs text-gray-500 border-t border-black/[0.06]">
        <summary className="cursor-pointer">Research notes</summary>
        {(state.warnings || []).map((note, index) => <p key={index} className="mt-2">{note}</p>)}
        {(state.diagnostics || []).map((event, index) => <p key={`diagnostic-${index}`} className="mt-2 break-words">
          {event.company_domain} · {event.stage} · {event.outcome}: {event.query || event.url || ''}
          {event.result_count !== undefined && ` · ${event.result_count} search results`}
          {event.extracted_count !== undefined && ` · ${event.extracted_count} extracted contacts`}
          {event.accepted_count !== undefined && ` · ${event.accepted_count} accepted`}
          {event.name && ` · ${event.name}`} {event.reason}
        </p>)}
      </details>}

      {/* Pagination & Next Button */}
      <div className="px-4 py-3 border-t border-black/[0.06] bg-[#fafafa] flex items-center justify-between">
        <div className="text-xs text-gray-500 font-mono">
          Showing {rows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, rows.length)} of {rows.length} people
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setCurrentPage(page - 1)}
              className="px-2.5 py-1 rounded border border-black/10 bg-white text-xs disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-xs text-gray-600 px-1 font-mono">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setCurrentPage(page + 1)}
              className="px-2.5 py-1 rounded border border-black/10 bg-white text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>

          {onNext && (
            <button
              type="button"
              onClick={onNext}
              disabled={!canContinue}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0d9467] hover:text-[#096647] transition-colors ml-2 disabled:opacity-40"
            >
              <span>Continue to write emails</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
