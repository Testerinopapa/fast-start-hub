# Project rules

- Keep bulky offline visual capture JSON compressed as `.json.gz`, restoring it only for reference analysis, so publishing does not load gigabytes of unused data; retain the introduction capture used by existing inspection scripts uncompressed.
- Bind application authentication and service clients to the base Lovable Cloud configuration in Vite, ignoring legacy production overrides, because managed OAuth sessions must be validated by their issuing service.
- Exclude OAuth credential fragments from product-route matching so opaque token contents cannot select a public page.

## Context.dev

- React/Vite is browser-only; Context.dev belongs in Supabase's Deno TypeScript functions. npm manages the SDK dependency; pin the Deno import to the same SDK version.
- Keep `CONTEXT_DEV_API_KEY` in ignored `supabase/functions/.env.local` locally and Supabase function secrets when deployed. Never prefix it with `VITE_` or import the wrapper into `src/`.
- Route all calls through `supabase/functions/_shared/context-dev.ts` (official SDK). `AUTOGTM_SEARCH_PROVIDER=context` opts company discovery into Context.dev; unset it to use the existing search provider. Website enrichment still requires the existing Firecrawl/Crawl4AI credentials.
- Chosen endpoint: `POST /web/search`, https://docs.context.dev/api-reference/web-scraping/search — eight company candidates per query, with existing three-query limits and evidence verification. Search results are unverified leads, not contact records or verified company facts.
- Metadata-only search accepts provider caching; this endpoint has no top-level `maxAgeMs`. If adding inline Markdown later, consult the documented `markdownOptions.maxAgeMs` setting.
- Retry only HTTP 408/429/5xx, at most twice, honoring Retry-After; long delays surface an error instead of retrying early. Never log raw SDK errors. Automated tests use mocked transport and must not call the paid API.
- Manual paid smoke check (one request, retries disabled): `npx deno@2.9.6 run --config supabase/functions/deno.json --env-file=supabase/functions/.env.local --allow-env --allow-net=api.context.dev scripts/context-dev-smoke.ts`.
- Setup docs: https://docs.context.dev/quickstart. Further candidates for evaluation are structured website extraction, company news and person enrichment; these are not enabled or called by this integration.
