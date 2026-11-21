#!/usr/bin/env python3
"""Overlay direct OpenAI-compatible inference onto a pinned AGPL Splee checkout.

This script is an additive patch, NOT a vendored copy of Splee. Original upstream
source, license and attribution are retained at runtime.
"""
from pathlib import Path
import sys

HOOK = "async fn once(state: &AppState, run: Option<&Ctx>, call: &Call, mut prompt: String) -> anyhow::Result<Attempt> {\n"
DIRECT_HOOK = """    if std::env::var("SPLEE_AI_TRANSPORT").as_deref() == Ok("direct") {
        return direct_gateway_once(state, run, call, prompt).await;
    }
"""

DIRECT_FUNCTION = r'''
/// Direct Explee / Lovable AI transport. No Claude executable or Anthropic adapter.
/// An evidence call is required for research tasks; model knowledge is NOT web evidence.
async fn direct_gateway_once(state: &AppState, run: Option<&Ctx>, call: &Call, prompt: String) -> anyhow::Result<Attempt> {
    let base = std::env::var("SPLEE_DIRECT_AI_API_BASE").context("direct AI base missing")?;
    let token = std::env::var("OPENOUTFIND_LLM_API_KEY").context("direct AI key missing")?;
    let run_id = std::env::var("EXPLEE_AI_RUN_ID").context("direct AI run ID missing")?;
    let url = reqwest::Url::parse(&base).context("invalid direct AI URL")?;
    anyhow::ensure!(
        url.scheme() == "https"
            && url.host_str().is_some_and(|host| host.ends_with(".supabase.co"))
            && url.path().ends_with("/v1")
            && url.query().is_none()
            && url.fragment().is_none(),
        "direct AI endpoint must use the configured secure Supabase gateway"
    );
    anyhow::ensure!(run_id.starts_with("github-"), "invalid direct AI run ID");
    anyhow::ensure!(call.servers.is_empty() && call.server_tools.is_empty() && call.directory.is_none() && call.places.is_none(),
        "direct AI transport has no connected MCP tool adapter for this call");
    if call.web {
        anyhow::ensure!(
            std::env::var("SPLEE_DIRECT_WEB_BACKEND").as_deref() == Ok("explee-context"),
            "direct AI evidence backend not enabled; refusing ungrounded web research"
        );
    }
    let http = reqwest::Client::builder()
        .timeout(call.timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("could not construct direct AI client")?;
    let mut messages = vec![
        json!({"role":"system","content": format!(
            "{}\nOnly return valid JSON conforming to this schema: {}. Do not invent sources, websites, companies, people or contact details. If evidence does not establish a fact, leave its field empty.",
            call.system, call.schema
        )}),
        json!({"role":"user","content":prompt})
    ];
    let mut evidence_calls: usize = 0;
    let max_turns = call.max_turns.clamp(1, 6);
    for turn in 0..max_turns {
        let tools_enabled = call.web && turn + 1 < max_turns && evidence_calls < 8;
        let mut body = json!({
            "model": "openai/gpt-6-luna",
            "messages": messages,
            "stream": false,
            "max_completion_tokens": 4096,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "splee_answer", "schema": call.schema}
            }
        });
        if tools_enabled {
            body["tools"] = json!([
                {"type":"function","function":{"name":"WebSearch","description":"Find public, source-linked pages for research; query required.","parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}},
                {"type":"function","function":{"name":"WebFetch","description":"Read a specific HTTPS public website page for evidence; URL required.","parameters":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}}}
            ]);
            body["tool_choice"] = json!(if evidence_calls == 0 { "required" } else { "auto" });
        }
        let response = http.post(format!("{}/chat/completions", base.trim_end_matches('/')))
            .bearer_auth(&token)
            .header("x-explee-run-id", &run_id)
            .json(&body)
            .send().await.context("direct AI gateway transport failed")?;
        anyhow::ensure!(response.status().is_success(), "direct AI gateway HTTP {}", response.status().as_u16());
        let bytes = response.bytes().await.context("direct AI gateway response failed")?;
        anyhow::ensure!(bytes.len() <= 2_000_000, "direct AI response too large");
        let payload: Value = serde_json::from_slice(&bytes).context("direct AI invalid envelope")?;
        let choice = payload.pointer("/choices/0").context("direct AI missing choice")?;
        anyhow::ensure!(choice["finish_reason"] != "length", "direct AI response incomplete");
        let msg = choice.get("message").context("direct AI missing message")?;
        if let Some(calls) = msg["tool_calls"].as_array().filter(|list| !list.is_empty()) {
            anyhow::ensure!(tools_enabled && calls.len() <= 3, "direct AI unauthorized tool request");
            messages.push(json!({"role":"assistant","content":null,"tool_calls":calls}));
            for tool in calls {
                let name = tool.pointer("/function/name").and_then(Value::as_str).context("direct AI tool name missing")?;
                let id = tool["id"].as_str().context("direct AI tool ID missing")?;
                let arguments = tool.pointer("/function/arguments").and_then(Value::as_str).context("direct AI tool arguments missing")?;
                let input: Value = serde_json::from_str(arguments).context("invalid direct AI tool arguments")?;
                let (path, field) = match name {
                    "WebSearch" => ("/web/search", "query"),
                    "WebFetch" => ("/web/fetch", "url"),
                    _ => anyhow::bail!("direct AI requested unsupported tool"),
                };
                let value = input[field].as_str().filter(|s| !s.trim().is_empty() && s.len() <= 500)
                    .context("missing or oversized direct AI tool argument")?;
                if let Some(ctx) = run {
                    report_tool(state, ctx, name, input.clone()).await;
                }
                let web_response = http.post(format!("{}{}", base.trim_end_matches('/'), path))
                    .bearer_auth(&token)
                    .header("x-explee-run-id", &run_id)
                    .json(&json!({(field): value}))
                    .send().await.context("direct AI evidence transport failed")?;
                anyhow::ensure!(web_response.status().is_success(), "direct AI evidence HTTP {}", web_response.status().as_u16());
                let evidence = web_response.bytes().await.context("direct AI evidence response failed")?;
                anyhow::ensure!(evidence.len() <= 16_000, "direct AI evidence too large");
                let _: Value = serde_json::from_slice(&evidence).context("direct AI evidence JSON invalid")?;
                let evidence_text = String::from_utf8(evidence.to_vec()).context("direct AI evidence UTF-8 invalid")?;
                messages.push(json!({"role":"tool","tool_call_id":id,"content":evidence_text}));
                evidence_calls += 1;
            }
            continue;
        }
        anyhow::ensure!(!call.web || evidence_calls > 0, "direct AI supplied no web evidence");
        let content = msg["content"].as_str().context("direct AI missing JSON content")?;
        let output: Value = serde_json::from_str(content).context("direct AI output is not valid JSON")?;
        anyhow::ensure!(output.is_object(), "direct AI structured answer must be an object");
        // Final typed decoding happens in ask<T> and is retried there when invalid.
        return Ok(Attempt { output: Some(output), cost: 0.0, error: None });
    }
    Err(anyhow!("direct AI reached bounded turn limit without structured output"))
}
'''

def patch(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    if DIRECT_HOOK.strip() in source:
        raise SystemExit("direct AI hook already present; source must be pristine")
    if source.count(HOOK) != 1:
        raise SystemExit("pinned upstream Splee sdk.rs changed; patch refused")
    source = source.replace(HOOK, DIRECT_FUNCTION + "\n" + HOOK + DIRECT_HOOK, 1)
    path.write_text(source, encoding="utf-8")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_splee_direct_ai.py <splee-upstream/backend/src/agent/sdk.rs>")
    patch(Path(sys.argv[1]))
    print("Applied direct OpenAI-compatible adapter to pinned Splee source")
