# ─── Multi-stage production Dockerfile for the Rebase backend ─────────
# Build context: the monorepo root (where pnpm-workspace.yaml lives)
# Usage:
#   docker build -t rebase-backend -f app/backend/Dockerfile .

# ── Stage 1: Install + Build ─────────────────────────────────────────
FROM node:22-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable

RUN apk add --no-cache python3 make g++ curl ca-certificates bash

WORKDIR /app

# Copy workspace root
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy source packages and app
COPY packages ./packages
COPY app ./app
# Every package's build ends with `node ../../tooling/scripts/assert-build-output.mjs`,
# so the build fails without it. The build context is the workspace root, but
# only the directories named here are actually copied in.
#
# `tooling/scripts`, not `scripts`: the directory was moved under `tooling/` and
# this line kept naming the old path, so `COPY` failed on a context that no
# longer had it and every demo build died here. The `RUN` below already used the
# new path — the two halves of the same rename disagreed.
COPY tooling/scripts ./tooling/scripts

# Populate the served uploads directory from the git-tracked `app/seed-assets/`.
# `app/uploads/` is gitignored AND excluded by .dockerignore, so it is never
# inherited from the host: the image's asset content is reproducible from git,
# and a build from a fresh clone, a worktree, or CI ships the same images as one
# from a long-lived checkout. Without this the demo served 404s for every image.
RUN node tooling/scripts/mirror-seed-assets.mjs app/seed-assets app/uploads

# Install all dependencies with flat node_modules for Docker compatibility
# (many packages rely on hoisted devDependencies like @vitejs/plugin-react)
RUN pnpm install --shamefully-hoist

# Build all packages. This must fail the image on error: `dist` is dockerignored,
# so a swallowed failure here produces an image with missing or partial output
# rather than a loud build error.
RUN pnpm --filter './packages/*' -r run build

# Build the backend (TypeScript → JavaScript), then resolve ESM import extensions
# 1. tsc compiles TS→JS  2. tsc-alias resolves path aliases  3. sed adds .js to remaining relative imports
RUN cd app/backend && npx tsc -p tsconfig.docker.json && npx tsc-alias -p tsconfig.docker.json -f \
    && find dist -name '*.js' -exec sed -i 's/from "\(\.[^"]*\)"/from "\1.js"/g; s/\.js\.js/.js/g' {} +

# Build frontend. VITE_GOOGLE_CLIENT_ID is injected as a build-arg because the
# only other source, app/frontend/.env.production, is gitignored AND stripped
# from the build context by .dockerignore's **/.env.* rule — so without this the
# SPA compiles with an empty client id and the Google login button hides itself.
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
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

# Uploads arrive from the builder, mirrored there from the tracked seed-assets
# (not inherited from the host — app/uploads is dockerignored).
# Set STORAGE_PATH so the app resolves to the correct location at runtime
RUN mkdir -p /app/app/uploads && chown -R rebase:rebase /app

ENV STORAGE_PATH=/app/app/uploads

USER rebase

WORKDIR /app/app/backend
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Copy the entrypoint script for auto-migration
COPY --from=builder /app/app/backend/entrypoint.sh ./entrypoint.sh
COPY --from=builder /app/app/backend/drizzle ./drizzle

# Auto-migrate then start the compiled JavaScript backend
CMD ["sh", "entrypoint.sh"]
