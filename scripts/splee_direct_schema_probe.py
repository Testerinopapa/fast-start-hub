#!/usr/bin/env python3
"""Two bounded live protocol probes: JSON schema and function-call shape; no web execution or sending."""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

def run():
    base = os.environ.get("OPENOUTFIND_AI_API_BASE", "").rstrip("/")
    token = os.environ.get("OPENOUTFIND_LLM_API_KEY", "")
    run_id = os.environ.get("EXPLEE_AI_RUN_ID", "")
    if not base.startswith("https://") or not base.endswith("/v1") or not token or not run_id:
        return "missing_direct_gateway_configuration"
    schema = {"type": "object", "properties": {
        "ok": {"type": "boolean"}, "stage": {"type": "string"}
    }, "required": ["ok", "stage"], "additionalProperties": False}
    body = {
        "model": "openai/gpt-6-luna",
        "messages": [
            {"role": "system", "content": "Return only a JSON object that conforms to the supplied schema."},
            {"role": "user", "content": "Return ok=true and stage='transport'. No explanation."}
        ],
        "response_format": {"type": "json_schema", "json_schema": {
            "name": "splee_probe", "schema": schema
        }},
        "max_completion_tokens": 1024,
        "stream": False
    }
    req = Request(base + "/chat/completions", method="POST",
        headers={"authorization": "Bearer " + token,
                 "x-explee-run-id": run_id,
                 "content-type": "application/json"},
        data=json.dumps(body).encode("utf-8"))
    try:
        with urlopen(req, timeout=60) as response:
            if response.status != 200:
                return "gateway_http_" + str(response.status)
            payload = json.load(response)
    except HTTPError as error:
        return "gateway_http_" + str(error.code)
    except (URLError, TimeoutError, OSError):
        return "gateway_unreachable"
    except (ValueError, UnicodeError):
        return "gateway_invalid_json"

    try:
        choices = payload["choices"]
        message = choices[0]["message"]
        raw = message["content"]
        obj = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(obj, dict) and obj.get("ok") is True and obj.get("stage") == "transport":
            return tool_probe(base, token, run_id)
        return "json_schema_value_mismatch"
    except (ValueError, KeyError, IndexError, TypeError):
        return "json_schema_response_shape_failure"

def tool_probe(base, token, run_id):
    """Check real OpenAI function-call shape without executing any web tools."""
    body = {
        "model": "openai/gpt-6-luna",
        "messages": [
            {"role": "system", "content": "Call WebSearch once; don't invent results."},
            {"role": "user", "content": "Use the WebSearch tool to find public evidence about scheduling software."}
        ],
        "tools": [{"type": "function", "function": {
            "name": "WebSearch",
            "description": "Search for public source URLs",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string"}
            }, "required": ["query"]}
        }}],
        "tool_choice": "required",
        "response_format": {"type": "json_object"},
        "max_completion_tokens": 1024,
        "stream": False
    }
    req = Request(base + "/chat/completions", method="POST",
        headers={"authorization": "Bearer " + token,
                 "x-explee-run-id": run_id,
                 "content-type": "application/json"},
        data=json.dumps(body).encode("utf-8"))
    try:
        with urlopen(req, timeout=60) as response:
            payload = json.load(response)
        calls = payload["choices"][0]["message"]["tool_calls"]
        if isinstance(calls, list) and calls and calls[0]["function"]["name"] == "WebSearch":
            args = json.loads(calls[0]["function"]["arguments"])
            return "pass" if isinstance(args.get("query"), str) and args["query"].strip() else "invalid_tool_arguments"
        return "missing_tool_call"
    except HTTPError as error:
        return "tool_gateway_http_" + str(error.code)
    except (URLError, TimeoutError, OSError):
        return "tool_gateway_unreachable"
    except (ValueError, KeyError, IndexError, TypeError):
        return "invalid_tool_call_shape"


if __name__ == "__main__":
    category = run()
    print("Direct gateway JSON-schema probe: " + category)
    sys.exit(0 if category == "pass" else 1)
