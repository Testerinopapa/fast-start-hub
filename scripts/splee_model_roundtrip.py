#!/usr/bin/env python3
"""Two-request, aggregate-only model bridge QA. No personal data or outbound."""
import json
import os
import pathlib
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

MAX_BYTES=100000
BASE=os.environ["OPENOUTFIND_AI_API_BASE"].rstrip("/")
TOKEN=os.environ["OPENOUTFIND_LLM_API_KEY"]
RUN_ID=os.environ["EXPLEE_AI_RUN_ID"]
MASTER=os.environ["LITELLM_MASTER_KEY"]
OUTPUT=pathlib.Path(os.environ["ROUNDTRIP_REPORT_PATH"])

def probe(url, payload, headers):
    data=json.dumps(payload,separators=(",",":")).encode()
    req=Request(url,data=data,method="POST",headers={"Content-Type":"application/json",**headers})
    try:
        with urlopen(req,timeout=55) as res:
            status=res.status
            raw=res.read(MAX_BYTES+1)
    except HTTPError as exc:
        status=exc.code
        raw=exc.read(MAX_BYTES+1)
    except (URLError,TimeoutError,OSError):
        return {"status":0,"error_code":"transport_or_timeout"}
    try:
        item=json.loads(raw) if len(raw)<=MAX_BYTES else {}
    except (ValueError,UnicodeError):
        item={}
    if status==200:
        return {"status":status, "response_shape_valid":bool(
          isinstance(item,dict) and
          (("choices" in item) if "chat/completions" in url else ("content" in item))
        )}
    # Return only known safe type/code strings, never arbitrary error text or raw body.
    err=item.get("error") if isinstance(item,dict) else {}
    if not isinstance(err,dict):err={}
    code=str(err.get("code") or err.get("type") or "unknown")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}",code):code="unclassified_error"
    return {"status":status,"error_code":code}

report={"schema_version":"explee.splee.model-bridge-qa.v1","ai_requests_max":2,
        "sending_performed":False,"factual_quality_verified":False}
try:
    if not TOKEN or not BASE.startswith("https://"):
        report["result"]="missing_safe_proxy_settings"
    else:
        direct=probe(BASE+"/chat/completions",{
            "model":"openai/gpt-6-luna",
            "messages":[{"role":"user","content":"Respond with exactly the word OK."}],
            "max_completion_tokens":48,"reasoning_effort":"none","stream":False
        },{"Authorization":"Bearer "+TOKEN,"x-explee-run-id":RUN_ID})
        report["direct_openai"]=direct
        if direct.get("status")==200 and direct.get("response_shape_valid"):
            via=probe("http://127.0.0.1:4000/v1/messages",{
                "model":"claude-sonnet-5-5",
                "messages":[{"role":"user","content":"Respond with exactly the word OK."}],
                "max_tokens":48,"stream":False
            },{"Authorization":"Bearer "+MASTER,"x-api-key":MASTER,
               "anthropic-version":"2023-06-01"})
            report["anthropic_via_litellm"]=via
            report["result"]="passed" if via.get("status")==200 and via.get("response_shape_valid") else "bridge_failed"
        else:
            report["result"]="provider_failed_no_bridge_request"
except Exception:
    report["result"]="unexpected_diagnostic_error"
finally:
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(report,sort_keys=True,indent=2)+"\n")
    print("Splee model round-trip result:",report["result"])
    for phase in ("direct_openai","anthropic_via_litellm"):
        if phase in report:print(phase,report[phase])
sys.exit(0 if report.get("result")=="passed" else 1)
