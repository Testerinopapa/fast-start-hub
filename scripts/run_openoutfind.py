#!/usr/bin/env python3
"""Run pinned OpenOutFind with a LOCAL LLM request cap and aggregate QA metrics.

This file never prints or uploads names, lead URLs, access tokens, or model prompts.
OpenOutFind stdout remains its progressive JSONL stream; partial rows survive errors.
"""
from __future__ import annotations

from collections import Counter
import inspect
import json
import os
from pathlib import Path
import re
import sys
import threading
from urllib.parse import urlsplit


_PHASES = {
    "openoutfind.core.pipeline.brief": "brief",
    "openoutfind.core.pipeline.icp": "initial_searches_and_anchors",
    "openoutfind.core.pipeline.keyword_guess": "keyword_guesses",
    "openoutfind.core.ml.qualifier": "lead_qualification",
}
_CLIENT = None


class QABudget:
    """Count real outgoing OpenAI-compatible HTTP requests, never model intentions.

    The hook fires before an HTTP request leaves the GitHub runner. OpenAI SDK
    retries are separately disabled, so each admitted request consumes at most
    one proxy admission. Reject locally *before* network once the cap is reached.
    """

    def __init__(self, maximum: int):
        if not 1 <= maximum <= 24:
            raise ValueError("EXPLEE_QA_MAX_AI_CALLS must be between 1 and 24")
        self.maximum = maximum
        self.requests_sent = 0
        self.denied = 0
        self.phase = "other"
        self.by_phase: Counter[str] = Counter()
        self._lock = threading.Lock()

    async def before_request(self, request):
        import httpx

        with self._lock:
            if self.requests_sent >= self.maximum:
                self.denied += 1
                # Raising a transport error is deliberate: SDK retries=0 and
                # the CLI will exit nonzero while preserving streamed rows.
                raise httpx.ConnectError("EXPLEE_LOCAL_AI_REQUEST_CAP", request=request)
            self.requests_sent += 1
            self.by_phase[self.phase] += 1

    def run_agent(self, runner, coro, phase="other"):
        if phase not in set(_PHASES.values()):
            phase = "other"
        with self._lock:
            previous = self.phase
            self.phase = phase
        try:
            return runner(coro)
        finally:
            with self._lock:
                self.phase = previous

    def summary(self):
        with self._lock:
            return {
                "schema_version": "explee.openoutfind.qa-metrics.v1",
                "max_ai_requests": self.maximum,
                "ai_requests_sent": self.requests_sent,
                "requests_blocked_locally": self.denied,
                "local_ai_cap_hit": self.denied > 0,
                "requests_by_phase": dict(sorted(self.by_phase.items())),
            }


def build_proxy_model(model, api_key, api_base, budget: QABudget | None = None):
    from openai import AsyncOpenAI
    import httpx
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    global _CLIENT
    run_id = os.environ.get("EXPLEE_AI_RUN_ID", "")
    parsed = urlsplit(api_base)
    if not re.fullmatch(r"github-[0-9]{1,24}-[0-9]{1,6}", run_id):
        raise ValueError("Missing GitHub qualification run ID")
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or
            parsed.password or parsed.query or parsed.fragment or
            not parsed.path.endswith("/openoutfind-ai/v1")):
        raise ValueError("Configure the secure Explee AI proxy base URL")
    if model != "openai/gpt-6-luna":
        raise ValueError("Only the tested Lovable qualification model is permitted")
    if budget is None:
        raise ValueError("A local AI request budget is required")

    # Reuse one HTTP client throughout this run: avoid reconnecting for every
    # profile and ensure all requests flow through the same budget gate.
    if _CLIENT is None:
        transport = httpx.AsyncClient(
            timeout=50, follow_redirects=False,
            event_hooks={"request": [budget.before_request]},
        )
        _CLIENT = AsyncOpenAI(
            api_key=api_key,
            base_url=api_base,
            max_retries=0,
            timeout=50,
            http_client=transport,
            default_headers={"x-explee-run-id": run_id},
        )
    return OpenAIChatModel(model, provider=OpenAIProvider(openai_client=_CLIENT))


def main() -> None:
    if os.environ.get("OPENOUTFIND_AI_MODEL") != "openai_compatible:openai/gpt-6-luna":
        raise SystemExit("Configure the tested Lovable AI model")
    for field in (
        "OPENOUTFIND_OPERATOR_EMAIL", "OPENOUTFIND_CONTACTS_API_TOKEN",
        "OPENOUTFIND_OPERATOR_COUNTRY",
    ):
        os.environ[field] = ""
    if len(sys.argv) != 2 or sys.argv[1] not in ("1", "3", "5"):
        raise SystemExit("Lead count must be 1, 3 or 5; email lookup is not allowed")
    try:
        maximum = int(os.environ.get("EXPLEE_QA_MAX_AI_CALLS", "16"))
        budget = QABudget(maximum)
    except ValueError as exc:
        raise SystemExit(f"Invalid local AI request cap: {exc}") from None

    from openoutfind.core import llm
    original_runner = llm.run_agent_sync

    def phase_runner(coro):
        frame = inspect.currentframe()
        caller = frame.f_back if frame else None
        phase = _PHASES.get(caller.f_globals.get("__name__", ""), "other") if caller else "other"
        return budget.run_agent(original_runner, coro, phase)

    llm.run_agent_sync = phase_runner
    llm._PROVIDER_BUILDERS["openai_compatible"] = (
        lambda model, api_key, api_base: build_proxy_model(model, api_key, api_base, budget)
    )

    from openoutfind.__main__ import main as outfind
    tmpdir = Path(os.environ["RUNNER_TEMP"])
    argv = [
        "outfind", "--db", str(tmpdir / "openoutfind-run.sqlite3"),
        "find", sys.argv[1], "--json",
    ]
    # A human-readable rule brief derived from Explee's selected campaign
    # replaces one unnecessary LLM call and prevents broad default judging.
    brief = tmpdir / "openoutfind" / "rules.md"
    if brief.is_file() and brief.stat().st_size:
        argv.extend(["--brief", str(brief)])
    sys.argv = argv

    try:
        outfind()
    finally:
        path = Path(os.environ.get("EXPLEE_QA_METRICS_FILE", str(tmpdir / "openoutfind-metrics.json")))
        path.write_text(json.dumps(budget.summary(), sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
