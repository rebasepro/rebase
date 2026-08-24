/**
 * Captures one real database's catalog metadata as a test fixture.
 *
 * The point is that the fixtures under `test/fixtures/real-schemas` are not
 * hand-written. Every hand-built fixture encodes what its author believed
 * Postgres returns, so a test over it proves the code agrees with that belief —
 * which is how a generator ends up confident about column shapes no database
 * produces. These come out of a real server, through the same
 * `readSchemaMetadata` the CLI calls, so a test over them is a test against
 * real catalog output.
 *
 * Usage:
 *   pnpm tsx tooling/scripts/capture-introspection-fixture.ts <database-url> <out.json> [schema] [--tables=a,b,c]
 *
 * `--tables` narrows the capture to a subset, for a database too large to
 * commit whole. The subset is still what the server returned for those tables —
 * rows are dropped, never edited — and foreign keys leaving it are dropped with
 * them, exactly as `readSchemaMetadata` already drops keys leaving the schema.
 *
 * The captured metadata is schema only — table, column and constraint names.
 * No row values are read; the only data-dependent number is the capped row
 * count used to tell a code list from an entity.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

import { buildTablesMap } from "../src/schema/introspect-db-logic";
import { countRowsUpTo, readSchemaMetadata } from "../src/schema/introspect-db-queries";
import { lookupCandidates, LOOKUP_MAX_ROWS } from "../src/schema/introspect-db-structure";

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const tablesArg = argv.find((a) => a.startsWith("--tables="));
    const [databaseUrl, outputPath, schema = "public"] = argv.filter((a) => !a.startsWith("--"));
    if (!databaseUrl || !outputPath) {
        console.error("usage: capture-introspection-fixture.ts <database-url> <out.json> [schema] [--tables=a,b,c]");
        process.exit(1);
    }
    const keep = tablesArg ? new Set(tablesArg.slice("--tables=".length).split(",").filter(Boolean)) : undefined;

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    try {
        const metadata = await readSchemaMetadata(client, schema);

        if (keep) {
            const missing = [...keep].filter((t) => !metadata.tables.some((row) => row.table_name === t));
            if (missing.length > 0) throw new Error(`no such table(s): ${missing.join(", ")}`);

            metadata.tables = metadata.tables.filter((t) => keep.has(t.table_name));
            const scoped = <T extends { table_name: string }>(rows: T[]) => rows.filter((r) => keep.has(r.table_name));
            metadata.columns = scoped(metadata.columns);
            metadata.pks = scoped(metadata.pks);
            metadata.uniques = scoped(metadata.uniques);
            metadata.checks = scoped(metadata.checks);
            metadata.comments = scoped(metadata.comments);
            metadata.fks = scoped(metadata.fks).filter((fk) => keep.has(fk.foreign_table_name));
        }

        const tablesMap = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);

        for (const table of lookupCandidates(metadata, tablesMap)) {
            metadata.rowCounts[table] = await countRowsUpTo(client, schema, table, LOOKUP_MAX_ROWS);
        }

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");

        console.log(
            `captured ${metadata.tables.length} tables, ${metadata.columns.length} columns, ` +
            `${metadata.fks.length} foreign key columns, ${metadata.uniques.length} unique constraints, ` +
            `${metadata.checks.length} checks, ${metadata.comments.length} comments -> ${outputPath}`
        );
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
