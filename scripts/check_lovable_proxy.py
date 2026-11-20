#!/usr/bin/env python3
"""Read-only, no-credit validation of Explee's Lovable AI OpenAI-compatible proxy.

GET /models only: does not reserve an AI request, call inference, look up a lead,
purchase email credits, or write to the database. Never prints tokens or raw bodies.
"""
from __future__ import annotations

import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MODEL = "openai/gpt-6-luna"


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ConnectionError("Proxy URL redirected; refusing to forward credentials")


def validated_url(base: str) -> str:
    try:
        parts = urlsplit(base.strip())
        if (parts.scheme != "https" or not parts.hostname or
            parts.username or parts.password or parts.query or parts.fragment or
            parts.path.rstrip("/") != "/functions/v1/openoutfind-ai/v1"):
            raise ValueError()
        if parts.port not in (None, 443):
            raise ValueError()
        return base.rstrip("/") + "/models"
    except ValueError:
        raise ValueError(
            "Set OPENOUTFIND_LLM_API_BASE to the HTTPS Edge Function URL ending "
            "with /functions/v1/openoutfind-ai/v1"
        ) from None


def check(base: str, token: str, fetch=None) -> str:
    if not token or not token.strip():
        raise RuntimeError("Missing GitHub repository secret OPENOUTFIND_LLM_API_KEY")
    url = validated_url(base)
    req = Request(
        url,
        headers={
            "Authorization": "Bearer " + token.strip(),
            "Accept": "application/json",
            "User-Agent": "Explee-Lovable-Proxy-Preflight/1",
        },
        method="GET",
    )
    if fetch is None:
        fetch = build_opener(NoRedirects()).open
    try:
        with fetch(req, timeout=12) as response:
            if response.status != 200:
                raise RuntimeError(f"Unexpected proxy response HTTP {response.status}")
            payload = json.loads(response.read(32768))
    except HTTPError as exc:
        # Never expose raw error bodies; they may contain private provider details.
        if exc.code == 401:
            raise RuntimeError(
                "HTTP 401: GitHub's OPENOUTFIND_LLM_API_KEY does not match the "
                "deployed Edge Function OPENOUTFIND_PROXY_TOKEN, or JWT verification is still enabled"
            ) from None
        if exc.code == 403:
            raise RuntimeError("HTTP 403: the proxy or gateway denied GitHub Actions access") from None
        if exc.code == 404:
            raise RuntimeError("HTTP 404: Lovable AI proxy is not deployed at this project URL") from None
        if exc.code == 503:
            raise RuntimeError("HTTP 503: proxy is deployed but server-side configuration is unavailable") from None
        raise RuntimeError(f"HTTP {exc.code}: proxy connection check failed") from None
    except (URLError, TimeoutError, ConnectionError, OSError) as exc:
        raise RuntimeError(
            f"Proxy unreachable (network, DNS, TLS, timeout, or redirect refusal): {type(exc).__name__}"
        ) from None
    except (UnicodeError, json.JSONDecodeError):
        raise RuntimeError("Proxy responded with invalid JSON; check the function deployment") from None

    models = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(models, list) or MODEL not in [
        value.get("id") for value in models if isinstance(value, dict)
    ]:
        raise RuntimeError("Proxy returned models but did not advertise the expected Lovable AI model")
    return "Lovable AI proxy authentication and model discovery PASS (GET /models, no inference requests)"


def main() -> int:
    try:
        print(check(
            os.environ.get("OPENOUTFIND_LLM_API_BASE", ""),
            os.environ.get("OPENOUTFIND_LLM_API_KEY", ""),
        ))
        return 0
    except (ValueError, RuntimeError) as error:
        print(f"Lovable AI proxy preflight FAILED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
