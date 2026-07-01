# ─── Multi-stage production Dockerfile for the Rebase backend ─────────
# Produces a minimal image (~150MB) with only the runtime needed.
#
# Build context: the project root (where pnpm-workspace.yaml lives)
# Usage:
#   docker build -t my-app-backend -f backend/Dockerfile .
#   docker run -p 3001:3001 --env-file .env my-app-backend

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
