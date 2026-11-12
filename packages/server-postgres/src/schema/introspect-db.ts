import chalk from "chalk";
import fs from "fs";
import path from "path";
import pg from "pg";
import arg from "arg";
import * as dotenv from "dotenv";

import { printIndexModule, tableIdentifier } from "@rebasepro/common";

import {
    buildTablesMap,
    describeRlsOffTables,
    generateSchemaModules,
    mergeIndexModule,
    safeHostFromUrl
} from "./introspect-db-logic";
import { detectCmsDir } from "./introspect-db-project";
import { countRowsUpTo, isUsableFileName, quoteRelation, readSchemaMetadata } from "./introspect-db-queries";
import { classifyTables, lookupCandidates, LOOKUP_MAX_ROWS } from "./introspect-db-structure";
import { parseCheckConstraints } from "./introspect-db-constraints";
import { out, outWarn, outError } from "../cli-output";
import { promptConfirm } from "../cli-prompt";
import { diagnoseDbError } from "../cli-errors";
import { pinSearchPath } from "../connection";
import { DEFAULT_SCHEMA_DIR } from "../cli-schema-dir";

/** A relative import between two files, POSIX-separated, without the extension. */
function relativeImport(fromDir: string, toFile: string): string {
    const relative = path.relative(fromDir, toFile).split(path.sep).join("/").replace(/\.tsx?$/, "");
    return relative.startsWith(".") ? relative : `./${relative}`;
}

