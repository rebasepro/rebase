import chalk from "chalk";
import fs from "fs";
import path from "path";
import pg from "pg";
import arg from "arg";
import * as dotenv from "dotenv";

import {
    TableRow,
    TableColumn,
    EnumValue,
    PrimaryKeyRow,
    ForeignKeyRow,
    buildTablesMap,
    buildEnumMap,
    identifyJoinTables,
    generateCollectionFile,
    generateIndexContent,
    mergeIndexContent,
    safeHostFromUrl,
} from "./introspect-db-logic";

async function main() {
    const args = arg(
        {
            "--output": String,
            "--collections": String,
            "--force": Boolean,
            "--schema": String,
            "-o": "--output",
            "-c": "--collections",
            "-f": "--force",
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
            dotenv.config({ path: p });
            break;
        }
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;
    if (!databaseUrl) {
        console.error(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
        process.exit(1);
    }

    const client = new pg.Client({ connectionString: databaseUrl });

    try {
        await client.connect();
    } catch (err) {
        console.error(chalk.red(`✗ Failed to connect to database: ${err instanceof Error ? err.message : String(err)}`));
        console.error(chalk.gray("  Check your DATABASE_URL and ensure the database is reachable."));
        process.exit(1);
    }

    // Log the host portion safely — handle URLs without "@"
    const hostPart = safeHostFromUrl(databaseUrl);
    console.log(chalk.gray(`Connected to database: ${hostPart}`));
    console.log(chalk.gray(`Introspecting schema '${pgSchema}'...`));

    try {
        // 1. Get Tables
        const { rows: tables } = await client.query<TableRow>(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = $1 AND table_type = 'BASE TABLE'
              AND table_name NOT LIKE 'drizzle_%'
              AND table_name NOT LIKE 'rebase_%'
            ORDER BY table_name
        `, [pgSchema]);

        // 2. Get Columns
        const { rows: columns } = await client.query<TableColumn>(`
            SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = $1
        `, [pgSchema]);

        // 2b. Get Enum Types and their values
        const { rows: enumValues } = await client.query<EnumValue>(`
            SELECT t.typname AS enum_name,
                   e.enumlabel AS enum_value,
                   e.enumsortorder AS sort_order
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname = $1
            ORDER BY t.typname, e.enumsortorder
        `, [pgSchema]);

        // Build a map: enum_name -> ordered list of values
        const enumMap = buildEnumMap(enumValues);

        // 3. Get Primary Keys
        const { rows: pks } = await client.query<PrimaryKeyRow>(`
            SELECT t.relname as table_name, a.attname as column_name
            FROM   pg_index i
            JOIN   pg_attribute a ON a.attrelid = i.indrelid
                                AND a.attnum = ANY(i.indkey)
            JOIN   pg_class t ON t.oid = i.indrelid
            JOIN   pg_namespace n ON n.oid = t.relnamespace
            WHERE  i.indisprimary AND n.nspname = $1
        `, [pgSchema]);

        // 4. Get Foreign Keys
        const { rows: fks } = await client.query<ForeignKeyRow>(`
            SELECT
                tc.table_name, 
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
        `, [pgSchema]);

        const tablesMap = buildTablesMap(tables, columns, pks, fks);
        const joinTables = identifyJoinTables(tablesMap);

        console.log(chalk.blue(`Found ${tablesMap.size} tables (including ${joinTables.size} detected join tables).`));

        // Generate Collections
        const generatedFiles: string[] = [];
        const skippedFiles: string[] = [];

        for (const [tableName, meta] of tablesMap.entries()) {
            if (joinTables.has(tableName)) continue; // We don't generate base collections for pure join tables

            // ── File overwrite protection ──────────────────────────────
            const filePath = path.join(outDir, `${tableName}.ts`);
            if (fs.existsSync(filePath) && !force) {
                skippedFiles.push(tableName);
                continue;
            }

            const fileContent = generateCollectionFile(
                tableName,
                meta,
                fks,
                joinTables,
                tablesMap,
                enumMap,
            );

            fs.writeFileSync(filePath, fileContent, "utf-8");
            generatedFiles.push(tableName);
            console.log(chalk.green(`  ✓ ${filePath}`));
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
                const indexContent = generateIndexContent(generatedFiles);
                fs.writeFileSync(indexPath, indexContent, "utf-8");
            }
            console.log(chalk.green(`  ✓ ${indexPath}`));
        }

        console.log("");
        if (skippedFiles.length > 0) {
            console.log(chalk.yellow(`⚠ Skipped ${skippedFiles.length} existing file(s): ${skippedFiles.join(", ")}`));
            console.log(chalk.gray(`  Use --force to overwrite existing files.`));
            console.log("");
        }
        console.log(chalk.bold.green(`✓ Introspected ${tablesMap.size} tables — generated ${generatedFiles.length} collection(s).`));
        console.log(chalk.gray(`  Review the generated files in ${outDir} and customize properties as needed.`));
        console.log("");

    } catch (e) {
        console.error(chalk.red(`✗ Error introspecting database: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
