# Your image.
#
# `rebase eject` wrote this file, and it is now yours — nothing regenerates or
# updates it. The platform runtime is no longer involved: this image compiles
# backend/src/index.ts and runs it, so CORS, auth wiring, storage and shutdown
# are configured there rather than by the runtime.
#
# Build from the repository root:
#   docker build -t {{PROJECT_NAME}} .

# ── Stage 1: install and build ───────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copied wholesale rather than package.json-first: a scaffolded project may or
# may not have a frontend or a config package, and a COPY of a path that does
# not exist fails the build. Layer caching is the thing traded away.
COPY . .

RUN npm install

# Collections → Drizzle schema → compiled JavaScript.
RUN npm run build --workspace backend

# The SPA, if this project has one. REBASE_APP_BASE must match the `path` the
# app declares in rebase.json, or index.html loads and every asset 404s.
RUN if [ -d frontend ]; then REBASE_APP_BASE=/ npm run build --workspace frontend; fi

RUN npm prune --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Run as a non-root user.
RUN addgroup -g 1001 rebase && adduser -u 1001 -G rebase -s /bin/sh -D rebase

COPY --from=builder /app ./
RUN chown -R rebase:rebase /app

USER rebase

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Delegates to the backend workspace's own `start` script, so this line does not
# need to know where tsc happened to put the output.
CMD ["npm", "start", "--workspace", "backend"]
