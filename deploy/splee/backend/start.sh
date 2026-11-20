#!/bin/sh
set -eu
# Fail closed: never start an unconfigured server with public access.
: "${DATABASE_URL:?Missing Splee PostgreSQL URL}"
: "${APP_SECRET:?Missing Splee encryption secret}"
: "${PUBLIC_URL:?Missing HTTPS public URL}"
: "${GATEWAY_HOST:?Missing private AI gateway host}"
: "${GATEWAY_SHARED_SECRET:?Missing AI gateway credential}"
case "$PUBLIC_URL" in https://*) ;; *) echo 'PUBLIC_URL must use https' >&2; exit 1;; esac
case "${SENDING_ENABLED:-}" in false) ;; *) echo 'Sending must remain disabled for QA' >&2; exit 1;; esac
case "${PUBLIC_AGENT:-}" in false) ;; *) echo 'Public demo agent must remain disabled for QA' >&2; exit 1;; esac
# The Claude CLI is a protocol client only: inference is sent to LiteLLM
# (Anthropic Messages -> OpenAI Chat Completions -> Lovable AI), not Anthropic.
export ANTHROPIC_BASE_URL="http://${GATEWAY_HOST}:4000"
export ANTHROPIC_AUTH_TOKEN="sk-${GATEWAY_SHARED_SECRET}"
export ANTHROPIC_MODEL="${AGENT_MODEL:-claude-sonnet-5-5}"
unset ANTHROPIC_API_KEY || true
export DISABLE_AUTOUPDATER=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
exec /usr/local/bin/splee
