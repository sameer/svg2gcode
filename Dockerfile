FROM node:22-bookworm-slim AS builder

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

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack

WORKDIR /app

COPY Cargo.toml Cargo.lock LICENSE README.md ./
COPY cli ./cli
COPY lib ./lib
COPY wasm ./wasm
COPY web ./web

WORKDIR /app/web

RUN npm ci
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/web/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
