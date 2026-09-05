#!/usr/bin/env node
/**
 * The Rebase runtime entrypoint.
 *
 * Runs a built project bundle. This is what the official `rebasepro/server`
 * container image executes, and what a self-hosted deployment runs directly:
 *
 *     rebase-server ./dist-bundle
 *     REBASE_BUNDLE=/bundle rebase-server
 *
 * The bundle is the project; this process is the engine. Keeping them separate
 * is what allows the engine to be upgraded — a security patch, a performance
 * fix — without rebuilding anyone's application.
 */
import { runFromBundle } from "../dist/index.es.js";

const args = process.argv.slice(2);

if (args[0] === "--help" || args[0] === "-h") {
    console.log(`
rebase-server — run a built Rebase project bundle

Usage:
  rebase-server [bundle-dir]

Arguments:
  bundle-dir            Path to the bundle. Defaults to $REBASE_BUNDLE, then ./dist-bundle

Key environment variables:
  NODE_ENV              "production" for a deployment. It closes the first-admin
                        window, requires CORS_ORIGINS, refuses local file
                        storage and turns the OpenAPI docs off
  DATABASE_URL          Connection string for the default database (required)
  JWT_SECRET            Signing secret, >=32 chars (required in production)
  REBASE_SERVICE_KEY    Server-to-server credential that bypasses row-level
                        security. Treat it like a database superuser password
  PORT                  Port to bind (default 3001)
  CORS_ORIGINS          Comma-separated allowed origins (required in production)
  REBASE_ADMIN_EMAIL    The first admin account, created once while the user
  REBASE_ADMIN_PASSWORD table is empty (>=12 chars). In production the first
                        account to register is NOT promoted, so without these
                        a fresh deployment has no way in
  DISABLE_SELF_REGISTRATION  "true" to refuse sign-ups outright
  REBASE_METRICS        "true" to expose Prometheus metrics at /metrics
  REBASE_MIGRATE_ON_BOOT  none | ensure (default). "ensure" creates missing
                        tables and columns at boot, INCLUDING your collections',
                        additively, and applies their row-level security. It
                        never alters, drops or narrows: those go through
                        'rebase db push' from a checkout, along with
                        junction-table RLS for many-to-many relations

Additional databases and buckets are configured by suffixing the variable with
the source key, e.g. DATABASE_URL__ANALYTICS or S3_BUCKET__MEDIA.

Docs: https://rebase.pro/docs/deployment/self-hosting/
`.trim());
    process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    console.log(pkg.version);
    process.exit(0);
}

await runFromBundle({ bundleDir: args[0] });
