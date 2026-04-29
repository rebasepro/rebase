#!/usr/bin/env node
/**
 * CLI entry point for `rebase doctor`.
 * Invoked via tsx by the server-postgresql CLI plugin.
 */
import path from "path";
import chalk from "chalk";
import { runDoctor } from "./doctor";

async function main() {
    const collectionsArg = process.argv.find((a) => a.startsWith("--collections="));
    const schemaArg = process.argv.find((a) => a.startsWith("--schema="));

    const collectionsPath = collectionsArg?.split("=")[1] ?? path.join("..", "shared", "collections");
    const schemaPath = schemaArg?.split("=")[1] ?? path.join("src", "schema.generated.ts");

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
        databaseUrl: databaseUrl ?? undefined,
    });

    // Exit with non-zero code if there are errors
    if (report.summary.errors > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(chalk.red("  ✗ Doctor failed:"), err instanceof Error ? err.message : String(err));
    process.exit(1);
});
