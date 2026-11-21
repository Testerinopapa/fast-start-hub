#!/usr/bin/env python3
"""Two-request, aggregate-only model bridge QA. No personal data or outbound."""
import json
import os
import pathlib
import re
import sys
import subprocess
import tempfile
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



def safe_cli_failure_category(stderr, stdout, payload):
    """Publish only enum labels, never untrusted raw CLI/provider text."""
    source=(str(stderr)+"\\n"+str(stdout)).lower()
    if any(v in source for v in ("unknown option","unknown argument","unrecognized option","invalid option")):
        return "cli_unsupported_argument"
    if any(v in source for v in ("401","unauthorized","authentication failed","invalid api key")):
        return "authentication_failure"
    if any(v in source for v in ("403","permission denied","access denied")):
        return "permission_failure"
    if any(v in source for v in ("409","duplicate")):
        return "duplicate_request_rejected"
    if any(v in source for v in ("429","rate limit","quota")):
        return "rate_or_budget_rejected"
    if any(v in source for v in ("400","bad request","invalid_request","schema validation failed")):
        return "provider_request_rejected"
    if any(v in source for v in ("503","502","500","upstream error")):
        return "upstream_provider_failure"
    if any(v in source for v in ("json_schema","structured output","structured_output")):
        return "structured_output_unavailable"
    if any(v in source for v in ("not logged in","login required","please run /login")):
        return "cli_login_required"
    if any(v in source for v in ("network error","connection refused","connection reset","fetch failed")):
        return "cli_network_failure"
    if isinstance(payload,dict) and payload.get("is_error") is True:
        return "cli_result_error"
    if isinstance(payload,dict) and payload.get("subtype")=="error_max_turns":
        return "max_turns_before_answer"
    return "unknown_cli_failure"


def safe_bridge_statuses():
    try:
        log=pathlib.Path(os.environ.get("RUNNER_TEMP","/nonexistent"))/"bridge-probe.log"
        content=log.read_text(encoding="utf-8",errors="replace")
        codes=re.findall(r'POST /v1/messages HTTP/1\.1"\s+(\d{3})', content)
        return [int(code) for code in codes[-8:]]
    except (OSError,ValueError):
        return []


def probe_claude_schema():
    """Isolate CLI-to-bridge schema handling; never persist raw prompts or answers."""
    env=os.environ.copy()
    env["ANTHROPIC_BASE_URL"]="http://127.0.0.1:4000"
    env["ANTHROPIC_AUTH_TOKEN"]=MASTER
    env.pop("ANTHROPIC_API_KEY",None)
    env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"]="1"
    env["DISABLE_AUTOUPDATER"]="1"
    schema={"type":"object","properties":{
        "ok":{"type":"boolean"},"stage":{"type":"string"}},"required":["ok","stage"]}
    cmd=["claude","-p","Return a JSON object with ok true and stage set to schema_probe_20261120.",
         "--model","claude-sonnet-5-5","--output-format","json",
         "--json-schema",json.dumps(schema,separators=(",",":")),
         "--max-turns","1","--tools","","--setting-sources","","--no-session-persistence"]
    try:
        with tempfile.TemporaryDirectory(prefix="splee-cli-probe-") as cwd:
            done=subprocess.run(cmd,env=env,cwd=cwd,stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=100)
        try: payload=json.loads(done.stdout)
        except (ValueError,TypeError): payload={}
        structured=payload.get("structured_output") if isinstance(payload,dict) else None
        valid=(done.returncode==0 and isinstance(structured,dict)
               and structured.get("ok") is True and structured.get("stage")=="schema_probe_20261120")
        return {"status":"passed" if valid else "failed","exit_zero":done.returncode==0,
                "structured_output_present":isinstance(structured,dict),
                **({} if valid else {"failure_category":safe_cli_failure_category(done.stderr,done.stdout,payload),
                    "cli_subtype": (payload.get("subtype") if isinstance(payload,dict) and
                        isinstance(payload.get("subtype"),str) and re.fullmatch(r"[a-z_]{1,48}",payload["subtype"]) else "unknown"),
                    "bridge_http_statuses":safe_bridge_statuses(),
                    "cli_turns": (payload.get("num_turns") if isinstance(payload,dict) and
                        isinstance(payload.get("num_turns"),int) and 0<=payload["num_turns"]<=30 else None)})}
    except subprocess.TimeoutExpired:
        return {"status":"timeout"}
    except (OSError,ValueError):
        return {"status":"cli_unavailable"}

report={"schema_version":"explee.splee.model-bridge-qa.v2","ai_requests_max":3,
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
                "messages":[{"role":"user","content":"Respond with exactly the word READY."}],
                "max_tokens":48,"stream":False
            },{"Authorization":"Bearer "+MASTER,"x-api-key":MASTER,
               "anthropic-version":"2023-06-01"})
            report["anthropic_via_litellm"]=via
            if via.get("status")==200 and via.get("response_shape_valid"):
                report["claude_cli_schema"]=probe_claude_schema()
                report["result"]="passed" if report["claude_cli_schema"]["status"]=="passed" else "cli_schema_failed"
            else:
                report["result"]="bridge_failed"
        else:
            report["result"]="provider_failed_no_bridge_request"
except Exception:
    report["result"]="unexpected_diagnostic_error"
finally:
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(report,sort_keys=True,indent=2)+"\n")
    print("Splee model round-trip result:",report["result"])
    for phase in ("direct_openai","anthropic_via_litellm","claude_cli_schema"):
        if phase in report:print(phase,report[phase])
sys.exit(0 if report.get("result")=="passed" else 1)
