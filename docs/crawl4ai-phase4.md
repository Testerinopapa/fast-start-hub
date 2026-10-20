> Provider migration: the provider setup and deployment instructions below are historical. See [Context.dev migration](context-dev-migration.md) for the current implementation.

# Crawl4AI Cloud — Phase 4 opt-in integration

The Phase 4 Edge Function can use Crawl4AI Cloud for search and scraping while keeping the original Firecrawl implementation as the default. This integration does **not** replace the other Firecrawl-powered phases.

## Prerequisites

Crawl4AI Cloud's hosted API supports GET /search?q= and POST /scrape with `{ "url": "...", "format": "md" }`. The free hosted credits are introductory, **not an unlimited free API**. The open-source self-hosted crawler does not include the same Cloud web-search endpoint.

Official docs: https://api.crawl4ai.com/docs/ and https://docs.crawl4ai.com/

## Enable (Supabase research project only)

Set `CRAWL4AI_API_KEY` through the Supabase Dashboard → Edge Functions → Secrets. Never use VITE variables or put the API key in the repository.

Set the additional secret `AUTOGTM_DISCOVERY_PROVIDER` to `crawl4ai`. Without this exact value, Phase 4 keeps using Firecrawl.

Deploy only:

```powershell
npx --yes supabase@2.120.0 functions deploy company-discovery --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

## Safety, budgets, and limitations

- Each search/page request uses the current database reservation and the **existing** limit of three searches and up to ten pages per campaign run.
- Saved projects/results remain unchanged. To validate the new provider, start an unused campaign; do not reset saved runs just to retest.
- Crawl4AI scrape currently yields **unverified** candidate records. It does not generate the quote-validated JSON extraction that the Firecrawl path provides. Never label these as website-verified or confirmed buyers until a structured verification adapter is added.
- Crawling a public page does not establish that the page owner is an actual buyer.
- Guest access is enabled elsewhere; before general availability, add account/IP-based spending caps or an approval gate. Per-owner caps alone do not prevent a visitor from creating more anonymous identities.
- No automated paid retry. Failed reservations count toward the existing budget.
- Roll back by removing `AUTOGTM_DISCOVERY_PROVIDER` (or setting it to `firecrawl`) and redeploying. Keep `FIRECRAWL_API_KEY` for the other phases.
- Cloud API calls consume hosted credits; self-hosting incurs infrastructure costs and needs a separate search source.
