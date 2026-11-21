# On-demand Splee using GitHub Actions (no Render bill)

This is the **default Splee testing path** for Explee. It replaces the *need to deploy* the previously proposed paid Render web server, AI gateway, and PostgreSQL. The Render Blueprint remains unapproved and inactive.

## Workflow

[.github/workflows/splee-actions-ephemeral.yml](../../.github/workflows/splee-actions-ephemeral.yml)

```text
Manual GitHub Actions run (or temporary branch smoke test)
  -> checkout Splee AGPL source at pinned SHA
  -> compile real Rust backend with Cargo
  -> launch temporary PostgreSQL 17 in GitHub runner
  -> start backend on 127.0.0.1:8787; migrations apply on startup
  -> create a disposable first-owner QA account and API key
  -> smoke: check API key + clean project list; no AI requests
  -> research: create a real Splee project, run its six-step explore agent
       -> local Claude CLI -> local LiteLLM -> existing Explee Lovable AI proxy
  -> aggregate-only result JSON + workflow summary
  -> terminate local processes; runner/Postgres discarded
```

**No Lovable development tools, Explee login changes, dashboard changes, Render billing, or persistent Splee server.** No outreach is permitted: `SENDING_ENABLED=false` and no real SMTP mailboxes are configured. Data stays in the runner and is deleted with its job.

## Usage

In GitHub: **Actions → Splee Ephemeral GitHub Actions Pipeline → Run workflow**.

- **smoke** (default) boots Splee and PostgreSQL, validates real migrations and a temporary local API key. It needs no model key, generates no prospects, does not call AI and does not claim output accuracy.
- **research** is an explicit opt-in to Splee's full six-stage `explore` workflow (company, competitors, campaigns, buyer companies, people, emails). It launches a Claude CLI + LiteLLM bridge, uses Lovable AI credits, runs against a public `domain` such as `calendly.com`, and never approves/sends email.

The *research* option requires the existing GitHub Actions repository secret **`OPENOUTFIND_LLM_API_KEY`**, used with the working Explee `openoutfind-ai` proxy. It authenticates using `x-explee-run-id: github-<run>-<attempt>` and is subject to **the existing backend safeguards** (40 requests per run and 100 per day). The workflow's `OPENOUTFIND_AI_API_BASE` defaults to the verified Lovable Cloud proxy on project `emlggkmtbosahpzrxaul`; optional repository variable `OPENOUTFIND_AI_API_BASE` overrides it.

The Anthropic-model name `claude-sonnet-5-5` is only an **adapter alias**. The intended actual inference provider is **Lovable AI `openai/gpt-6-luna`**. Splee's Rust agent uses the Claude SDK and Claude CLI; local LiteLLM routes that API to the existing Lovable AI OpenAI-compatible proxy. This bridge may still fail for Claude-specific `WebSearch`/`WebFetch` tools or structured-output schema handling. **Those compatibility boundaries are not proven merely by passing a local API health check or synthetic tests.** If real research fails, the workflow reports failure and preserves non-sensitive stage counts, not fabricated company facts or prospects. We do not silently use Anthropic paid API or send actual emails as fallback.

## What the tests prove

The on-demand **smoke** run confirms the real Splee binary can start against PostgreSQL, apply migrations, perform first-time local account setup and generate a local API key. It does not prove functioning AI or research quality.

The opt-in **research** run polls Splee's real enqueued agent and evaluates its output using `scripts/splee_pipeline_qa.py`, which checks missing names, employer/source fields, duplicate profiles, buyer-company domain/source mismatch, and unfinished email templates. The workflow uploads **only aggregate QA JSON**. It does not upload the SQLite/Postgres database, source URLs tied to individual people, message bodies, API tokens or raw agent output. `quality_verified` stays `false` until an independent review of first-party evidence.

Note: the existing read-only Splee API v1 does not expose competitor records. That part of the QA report is explicitly `not_exposed_by_api_v1`; live six-stage execution does *not* mean competitor quality was independently checked.

## Cost and scope

- **Render:** no charge; no Render resources are needed or created.
- **GitHub Actions:** consumes runner minutes and storage under the repository's GitHub billing/usage plan; compiling Splee's Rust workspace is relatively heavy. Caching helps future runs.
- **Lovable AI:** no usage for smoke; **research** consumes AI credits and is subject to existing backend limits.
- **PostgreSQL:** temporary PostgreSQL container inside GitHub job, no separate database provider charges.
- **Splee:** open-source AGPL-3.0; its source is used at exact commit `3c2b1723bc9651a2cd2872ae6a3b4939501c8435` and is not copied into Explee's proprietary application.

For continuous uptime, Splee would still need an always-on host and database. **This Actions workflow is intentionally a batch testing pipeline, not a deployed permanent website.**

## Troubleshooting

- **Build failure:** check the Cargo and Rust toolchain steps; no AI credits are used.
- **Backend startup failure:** Splee's migration or app configuration is invalid. Server logs are kept only inside the temporary runner, not exported with potential source data.
- **Missing OPENOUTFIND_LLM_API_KEY:** research job stops before the model gateway starts. Smoke still works.
- **Lovable AI 429 / rate limit:** current per-run/day safeguards are enforced by the existing Explee proxy; do not raise them silently.
- **Research agent failure:** inspect stage counts in the aggregate report; Claude built-in web search and LiteLLM protocol conversion require further compatibility testing.
- **No prospects or email drafts:** not a pass. Output is reported as partial/incomplete, with `output_quality_verified=false`.

Prior paid Render Blueprint: `exs-dc0dk8uc6qcc738j3pug` — **not approved, not deployed, and unnecessary for GitHub Actions QA**.


## November 20 Calendly live investigation

This integration **is not ready to produce verified Explee six-stage output**:

- [Smoke run 44845214114](https://github.com/Testerinopapa/fast-start-hub/actions/runs/44845214114): successful real Rust build, migrations and API authentication.
- [First real research attempt 44847874270](https://github.com/Testerinopapa/fast-start-hub/actions/runs/44847874270): LiteLLM never became ready. The workflow passed Splee's `DATABASE_URL` to LiteLLM, which has its own Prisma database startup path; the gateway must launch with that variable unset. The gateway env isolation fix is now in the workflow.
- [Research attempt 44848776079](https://github.com/Testerinopapa/fast-start-hub/actions/runs/44848776079): LiteLLM started, but Splee's real six-stage agent **failed on step 1**. Its project profile stayed incomplete; campaigns, buyer companies, people, and email drafts all had zero records.
- [Typed error research attempt 44849418615](https://github.com/Testerinopapa/fast-start-hub/actions/runs/44849418615): step 1 again failed, categorized as `ai_answer_unusable`. The raw agent error was not exported.
- [Model protocol probe 44849610962](https://github.com/Testerinopapa/fast-start-hub/actions/runs/44849610962): a direct OpenAI-compatible Lovable AI request and a separate Anthropic-style request through LiteLLM both returned valid HTTP 200 responses. This proves basic model compatibility, **not** Splee's required structured-output and WebSearch/WebFetch behavior.

**Do not interpret a healthy server, one-word model response, or synthetic fixture as proof that Splee creates good research.** Next implement/test the Claude Agent SDK structured-output format and web tools against this gateway, then perform human source verification on an actual six-stage output. No default model switching, retry loops, email sends or invented evidence should be introduced.

