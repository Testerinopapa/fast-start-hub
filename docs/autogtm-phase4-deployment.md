# Phase 4: Find Companies

Implemented locally. No remote migration, function deployment, or live Firecrawl request was made for this change. Tests and build commands were not run, following the request to skip validation work.

## Deployment after approval

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

Clicking Find Companies starts one run for a saved campaign. The server derives up to three queries from its audience, industry, ICP, keywords and locations. Each search returns at most eight links; at most ten distinct business domains are researched, one homepage per domain. Common directories, social sites, the original business and known competitors are excluded. Requests use the existing Firecrawl v2 [Search](https://docs.firecrawl.dev/api-reference/endpoint/search) and [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape) integrations.

Names and optional descriptions, industries and locations must have quotes found in the returned page text. Cross-domain redirects, pages classified as non-businesses, unsupported fields, and companies without campaign keyword evidence are omitted. Missing details stay null. Ranking uses observed keyword overlap and verified location matches; it is a prioritization hint, not a proven customer fit or a market estimate. Homepage-only research can miss details or companies that require deeper pages or different terminology.

Each provider request is reserved in the database before it is sent. Closing the browser pauses further requests; returning resumes remaining work for the selected campaign. An interrupted request remains counted and is not replayed. A two-minute reservation prevents concurrent tabs from consuming the same budget. Errors stop automatic progress; Resume remaining search uses only unspent requests. Exhausted runs retain partial results. Completed results load from Supabase without rerunning Firecrawl.

Changed campaign criteria require an explicit Search updated criteria action. It replaces the current unsaved result list and retains saved companies with their original targeting evidence. A campaign allows at most three runs, each with at most three searches and ten homepage requests, and up to thirty saved companies. Searches and structured extraction consume the existing Firecrawl allowance; no paid plan is added.

## Phase 5 input

`company-discovery` accepts authenticated POST requests with `job_id` and `action: "load"`. It returns `discoveries` and `inputs`. Each input contains `job_id`, `project_id`, `campaign_id`, `campaign_name`, the verified saved `company`, and its `targeting` snapshot. Unselected search results and removed companies are excluded. Deleted campaigns are excluded. The same company can belong to different campaigns, but each campaign's results and saved list are deduplicated by business domain. Phase 5 can combine identical domains while retaining campaign associations.

The Phase 4 screen provides campaign choice, persisted results, filtering, selection, individual/bulk save and removal, source links, progress and errors. It only unlocks continuation after at least one company is saved. Implementing contact discovery in Phase 5 remains a separate task; its existing content is not changed here.
