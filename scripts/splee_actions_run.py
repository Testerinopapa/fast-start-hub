#!/usr/bin/env python3
"""Exercise a *temporary local* Splee backend in a GitHub Actions runner.

No Explee login, Render instance, persistent Splee database or outbound
email. QA account, API key and any prospects exist only in runner memory/DB.
Only aggregate counts/status codes are written to the workflow artifact.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from splee_pipeline_qa import evaluate, live_snapshot

BASE = "http://127.0.0.1:8787"
SCHEMA = "explee.splee.actions.v1"
HOSTNAME = re.compile(r"^(?:[a-z0-9-]+\.)+[a-z]{2,24}$", re.I)
MAX_RESPONSE = 2_000_000


class SafeFailure(Exception):
    pass


def request_json(opener, method, path, payload=None, token=None):
    if not path.startswith("/api/") or "?" in path:
        raise SafeFailure("invalid_local_api_route")
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    body = json.dumps(payload).encode() if payload is not None else None
    req = Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=12) as response:
            if response.status < 200 or response.status >= 300:
                raise SafeFailure("local_api_unexpected_status")
            raw = response.read(MAX_RESPONSE + 1)
    except HTTPError as e:
        raise SafeFailure("local_api_http_" + str(e.code)) from None
    except (URLError, TimeoutError, OSError):
        raise SafeFailure("local_api_unreachable") from None
    if len(raw) > MAX_RESPONSE:
        raise SafeFailure("local_api_response_too_large")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise SafeFailure("local_api_invalid_json") from None


def bootstrap(opener):
    # This account has no usable mailbox, identity or real password outside the
    # ephemeral PostgreSQL service. Nothing is saved to Actions artifacts.
    test_email = "qa-" + secrets.token_hex(9) + "@example.com"
    password = secrets.token_urlsafe(32)
    request_json(opener, "POST", "/api/auth/signup",
                 {"email": test_email, "password": password, "name": "Ephemeral Pipeline QA"})
    key = request_json(opener, "POST", "/api/organization/api-keys", {"name": "Single-run read-only QA"})
    token = key.get("secret") if isinstance(key, dict) else None
    if not isinstance(token, str) or not token:
        raise SafeFailure("missing_qa_api_key")
    projects = request_json(opener, "GET", "/api/v1/projects", token=token)
    if projects != []:
        raise SafeFailure("unexpected_nonempty_ephemeral_db")
    return token


def wait_for_run(opener, project_id, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        runs = request_json(opener, "GET", "/api/projects/" + project_id + "/runs")
        if not isinstance(runs, list):
            raise SafeFailure("invalid_agent_run_list")
        explore = next((r for r in runs if isinstance(r, dict) and r.get("kind") == "explore"), None)
        if explore:
            status = explore.get("status")
            if status in {"succeeded", "failed", "cancelled", "canceled"}:
                return status, int(explore.get("step") or 0)
            if status not in {"queued", "running", "pending"}:
                raise SafeFailure("unknown_agent_status")
        time.sleep(4)
    return "timed_out", 0


def run(mode, domain, max_seconds):
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    health = request_json(opener, "GET", "/api/health")
    if health != {"ok": True}:
        raise SafeFailure("backend_database_unhealthy")
    token = bootstrap(opener)
    if mode == "smoke":
        return {
            "mode": "smoke",
            "status": "healthy",
            "postgres_migrations": "applied",
            "signup": "passed",
            "api_key": "passed",
            "api_v1": "passed",
            "ai_calls_attempted": False,
            "sending_performed": False,
            "output_quality_verified": False,
        }
    if mode != "research" or not HOSTNAME.fullmatch(domain):
        raise SafeFailure("invalid_research_domain")
    created = request_json(opener, "POST", "/api/projects", {"domain": domain})
    project_id = created.get("id") if isinstance(created, dict) else None
    if not isinstance(project_id, str) or not re.fullmatch(r"[0-9a-fA-F-]{36}", project_id):
        raise SafeFailure("project_create_failed")
    # POST /projects enqueues the *actual pinned Splee six-step explore agent*,
    # not a mock or a generated stand-in.
    status, step = wait_for_run(opener, project_id, max_seconds)
    try:
        observed = live_snapshot(BASE, token, project_id)
        report = evaluate(observed, domain)
        stages = report["stages"]
        summary = {
            "mode": "research", "status": status, "last_step": step,
            "sending_performed": False,
            "output_quality_verified": False,
            "stage_counts": {name: v["inspected"] for name, v in stages.items()},
            "stage_states": {name: v["state"] for name, v in stages.items()},
            "quality_flags": {name: v["flags"] for name, v in stages.items()},
            "issues": report["issues"],
            "note": "Field coverage is not independent verification. Competitors are not exposed via Splee API v1.",
        }
    except (ValueError, KeyError, TypeError):
        summary = {
            "mode": "research", "status": status, "last_step": step,
            "sending_performed": False, "output_quality_verified": False,
            "diagnostic": "read_only_quality_snapshot_unavailable",
        }
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("smoke", "research"), required=True)
    parser.add_argument("--domain", default="calendly.com")
    parser.add_argument("--max-seconds", type=int, default=420)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.max_seconds < 20 or args.max_seconds > 900:
        parser.error("Research timeout must be 20..900 seconds")
    result = {"schema_version": SCHEMA, "mode": args.mode, "status": "not_started",
              "sending_performed": False, "output_quality_verified": False}
    code = 1
    try:
        result.update(run(args.mode, args.domain, args.max_seconds))
        code = 0 if result["status"] in {"healthy", "succeeded"} else 1
    except SafeFailure as e:
        result.update({"status": "failed", "reason": str(e)})
    except (ValueError, KeyError, TypeError, URLError, OSError):
        result.update({"status": "failed", "reason": "unexpected_local_runner_failure"})
    finally:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print("Splee Actions QA: mode=" + result["mode"] + " status=" + result["status"])
        print("No email sending, personal records, account credentials or AI prompts were published.")
    return code


if __name__ == "__main__":
    sys.exit(main())
