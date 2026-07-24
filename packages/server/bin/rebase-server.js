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
  DATABASE_URL          Connection string for the default database (required)
  JWT_SECRET            Signing secret, >=32 chars (required in production)
  PORT                  Port to bind (default 3001)
  CORS_ORIGINS          Comma-separated allowed origins (required in production)
  REBASE_METRICS        "true" to expose Prometheus metrics at /metrics
  REBASE_MIGRATE_ON_BOOT  none | ensure | push

Additional databases and buckets are configured by suffixing the variable with
the source key, e.g. DATABASE_URL__ANALYTICS or S3_BUCKET__MEDIA.

Docs: https://rebase.pro/docs/backend/self-hosting
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
