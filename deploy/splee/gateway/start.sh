#!/bin/sh
set -eu
: "${LOVABLE_API_KEY:?Set Lovable Cloud project key on the private gateway service}"
: "${GATEWAY_SHARED_SECRET:?Missing generated gateway authentication secret}"
export LITELLM_MASTER_KEY="sk-${GATEWAY_SHARED_SECRET}"
export LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES=true
# Do not log payloads, keys, or model prompts. Private Render network only.
exec litellm --config /opt/splee/config.yaml --host 0.0.0.0 --port 4000
