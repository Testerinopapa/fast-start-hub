# Phase 4: discovery and enrichment

Prepared locally; not deployed. Publish only after approval. No new tables, migrations, secrets, services or dependencies are needed. Existing ownership checks, the `company_profiles.company_discovery` JSON column and the service-role-only compare-and-swap RPC are reused.

## Root cause

Read-only inspection found a completed Nvidia campaign with three searches, eight candidate websites and zero accepted companies. The searches were `Nvidia`, `Nvidia Nvidia Bug tracking`, and `Nvidia nvidia bug tracking purpose built engineering team`. ElevenLabs similarly returned seven candidates and zero accepted companies.

The old verifier required readable text, structured business classification, a quoted name, a quoted description or industry, matching domain metadata, and exact campaign vocabulary within the extracted description/industry. Any missing requirement discarded the entire candidate. It did not preserve search titles/snippets, replaced search landing pages with homepages, and recorded only a generic rejection message. The stored records cannot establish which individual gate rejected each historical page. The old brand-name campaigns also provide weaker targeting than actual customer segments; this change does not rewrite saved campaign criteria.

## New behavior

- At most three short, complementary searches use audience, industry, keywords and optional locations. ICP boilerplate and repeated audience phrases no longer crowd the queries.
- Each search requests eight results; at most ten distinct domains are retained and enriched, with one website request per candidate. The selected landing-page URL is retained for enrichment.
- Candidates enter `results` and Supabase immediately as **Unverified**, before enrichment completes. Their domain, source URLs, original search title and available search snippet are retained. A search title is not presented as a verified company name. Missing name, industry and location remain null.
- Website enrichment verifies individual fields against quoted page text. Missing fields, weak keyword overlap, unavailable extraction and source restrictions retain the candidate. Directories/social/review hosts, unsafe URLs and file results are excluded with logged reasons. A nonbusiness classification must include a supported page quote before rejecting an enriched source.
- **Website verified** means the page was classified as a business and at least its name or description was confirmed against its text. It does not establish that the company is an ideal customer. Campaign relevance is assessed separately using page vocabulary and available location evidence; weak matches stay visible.
- Research confidence is low for search-only/unverified evidence, medium for partial verified business identity, and high when both name and description are confirmed. These are qualitative evidence levels, not conversion probabilities. Descriptions retained from search are explicitly labeled unverified snippets, even when other website facts are verified.
- The original table and loading animation remain. Once its minimum animation completes, the table reveals available candidates while enrichment continues. Saving preserves research status, confidence, evidence, source URLs and targeting data. Existing automatic saving includes unverified candidates without relabeling them verified.

## Diagnostics

Structured `autogtm.discovery` console events and up to 100 diagnostics per run record queries, returned-result counts, retained-domain counts, duplicate domains, budget exclusions, source rejection reasons, missing/unconfirmed fields and provider failures. The existing Search notes disclosure shows these persisted diagnostics. Raw provider bodies, page contents, authorization headers and API keys are not logged.

## Existing saved runs and budgets

On the first load, old runs are upgraded through the existing version-checked RPC. Eligible cached domains omitted by the old verifier reappear as Unverified with an explanation that their specific historical rejection reason is unavailable. Existing verified results, saved selections, removed domains, criteria, consumed request counts and query history are preserved. Active reservations are left alone until finished or stale. No Firecrawl requests are repeated to recover cached candidates.

Completed runs stay cached. Better query construction applies to new runs; it does not silently rerun completed searches or reset their budgets. A changed campaign retains the existing three-run maximum and thirty-saved-company limit. Provider requests remain reserved before sending, so interrupted requests count toward the same limits. Authentication, credit and unknown provider errors stop the run while leaving discovered candidates available. Documented unsupported/restricted sources keep an unverified candidate and allow the remaining bounded enrichment to continue.

## Deployment after approval

1. Publish the updated frontend through the existing Lovable/Git workflow. It sends `data_version: 2` and understands unverified rows.
2. Deploy only the affected function:

```powershell
npx supabase@2.120.0 functions deploy company-discovery --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

The endpoint rejects older clients with an explicit refresh message before returning unverified data, because the old UI labels every result as verified. Other pipeline functions do not need redeployment. No `db push` is required.

Investigation used existing source code and read-only database inspection. Tests, builds and live Firecrawl requests were not run, following the request to avoid validation scripts. Successful live discovery/enrichment has not been verified for these local changes.
