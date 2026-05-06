# ─── Multi-stage production Dockerfile for the Rebase backend ─────────
# Build context: the monorepo root (where pnpm-workspace.yaml lives)
# Usage:
#   docker build -t rebase-backend -f app/backend/Dockerfile .

# ── Stage 1: Install + Build ─────────────────────────────────────────
FROM node:22-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace root
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy source packages, patches, and app
COPY packages ./packages
COPY patches ./patches
COPY app ./app

# Install all dependencies with flat node_modules for Docker compatibility
# (many packages rely on hoisted devDependencies like @vitejs/plugin-react)
RUN pnpm install --shamefully-hoist

# Build all packages using pnpm recursive with --no-bail.
# Some packages may fail tsc declarations — that's fine, we only need vite bundles + esbuild outputs.
RUN pnpm --filter './packages/*' -r --no-bail run build; exit 0

# Build the backend (TypeScript → JavaScript), then resolve ESM import extensions
RUN cd app/backend && npx tsc -p tsconfig.docker.json && npx tsc-alias -p tsconfig.docker.json -f

# Build frontend (reads .env.production for VITE_API_URL etc.)
RUN cd app/frontend && npx vite build

# Prune devDependencies to reduce image size
RUN pnpm install --shamefully-hoist --prod

# ── Stage 2: Production Runtime ──────────────────────────────────────
FROM node:22-alpine AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

RUN corepack enable

# Security: run as non-root
RUN addgroup -g 1001 rebase && adduser -u 1001 -G rebase -s /bin/sh -D rebase

WORKDIR /app

# Copy only production artifacts (node_modules already pruned of devDependencies)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/app ./app

# Create uploads directory
RUN mkdir -p /app/app/backend/uploads && chown -R rebase:rebase /app

USER rebase

WORKDIR /app/app/backend
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Copy the entrypoint script and drizzle config for auto-migration
COPY --from=builder /app/app/backend/entrypoint.sh ./entrypoint.sh
COPY --from=builder /app/app/backend/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/app/backend/drizzle ./drizzle

# Auto-migrate then start the compiled JavaScript backend
CMD ["sh", "entrypoint.sh"]
