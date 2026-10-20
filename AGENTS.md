# Project rules

- Keep bulky offline visual capture JSON compressed as `.json.gz`, restoring it only for reference analysis, so publishing does not load gigabytes of unused data; retain the introduction capture used by existing inspection scripts uncompressed.
- Bind application authentication and service clients to the base Lovable Cloud configuration in Vite, ignoring legacy production overrides, because managed OAuth sessions must be validated by their issuing service.
- Exclude OAuth credential fragments from product-route matching so opaque token contents cannot select a public page.

## Context.dev

- React/Vite is browser-only; Context.dev belongs in Supabase's Deno TypeScript functions. npm manages the SDK dependency; pin the Deno import to the same SDK version.
- Keep `CONTEXT_DEV_API_KEY` in ignored `supabase/functions/.env.local` locally and Supabase function secrets when deployed. Never prefix it with `VITE_` or import the wrapper into `src/`.
- Route all web research through `supabase/functions/_shared/context-dev.ts` (official SDK). Context.dev is the sole active provider for company research, competitors, company discovery and people discovery; no provider-selection flags are required.
- Endpoints: [search](https://docs.context.dev/api-reference/web-scraping/search), [URL mapping](https://docs.context.dev/api-reference/web-scraping/map), [structured scraping](https://docs.context.dev/api-reference/web-scraping/scrape), [batch submission](https://docs.context.dev/batches/overview) and [batch status/results](https://docs.context.dev/batches/results). Preserve existing search and ten-page batch limits. Search results are unverified leads, not verified company facts.
- Normalize per-format success/data, final URLs and batch progress inside the wrapper. Keep Markdown for evidence checks, set scraping `maxAgeMs` explicitly (currently one day), and never treat failed JSON outputs as facts.
- Batches use stable Idempotency-Key values and stored `context:`-prefixed IDs. Paginate with opaque cursors at the fixed API origin, never provider-supplied download URLs. Preserve original page order using itemId. Authenticated clients poll every ten seconds; there is no research webhook. Old completed results remain readable; unfinished old-provider batches fail explicitly without new paid work. A lost submission confirmation is not automatically resubmitted by later polls.
- Metadata-only search accepts provider caching; this endpoint has no top-level `maxAgeMs`. If adding inline Markdown later, consult the documented `markdownOptions.maxAgeMs` setting.
- Retry only HTTP 408/429/5xx, at most twice, honoring Retry-After; long delays surface an error instead of retrying early. Never log raw SDK errors. Automated tests use mocked transport and must not call the paid API.
- Manual paid smoke check (one request, retries disabled): `npx deno@2.9.6 run --config supabase/functions/deno.json --env-file=supabase/functions/.env.local --allow-env --allow-net=api.context.dev scripts/context-dev-smoke.ts`.
- Deployment and migration notes: `docs/context-dev-migration.md`. Company news and identity enrichment endpoints are not enabled; people discovery uses public-page search and evidence-based extraction.
