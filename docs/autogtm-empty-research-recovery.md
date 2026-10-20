> Provider migration: the provider setup and deployment instructions below are historical. See [Context.dev migration](context-dev-migration.md) for the current implementation.

# Empty competitors and campaigns: recovery

Read-only inspection on October 14, 2026 found two independent failures in the saved YouTube project:

- Competitor research completed three searches and ten pages with zero accepted companies. One query used Korean fitness audience details sourced from a YouTube creator channel. Most saved candidates were comparison articles or unrelated sites. The original save RPC makes completed competitor results immutable, so refreshing cannot redo this search.
- Campaign generation recorded two attempts and no campaigns. The latest attempt failed about 150 ms after its reservation with the generic fetch-exception message. This establishes a request/transport exception, not an empty Claude response. The old code did not retain enough diagnostics to distinguish malformed headers from network failures. The secret name exists; its contents and validity were not inspected.

## Prepared changes

Exclude creator-channel facts from competitor search context and Claude's audience/product facts. Prefer product-focused competitor queries, exclude obvious comparison articles and social results, and match first-party scrape redirects by business domain. Missing evidence still does not become a company fact. Search counts and ranking rejection categories are logged.

Trim outer whitespace from the OpenRouter secret and reject malformed header values before reserving a model request. Fetch failures now report safe configuration, DNS, TLS, timeout or network categories; HTTP failures include their status. Raw exceptions, keys and request bodies are never logged. No automatic model retry is added.

An explicit **Retry competitor research** action can replace an empty completed competitor state once. A service-role-only RPC checks ownership, version, completion, zero results and the two-run cap while holding a row lock. The new run retains the existing three-search/ten-website limits. Refreshes and concurrent submissions cannot reserve extra runs. No new table is required, and saved campaigns are not reset by this recovery.

## Deployment requires approval

Review the pending migration list before applying it; this change adds only `20261014000300_autogtm_retry_empty_competitors.sql`.

```powershell
npx supabase@2.120.0 db push --linked --dry-run
npx supabase@2.120.0 db push --linked
npx supabase@2.120.0 functions deploy campaigns --project-ref cvpeezzkzsbosyuhmhmf --use-api
npx supabase@2.120.0 functions deploy competitor-research --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

The retired callback is no longer deployed. Publish the frontend through the existing workflow. For current provider deployment, follow [Context.dev migration](context-dev-migration.md).

After deployment, the existing empty competitor project needs its explicit retry to use the corrected queries. Phase 3 needs **Regenerate suggestions** because its automatic attempt has already been consumed. If that request fails, the new error category identifies the next action; do not claim that the old generic connection failure has been conclusively diagnosed.

No deployment, paid provider request, build or test was performed while preparing this recovery.
