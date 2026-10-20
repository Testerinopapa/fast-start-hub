> Provider migration: the provider setup and deployment instructions below are historical. See [Context.dev migration](context-dev-migration.md) for the current implementation.

# Context.dev evaluation

The project uses React/Vite with npm and server-side Supabase Deno functions.
The initial integration uses the official context.dev 3.12.0 SDK for company
discovery search. Enable it with the server secret `AUTOGTM_SEARCH_PROVIDER=context`.
Keep `CONTEXT_DEV_API_KEY` server-side. Local values are in ignored
`supabase/functions/.env.local`; these do not configure hosted Supabase functions.

All requests pass through `supabase/functions/_shared/context-dev.ts`.
The existing authenticated discovery endpoint, budget reservations, candidate
ranking, saved results and website evidence verification remain in use.
Website enrichment still uses Firecrawl or the configured Crawl4AI provider.
No hosted secrets or functions were deployed during this evaluation.

## One real request

Endpoint: [POST /web/search](https://docs.context.dev/api-reference/web-scraping/search).
Query: `independent management consulting firm London about team clients -software -directory`.
The manual smoke script disabled retries and made one request. Selected output:

```json
{
  "request_id": "cec31a5a-97df-4cff-9ba3-0e689af3e54f",
  "credits_consumed": 1,
  "result_count": 8,
  "sample_urls": [
    "https://www.curzonconsulting.com/",
    "https://www.oaklin.com/",
    "https://www.berkeleypartnership.com/",
    "https://www.lilygrey.com/"
  ]
}
```

Results also included a directory and a news article. This proves authenticated
SDK search and the discovery-compatible result mapping, not that every result
is a qualified buyer. No browser-to-hosted-database test was performed.

## What this can support

The implemented search integration supplies fresh discovery candidates when a
user advances company discovery. Provider caching is accepted for this use case.
Structured website extraction could later support company research, news could
supply outreach context, and person enrichment could supplement people discovery.
Those extensions need separate evaluation of evidence quality and credit usage;
they are not implemented or called here.

## Validation

- Production Vite build passed, with its large-chunk warning.
- Wrapper and company-discovery endpoint passed Deno type checking.
- All four new mocked Context.dev tests passed: endpoint/auth/result mapping,
  transient retries, Retry-After, retry bounds and safe error messages.
- Existing full edge tests are blocked by campaign diagnostic type errors in
  pre-existing changes. The existing competitor-query test also fails its
  expectation that the first query contains `english`.
- The supplied credential is in a Git-ignored server env file, never Vite config.

See AGENTS.md for configuration and the explicit paid smoke command.
