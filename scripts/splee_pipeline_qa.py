#!/usr/bin/env python3
"""Read-only Splee -> Explee output-quality audit.

This adapter NEVER starts campaigns, approves/sends mail, creates leads, or
changes Splee. It reports only aggregate metrics and safe issue codes; no lead
names, contact data, subject lines, message text, or credentials enter reports.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import ssl
import sys
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, HTTPSHandler

STAGES = (
    "company_research", "competitor_research", "campaigns",
    "buyer_companies", "decision_makers", "email_drafts",
)
SCHEMA = "explee.splee.qa.v1"
MAX_RESPONSE = 2_000_000
MAX_ITEMS = 100
BAD_PATH = re.compile(r"/(?:blog|article|news|resources|guide|directory)(?:/|$)", re.I)
UNFILLED = re.compile(r"\{\{[^}]{1,70}\}\}|\[(?:first[ _-]?name|company|your[ _-]?name)\]|\blorem ipsum\b|\bTBD\b", re.I)
DOMAIN = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,250}[a-z0-9])?$", re.I)


def domain_of(value):
    if not isinstance(value, str) or not value.strip():
        return ""
    raw = value.strip()
    try:
        url = urlsplit(raw if "://" in raw else "https://" + raw)
        host = (url.hostname or "").lower().removeprefix("www.")
        if url.scheme not in ("https", "http") or not DOMAIN.fullmatch(host):
            return ""
        return host
    except ValueError:
        return ""


def is_evidence_url(value):
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        return url.scheme == "https" and bool(domain_of(value)) and not url.username and not url.password
    except ValueError:
        return False


def objects(value):
    if isinstance(value, list):
        rows = value
    elif isinstance(value, dict) and isinstance(value.get("items"), list):
        rows = value["items"]
    else:
        raise ValueError("invalid_list_shape")
    if len(rows) > MAX_ITEMS:
        raise ValueError("response_exceeded_audit_page_limit")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("invalid_item_type")
    return rows


def metric_stage(state, inspected=0, flags=None):
    return {"state": state, "inspected": inspected, "flags": dict(sorted((flags or {}).items()))}


def evaluate(snapshot, expected_domain="", explee=None):
    """Evaluate observed completeness and internal consistency, NOT factual truth."""
    project = snapshot.get("project")
    if not isinstance(project, dict):
        raise ValueError("missing_project")
    campaigns = objects(snapshot.get("campaigns"))
    companies = objects(snapshot.get("companies"))
    leads = objects(snapshot.get("leads"))
    emails = objects(snapshot.get("emails"))
    research = snapshot.get("research")
    if not isinstance(research, dict):
        raise ValueError("missing_research_grid")
    host = domain_of(project.get("domain"))
    expected = domain_of(expected_domain)
    issues = []
    project_company = project.get("company")
    flags = {}
    if not host:
        flags["missing_company_domain"] = 1
    if not str(project.get("name") or "").strip():
        flags["missing_company_name"] = 1
    if not str(project.get("business_description") or "").strip() and not (
        isinstance(project_company, dict) and project_company
    ):
        flags["missing_business_profile"] = 1
    if expected and host != expected:
        flags["unexpected_project_domain"] = 1
    if flags:
        issues.extend("company_research." + k for k in flags)
    stages = {
        "company_research": metric_stage("review" if not flags else "incomplete", 1, flags),
        # Verified in upstream source, but its competitor results aren't exposed
        # through the API key v1 surface. Never silently call it a success.
        "competitor_research": metric_stage("not_exposed_by_api_v1"),
    }

    flags = {}
    if not campaigns:
        flags["no_campaigns"] = 1
    flags["campaigns_missing_name"] = sum(not str(c.get("name") or "").strip() for c in campaigns)
    flags["campaigns_missing_description"] = sum(not str(c.get("description") or "").strip() for c in campaigns)
    if any(v for v in flags.values()):
        issues.append("campaigns.missing_fields")
    stages["campaigns"] = metric_stage("review" if campaigns else "missing", len(campaigns), flags)

    seen = set()
    flags = {"missing_domain": 0, "missing_evidence_url": 0, "duplicate_domain": 0,
             "self_match": 0, "unrelated_page_url": 0}
    for row in companies:
        item = row.get("company", row)
        if not isinstance(item, dict):
            flags["missing_domain"] += 1
            continue
        d = domain_of(item.get("domain"))
        if not d:
            flags["missing_domain"] += 1
        elif d in seen:
            flags["duplicate_domain"] += 1
        else:
            seen.add(d)
        if d and host and d == host:
            flags["self_match"] += 1
        evidence = item.get("source_url")
        if not is_evidence_url(evidence):
            flags["missing_evidence_url"] += 1
        elif BAD_PATH.search(urlsplit(evidence).path):
            flags["unrelated_page_url"] += 1
    if any(flags.values()):
        issues.append("buyer_companies.quality_flags")
    stages["buyer_companies"] = metric_stage("review" if companies else "missing", len(companies), flags)

    flags = {"missing_name": 0, "missing_role": 0, "missing_employer": 0,
             "missing_source": 0, "duplicate_identity": 0}
    people = set()
    for row in leads:
        item = row.get("lead", row)
        if not isinstance(item, dict):
            flags["missing_name"] += 1
            continue
        name = str(item.get("full_name") or "").strip()
        employer = domain_of(item.get("company_domain")) or str(item.get("company_name") or "").strip().lower()
        if not name:
            flags["missing_name"] += 1
        if not str(item.get("title") or "").strip():
            flags["missing_role"] += 1
        if not employer:
            flags["missing_employer"] += 1
        link = item.get("linkedin_url") or ""
        source = item.get("source") or ""
        if not is_evidence_url(link) and not is_evidence_url(source):
            flags["missing_source"] += 1
        identity = (name.lower(), employer)
        if name and employer:
            if identity in people:
                flags["duplicate_identity"] += 1
            people.add(identity)
    if any(flags.values()):
        issues.append("decision_makers.quality_flags")
    stages["decision_makers"] = metric_stage("review_unverified" if leads else "missing", len(leads), flags)

    flags = {"missing_subject": 0, "missing_body": 0, "unfilled_template": 0,
             "non_draft": 0, "not_in_project": 0}
    for email in emails:
        if email.get("project_id") and str(email["project_id"]) != str(project.get("id")):
            flags["not_in_project"] += 1
            continue
        sub = str(email.get("subject") or "")
        body = str(email.get("body") or "")
        if not sub.strip():
            flags["missing_subject"] += 1
        if not body.strip():
            flags["missing_body"] += 1
        if UNFILLED.search(sub) or UNFILLED.search(body):
            flags["unfilled_template"] += 1
        if email.get("status") != "draft":
            flags["non_draft"] += 1
    if any(flags.values()):
        issues.append("email_drafts.quality_flags")
    stages["email_drafts"] = metric_stage("review_unsent" if emails else "missing", len(emails), flags)

    # Splee's research grid is company-level Q&A, not proof of audited
    # first-party company facts or a source-backed competitor comparison.
    questions = research.get("questions")
    if not isinstance(questions, list):
        raise ValueError("invalid_research_grid")
    project_comparison = {"available": False}
    if isinstance(explee, dict):
        explee_host = domain_of(explee.get("website"))
        campaigns2 = explee.get("campaigns")
        project_comparison = {
            "available": True,
            "company_domain_matches": bool(host and explee_host and host == explee_host),
            "explee_campaigns": len(campaigns2) if isinstance(campaigns2, list) else None,
            "splee_campaigns": len(campaigns),
            "explee_mode": "saved_live_research",
            "note": "Count/domain agreement is not a relevance or verification score.",
        }

    return {
        "schema_version": SCHEMA,
        "provider": "splee",
        "mode": snapshot.get("mode", "live_read_only"),
        "quality_verified": False,
        "sending_performed": False,
        "stages": stages,
        "research_question_count": len(questions),
        "comparison": project_comparison,
        "issues": sorted(set(issues)),
        "caveat": "Read-only API QA: field presence is not proof of factual accuracy or campaign fit. Competitor data is not available through Splee API v1. No emails were sent.",
    }


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def valid_base_url(value):
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or not parsed.hostname or "." not in parsed.hostname or not DOMAIN.fullmatch(parsed.hostname)
                or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment
                or parsed.path not in ("", "/")):
            raise ValueError("invalid_splee_base_url")
        try:
            ipaddress.ip_address(parsed.hostname)
        except ValueError:
            pass
        else:
            raise ValueError("invalid_splee_base_url")
        return "https://" + parsed.hostname
    except (ValueError, AttributeError):
        raise ValueError("invalid_splee_base_url") from None


def get_json(opener, base, token, path):
    if not path.startswith("/api/v1/") or "?" in path and path.count("?") > 1:
        raise ValueError("invalid_api_path")
    req = Request(base + path, headers={"Authorization": "Bearer " + token, "Accept": "application/json"}, method="GET")
    try:
        with opener.open(req, timeout=25) as res:
            if res.status != 200:
                raise ValueError("unexpected_http_status")
            raw = res.read(MAX_RESPONSE + 1)
    except HTTPError as exc:
        raise ValueError("splee_http_" + str(exc.code)) from None
    except (URLError, TimeoutError, OSError):
        raise ValueError("splee_connection_error") from None
    if len(raw) > MAX_RESPONSE:
        raise ValueError("response_too_large")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise ValueError("invalid_json_response") from None


def live_snapshot(base, token, project_id):
    pid = str(uuid.UUID(project_id))
    opener = build_opener(NoRedirects(), HTTPSHandler(context=ssl.create_default_context()))
    projects = get_json(opener, base, token, "/api/v1/projects")
    if not isinstance(projects, list):
        raise ValueError("invalid_project_list")
    project = next((p for p in projects if isinstance(p, dict) and str(p.get("id")) == pid), None)
    if project is None:
        raise ValueError("splee_project_not_authorized_or_missing")
    return {
        "mode": "live_read_only",
        "project": project,
        "campaigns": get_json(opener, base, token, f"/api/v1/projects/{pid}/campaigns"),
        "companies": get_json(opener, base, token, f"/api/v1/projects/{pid}/companies"),
        "leads": get_json(opener, base, token, f"/api/v1/projects/{pid}/leads"),
        "research": get_json(opener, base, token, f"/api/v1/projects/{pid}/research"),
        # API defaults to drafts; no emails are approved or sent.
        "emails": get_json(opener, base, token, f"/api/v1/emails?project_id={pid}&status=draft"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    offline = sub.add_parser("fixture")
    offline.add_argument("--input", type=Path, required=True)
    live = sub.add_parser("live")
    live.add_argument("--expected-domain", default="")
    live.add_argument("--explee-report", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.mode == "fixture":
            data = json.loads(args.input.read_text(encoding="utf-8"))
            data["mode"] = "synthetic_fixture"
            result = evaluate(data)
        else:
            base = valid_base_url(os.environ.get("SPLEE_BASE_URL", ""))
            token = os.environ.get("SPLEE_API_KEY", "")
            pid = os.environ.get("SPLEE_PROJECT_ID", "")
            if not token or not pid:
                raise ValueError("missing_splee_connection_settings")
            data = live_snapshot(base, token, pid)
            original = json.loads(args.explee_report.read_text(encoding="utf-8")) if args.explee_report and args.explee_report.is_file() else None
            result = evaluate(data, args.expected_domain, original)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        # No raw API data printed, including response-body errors.
        print("Splee QA written: mode=" + result["mode"] +
              ", stage_counts=" + ",".join(str(result["stages"][name]["inspected"]) for name in STAGES) +
              ", issue_categories=" + str(len(result["issues"])))
    except (ValueError, KeyError, TypeError, OSError, json.JSONDecodeError) as exc:
        safe = str(exc)
        # Only emit errors from the hard-coded, known vocabulary.
        if safe not in {
            "invalid_list_shape", "response_exceeded_audit_page_limit", "invalid_item_type",
            "missing_project", "missing_research_grid", "invalid_research_grid", "invalid_splee_base_url",
            "invalid_api_path", "unexpected_http_status", "splee_connection_error", "response_too_large",
            "invalid_json_response", "invalid_project_list", "splee_project_not_authorized_or_missing",
            "missing_splee_connection_settings",
        } and not re.fullmatch(r"splee_http_\d{3}", safe):
            safe = "invalid_splee_qa_input"
        parser.exit(1, "Splee QA failed: " + safe + "\n")


if __name__ == "__main__":
    main()
