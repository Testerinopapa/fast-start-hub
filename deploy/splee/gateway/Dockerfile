# Isolated Anthropic Messages -> Lovable AI compatibility gateway.
# LiteLLM receives credentials only at runtime, never during image build.
FROM python:3.12-slim-bookworm
RUN pip install --no-cache-dir "litellm[proxy]==1.110.2"
COPY deploy/splee/gateway/config.yaml /opt/splee/config.yaml
COPY deploy/splee/gateway/start.sh /usr/local/bin/splee-gateway-start
RUN chmod 755 /usr/local/bin/splee-gateway-start \
  && groupadd -r gateway && useradd -r -g gateway -m gateway
USER gateway
ENV PYTHONUNBUFFERED=1 LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES=true
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/splee-gateway-start"]
