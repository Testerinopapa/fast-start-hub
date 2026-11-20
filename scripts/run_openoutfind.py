#!/usr/bin/env python3
"""Run pinned OpenOutFind with bounded, non-replaying proxy transport only."""
import os
import sys
from urllib.parse import urlsplit


def build_proxy_model(model, api_key, api_base):
    from openai import AsyncOpenAI
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider
    import re
    run_id = os.environ.get("EXPLEE_AI_RUN_ID", "")
    parsed = urlsplit(api_base)
    if not re.fullmatch(r"github-[0-9]{1,24}-[0-9]{1,6}", run_id):
        raise ValueError("Missing GitHub qualification run ID")
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.path.endswith("/openoutfind-ai/v1"):
        raise ValueError("Configure the secure Explee AI proxy base URL")
    if model != "openai/gpt-6-luna":
        raise ValueError("Only the tested Lovable qualification model is permitted")
    client = AsyncOpenAI(api_key=api_key, base_url=api_base, max_retries=0,
                         timeout=50, default_headers={"x-explee-run-id": run_id})
    return OpenAIChatModel(model, provider=OpenAIProvider(openai_client=client))


def main():
    # No automatic enrichment and no operator registration in this process.
    if os.environ.get("OPENOUTFIND_AI_MODEL") != "openai_compatible:openai/gpt-6-luna":
        raise SystemExit("Configure the tested Lovable AI model")
    for field in ("OPENOUTFIND_OPERATOR_EMAIL", "OPENOUTFIND_CONTACTS_API_TOKEN", "OPENOUTFIND_OPERATOR_COUNTRY"):
        os.environ[field] = ""
    if len(sys.argv) != 2 or sys.argv[1] not in ("1", "3", "5"):
        raise SystemExit("Lead count must be 1, 3 or 5; email lookup is not allowed")
    from openoutfind.core import llm
    llm._PROVIDER_BUILDERS["openai_compatible"] = build_proxy_model
    from openoutfind.__main__ import main as outfind
    sys.argv = ["outfind", "--db", os.path.join(os.environ["RUNNER_TEMP"], "openoutfind-run.sqlite3"), "find", sys.argv[1], "--json"]
    outfind()


if __name__ == "__main__":
    main()