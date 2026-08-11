import chalk from "chalk";
import fs from "fs";
import path from "path";
import pg from "pg";
import arg from "arg";
import * as dotenv from "dotenv";
import readline from "readline";

import {
    buildTablesMap,
    buildEnumMap,
    generateCollectionFile,
    generateIndexContent,
    mergeIndexContent,
    safeHostFromUrl
} from "./introspect-db-logic";
import { detectCollectionBuilder } from "./introspect-db-project";
import { countRowsUpTo, readSchemaMetadata } from "./introspect-db-queries";
import { classifyTables, lookupCandidates, LOOKUP_MAX_ROWS } from "./introspect-db-structure";
import { parseCheckConstraints } from "./introspect-db-constraints";
import { out, outWarn, outError } from "../cli-output";

async function main() {
    const args = arg(
        {
            "--output": String,
            "--collections": String,
            "--force": Boolean,
            "--schema": String,
            "--data-inference": Boolean,
            "--no-data-inference": Boolean,
            "-o": "--output",
            "-c": "--collections",
            "-f": "--force"
        },
        { permissive: true }
    );

    const cwd = process.cwd();
    const isBackendDir = path.basename(cwd) === "backend";
    const defaultOutDir = isBackendDir
        ? path.resolve(cwd, "..", "config", "collections")
        : path.resolve(cwd, "config", "collections");

    const outDir = args["--output"] || args["--collections"] || defaultOutDir;
    const force = args["--force"] || false;
    const pgSchema = args["--schema"] || "public";

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    // Load env
    const envPaths = [
        process.env.DOTENV_CONFIG_PATH,
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../.env"),
        path.resolve(process.cwd(), "../../.env")
    ].filter(Boolean) as string[];

    for (const p of envPaths) {
        if (fs.existsSync(p)) {
            dotenv.config({ path: p, quiet: true });
            break;
        }
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;
    if (!databaseUrl) {
        outError(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
        process.exit(1);
    }

    const client = new pg.Client({ connectionString: databaseUrl });

    try {
        await client.connect();
    } catch (err) {
        outError(chalk.red(`✗ Failed to connect to database: ${err instanceof Error ? err.message : String(err)}`));
        outError(chalk.gray("  Check your DATABASE_URL and ensure the database is reachable."));
        process.exit(1);
    }

    // Log the host portion safely — handle URLs without "@"
    const hostPart = safeHostFromUrl(databaseUrl);
    out(chalk.gray(`Connected to database: ${hostPart}`));
    out(chalk.gray(`Introspecting schema '${pgSchema}'...`));

    try {
        const metadata = await readSchemaMetadata(client, pgSchema);
        const enumMap = buildEnumMap(metadata.enumValues);
        const tablesMap = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);
        const fks = metadata.fks;

        // Only tables that could structurally be a code list are counted, and
        // each count stops at the threshold — see `countRowsUpTo`. Introspection
        // runs against a database it does not own, so "cheap on a table of any
        // size" is a requirement, not an optimization.
        for (const table of lookupCandidates(metadata, tablesMap)) {
            try {
                metadata.rowCounts[table] = await countRowsUpTo(client, pgSchema, table, LOOKUP_MAX_ROWS);
            } catch (err) {
                // A table this run cannot read is simply not classified as a code
                // list; everything else about it still generates.
                out(chalk.gray(`  (skipped row count for ${table}: ${err instanceof Error ? err.message : String(err)})`));
            }
        }

        const classifications = classifyTables(metadata, tablesMap);
        const checkFacts = parseCheckConstraints(metadata.checks);

        // Which builder the generated files may import — read from the manifests
        // above `outDir`, because a project without `@rebasepro/admin-types` cannot
        // resolve that import and has no `admin` block to write into either.
        const builder = detectCollectionBuilder(outDir);
        if (builder === "annotation") {
            outWarn(chalk.yellow(
                "⚠ Neither @rebasepro/admin-types nor @rebasepro/common is declared above " +
                `${outDir}.`
            ));
            outWarn(chalk.gray(
                "  Generating plain type annotations, which widen the property keys to `string`: " +
                "`propertiesOrder` and friends will not be checked. Add @rebasepro/common to the " +
                "config package to turn that checking on."
            ));
        }
        const joinTables = new Set(
            Array.from(classifications.values())
                .filter((c) => c.role === "junction")
                .map((c) => c.table)
        );

        const roleCount = (role: string) =>
            Array.from(classifications.values()).filter((c) => c.role === role).length;

        out(chalk.blue(`Found ${tablesMap.size} tables.`));
        out(chalk.gray(
            `  ${roleCount("entity")} entities, ${joinTables.size} join tables (folded into relations), ` +
            `${roleCount("lookup")} code lists, ${roleCount("owned-child")} owned by another table (hidden from navigation).`
        ));

        let runDataInference = false;
        if (args["--no-data-inference"]) {
            runDataInference = false;
        } else if (args["--data-inference"] !== undefined) {
            runDataInference = args["--data-inference"];
        } else if (!process.stdin.isTTY) {
            // No terminal to answer the question below (scaffolding scripts, CI,
            // `rebase init --introspect`) — asking would hang forever.
            out(chalk.gray("Skipping data inference (non-interactive run; pass --data-inference to enable)."));
        } else {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            const answer = await new Promise<string>((resolve) => rl.question(chalk.yellow("? Do you want to run comprehensive data inference on sampled rows to auto-detect types, formats, constraints, and UI configurations? (y/N) "), resolve));
            runDataInference = answer.trim().toLowerCase() === "y";
            rl.close();
        }

        if (runDataInference) {
            out(chalk.gray("Sampling database rows for data inference..."));
        }

        // Generate Collections
        const generatedFiles: string[] = [];
        const skippedFiles: string[] = [];

        const tablesToProcess = Array.from(tablesMap.entries()).filter(([tableName]) => !joinTables.has(tableName));

        const BATCH_SIZE = 10;
        for (let i = 0; i < tablesToProcess.length; i += BATCH_SIZE) {
            const batch = tablesToProcess.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async ([tableName, meta]) => {
                // ── File overwrite protection ──────────────────────────────
                const filePath = path.join(outDir, `${tableName}.ts`);
                if (fs.existsSync(filePath) && !force) {
                    skippedFiles.push(tableName);
                    return;
                }

                let sampleData: Record<string, unknown>[] | undefined = undefined;
                if (runDataInference) {
                    try {
                        const { rows } = await client.query(`SELECT * FROM "${pgSchema}"."${tableName}" LIMIT 100`);
                        sampleData = rows;
                    } catch (err) {
                        outError(chalk.yellow(`⚠ Failed to sample data for table ${tableName}: ${err instanceof Error ? err.message : String(err)}`));
                    }
                }

                const fileContent = generateCollectionFile(
                    tableName,
                    meta,
                    fks,
                    joinTables,
                    tablesMap,
                    enumMap,
                    sampleData,
                    { metadata, classifications, checkFacts, builder }
                );

                fs.writeFileSync(filePath, fileContent, "utf-8");
                generatedFiles.push(tableName);
                out(chalk.green(`  ✓ ${filePath}`));
            }));
        }

        // Generate index.ts (sorted alphabetically for deterministic output)
        if (generatedFiles.length > 0) {
            const indexPath = path.join(outDir, "index.ts");

            if (fs.existsSync(indexPath) && !force) {
                // Merge: read existing index, add new exports that don't already exist
                const existing = fs.readFileSync(indexPath, "utf-8");
                const merged = mergeIndexContent(existing, generatedFiles);
                fs.writeFileSync(indexPath, merged, "utf-8");
            } else {
                // --force replaces collections derived from the database, but the
                // directory can also hold hand-written ones with no table in the
                // introspected schema (the auth users collection lives in
                // "rebase"). The backend discovers the whole directory, so an
                // index listing only introspected tables would silently drop them
                // from the admin UI while the API still served them.
                const siblings = fs.readdirSync(outDir)
                    .filter(f => f.endsWith(".ts") && f !== "index.ts")
                    .map(f => f.replace(/\.ts$/, ""));
                const allFiles = [...new Set([...generatedFiles, ...siblings])];
                const indexContent = generateIndexContent(allFiles);
                fs.writeFileSync(indexPath, indexContent, "utf-8");
            }
            out(chalk.green(`  ✓ ${indexPath}`));
        }

        out("");
        if (skippedFiles.length > 0) {
            out(chalk.yellow(`⚠ Skipped ${skippedFiles.length} existing file(s): ${skippedFiles.join(", ")}`));
            out(chalk.gray("  Use --force to overwrite existing files."));
            out("");
        }
        out(chalk.bold.green(`✓ Introspected ${tablesMap.size} tables — generated ${generatedFiles.length} collection(s).`));
        out(chalk.gray(`  Review the generated files in ${outDir} and customize properties as needed.`));
        out("");

    } catch (e) {
        outError(chalk.red(`✗ Error introspecting database: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    outError(String(err));
    process.exit(1);
});
