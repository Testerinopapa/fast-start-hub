# Splee server → Lovable AI (QA deployment proposal)

## Status

**Configuration prepared and validated in GitHub. NOT deployed.**

Render Blueprint ID: `exs-dc0dk8uc6qcc738j3pug` (user's connected Render workspace).

The first Render plan rejected `fromService.property: url`; it was corrected to `envVarKey: RENDER_EXTERNAL_URL`. The second plan blocked with `need_payment_info` for all three planned resources. **No infrastructure has been approved or created**, and no Lovable AI calls have been run through Splee.

This is a **separate QA stack**, not a replacement of Explee's current research or OpenOutFind pipeline. No Explee frontend/login/DB changes and no Lovable development tools.

## Actual architecture

```text
Explee UI (Lovable / existing project)
       |
       |  (future opt-in integration; NOT connected yet)
       v
Splee Rust HTTP API + workers (Render web service, AGPL-3.0)
       |                              |
       |                              +--> separate Render PostgreSQL
       v
Splee Claude Agent SDK → local claude CLI
       |
       |  Anthropic Messages API
       v
LiteLLM (Render PRIVATE service)
       |  Anthropic Messages → OpenAI Chat Completions
       v
https://ai.gateway.lovable.dev/v1
       |  LOVABLE_API_KEY, model openai/gpt-6-luna
       v
Lovable AI
```

Lovable Cloud runs PostgreSQL and Supabase-compatible server functions; it does **not** directly deploy Splee's persistent Rust worker and database migrations. For a working Splee backend it needs an external container host (Render proposed). The gateway and Splee server are separate, and the gateway must not be exposed publicly.

Source pinned to `Iweisc/splee@3c2b1723bc9651a2cd2872ae6a3b4939501c8435`. Splee is licensed AGPL-3.0-only; its source is cloned from the official public repository during the Docker build rather than incorporated into Explee. If we modify/serve that program, users of the modified Splee service must be offered its corresponding source under AGPL, including modifications. Review before production deployment.

## Container configuration

The Render Blueprint at `deploy/splee/render.yaml` requests:

- Public backend `explee-splee-backend` — Docker Rust Splee, health at `/api/health`; agent concurrency 1; **SENDING_ENABLED=false**, **PUBLIC_AGENT=false**, **OPEN_SIGNUP=false**.
- Private AI gateway `explee-splee-ai-gateway` — LiteLLM 1.110.2, OpenAI-compatible Lovable AI model, an internal-only Anthropic Messages endpoint for Splee's CLI.
- `explee-splee-postgres` — isolated PostgreSQL 17, no public database ingress.

Render will generate backend `APP_SECRET` and the shared gateway password and wire them between the two services (with references; no secrets committed). **Only the project's `LOVABLE_API_KEY` is a required manual secret**, entered on the *private AI gateway service* in Render, not in GitHub, app frontend or this repository. Use a Lovable Cloud project key that has Lovable AI access and permission for the requested model. Do not share it in chat.

The gateway presents Splee's requested model name `claude-sonnet-5-5` but actually routes inference to Lovable AI `openai/gpt-6-luna` via LiteLLM translation. That alias **does not mean Anthropic Claude models or services are being used for inference**. The Claude CLI remains the SDK's runtime protocol/tool client.

## Important compatibility blockers to test

1. **Model authorization:** Verify the externally supplied project `LOVABLE_API_KEY` can call `https://ai.gateway.lovable.dev/v1/chat/completions` from Render using the full model id. The key is not automatically available outside its Lovable Cloud project.
2. **Anthropic protocol translation:** Splee uses Claude Agent SDK `output_format=json_schema` and expects structured output from Claude CLI. LiteLLM must translate this correctly to Lovable Chat Completions. A working `/v1/models` or chat with `ok` does not prove this step.
3. **Web search/tool calls:** Splee's research uses Claude's built-in `WebSearch` and `WebFetch`. These are NOT guaranteed to work with an OpenAI-compatible model via LiteLLM. If those tools are unavailable, the six-stage Splee research pipeline will require an explicit local search/fetch MCP adapter (e.g. Context.dev) before it can be called functional. **No automatic fallback to invented sources.**
4. **Splee backend build:** Static deployment checks pass, but this configuration has not yet compiled Splee's full Rust workspace inside the proposed Render image.
5. **Output accuracy:** Even if all service health checks pass, run a real QA project first and verify company facts, competitors, buyer-company fit, professional identities, and draft accuracy. No outreach until quality checks pass.
6. **Explee frontend:** No frontend integration has been made. The existing separate `Explee Splee Six-Stage QA` GitHub Actions workflow can inspect an existing Splee project once this server is live.

## Deploy when approved

1. **Render billing:** Add a payment method to the Render workspace if you approve the paid compute and database resources. The plan previously returned `need_payment_info`; no deployment approval has been requested or granted.
2. In Render, review the existing Blueprint `explee-splee-lovable-ai-qa` and the estimated recurring costs. Correct size or plan as necessary.
3. On initial approval, supply the `LOVABLE_API_KEY` value on the **private gateway**, directly in Render's UI. Set `LOVABLE_API_KEY` from the Lovable Cloud project/server-side secret. Do not paste secrets into repo files or chat messages.
4. Verify both deployments in Render. Inspect `/api/health` (backend) and LiteLLM `/v1/models` (private gateway), and test a single **structured** research tool call with no email/send actions. If the tools or JSON output fail, stop rather than asserting six-stage success.
5. Create an isolated Splee QA project with Calendly or another public company. Leave `SENDING_ENABLED=false` and do not connect live mailboxes. Create a Splee API key from its own admin interface.
6. In Explee GitHub Settings → Secrets/variables → Actions:
   - variable `SPLEE_BASE_URL` = Splee backend's public HTTPS URL from Render;
   - secret `SPLEE_API_KEY` = Splee API key created in the deployed test account.
   - Run **Explee Splee Six-Stage QA** manually with `run_live=true` and that Splee QA project UUID. Optional Explee live run ID for cross comparison (e.g. `44815551658` while artifact exists).
7. Review aggregates plus actual evidence in the private test service. Do not call it production-ready unless all six stages have source-backed data.

## GitHub checks and safety

`Splee Server + Lovable AI Deployment QA` runs offline. It validates the Render YAML/secret wiring, model alias, container and shell configuration, QA-only flags and isolation. **It does not incur AI credits or build/deploy paid Render resources.**

The existing live Explee OpenOutFind proxy is kept unchanged. The Splee gateway does not reuse its `OPENOUTFIND_PROXY_TOKEN`, which is limited to GitHub run IDs and has separate quota safeguards. Do not bypass those quotas by reusing OpenOutFind's credentials.

## Source and docs

- Splee upstream: https://github.com/Iweisc/splee
- Splee license: https://github.com/Iweisc/splee/blob/main/LICENSE
- Lovable AI server key example: https://github.com/TanStack/ai/blob/main/docs/adapters/lovable.md
- LiteLLM Claude Code gateway: https://docs.litellm.ai/docs/proxy/client_setup/claude_code
- LiteLLM OpenAI-compatible provider: https://docs.litellm.ai/docs/providers/openai_compatible
- Render Blueprint reference: https://render.com/docs/blueprint-spec
