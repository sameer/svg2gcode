# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        binaryen \
        build-essential \
        ca-certificates \
        curl \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:${PATH}
ENV CARGO_TARGET_DIR=/tmp/svg2gcode-wasm-target
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_FACTOR=2
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV NPM_CONFIG_NETWORK_TIMEOUT=300000

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack

COPY docker/start-frontend-dev.sh /usr/local/bin/start-frontend-dev.sh

WORKDIR /app/web

EXPOSE 5173

CMD ["sh", "/usr/local/bin/start-frontend-dev.sh"]
