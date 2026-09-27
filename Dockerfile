# syntax=docker/dockerfile:1

# ---------- build stage: compile native dependencies ----------
FROM node:24-alpine AS builder
WORKDIR /app
# better-sqlite3 ships no prebuilt binary for musl/arm64 — build from source
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- runtime stage ----------
FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="ShadowVeil" \
      org.opencontainers.image.description="Online code obfuscation platform (JavaScript / Python / Shell + open API)"

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/shadowveil.db

WORKDIR /app

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

# SQLite storage (mount a volume here to persist data)
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000/api/v1/health" >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
