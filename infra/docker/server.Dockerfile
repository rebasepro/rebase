# The official Rebase runtime image.
#
# It contains the engine and nothing of any particular project. A project is
# supplied as a **bundle** mounted at /bundle, which is what makes the two
# separable: the image can be rebuilt for a security patch and every project
# running on it picks that up on restart, without anyone rebuilding an app.
#
#   docker run -v ./dist-bundle:/bundle -e DATABASE_URL=... rebasepro/server
#
# Build from the repository root:
#   docker build -f infra/docker/server.Dockerfile -t rebasepro/server:0.11.0 .

# ── Stage 1: build the workspace packages ────────────────────────────────────
FROM node:22-slim AS build

RUN corepack enable

WORKDIR /src

# Manifests first so the dependency layer survives source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
COPY packages/common/package.json packages/common/
COPY packages/client/package.json packages/client/
COPY packages/codegen/package.json packages/codegen/
COPY packages/server/package.json packages/server/
COPY packages/server-postgres/package.json packages/server-postgres/

# The runtime never runs atlas — it is imported only by server-postgres's CLI
# (migration authoring), never on the boot path, and the image only supports
# REBASE_MIGRATE_ON_BOOT=ensure|none, neither of which shells out to it. Its
# install script downloads a binary from a third-party host (atlasbinaries.com),
# so building it here adds a network dependency and a supply-chain surface for a
# tool the runtime cannot use. Mark it explicitly not-built so pnpm skips the
# download AND does not fail asking for a decision (pnpm 11 errors on an
# undecided ignored build). The package still installs, it just has no binary —
# exactly right, because nothing in the runtime invokes one.
RUN sed -i "s#'@ariga/atlas': true#'@ariga/atlas': false#" pnpm-workspace.yaml

RUN pnpm install --frozen-lockfile --filter @rebasepro/server... --filter @rebasepro/server-postgres...

COPY packages/types packages/types
COPY packages/utils packages/utils
COPY packages/common packages/common
COPY packages/client packages/client
COPY packages/codegen packages/codegen
COPY packages/server packages/server
COPY packages/server-postgres packages/server-postgres
# `tooling/scripts`, not `scripts`. Every package build below shells out to
# `../../tooling/scripts/{add-dts-extensions,assert-build-output}.mjs`, and the
# directory moved there in 1530c79c5 while this line did not — so the image has
# not been buildable since, failing at COPY with `"/scripts": not found` before
# any of those scripts could be missed.
COPY tooling/scripts tooling/scripts

RUN pnpm --filter @rebasepro/types build \
    && pnpm --filter @rebasepro/utils build \
    && pnpm --filter @rebasepro/common build \
    && pnpm --filter @rebasepro/client build \
    && pnpm --filter @rebasepro/codegen build \
    && pnpm --filter @rebasepro/server build \
    && pnpm --filter @rebasepro/server-postgres build

# Assemble a plain, hoisted node_modules the runtime image can use directly.
# pnpm's symlinked store does not survive a COPY between stages intact, and the
# runtime has no package manager to repair it with.
RUN mkdir -p /runtime \
    && cd /runtime \
    && npm init -y > /dev/null \
    && npm install --omit=dev --no-audit --no-fund \
        "hono@^4.12.25" \
        "@hono/node-server@^2.0.4" \
        "drizzle-orm@^0.45.2" \
        "jsonwebtoken@^9.0.3" \
        "ws@^8.21.0" \
        "zod@^4.4.3" \
        "pg@^8.21.0" \
        "@aws-sdk/client-s3@^3.1068.0" \
        "@aws-sdk/s3-request-presigner@^3.1068.0" \
        "nodemailer@^6.9.0" \
        "json-logic-js@^2.0.5" \
        "fast-equals@6.0.2" \
        "object-hash@^3.0.0" \
    && mkdir -p node_modules/@rebasepro
