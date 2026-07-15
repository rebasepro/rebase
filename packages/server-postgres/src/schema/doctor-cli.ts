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
import { validatePolicyPgRoles } from "../security/rls-enforcement";
import { logger } from "@rebasepro/server";

/**
 * The RLS half of the doctor: policies actually deployed vs the ones the
 * collections describe, plus policy roles this server could never satisfy.
 *
 * Returns true when something is wrong, so callers can set the exit code.
 */
async function runPolicyChecks(collectionsPath: string, databaseUrl?: string): Promise<boolean> {
    if (!databaseUrl) {
        logger.warn(chalk.yellow("  ⚠ No DATABASE_URL — skipping RLS policy checks"));
        return false;
    }

    let problems = false;
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
        const collections = await loadCollections(path.resolve(process.cwd(), collectionsPath));
        const runSql = async (text: string) => (await pool.query(text)).rows as Record<string, unknown>[];

        // A policy naming a role the server never runs as filters every row, so
        // the collection reads as empty. Report it without booting a server.
        try {
            await validatePolicyPgRoles(runSql, collections as never);
            logger.info(chalk.green("  ✓ Policy roles are usable by this server"));
        } catch (err) {
            problems = true;
            logger.info("");
            logger.error(chalk.red(err instanceof Error ? err.message : String(err)));
        }

        const drift = await checkPolicyDrift(pool as never, collections);
        logger.info("");
        if (hasDrift(drift)) {
            problems = true;
            logger.info(chalk.yellow("  RLS policies: database does not match your collections"));
            logger.info(formatPolicyDrift(drift));
        } else {
            logger.info(chalk.green("  ✓ RLS policies match your collections"));
        }
    } catch (err) {
        logger.warn(chalk.yellow("  ⚠ Could not check RLS policies"), { error: err });
    } finally {
        await pool.end();
    }
    return problems;
}

async function main() {
    const collectionsArg = process.argv.find((a) => a.startsWith("--collections="));
    const schemaArg = process.argv.find((a) => a.startsWith("--schema="));
    const sdkArg = process.argv.find((a) => a.startsWith("--sdk="));
    // --policies runs only the RLS checks: no schema diff, no SDK types. Useful
    // as a CI gate against a deployed database, where the collection files and
    // generated schema are not what you are asking about.
    const policiesOnly = process.argv.includes("--policies");

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

    if (policiesOnly) {
        // Non-zero so this can gate CI — the whole point of the flag.
        if (await runPolicyChecks(collectionsPath, databaseUrl)) process.exit(1);
        return;
    }

    const report = await runDoctor({
        collectionsPath: path.resolve(process.cwd(), collectionsPath),
        schemaPath: path.resolve(process.cwd(), schemaPath),
        sdkPath: path.resolve(process.cwd(), sdkPath),
        databaseUrl: databaseUrl ?? undefined
    });

    const policiesDrifted = await runPolicyChecks(collectionsPath, databaseUrl);

    // Exit with non-zero code if there are errors
    if (report.summary.errors > 0 || policiesDrifted) {
        process.exit(1);
    }
}

main().catch((err) => {
    logger.error(chalk.red("  ✗ Doctor failed"), { error: err });
    process.exit(1);
});
