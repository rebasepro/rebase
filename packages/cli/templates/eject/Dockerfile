# ─── Your image ───────────────────────────────────────────────────────
#
# `rebase eject` wrote this file, and it is yours now — nothing regenerates or
# updates it. The platform runtime is no longer involved: this image compiles
# and runs backend/src/index.ts, so CORS, auth wiring, storage and shutdown are
# configured there rather than by the runtime, and Rebase runtime upgrades do
# not reach this project.
#
# Assumes pnpm, which is what `rebase init` scaffolds a workspace for. On npm,
# swap the three pnpm lines below for `npm ci` and `npm run build --workspace`.
#
# Build context: the project root (where pnpm-workspace.yaml lives)
# Usage:
#   docker build -t my-app .
#   docker compose -f docker-compose.custom.yml up
#
# The managed alternative — no image to build, your project mounted into the
# published runtime — is docker-compose.yml, which is still here and still
# works if you change `runtime` back to "managed" in rebase.json.

# ── Stage 1: Install + Build ─────────────────────────────────────────
FROM node:22-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Native dependencies for bcrypt, pg, etc.
RUN apk add --no-cache python3 make g++ curl ca-certificates

WORKDIR /app

# Copy workspace root files first (cache-friendly layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Copy workspace packages
COPY backend ./backend
COPY config ./config

# Install all deps (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Build config first, then backend
RUN pnpm --filter "*-config" run build
RUN pnpm --filter "*-backend" run build

# Prune dev dependencies for a smaller runtime
RUN CI=true pnpm install --frozen-lockfile --prod

# ── Stage 2: Production Runtime ──────────────────────────────────────
FROM node:22-alpine AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV CI=true

RUN corepack enable

# Security: run as non-root
RUN addgroup -g 1001 rebase && adduser -u 1001 -G rebase -s /bin/sh -D rebase

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/config ./config

# Create uploads directory
RUN mkdir -p /app/backend/uploads && chown -R rebase:rebase /app

USER rebase

WORKDIR /app/backend
EXPOSE 3001

# Health check for orchestrators (Docker Compose, ECS, k8s)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["pnpm", "start"]