# The last three are drivers for features the RUNTIME implements and loads with
# `await import(...)` only when a project turns them on: S3 object storage and
# SMTP email.
#
# They belong in the image for the same reason `pg` does — the runtime is what
# constructs the storage and email controllers, so those imports resolve from
# HERE. A project declaring `@aws-sdk/client-s3` in its own dependencies does not
# help: that copy lands in /bundle/node_modules, which is not on the resolution
# path of a module living in /app.
#
# Without them a tenant with S3 storage configured boots clean, passes every
# health probe, serves every other route, and fails ONLY on writes with
# "@aws-sdk/client-s3 is required for S3 storage". That surfaced as documents
# which appeared to save — the row and its thumbnail updated, so the dashboard
# preview showed the new artwork — but reopened empty, because the payload
# upload was the one part that threw.
#
# Deliberately NOT here: `@google-cloud/storage` (tenant pods cannot reach the
# GKE metadata server, so GCS is reached over its S3-compatible API instead) and
# `sharp` (native, and managed intake rejects native dependencies outright).

# The workspace packages are copied into the runtime stage below, one by one, so
# that only built output ships. (They are deliberately NOT copied here: a
# `COPY --from=build` inside the `build` stage itself is self-referential.)

# ── Stage 2: the runtime ─────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# tini reaps zombies and forwards signals, so SIGTERM reaches the process and
# graceful shutdown actually runs instead of being killed after the grace period.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Where the image keeps its own copy of the framework. The runtime collapses a
# bundle's duplicate `@rebasepro/server` onto this one after installing the
# bundle's dependencies — a second copy is a different module instance, so every
# custom function would resolve a framework whose singleton was never
# initialised and throw "server not initialized yet" on every request.
ENV NODE_ENV=production \
    PORT=8080 \
    REBASE_RUNTIME_MODULES=/app/node_modules

WORKDIR /app

COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /src/packages/types/dist ./node_modules/@rebasepro/types/dist
COPY --from=build /src/packages/types/package.json ./node_modules/@rebasepro/types/package.json
COPY --from=build /src/packages/utils/dist ./node_modules/@rebasepro/utils/dist
COPY --from=build /src/packages/utils/package.json ./node_modules/@rebasepro/utils/package.json
COPY --from=build /src/packages/common/dist ./node_modules/@rebasepro/common/dist
COPY --from=build /src/packages/common/package.json ./node_modules/@rebasepro/common/package.json
COPY --from=build /src/packages/client/dist ./node_modules/@rebasepro/client/dist
COPY --from=build /src/packages/client/package.json ./node_modules/@rebasepro/client/package.json
COPY --from=build /src/packages/codegen/dist ./node_modules/@rebasepro/codegen/dist
COPY --from=build /src/packages/codegen/package.json ./node_modules/@rebasepro/codegen/package.json
COPY --from=build /src/packages/server/dist ./node_modules/@rebasepro/server/dist
COPY --from=build /src/packages/server/bin ./node_modules/@rebasepro/server/bin
COPY --from=build /src/packages/server/package.json ./node_modules/@rebasepro/server/package.json
COPY --from=build /src/packages/server-postgres/dist ./node_modules/@rebasepro/server-postgres/dist
COPY --from=build /src/packages/server-postgres/src ./node_modules/@rebasepro/server-postgres/src
COPY --from=build /src/packages/server-postgres/package.json ./node_modules/@rebasepro/server-postgres/package.json

COPY infra/docker/entrypoint.mjs ./entrypoint.mjs

# An empty mount point, so `docker run` without a volume fails with the runtime's
# own "no bundle here" message rather than an ENOENT from the loader.
RUN mkdir -p /bundle && chown -R node:node /app /bundle

# Unprivileged: nothing here needs root, and a compromised hook should not be
# able to write to the image.
USER node

EXPOSE 8080

# Readiness is a database round-trip; liveness deliberately is not, so a database
# blip cannot make an orchestrator kill an otherwise healthy process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "./entrypoint.mjs"]
