# Splee is a separate AGPL-3.0 program, NOT bundled into Explee.
# Pin upstream commit so a build never silently imports new source.
FROM rust:1.93-bookworm AS builder
ARG SPLEE_COMMIT=3c2b1723bc9651a2cd2872ae6a3b4939501c8435
RUN apt-get update && apt-get install -y --no-install-recommends git pkg-config clang cmake libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --filter=blob:none --no-checkout https://github.com/Iweisc/splee.git /splee \
    && git -C /splee checkout --detach "${SPLEE_COMMIT}" \
    && test "$(git -C /splee rev-parse HEAD)" = "${SPLEE_COMMIT}"
WORKDIR /splee/backend
RUN cargo build --locked --release -p splee

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 curl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code@2.1.329 \
  && claude --version
COPY --from=builder /splee/backend/target/release/splee /usr/local/bin/splee
COPY deploy/splee/backend/start.sh /usr/local/bin/splee-start
RUN chmod 755 /usr/local/bin/splee-start \
  && groupadd -r splee && useradd -r -g splee -m splee
USER splee
ENV BIND_ADDR=0.0.0.0:10000 SENDING_ENABLED=false PUBLIC_AGENT=false OPEN_SIGNUP=false AGENT_CONCURRENCY=1
EXPOSE 10000
ENTRYPOINT ["/usr/local/bin/splee-start"]
