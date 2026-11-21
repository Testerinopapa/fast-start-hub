# Splee: direct Lovable AI, no Claude CLI

This QA branch stages the **real pinned AGPL Splee backend** with its original
six-stage Explore run. Only the AI transport in `backend/src/agent/sdk.rs` is
overlaid at checkout time. Explee does not vendor Splee's implementation.

## Implementation

- `scripts/patch_splee_direct_ai.py`: replaces Claude CLI inference with
  direct HTTPS chat-completions to the existing Explee/Lovable AI proxy,
  using `response_format: json_schema`. Splee's typed result decoding remains
  in place.
- For research calls, the model first produces **one JSON search query**;
  Context.dev then provides actual indexed source metadata and reads a real
  provider-returned page. The model receives those results as untrusted data
  before generating the final schema-typed answer.
- No native Claude WebSearch/WebFetch tools, no LiteLLM or Claude CLI. This
  avoids the rejected tool-protocol shape found during live diagnostics.
- `supabase/functions/splee-web/index.ts`: isolated token-authenticated
  read-only Context.dev search/fetch endpoint. Reuses `openoutfind_ai_reserve`
  for per-run and daily quotas; shares the proxy token but never exposes
  Context.dev credentials. Existing `openoutfind-ai` function is unchanged.
- Unsupported Splee MCP integrations (for example, certain LinkedIn/company
  directory tools) **fail explicitly** until implemented. They are not
  silently replaced by fabricated results.
- Only public data is queried; `SENDING_ENABLED=false`; no mailboxes.

## Deployment dependency

**The new `splee-web` function must be deployed before a full run will
work.** GitHub code on a QA branch does not prove an Edge Function is live.

The existing AI proxy is at:
`https://emlggkmtbosahpzrxaul.supabase.co/functions/v1/openoutfind-ai/v1`

Deploy the `splee-web` function to the **same Supabase project** with
`verify_jwt=false` (it authenticates its own bearer token). On that project's
server, configure the already-used `OPENOUTFIND_PROXY_TOKEN` and the
Context.dev provider's `CONTEXT_DEV_API_KEY`; the server also needs the
usual Supabase service-role/database environment for quota enforcement.
Never put these secrets in Vite or browser code.

Use the existing GitHub secret `OPENOUTFIND_LLM_API_KEY` as the bearer
token for both server endpoints. The default web base URL is:
`https://emlggkmtbosahpzrxaul.supabase.co/functions/v1/splee-web/v1`.

The separate `supabase/config.toml` `project_id` may represent a different
research project: **do not deploy the web function to that different project
by accident**, since it must share the AI gateway token and quota database.

## Verification order

1. GitHub Action **Splee Direct AI Schema Planning Probe** checks real
   strict JSON output/query planning (bounded, paid, manually authorized).
2. **Splee Evidence Gateway Unit Tests** runs Deno type checks and mocked
   auth, quota, URL and source retrieval tests (zero paid calls).
3. **Splee Direct AI Overlay Compile** builds the real pinned Splee Rust
   backend after the transport patch (zero paid calls).
4. **Splee Evidence Gateway Deployment Preflight** expects an HTTP 400
   from a deliberately invalid run ID **after valid bearer authentication**;
   this verifies deployment without executing a search or model request.
5. Manually dispatch **Splee Ephemeral Direct AI Pipeline**, choose
   `research`, domain `calendly.com`. This creates ephemeral Postgres,
   runs real Splee stages 1–6, and saves aggregate-only QA metrics.
   It performs no outbound email.
6. Review stage completion, evidence coverage, duplicate domains and
   decision-maker attribution. A successful job or correct JSON schema is
   **not** independent verification of lead accuracy.

## Limits and known gaps

- The AI proxy caps its output to 4096 tokens, and the shared admission
  guard imposes request limits. Large 25-company outputs may need batching.
- Web evidence is real only once the new Context.dev bridge is deployed and
  its server-side provider key is configured.
- Explee is not yet importing Splee's persisted stage records into its
  end-user UI. The QA pipeline tests Splee's own isolated data.
- Splee reports `cost_usd=0` for direct calls because the Lovable gateway
  does not expose per-request pricing to this adapter. **This is not free
  inference.** Check provider usage/credits separately.
- No request has been made to send email or conduct outreach.
