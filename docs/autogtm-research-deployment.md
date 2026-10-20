# AutoGTM research deployment (Context.dev)

This guide supersedes the retired provider's deployment and webhook procedures.
The current source of truth is [Context.dev migration](context-dev-migration.md).

## Architecture

- Research project: `cvpeezzkzsbosyuhmhmf`. The authentication issuer is the separate project `hpkmrpezybhtyjcsxfiq`.
- The six active research/discovery functions use `supabase/functions/_shared/context-dev.ts` with the server-only secret `CONTEXT_DEV_API_KEY`.
- Research submits at most ten URLs per batch and stores provider IDs prefixed with `context:`. Finished results are reconciled by authenticated status polling, not callbacks.
- Existing ownership checks, project tables, SQL reservations, saved profiles and rate limits remain in place.
- The campaign-generation function is separate; it does not need to be redeployed for this provider migration.

## Deploy

Set `CONTEXT_DEV_API_KEY` in the research project's Edge Function secrets. Never put it in a `VITE_` variable, GitHub source, or frontend configuration. From an up-to-date repository checkout:

```powershell
npx supabase functions deploy start-research --project-ref cvpeezzkzsbosyuhmhmf
npx supabase functions deploy research-status --project-ref cvpeezzkzsbosyuhmhmf
npx supabase functions deploy research-projects --project-ref cvpeezzkzsbosyuhmhmf
npx supabase functions deploy competitor-research --project-ref cvpeezzkzsbosyuhmhmf
npx supabase functions deploy company-discovery --project-ref cvpeezzkzsbosyuhmhmf
npx supabase functions deploy people-discovery --project-ref cvpeezzkzsbosyuhmhmf
```

## Verify and retire old hosted assets

List deployed functions and run a signed-in, end-to-end company and discovery research test before removing any prior provider resources. A successful CLI deployment does **not** establish that paid provider calls work.

Follow [the hosted cleanup instructions](context-dev-migration.md#hosted-rollout) **only after** the new integration succeeds. Previous research jobs that used retired provider IDs must be restarted; completed profiles remain stored. No new SQL migration is required for this provider switch.

The removed historical procedures remain available through Git history if needed for auditing.