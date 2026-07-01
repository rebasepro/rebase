# ─── Multi-stage production Dockerfile for the Rebase frontend ────────
# Builds the Vite app, then serves via nginx for proper caching/compression.
#
# Build context: the project root (where pnpm-workspace.yaml lives)
# Usage:
#   docker build -t my-app-frontend -f frontend/Dockerfile .

# ── Stage 1: Install + Build ─────────────────────────────────────────
FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Copy workspace packages
COPY frontend ./frontend
COPY config ./config

# Install dependencies (skip scripts to avoid @ariga/atlas binary download,
# which is a backend-only dependency that may fail on certain platforms)
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm rebuild esbuild

# Build config first, then frontend
RUN pnpm --filter "*-config" run build
RUN pnpm --filter "*-frontend" run build

# ── Stage 2: Serve with nginx ────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx page
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Custom nginx config for SPA routing + compression
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
