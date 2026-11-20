#!/usr/bin/env python3
"""Summarize a real or partial OpenOutFind run without exposing personal records.

Only aggregate counts, classified error *types*, and bounded AI phase metrics
leave the GitHub runner. The raw stderr and lead JSONL are never echoed.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


ERROR_TYPES = {
    "no_credential", "provider_auth", "provider_out_of_credits",
    "provider_rate_limited", "provider_unavailable", "bad_config",
    "onboarding_incomplete", "not_initialized", "goal_unreached",
    "qualify_pending", "population_pending", "keyword_guess_pending",
    "unanchored",
}
PHASES = {
    "brief", "initial_searches_and_anchors", "keyword_guesses",
    "lead_qualification", "other",
}


def typed_error(stderr: str) -> str | None:
    """Read only upstream's documented JSON error.type, never its message."""
    for line in stderr.splitlines():
        if not line.lstrip().startswith("{"):
            continue
        try:
            payload = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        error = payload.get("error")
        label = error.get("type") if isinstance(error, dict) else None
        if isinstance(label, str) and label in ERROR_TYPES:
            return label
    return None


def summarize(aggregate: dict, metrics: dict, stderr: str,
              exit_code: int, requested: int) -> dict:
    if aggregate.get("schema_version") != "explee.openoutfind.summary.v1":
        raise ValueError("Missing normalized OpenOutFind aggregate summary")
    if requested not in (1, 3, 5):
        raise ValueError("Lead goal must be 1, 3 or 5")
    if exit_code < 0 or exit_code > 255:
        raise ValueError("Invalid finder exit code")
    returned = aggregate.get("returned_leads")
    complete = aggregate.get("complete_profiles")
    if not isinstance(returned, int) or returned < 0 or not isinstance(complete, int) or not 0 <= complete <= returned:
        raise ValueError("Invalid aggregate lead counts")
    if not isinstance(metrics, dict):
        metrics = {}
    if metrics.get("schema_version") not in (None, "explee.openoutfind.qa-metrics.v1"):
        raise ValueError("Unexpected QA request metrics")
    sent = metrics.get("ai_requests_sent")
    maximum = metrics.get("max_ai_requests")
    blocked = metrics.get("requests_blocked_locally", 0)
    if sent is not None and (not isinstance(sent, int) or not 0 <= sent <= 24):
        raise ValueError("Invalid AI-request count")
    if maximum is not None and (not isinstance(maximum, int) or not 1 <= maximum <= 24):
        raise ValueError("Invalid AI-request cap")
    if not isinstance(blocked, int) or blocked < 0:
        raise ValueError("Invalid local-cap value")
    raw_phases = metrics.get("requests_by_phase", {})
    if not isinstance(raw_phases, dict):
        raise ValueError("Invalid phase counter")
    phases = {
        name: number
        for name, number in raw_phases.items()
        if name in PHASES and isinstance(number, int) and number >= 0
    }
    if sent is not None and sum(phases.values()) != sent:
        raise ValueError("Phase counts must add up to actual AI requests")
    local_limit_hit = bool(metrics.get("local_ai_cap_hit", False))
    reason = ("local_ai_budget" if local_limit_hit else
              typed_error(stderr) if exit_code else
              None)
    if exit_code and not reason:
        reason = "unknown_finder_failure"
    if exit_code == 0 and returned >= requested:
        result = "goal_met"
    elif returned:
        result = "partial"
        if not reason:
            reason = "goal_not_met"
    else:
        result = "no_leads"
        if not reason:
            reason = "goal_not_met"
    return {
        "schema_version": "explee.openoutfind.qa-report.v1",
        "result": result,
        "finder_exit_code": exit_code,
        "reason": reason,
        "requested_leads": requested,
        "returned_leads": returned,
        "complete_profiles": complete,
        "incomplete_profiles": returned - complete,
        "independently_verified_people": 0,
        "max_ai_requests": maximum,
        "ai_requests_sent": sent,
        "requests_blocked_locally": blocked,
        "local_ai_cap_hit": local_limit_hit,
        "ai_requests_by_phase": phases,
        "ai_requests_per_returned_lead": round(sent / returned, 2) if isinstance(sent, int) and returned else None,
        "email_purchases": 0,
        "outreach_sent": 0,
        "caveat": "Provider results and LLM fit are unverified. Partial rows are not a successful run.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--stderr", type=Path, required=True)
    parser.add_argument("--exit-code-file", type=Path, required=True)
    parser.add_argument("--requested", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    aggregate = json.loads(args.summary.read_text(encoding="utf-8"))
    metrics = json.loads(args.metrics.read_text(encoding="utf-8")) if args.metrics.exists() else {}
    stderr = args.stderr.read_text(encoding="utf-8", errors="replace") if args.stderr.exists() else ""
    code = int(args.exit_code_file.read_text(encoding="utf-8").strip())
    report = summarize(aggregate, metrics, stderr, code, args.requested)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
