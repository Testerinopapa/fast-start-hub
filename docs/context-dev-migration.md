# Context.dev research provider

Context.dev replaces the previous web data provider in all active AutoGTM stages:

| Stage | Context.dev calls |
| --- | --- |
| Company research | GET /web/urls, POST /batch/submit, GET /batch/{id}, GET /batch/{id}/results |
| Competitor research | POST /web/search, batch submission and polling |
| Company discovery | POST /web/search and POST /web/scrape |
| People discovery | POST /web/search and POST /web/scrape |

The official SDK is pinned to 3.12.0. All calls use the server-only wrapper
`supabase/functions/_shared/context-dev.ts` and `CONTEXT_DEV_API_KEY`. The search
and discovery provider flags are no longer used. The retired adapters, unused
Alexandria/Apollo integration and old webhook have been removed from source.

The frontend, authentication issuer, ownership checks and SQL reservations remain
in place. No database migration is required: provider IDs are already text.
New batch IDs are stored as `context:<id>`. Existing completed profiles remain
available. Unfinished old-provider batches receive `PROVIDER_CHANGED` and require
new research; they are never interpreted as Context.dev jobs.

## Job behavior

Submissions use stable idempotency keys scoped to the research job and competitor
run. They contain at most ten public URLs, requesting Markdown and structured JSON.
Scraping accepts cached content up to one day old. JSON extraction may cost more
than a plain Markdown scrape; a ten-page limit is not a ten-credit guarantee.

The browser polls at ten-second intervals. Batches continue at Context.dev when
the page closes; results are saved on the next authenticated poll after reopening.
There is no webhook or background reconciliation in this version. If a submission
response is lost, later polls do not blindly resubmit it; check Context.dev batch
activity before starting a replacement. Unconfirmed company jobs expire after
30 minutes; competitor submissions become failed after their lease expires.

Failed formats never become evidence. Result pagination uses opaque cursors and
the fixed API origin, and results are reordered by itemId before profile assembly.
Existing source checks, verification and search reservations remain enforced.
This provider migration does not fix the HubSpot primary-category and campaign
targeting problems identified in the earlier export.

## Hosted rollout

These are local source changes until deployed to the research project. Do not
change the login/Lovable Cloud project or put this secret in a VITE_ variable.
Configure `CONTEXT_DEV_API_KEY` in research-project secrets with permission for
search, mapping, scraping and batch read/write. Deploy these functions together:

```powershell
supabase functions deploy start-research --project-ref cvpeezzkzsbosyuhmhmf
supabase functions deploy research-status --project-ref cvpeezzkzsbosyuhmhmf
supabase functions deploy research-projects --project-ref cvpeezzkzsbosyuhmhmf
supabase functions deploy competitor-research --project-ref cvpeezzkzsbosyuhmhmf
supabase functions deploy company-discovery --project-ref cvpeezzkzsbosyuhmhmf
supabase functions deploy people-discovery --project-ref cvpeezzkzsbosyuhmhmf
```

Publish the frontend for the new polling interval. Verify all six deployed
functions with `supabase functions list --project-ref cvpeezzkzsbosyuhmhmf`,
then perform a signed-in, end-to-end Context.dev research run and inspect errors
in Edge Function logs. A successful upload alone does not verify provider access.

Once the live workflow succeeds, retire the previous provider's hosted assets
from the **research** project (not the separate authentication project):

```powershell
npx supabase functions delete firecrawl-webhook --project-ref cvpeezzkzsbosyuhmhmf
npx supabase secrets unset FIRECRAWL_API_KEY --project-ref cvpeezzkzsbosyuhmhmf
```

Deleting source code from GitHub does not delete hosted functions or secrets.
Do not run these cleanup commands until the replacement pipeline is verified.
No provider secret should ever be committed to this repository.

## Verification

Provider tests use mocked HTTP responses and do not consume credits. Check
`_shared/context-dev_test.ts` and the research/discovery endpoint tests for schema
mapping, partial failures, idempotency, pagination, ownership and legacy-job cases.
The repository has pre-existing campaign diagnostic type errors and campaign CRUD
test failures; they are independent of the provider migration.

Validation on this migration: the production build and targeted type checks for
all six research/discovery functions passed. All 11 wrapper tests passed. The
endpoint runtime suite was run with type checking disabled because its campaign
import has existing type errors: ten research/provider tests passed; the existing
campaign CRUD test failed (409 versus expected 200). No live paid requests were
made for this migration; hosted integration still requires rollout verification.

API references: [scrape](https://docs.context.dev/api-reference/web-scraping/scrape),
[map](https://docs.context.dev/api-reference/web-scraping/map),
[search](https://docs.context.dev/api-reference/web-scraping/search),
[batches](https://docs.context.dev/batches/overview),
[batch results](https://docs.context.dev/batches/results).
