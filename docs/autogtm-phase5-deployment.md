# Phase 5: broader professional sources

Prepared locally; not deployed. Keep the existing Supabase/Firecrawl integrations and Phase 5 table. Apply the incremental migration and redeploy only `people-discovery` after approval.

## Observed failure

Read-only database inspection of YouTube job `aeccd86b-47f2-4504-9d3f-b24ccbd52879` found one Phase 4 saved company: `947fmtheword.com` (94.7 FM The Word KRKS). Phase 5 therefore researched that station, not YouTube. The stored campaign is “First-time buyers of YouTube”; its Phase 4 search history includes “getting started.” Those upstream targeting choices are not rewritten by this fix.

The Phase 5 run used one search and two pages, completed with zero contacts and no warnings. Both URLs were the same unrelated article:

- `https://947fmtheword.com/articles/family/marriage/how-to-encourage-your-husbands-leadership-even-when-he-fails`
- The identical URL with a trailing slash.

The deployed query builder would have submitted `site:947fmtheword.com (team OR leadership OR founders OR about OR contact)`. The old state did not store the actual submitted query, raw search/scrape responses, result counts or per-contact rejection records. Those historical details cannot be reconstructed from the database. Empty extraction arrays produced no warning.

Source inspection also found three general problems: all external sources were filtered out; extraction targeted the website publisher rather than the selected company; and any path containing “leadership” outranked real corporate pages. Slash variants consumed separate reservations.

Public evidence demonstrates why a domain-only search is insufficient for YouTube: its [official Neal Mohan profile](https://blog.youtube/author/neal-mohan/) is on `blog.youtube`; [Google's corporate blog](https://blog.google/intl/en-in/products/platforms/a-future-full-of-opportunities-made-on-youtube/) also publishes named YouTube leadership. These references establish source eligibility, not hard-coded contact records. The pipeline must obtain its own public evidence.

## New behavior

- Company-name leadership searches cover the broader web. A second campaign-role search runs only when the initial research yields fewer than three contacts and budget remains.
- Eligible sources include the company's domain, approved established reporting publishers, explicit corporate/newsroom links found on the company's pages, and reviewed cross-domain corporate relationships. The initial reviewed relationship is YouTube → `blog.youtube`, `blog.google`, `about.google`, `abc.xyz`. No people are seeded or hard-coded. Unknown external publishers remain excluded with a reason instead of being assumed credible.
- Team pages, author bios, executive titles and corporate sources rank ahead of arbitrary articles whose slugs merely contain “leadership.” Slash/www variants are deduplicated. YouTube user channels, watch pages, playlists, shorts and search pages are excluded as professional-company evidence.
- Extraction names the actual target company, even when the publisher is its parent or a news outlet. External sources must supply a verbatim passage linking the person's name, title and target company. Google employees are not automatically YouTube employees; platform creators and guests are not treated as staff. Conflicting roles for one name are flagged instead of merged.
- LinkedIn, email and telephone information are never eligibility requirements. Names/roles are publicly identified, with source URLs and supporting quotes. Current employment and email/phone details remain unverified. Source publication dates are shown only when provided by page metadata.
- The existing table now identifies the saved company domains being researched. Its Research notes disclosure includes queries, returned search titles/URLs, candidate exclusions, extracted/accepted counts, named rejection reasons and safe provider failures. Up to 200 diagnostic events per domain are saved and logged. Raw page bodies, credentials and provider payloads are not retained.

## Budget and old results

The cumulative cap is two searches (five search results each), four page requests, and ten saved contacts per domain; at most ten domains per research job. A supported shortlist can complete after the first search/two pages. JSON extraction uses the existing Firecrawl allowance; these are request limits, not a claim that extraction is free.

Previously completed empty runs are upgraded once on load and reopened for a broader search if there is unused allowance under the new cap. Old reservations and page history are preserved: a run that already spent one search/two pages gets at most one additional search/two pages. Nonempty cached runs are retained without automatic repeat research. Failed runs keep their recovery controls. Neither refreshes nor concurrent tabs reset budgets.

The existing owner-scoped JSON storage, service-role-only save RPC, per-request reservations and version checks remain. One incremental migration changes the RPC bounds from 1/2 to 2/4; it adds no table or column. Frontend layout, animations and autoplay remain.

Phase 5 still researches saved Phase 4 customers. Entering YouTube as the original company does not select YouTube as a customer lead. A YouTube leadership shortlist requires YouTube to be the selected target; silently inserting its leaders into the radio station's contact results would be incorrect.

## Deployment after approval

From the existing linked repository:

```powershell
npx supabase@2.120.0 db push --linked --dry-run
```

Review the pending set. The new migration is `20261014000100_autogtm_people_public_sources.sql`; the original Phase 5 migration must already be applied. Once the pending set is approved:

```powershell
npx supabase@2.120.0 db push --linked
npx supabase@2.120.0 functions deploy people-discovery --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

Publish the frontend through the existing Lovable/Git workflow. No changes to auth providers, secrets, or unrelated functions are required.

Investigation used source inspection, read-only stored-state queries, and public official sources. No remote deployment, live Firecrawl request, test script or build was run. Successful end-to-end extraction remains unverified until an approved deployment and live run.
