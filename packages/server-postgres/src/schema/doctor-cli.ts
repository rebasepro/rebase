#!/usr/bin/env node
/**
 * CLI entry point for `rebase doctor`.
 * Invoked via tsx by the server-postgresql CLI plugin.
 */
import path from "path";
import chalk from "chalk";
import fs from "fs";
import { runDoctor, loadCollections } from "./doctor";
import { checkPolicyDrift, formatPolicyDrift, hasDrift } from "../security/policy-drift";
import { logger } from "@rebasepro/server";

async function main() {
    const collectionsArg = process.argv.find((a) => a.startsWith("--collections="));
    const schemaArg = process.argv.find((a) => a.startsWith("--schema="));
    const sdkArg = process.argv.find((a) => a.startsWith("--sdk="));

    const collectionsPath = collectionsArg?.split("=")[1] ?? path.join("..", "config", "collections");
    const schemaPath = schemaArg?.split("=")[1] ?? path.join("src", "schema.generated.ts");
    const sdkPath = sdkArg?.split("=")[1] ?? path.join("..", "generated", "sdk", "database.types.ts");

    // Load .env
    try {
        const dotenv = await import("dotenv");
        const envPath = process.env.DOTENV_CONFIG_PATH;
        if (envPath) {
            dotenv.config({ path: envPath });
        } else {
            dotenv.config();
        }
    } catch {
        // dotenv may not be installed
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;

    const report = await runDoctor({
        collectionsPath: path.resolve(process.cwd(), collectionsPath),
        schemaPath: path.resolve(process.cwd(), schemaPath),
        sdkPath: path.resolve(process.cwd(), sdkPath),
        databaseUrl: databaseUrl ?? undefined
    });

    // ── RLS policy drift ─────────────────────────────────────────────────
    // Policies live in the database; the collections are only their source.
    // Nothing else reconciles the two, so a stale policy from an old push keeps
    // filtering rows and the collection just reads as empty.
    let policiesDrifted = false;
    if (databaseUrl) {
        try {
            const { Pool } = await import("pg");
            const pool = new Pool({ connectionString: databaseUrl });
            try {
                const collections = await loadCollections(path.resolve(process.cwd(), collectionsPath));
                const drift = await checkPolicyDrift(pool as never, collections);
                policiesDrifted = hasDrift(drift);
                logger.info("");
                if (policiesDrifted) {
                    logger.info(chalk.yellow("  RLS policies: database does not match your collections"));
                    logger.info(formatPolicyDrift(drift));
                } else {
                    logger.info(chalk.green("  ✓ RLS policies match your collections"));
                }
            } finally {
                await pool.end();
            }
        } catch (err) {
            logger.warn(chalk.yellow("  ⚠ Could not check RLS policy drift"), { error: err });
        }
    }

    // Exit with non-zero code if there are errors
    if (report.summary.errors > 0 || policiesDrifted) {
        process.exit(1);
    }
}

main().catch((err) => {
    logger.error(chalk.red("  ✗ Doctor failed"), { error: err });
    process.exit(1);
});
