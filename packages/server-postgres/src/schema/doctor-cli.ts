#!/usr/bin/env node
/**
 * CLI entry point for `rebase doctor`.
 * Invoked via tsx by the server-postgres CLI plugin.
 */
import path from "path";
import chalk from "chalk";
import { runDoctor } from "./doctor";
import { exitCodeForPolicyGate, runPolicyChecks } from "./doctor-policy-checks";
import { diagnoseDbError } from "../cli-errors";

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
            dotenv.config({ path: envPath, quiet: true });
        } else {
            dotenv.config({ quiet: true });
        }
    } catch {
        // dotenv may not be installed
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;

    if (policiesOnly) {
        // Non-zero so this can gate CI — the whole point of the flag, and a
        // check that could not run has not passed. See exitCodeForPolicyGate.
        process.exit(exitCodeForPolicyGate(await runPolicyChecks(collectionsPath, databaseUrl)));
    }

    const report = await runDoctor({
        collectionsPath: path.resolve(process.cwd(), collectionsPath),
        schemaPath: path.resolve(process.cwd(), schemaPath),
        sdkPath: path.resolve(process.cwd(), sdkPath),
        databaseUrl: databaseUrl ?? undefined
    });

    const policyStatus = await runPolicyChecks(collectionsPath, databaseUrl);

    // Exit non-zero if there are errors. A policy run that could not happen is
    // reported loudly above but does not fail the interactive command — the
    // same treatment the *chosen* skip of the database phase gets. `--policies`
    // is the gate, and that one fails closed.
    //
    // A phase that was skipped by a fault is different, and `blocked` is what
    // separates the two: "no DATABASE_URL" is a local situation somebody may be
    // content with, while "the DATABASE_URL you set refuses connections" would
    // otherwise let `rebase doctor` go green in CI against a database it never
    // reached.
    const blocked = [report.collectionsToSchema, report.schemaToDatabase, report.collectionsToSdk]
        .some(phase => phase.blocked);
    if (report.summary.errors > 0 || policyStatus === "problems" || blocked) {
        process.exit(1);
    }
}

main().catch((err) => {
    // A known database failure has a diagnosis; a stack trace through pg and
    // drizzle internals is not it. This is the last resort — `runDoctor`
    // already catches the connection failure it can name — so it exists for
    // everything reached after the report, the policy checks in particular.
    const banner = diagnoseDbError(err, process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING);
    if (banner) {
        console.error(banner);
    } else {
        console.error(chalk.red("  ✗ Doctor failed"), err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
    process.exit(1);
});
