> Provider migration: the provider setup and deployment instructions below are historical. See [Context.dev migration](context-dev-migration.md) for the current implementation.

# Phase 3: Claude campaign generation

Prepared locally; not deployed. The user clarified that the provider is **Claude through OpenRouter**, superseding the conflicting Gemini instructions. The implementation uses `OPENROUTER_API_KEY`, not `GEMINI_API_KEY`. No supplied credential is stored in source, frontend configuration, migrations or this document.

## Provider and request limits

The pinned model is `anthropic/claude-haiku-4.5`, using OpenRouter's chat-completions API and strict JSON-schema output. This is a paid model, not a Gemini free-tier model. At implementation time, the [OpenRouter model page](https://openrouter.ai/anthropic/claude-haiku-4.5/pricing) lists $1 input / $5 output per million tokens. Pricing may change. Each request caps output at 6,000 tokens, uses bounded saved research, disables provider fallbacks, and makes no retry/model-repair call. [Structured-output documentation](https://openrouter.ai/docs/guides/features/structured-outputs) describes `response_format` and required-parameter routing.

Entering Phase 3 requests one automatic generation per **project**, even across refreshes, tabs and later research jobs. Loading a saved later phase does not initiate automatic generation. A project-row reservation is committed before the model request. Errors, rejected JSON, interrupted requests and failed saves never trigger a second automatic model call. Explicit **Regenerate suggestions** reserves another request. Duplicate submissions use version checks and request IDs; one request runs per project at a time. A two-minute abandoned reservation becomes failed, requiring explicit regeneration.

## Research and validation

The endpoint authenticates using the existing login project, checks research ownership, and requires completed company and competitor research. It sends only bounded business descriptions, products, audiences, competitor descriptions/products/audiences, source references and protected audience names. It does not send contacts, auth sessions or raw crawled pages.

Claude must return 4–6 distinct potential customer segments. Each has a name, target audience, industry, ICP, potential pain points, observable criteria, customer-search keywords, optional supported locations, reasoning and references to supplied research facts. The prompt distinguishes the seller from its prospective customers, warns against adopting competitors' features as company facts, permits valid individual/consumer audiences, and prohibits the old generic buying-context templates and invented sizes/counts.

The server checks JSON shape, required fields, length/list limits, duplicate audiences, allowed research references and at least one company offering/product reference per suggestion. It rejects unexpected fields and numerical market/lead claims. Sources are resolved from the saved research, never generated URLs. Every AI audience is marked **inferred**, with counts left empty. Validation establishes structure and reference provenance; it does not prove that an inferred opportunity is commercially valid.

## Preservation and UI

The old rule generator is removed. Existing campaign field validation and targeting data remain compatible with Phase 4. The original cards, 120ms appearance stagger, skeleton timing, and autoplay are reused. The only new action in the existing toolbar is Regenerate suggestions.

Legacy generic suggestions such as “First-time buyers of YouTube” are filtered from both cards and targeting criteria; custom and customized campaigns are retained. When filtering leaves a saved later-phase project without campaigns, the frontend changes the active phase back to Phase 3 so its automatic-generation request can run. Loading remains visible while that request is pending. Adding a secret alone does not regenerate a saved plan. This compatibility fix requires publishing the frontend and redeploying `campaigns`; it adds no migration.

Generation replaces untouched `suggested` campaigns while preserving `custom` and `customized` campaigns, their IDs, contents and selections. Completion merges against the latest database plan, protecting edits made in another tab while Claude responds. Existing campaign pain points/criteria are no longer discarded when editing other fields. At least four suggestion slots must remain within the existing 12-campaign limit; more than eight protected campaigns prevents a model call. Concurrent edits that remove that capacity preserve the old plan and show an error. No custom campaign is silently deleted to make room.

Generation errors are shown in the existing card area. Autoplay stops on generation failure, but users can still manually continue with valid saved/custom campaigns. Refresh reloads saved results. After one project-level generation, a different research job requires explicit regeneration rather than silently spending another automatic request. Untouched suggested campaign IDs can change on regeneration; downstream research remains in storage, but only current campaign IDs appear in the workflow. Keep a campaign customized if it must survive regeneration.

## Database changes

`20261014000200_autogtm_ai_campaigns.sql` adds `projects.campaign_generation` and two service-role-only RPCs for reservation and atomic completion. Campaigns continue to live in the existing `company_profiles.campaign_plan`. Existing ownership/RLS and two-project authentication are preserved. No new table, SDK, background worker or Firecrawl request is introduced.

## Setup and deployment after approval

1. Rotate the credential pasted into chat. In the research project's Supabase Dashboard → Edge Functions → Secrets, set the replacement as `OPENROUTER_API_KEY`. Do not put it into a frontend `.env` file or command history. Ensure that OpenRouter has credits and access to Claude Haiku 4.5.
2. Review pending migrations from the existing linked repository:

```powershell
npx supabase@2.120.0 db push --linked --dry-run
```

3. Once the proposed migration set is approved, apply it and deploy only the campaigns function:

```powershell
npx supabase@2.120.0 db push --linked
npx supabase@2.120.0 functions deploy campaigns --project-ref cvpeezzkzsbosyuhmhmf --use-api
```

If the dry run includes unrelated pending migrations, resolve their deployment scope first. Publish the updated frontend through the existing Lovable/Git workflow. Its Phase 3 load includes the automatic-generation flag; older frontends do not request automatic model calls. No auth-provider or Firecrawl secret changes are needed.

No remote migration, deployment, model request, build or test run was performed during implementation. The obsolete tests for the deleted rule generator were removed; unrelated tests remain. Live model output quality and migration execution remain unverified until an approved deployment.
