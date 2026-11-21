# Managed six-stage research

## Implemented and deployed

The managed `splee-research` function persists owner-scoped projects and six stages in Lovable Cloud. New starts use the existing create-project form and company explore route with `cloud=1`. Legacy research functions, routes, auth configuration, OpenOutFind workflows and proxy are unchanged.

1. Company profile: at most ten same-company pages; strict structured extraction; names and descriptions must occur in source text.
2. Competitors: bounded queries and five first-party domains; existing quote, domain and offering-overlap validators.
3. Campaigns: four to six structured segments with seller evidence and provisional fit; managed Lovable AI Responses, pinned SDK, no automatic inference retry.
4. Companies: one selected campaign, bounded queries and five websites; first-party business identity plus plausible buyer overlap required. Website verification does not verify customer fit.
5. People: at most three companies, two searches/four pages each; supported identifiable senior roles and employer association. No identity, email or phone synthesis. Current employment remains unverified.
6. Drafts: at most three; AI selects exact evidence quotations, then deterministic personalized composition uses saved identities. `SENDING_ENABLED=false`; no sending endpoint or email addresses.

Saved projects support status, export, campaign selection before customer searches begin, and company selection/removal. Atomic claim/revision checks consume operations before paid execution; ambiguous interrupted operations are not replayed. The workflow advances while the authenticated page remains open, by ten-second polling; it is not an unattended scheduled job. Closing the page pauses further work, and reopening continues saved progress.

## Changed files

- `supabase/functions/splee-research/index.ts`: authenticated job API, claims, persistence, missing-key guard and safe recovery.
- `supabase/functions/_shared/splee-core.ts`: six-stage orchestration and evidence validation.
- `supabase/functions/_shared/splee-ai.ts`: bounded managed AI structured requests.
- `supabase/functions/_shared/splee-auth.ts`: server-verified managed or trusted legacy identities; issuer-namespaced legacy owners.
- `supabase/functions/_shared/splee-core_test.ts`, `tests/splee-database.test.mjs`: mocked workflow, rules, isolation and usage tests.
- `drizzle/migrations/0003_managed_six_stage_research.sql` and generated journal/snapshot/types: applied managed job schema and atomic admission routines.
- `src/lib/sixStageResearch.js`: new authenticated Cloud requests and manual idempotent starts.
- `src/components/autogtm/SixStageWorkflow.jsx`, `GroundedEmailDrafts.jsx`, `ResearchButton.jsx`: existing output screen adapters, saved project selector/export, draft-only controls.
- `AppAutoGtmPage.jsx`, `AutoGtmWorkflowPage.jsx`, `Step1CompanyCard.jsx`: narrow entry wiring and honest evidence badge.
- `supabase/functions/deno.json`, `AGENTS.md`, `roadmap.md`: checks and implementation rules.

## Verification

- All nine deployed function entrypoints pass Deno contract checking.
- Nine PostgreSQL tests passed, including existing research/OpenOutFind tests, new owner isolation, browser read-only permissions, forged-owner mutation denial, idempotency and shared 100/day, 40/run safeguards.
- 33 mocked evidence/orchestration tests passed; one pre-existing optional capture replay ignored.
- Six-stage synthetic fixture completed with counts `1 / 1 / 4 / 1 / 1 / 1`; these are test data, not actual leads.
- Desktop/mobile browser rendering and authenticated synthetic export passed; no horizontal overflow or page exceptions. Private outputs disappeared after sign-out. This is mocked rendering, not real sign-in verification.
- Real deployed API: anonymous and forged JWT return 401; forged owner field returns 400; authenticated managed-account start/status/export succeed; repeated Calendly start retains the same project. Database confirms zero AI requests.
- Latest preview build log reports build OK. No manual production build or UI publication was triggered.

## Live blockers and output

`CONTEXT_DEV_API_KEY` is absent from Lovable project secrets. Add it in Project Settings → Secrets, then open the saved project and choose **Continue remaining research**. No separate backend setup or deployment credential is required.

The real Calendly job is blocked at stage 1: completed stages `0/6`, counts `0 / 0 / 0 / 0 / 0 / 0`. No website evidence, people or drafts were fabricated, and no paid research was performed.

Browser auth still uses the pre-existing external issuer. The tooling only minted a managed-account session, which does not hydrate that unchanged browser client. Consequently the actual existing-user signed-in browser start-to-output flow and external-issuer live auth fallback remain unverified; API persistence was verified with real managed auth, and UI behavior separately with synthetic transport. Auth settings and generated auth client were not changed.

Production UI has not been published; only the function and schema were deployed. Publishing should follow a real existing-user sign-in regression check. Adding the Context.dev key is required before evaluating real six-stage Calendly quality.

Saved output route: `/auto-gtm/company/calendly.com/explore?cloud=1&job=c014d8c6-fde5-46fb-b9aa-97fedf4a21f2` (private, sign-in required).
