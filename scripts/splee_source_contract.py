#!/usr/bin/env python3
"""Check the pinned AGPL Splee upstream API and six-stage source boundaries.

Only reads source checked out by GitHub Actions at an exact commit. It does NOT
execute third-party code or copy AGPL implementation into Explee.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

SPLEE_SHA = "3c2b1723bc9651a2cd2872ae6a3b4939501c8435"
ROUTES = [
    '"/v1/projects"',
    '"/v1/projects/{id}/campaigns"',
    '"/v1/projects/{id}/companies"',
    '"/v1/projects/{id}/leads"',
    '"/v1/projects/{id}/research"',
    '"/v1/emails"',
]
AGENTS = {
    "company_research": "backend/src/agent/explore.rs",
    "campaigns": "backend/src/agent/explore.rs",
    "buyer_companies": "backend/src/agent/prospect.rs",
    "decision_makers": "backend/src/agent/prospect.rs",
    "email_drafts": "backend/src/agent/write.rs",
}
COMPETITOR = "backend/src/routes/competitors.rs"


def inspect(root: Path) -> dict:
    def read(name):
        return (root / name).read_text(encoding="utf-8")
    license_text = read("LICENSE")
    if "GNU AFFERO GENERAL PUBLIC LICENSE" not in license_text:
        raise ValueError("upstream_license_changed")
    api = read("backend/src/routes/api_v1.rs")
    missing = [route for route in ROUTES if route not in api]
    if missing:
        raise ValueError("splee_api_contract_changed")
    agent_files = sorted(set(AGENTS.values()))
    for name in agent_files:
        if not read(name).strip():
            raise ValueError("splee_agent_source_missing")
    competitors = read(COMPETITOR)
    if '"/projects/{id}/competitors"' not in competitors:
        raise ValueError("splee_competitor_route_changed")
    if '"/v1/projects/{id}/competitors"' in api:
        raise ValueError("splee_competitor_api_changed_review_adapter")
    return {
        "schema_version": "explee.splee.source-contract.v1",
        "pinned_upstream_sha": SPLEE_SHA,
        "upstream_license": "AGPL-3.0",
        "source_stages_found": sorted({*AGENTS.keys(), "competitor_research"}),
        "read_only_api_routes_found": len(ROUTES),
        "competitor_data_available_with_v1_api_key": False,
        "runtime_functionality_verified": False,
        "independent_data_quality_verified": False,
        "code_imported_into_explee": False,
        "warning": "Static source surface check, not a live Splee deployment or a replacement for Explee. Keep Splee independently licensed.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = inspect(args.root)
    except (ValueError, OSError) as e:
        label = str(e)
        if label not in {"upstream_license_changed", "splee_api_contract_changed", "splee_agent_source_missing",
                         "splee_competitor_route_changed", "splee_competitor_api_changed_review_adapter"}:
            label = "splee_source_unavailable"
        parser.exit(1, "Splee source audit failed: " + label + "\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("Splee source contract passed; upstream pinned and no third-party code executed")


if __name__ == "__main__":
    main()
