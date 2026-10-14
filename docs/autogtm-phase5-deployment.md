# Phase 5: public decision-maker research

Prepared locally. Nothing has been deployed. This adds one JSON column and one service-role-only save RPC on the existing `company_profiles` table, one Edge Function, and the Phase 5 frontend integration. No new service, table, dependency or secret is required.

## Flow and limits

Entering Phase 5 automatically loads the active Phase 4 campaign's saved companies, excluding removed companies. Phase 4's temporary row checkboxes are not an additional persisted selection: saving is the input to Phase 5. The server reads that selection itself; it never accepts arbitrary domains supplied by the browser.

For each saved company, one Firecrawl Search request returns up to five public page links. Team, Leadership, Management, Founders, About and Contact pages are prioritized. Saved first-party source URLs and the homepage are fallbacks. Up to two first-party pages are researched per company, with a second page optionally chosen from links on the first. There is no profile scraping on LinkedIn, access bypass, extra mapping call or email verification service.

Limits are ten company domains per research job, one search and two page requests per domain, and ten contacts per domain. At most ten searches and twenty page requests can occur for a job. JSON extraction uses the existing Firecrawl allowance and can consume additional credits; this is a request cap, not a promise of a particular credit cost. Remaining companies are explicitly noted as outside the limit. Completed and empty results remain cached across refreshes and campaigns. A changed campaign reuses evidence and recalculates relevance without repeating requests.

The integration uses the existing Firecrawl v2 Search and Scrape interfaces documented in the [official API specification](https://github.com/firecrawl/firecrawl-docs/blob/main/api-reference/v2-openapi.json).

## Evidence and persistence

Names require an exact supporting passage from a first-party company page and explicit extracted company-team association. Unsupported names and unrelated people are omitted. Titles require supporting text, otherwise null; locations require evidence explicitly tied to that person, never an inferred office address. Profile links must occur in a supporting passage with the person's name and be a first-party or LinkedIn professional profile link. Public search snippets alone never establish a contact.

Saved contacts retain their company domain, supporting quotes, source URLs, identification date and `publicly_identified` status. `contact_details_verified` is always false; email and phone numbers are not generated or verified. A public page does not confirm current employment. Campaign relevance is a transparent heuristic based on the public title, seniority and campaign vocabulary, and is labeled as inferred. The company candidate's unverified status is also retained in the frontend.

The owner-scoped profile and existing cross-project authentication are reused. The save RPC locks the profile, checks campaign membership and the saved company selection, enforces monotonic request counters, and compares versions. The RPC is callable only by the service role. Each paid request reserves its allowance before sending. Refreshes and concurrent tabs reuse the reservation; after two minutes, abandoned work proceeds using the remaining budget without repeating the interrupted request.

Source-specific access restrictions produce notes and permit other bounded pages. Authentication, quota and unknown provider failures pause research and preserve contacts. Resume consumes only remaining budget; if none remains for that company, it continues to the next saved company. No automatic paid retry loop is introduced.

## UI

The original Phase 5 columns, initials, profile icon, pagination, card animation and PeopleSkeleton are reused. The loading phase retains its 4.2-second minimum; results appear as they are saved and autoplay waits for research completion before its original 3.5-second handoff. Empty/error results stay in Phase 5 with an explanation. The activity feed no longer claims to verify emails. The final dashboard reuses these saved contacts and real counts instead of the old 818-person claim. Phase 6 email generation remains outside this implementation.

## Deployment after approval

From the repository root, with the existing linked project:

```powershell
npx supabase@2.120.0 db push --linked --dry-run
```

Review the proposed migrations: the Phase 5 change is `20261013000100_autogtm_people_discovery.sql`. If any other unapplied migration appears, resolve its deployment scope before pushing. Once the proposed set is approved:

```powershell
npx supabase@2.120.0 db push --linked
npx supabase@2.120.0 functions deploy people-discovery --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

Publish the frontend through the existing Lovable/Git workflow after the migration and function. `supabase/config.toml` includes `verify_jwt = false` for this function, matching existing functions because authentication tokens belong to the original LinkedIn login project; the function still authenticates every request and checks ownership itself.

No remote deployment, Firecrawl request, build or test script was run during implementation. Live discovery and migration execution remain unverified until deployment is approved.