async function main() {
    const args = arg(
        {
            "--schema-dir": String,
            "--force": Boolean,
            "--schema": String,
            "--data-inference": Boolean,
            "--no-data-inference": Boolean,
            "-f": "--force"
        },
        { permissive: true }
    );

    // Absolute, because it is printed. Relative to where the driver runs —
    // `backend/` — so the default is `backend/schema`, as every other driver
    // command reads it. The project's `frontend/src/cms`, when it has one, is
    // found from there (`detectCmsDir`).
    const outDir = path.resolve(process.cwd(), args["--schema-dir"] || DEFAULT_SCHEMA_DIR);
    const cmsDir = detectCmsDir(outDir);
    const force = args["--force"] || false;
    const pgSchema = args["--schema"] || "public";

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

    // Pinned to `public`, as the server's connections are. Postgres spells an
    // expression it read back — a policy's USING, a CHECK, a column default —
    // with every name on the search path unqualified, and under the default
    // `"$user", public` a role named `rebase` puts the `rebase` schema on it:
    // `rebase.roles()` came back as `roles()`, which the push, pinned to
    // `public`, could not find.
    const client = new pg.Client({ connectionString: pinSearchPath(databaseUrl) });

    try {
        await client.connect();
    } catch (err) {
        // The banner `db push` prints for the same failure, when it is one of
        // the ones it knows.
        const banner = diagnoseDbError(err, databaseUrl);
        if (banner) {
            outError(banner);
        } else {
            outError(chalk.red(`✗ Failed to connect to database: ${err instanceof Error ? err.message : String(err)}`));
            outError(chalk.gray("  Check your DATABASE_URL and ensure the database is reachable."));
        }
        process.exit(1);
    }

    // Only once there is something to write into: created before connecting,
    // a run against a database that was down left an empty directory behind.
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    // Log the host portion safely — handle URLs without "@"
    const hostPart = safeHostFromUrl(databaseUrl);
    out(chalk.gray(`Connected to database: ${hostPart}`));
    out(chalk.gray(`Introspecting schema '${pgSchema}'...`));

    try {
        const metadata = await readSchemaMetadata(client, pgSchema);
        const tablesMap = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);

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
            runDataInference = await promptConfirm(chalk.yellow("? Do you want to sample rows to suggest validation and how the panel edits each column? (y/N) "));
        }

        // ── The name has to be usable as a filename ────────────────
        //
        // A table name came out of `pg_class` in a database this tool did
        // not create — adopting somebody else's database is the whole point
        // of introspection — and it is about to be joined onto a path.
        // Postgres will happily hold a table called `../../../etc/cron.d/x`,
        // and `path.join` resolves it. Skipped rather than sanitised: a file
        // named something other than its table does not round-trip.
        const unusable = new Set(Array.from(tablesMap.keys()).filter((t) => !joinTables.has(t) && !isUsableFileName(t)));
        for (const tableName of unusable) {
            outWarn(chalk.yellow(
                `⚠ Skipping table ${JSON.stringify(tableName)}: its name cannot be used as a ` +
                "filename. Rename the table, or write this table by hand."
            ));
        }

        // One table at a time: there is one connection, and sampling ten at
        // once over it is what node-postgres warns about.
        const samples = new Map<string, Record<string, unknown>[]>();
        if (runDataInference) {
            out(chalk.gray("Sampling database rows for data inference..."));
            for (const tableName of tablesMap.keys()) {
                if (joinTables.has(tableName) || unusable.has(tableName)) continue;
                try {
                    // Quoted by `quoteRelation`, which doubles an embedded quote.
                    const { rows } = await client.query(`SELECT * FROM ${quoteRelation(pgSchema, tableName)} LIMIT 100`);
                    samples.set(tableName, rows);
                } catch (err) {
                    outError(chalk.yellow(`⚠ Failed to sample data for table ${tableName}: ${err instanceof Error ? err.message : String(err)}`));
                }
            }
        }

        const generation = generateSchemaModules({
            metadata,
            classifications,
            checkFacts,
            samples,
            leaveOut: unusable,
            ...(cmsDir ? { cms: { tableImport: (table: string) => relativeImport(cmsDir, path.join(outDir, `${table}.ts`)) } } : {})
        });
        for (const { table, reason } of generation.failed) {
            outWarn(chalk.yellow(`⚠ Skipping table ${JSON.stringify(table)}: ${reason}`));
        }

        const generatedFiles: { identifier: string; table: string }[] = [];
        const skippedFiles: string[] = [];
        const notes: string[] = [];
        const customizations: string[] = [];
        for (const generated of generation.tables) {
            // ── File overwrite protection ──────────────────────────────
            const filePath = path.join(outDir, `${generated.table}.ts`);
            if (fs.existsSync(filePath) && !force) {
                skippedFiles.push(generated.table);
                continue;
            }
            fs.writeFileSync(filePath, generated.schemaModule, "utf-8");
            generatedFiles.push({ identifier: generated.identifier, table: generated.table });
            for (const note of generated.notes) notes.push(`${generated.table}: ${note}`);
            out(chalk.green(`  ✓ ${filePath}`));

            if (cmsDir && generated.customization) {
                const cmsPath = path.join(cmsDir, `${generated.table}.tsx`);
                if (fs.existsSync(cmsPath) && !force) continue;
                fs.mkdirSync(cmsDir, { recursive: true });
                fs.writeFileSync(cmsPath, generated.customization, "utf-8");
                customizations.push(generated.table);
                out(chalk.green(`  ✓ ${cmsPath}`));
            }
        }

        // Every column the planner will not reproduce exactly, before anyone
        // pushes. Each line is also at the top of its file.
        if (notes.length > 0) {
            outWarn("");
            outWarn(chalk.yellow(`⚠ ${notes.length} note(s) on what \`rebase db push\` would not reproduce exactly:`));
            for (const note of [...notes].sort()) outWarn(chalk.gray(`  - ${note}`));
            outWarn(chalk.gray("  Read these before the first push. Run `rebase db push --dry-run` to see the plan."));
        }

        // And the tables whose access the push changes whatever their files
        // say: no table keeps row-level security off.
        const written = new Set(generatedFiles.map((file) => file.table));
        const rlsOff = describeRlsOffTables(generation.rlsOff.filter((table) => written.has(table)));
        if (rlsOff) {
            const [headline, ...rest] = rlsOff.split("\n");
            outWarn("");
            outWarn(chalk.yellow(`⚠ ${headline}`));
            for (const line of rest) outWarn(chalk.gray(`  ${line}`));
            outWarn(chalk.gray("  `rebase db push --dry-run` lists every policy it would create."));
        }

        // backend/schema/index.ts: its exports are the tables the backend
        // serves, so every generated one is exported.
        if (generatedFiles.length > 0) {
            const indexPath = path.join(outDir, "index.ts");
            const entries = generatedFiles
                .map((file) => ({ identifier: file.identifier, importPath: `./${file.table}` }))
                .sort((a, b) => a.importPath.localeCompare(b.importPath));
            if (fs.existsSync(indexPath) && !force) {
                fs.writeFileSync(indexPath, mergeIndexModule(fs.readFileSync(indexPath, "utf-8"), entries), "utf-8");
            } else {
                // --force replaces the tables derived from the database, but the
                // directory can also hold hand-written ones with no table in the
                // introspected schema. An index listing only introspected tables
                // would silently stop serving them.
                const siblings = fs.readdirSync(outDir)
                    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
                    .map((f) => f.replace(/\.ts$/, ""))
                    .filter((name) => !entries.some((entry) => entry.importPath === `./${name}`))
                    .map((name) => ({ identifier: tableIdentifier(name), importPath: `./${name}` }));
                const all = [...entries, ...siblings].sort((a, b) => a.importPath.localeCompare(b.importPath));
                fs.writeFileSync(indexPath, printIndexModule(all), "utf-8");
            }
            out(chalk.green(`  ✓ ${indexPath}`));
        }

        out("");
        if (skippedFiles.length > 0) {
            out(chalk.yellow(`⚠ Skipped ${skippedFiles.length} existing file(s): ${skippedFiles.join(", ")}`));
            out(chalk.gray("  Use --force to overwrite existing files."));
            out("");
        }
        out(chalk.bold.green(`✓ Introspected ${tablesMap.size} tables — generated ${generatedFiles.length} table(s).`));
        if (generatedFiles.length > 0) {
            out(chalk.gray(`  Review the generated files in ${outDir}.`));
        }
        if (customizations.length > 0 && cmsDir) {
            out(chalk.gray(`  ${customizations.length} panel customization(s) in ${cmsDir}: pass them to <RebaseCMS tableCustomizations={[…]} />.`));
        }
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
