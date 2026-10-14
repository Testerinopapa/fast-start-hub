# Phase 4: Find Companies

## Pending provider-error fix

Read-only inspection of the failed Asana run found three searches, five page attempts and zero verified results. The final attempted domain was `pcmag.com`. The existing helper collapsed both HTTP 401 and 403 into `PROVIDER_CONFIGURATION`, and did not save the provider's status/body, so the historical error does not establish whether the credential was invalid or the website was restricted. `FIRECRAWL_API_KEY` is present in the research project; its value was not retrieved.

The local fix distinguishes a 401 credential rejection from a generic 403 refusal, and recognizes Firecrawl's documented unsupported/restricted-source codes. Company discovery records those source refusals as warnings and continues with remaining candidates within the reserved budget. Unknown 403 errors still stop with an accurate message identifying the request. Raw provider errors are not returned or logged. See [Firecrawl error codes](https://docs.firecrawl.dev/api-reference/errors).

No secret update or migration is needed for this code change. Deploy only after approval:

```powershell
npx supabase@2.120.0 functions deploy company-discovery --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

The existing failed run has exhausted its five candidate pages. Deployment does not rewrite its historical error or rerun consumed requests. New runs and any resumed runs with remaining budget use the corrected handling. Other functions importing the shared helper retain their deployed version until explicitly redeployed.

## Earlier automatic-workflow fix

The original Phase 4 migration and `company-discovery` function are deployed (confirmed read-only on 2026-10-12). The automatic workflow fix is local and only changes the frontend. Publish the updated frontend through the existing hosting process; this fix needs no SQL or Edge Function deployment. No live Firecrawl request was made while investigating. Tests and build commands were not run, following the request to skip validation work.

The empty-table investigation found that the campaigns existed but their discovery state was absent. The user's screenshot showed the older manual screen ("Select a campaign and click Find Companies"), although fresh requests to both the exact workflow URL and the app entry served `/assets/index-C2C921dl.js`, which contains automatic discovery and no longer contains that prompt. The user reports publishing and hard-refreshing already, so browser caching is not a confirmed explanation. The next diagnostic is to compare the JavaScript asset loaded by the affected browser with that server response. The observed published commit is `32f5ba5`; the Stage 3 transition changes described below remain local until included in a subsequent release.

Phase 3 now persists a default researched campaign if an older plan has no selection, shows its original results animation and viewing delay, and continues to Phase 4 automatically. Selecting a campaign no longer pauses auto-play. Optional campaign editing and the explicit Pause control still pause the transition. Phase 4 automatically starts the active campaign after loading its cache, advances its bounded discovery run, saves verified results, and resumes the original timed workflow progression. Errors and genuine zero-result searches remain visible instead of advancing. Existing cached results do not trigger new searches, and removed domains are not automatically saved again. A successful authenticated Firecrawl run has not been verified during this investigation.

Comparison with the PrimKeet placeholder workflow at `63ba931` identified two frontend regressions: `93e1a5a` removed the 3.5-second automatic transition from campaign results, and `0dde947` mapped the company-loading phase directly to the results table. The local fix restores that transition and the original standalone `TableSkeleton` with its 4.4-second minimum display. Real discovery runs during that loading phase; completion reveals actual results, and failures reveal the existing error/retry controls. The placeholder table imported `autogtm_companies.json` and therefore never depended on a search succeeding. Its fabricated counts, traffic and other demo data are not restored.

## Original backend setup (already deployed on this project)

From the repository root, inspect the pending migrations:

```powershell
npx supabase@2.120.0 migration list --linked
npx supabase@2.120.0 db push --linked --dry-run
```

The expected new migration is `20261012000500_autogtm_company_discovery.sql`. If earlier migrations are listed, reconcile the manually deployed migration history first. Do not apply other infrastructure changes as part of this deployment.

After approval:

```powershell
npx supabase@2.120.0 db push --linked
npx supabase@2.120.0 functions deploy company-discovery --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

Then publish the frontend through the existing Lovable hosting process. No additional secrets, subscriptions, packages or existing-function deployments are needed. `FIRECRAWL_API_KEY` stays in Supabase. The function's `verify_jwt = false` matches the existing two-project architecture: its handler validates the session against the original login project and resolves the research owner before accessing data.

## Data and usage

The migration adds `company_profiles.company_discovery`, a campaign-keyed JSON object, plus a service-role-only save RPC. It inherits existing project ownership and RLS; there are no new tables. The RPC locks the owning profile, checks the campaign still exists and the plan version matches, and atomically updates only the selected campaign's discovery state. Browser requests cannot supply company facts or arbitrary search queries.

Entering Phase 4 starts one run for the active saved campaign after reading its existing cache. Selecting another campaign loads or starts that campaign automatically. The server derives up to three queries from its audience, industry, ICP, keywords and locations. Each search returns at most eight links; at most ten distinct business domains are researched, one homepage per domain. Common directories, social sites, the original business and known competitors are excluded. Requests use the existing Firecrawl v2 [Search](https://docs.firecrawl.dev/api-reference/endpoint/search) and [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape) integrations.

Names and optional descriptions, industries and locations must have quotes found in the returned page text. Cross-domain redirects, pages classified as non-businesses, unsupported fields, and companies without campaign keyword evidence are omitted. Missing details stay null. Ranking uses observed keyword overlap and verified location matches; it is a prioritization hint, not a proven customer fit or a market estimate. Homepage-only research can miss details or companies that require deeper pages or different terminology.

Each provider request is reserved in the database before it is sent. Closing the browser pauses further requests; returning resumes remaining work for the selected campaign. An interrupted request remains counted and is not replayed. A two-minute reservation prevents concurrent tabs from consuming the same budget. Errors stop automatic progress; Resume remaining search uses only unspent requests. Exhausted runs retain partial results. Completed results load from Supabase without rerunning Firecrawl.

Changed campaign criteria automatically start an updated search within the existing limits. It replaces the current unsaved result list and retains saved companies with their original targeting evidence. A campaign allows at most three runs, each with at most three searches and ten homepage requests, and up to thirty saved companies. Searches and structured extraction consume the existing Firecrawl allowance; no paid plan is added.

## Phase 5 input

`company-discovery` accepts authenticated POST requests with `job_id` and `action: "load"`. It returns `discoveries` and `inputs`. Each input contains `job_id`, `project_id`, `campaign_id`, `campaign_name`, the verified saved `company`, and its `targeting` snapshot. Unselected search results and removed companies are excluded. Deleted campaigns are excluded. The same company can belong to different campaigns, but each campaign's results and saved list are deduplicated by business domain. Phase 5 can combine identical domains while retaining campaign associations.

The Phase 4 screen provides automatic discovery and saving, optional campaign choice, persisted results, filtering, selection, individual/bulk save and removal, source links, progress and errors. It continues automatically after successful discovery and saving, using the original viewing delay; Pause Auto-play still pauses that transition. Implementing contact discovery in Phase 5 remains a separate task; its existing content is not changed here.
