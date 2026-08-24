/**
 * Record this release's whole PROJECT state as an upgrade snapshot.
 *
 * ## Why this exists alongside `record-schema-snapshot.mts`
 *
 * That one records a database. This one records a database *and the artifacts a
 * project keeps beside it*, because the expensive upgrade bug of 0.13 lived in
 * the disagreement between them and was structurally invisible to a
 * database-only corpus.
 *
 * The shape of it: 0.13 changed a derived foreign-key column name, boot-ensure
 * renamed the column in the database — correctly, data intact — and then
 * `assertRelationsResolve` read the project's checked-in
 * `backend/src/schema.generated.ts`, which the *previous* release generated and
 * which still declared the old name, and killed the boot. Permanently: the rename
 * was already applied, so every restart failed identically.
 *
 * A snapshot containing only the database cannot express that state. Both halves
 * have to be recorded, from the same release, at the same moment:
 *
 *   schema.sql            the database, as this release provisions it
 *   generated-schema.json the tables and columns a project's generated schema
 *                         declares — read back from the catalogue, because that
 *                         is precisely what codegen describes
 *   collections.json      the collections that produced both
 *   manifest.json         which release this was, and what it knew
 *
 * `project-upgrade-e2e.test.ts` then replays each one through the CURRENT code
 * and asserts the upgrade completes, the rows survive, the tables stay locked,
 * and a stale generated schema is diagnosed rather than followed.
 *
 * ## Self-provisioning, deliberately
 *
 * Unlike the auth recorder, this one starts its own Postgres and provisions it
 * from the reference project in `tooling/scripts/derived-names.mts`. That is what lets
 * `release.sh` record a snapshot every time without anyone having to have a live
 * database of the right vintage lying around — and "once per release" is a
 * discipline that has already been skipped for three releases running, so the
 * only version of it worth building is the one nobody has to remember.
 *
 * What it gives up is a schema shaped by a real deployment's history. That axis
 * is covered: the auth corpus records real databases, and the bundle corpus boots
 * real bundles. This one covers the axis neither does — a project's code and its
 * database, aged together and met by a newer release.
 *
 *     node --import tsx tooling/scripts/record-project-snapshot.mts
 *     node --import tsx tooling/scripts/record-project-snapshot.mts --out v0.14.0
 *
 * Requires Docker.
 */
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * It lives in `packages/server-postgres/scripts` rather than the repo's own
 * `tooling/scripts/` for one flat reason: `pg`, `drizzle-orm` and `execa` are this
 * package's dependencies and do not resolve from the root, which is not a
 * workspace package. Run it through `pnpm record:project-snapshot` at the root.
 */
const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(PACKAGE, "../..");
const SNAPSHOT_DIR = path.join(PACKAGE, "test/e2e/project-snapshots");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
};

// ── What this release is ─────────────────────────────────────────────────────

const pkg = JSON.parse(
    fs.readFileSync(path.join(PACKAGE, "package.json"), "utf8")
) as { version: string };

const { AUTH_SCHEMA_VERSION } = await import(
    `${PACKAGE}/src/auth/schema-version.ts`
) as { AUTH_SCHEMA_VERSION: number };

const outName = flag("out") ?? `v${pkg.version}`;
const outDir = path.join(SNAPSHOT_DIR, outName);

if (fs.existsSync(outDir) && !args.includes("--force")) {
    console.error(
        `${path.relative(ROOT, outDir)} already exists.\n\n` +
        "Refusing to overwrite. A snapshot is a record of what a release shipped; rewriting it\n" +
        "un-tests every upgrade path that ran through it. Pass --out <name> for a second one\n" +
        "from the same version. --force overrides, and is almost never what you want."
    );
    process.exit(1);
}

// ── The reference project ────────────────────────────────────────────────────

const { FIXTURE } = await import(`${ROOT}/scripts/derived-names.mts`) as { FIXTURE: Record<string, unknown>[] };
const { generatePostgresDdl } = await import(
    `${PACKAGE}/src/schema/generate-postgres-ddl-logic.ts`
);
const { ensureAppRole } = await import(`${PACKAGE}/src/security/rls-enforcement.ts`);
const { ensureAuthTablesExist } = await import(`${PACKAGE}/src/auth/ensure-tables.ts`);
const { startPgContainer, stopPgContainer } = await import(
    `${PACKAGE}/test/e2e/pg-setup.ts`
);
const { drizzle } = await import("drizzle-orm/node-postgres");

/**
 * A JSON-safe projection of the collections.
 *
 * `relation.target` is a thunk returning the target collection, and
 * `JSON.stringify` drops functions silently — the first recording came out with
 * every relation stripped of the thing it points at, which produced a snapshot
 * that replayed cleanly because it declared no relations to get wrong. The slug
 * is recorded instead and the replay rebuilds the thunk from it.
 *
 * Declarative on purpose: the alternative is recording executable code, which
 * ages into an artifact a later release may not be able to load at all — and an
 * old snapshot that cannot be loaded is an upgrade path that stops being tested
 * exactly when it gets interesting.
 */
function serializable(collections: Record<string, unknown>[]): Record<string, unknown>[] {
    return collections.map(collection => ({
        ...collection,
        properties: Object.fromEntries(
            Object.entries(collection.properties as Record<string, Record<string, unknown>>).map(([name, prop]) => {
                const relation = prop.relation as Record<string, unknown> | undefined;
                if (!relation || typeof relation.target !== "function") return [name, prop];
                const target = (relation.target as () => Record<string, unknown>)();
                return [name, { ...prop, relation: { ...relation, target: undefined, targetSlug: target.slug } }];
            })
        )
    }));
}

/** Schemas the reference project uses. Read from it, not hard-coded. */
const schemasOf = (collections: Record<string, unknown>[]): string[] =>
    Array.from(new Set(["public", "rebase", ...collections.map(c => (c.schema as string) ?? "public")]));

const container = await startPgContainer();
let client: pg.Client | undefined;

try {
    client = new pg.Client({ connectionString: container.connectionString });
    await client.connect();

    const run = async (sqlText: string): Promise<Record<string, unknown>[]> =>
        (await client!.query(sqlText)).rows as Record<string, unknown>[];

    console.log("[record] Provisioning the auth schema…");
    const pool = new pg.Pool({ connectionString: container.connectionString });
    await ensureAuthTablesExist(drizzle(pool));
    await pool.end();

    console.log("[record] Provisioning the collection schema…");
    // The role has to exist before any policy naming it can be created, and the
    // generated DDL is where the policies are.
    await ensureAppRole(run, schemasOf(FIXTURE));
    const ddl: string = await generatePostgresDdl(FIXTURE, { includePolicies: true });
    await client.query(ddl);

    // ── Seed ─────────────────────────────────────────────────────────────────
    //
    // Rows, and not optional. A snapshot with empty tables exercises the DDL half
    // of an upgrade and none of the data half — and the data half is where a
    // rename that should have been a rename shows up as an empty column. The
    // replay asserts these exact rows survive.
    console.log("[record] Seeding…");
    const seeded: Record<string, number> = {};
    for (const collection of FIXTURE) {
        const schema = (collection.schema as string) ?? "public";
        const table = collection.table as string;
        const properties = collection.properties as Record<string, Record<string, unknown>>;

        // Only the plain scalar columns: relations are populated below, once
        // every row they point at exists.
        const scalars = Object.entries(properties)
            .filter(([name, prop]) => name !== "id" && (prop.type === "string" || prop.type === "number"))
            .map(([name, prop]) => ({
                column: (prop.columnName as string) ?? name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`),
                // An enum column takes one of its own labels and nothing else —
                // a per-row suffix makes it `draft-1`, which Postgres rejects as
                // an invalid input value for the type.
                enumerated: Boolean(prop.enum),
                value: prop.enum ? (prop.enum as string[])[0] : `${table}-seed`
            }));

        const numericId = (properties.id as Record<string, unknown>)?.isId === "increment";
        for (let i = 1; i <= 2; i++) {
            const columns = scalars.map(s => `"${s.column}"`);
            const values = scalars.map(s => (s.enumerated ? `'${s.value}'` : `'${s.value}-${i}'`));
            if (!numericId) {
                columns.unshift(`"id"`);
                values.unshift(`gen_random_uuid()`);
            }
            await client.query(
                `INSERT INTO "${schema}"."${table}" (${columns.join(", ")}) VALUES (${values.join(", ")})`
            );
        }
        seeded[`${schema}.${table}`] = 2;
    }

    // Point every foreign key at a real row. An unpopulated relation column is
    // invisible to the replay's data check — a rename that silently became an
    // ADD leaves an empty column, and an empty column that was already empty
    // proves nothing.
    const ownedKeys = await client.query<{
        schema: string; table: string; column: string;
        ref_schema: string; ref_table: string; ref_column: string;
    }>(`
        SELECT tc.table_schema AS schema, tc.table_name AS table, kcu.column_name AS column,
               ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema <> 'rebase'
    `);
    for (const fk of ownedKeys.rows) {
        // Junctions are populated below, as whole rows.
        if (seeded[`${fk.schema}.${fk.table}`] === undefined) continue;
        await client.query(
            `UPDATE "${fk.schema}"."${fk.table}" SET "${fk.column}" = ` +
            `(SELECT "${fk.ref_column}" FROM "${fk.ref_schema}"."${fk.ref_table}" ORDER BY 1 LIMIT 1)`
        );
    }

    // A junction row, because a junction column is exactly what the 0.13 rename
    // moved, and an empty junction cannot show a rename that lost its data.
    const junctionRows = await client.query<{ schema: string; table: string }>(`
        SELECT table_schema AS schema, table_name AS table
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE '%\\_%'
    `);
    for (const { schema, table } of junctionRows.rows) {
        const columns = await client.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
            [schema, table]
        );
        const names = columns.rows.map(r => r.column_name);
        // A junction is exactly two key columns and nothing else.
        if (names.length !== 2 || !names.every(n => n.endsWith("_id"))) continue;

        const fks = await client.query<{ column: string; ref_schema: string; ref_table: string; ref_column: string }>(`
            SELECT kcu.column_name AS column, ccu.table_schema AS ref_schema,
                   ccu.table_name AS ref_table, ccu.column_name AS ref_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2
        `, [schema, table]);
        if (fks.rows.length !== 2) continue;

        const picks = fks.rows.map(fk =>
            `(SELECT "${fk.ref_column}" FROM "${fk.ref_schema}"."${fk.ref_table}" ORDER BY 1 LIMIT 1)`
        );
        await client.query(
            `INSERT INTO "${schema}"."${table}" (${fks.rows.map(f => `"${f.column}"`).join(", ")}) ` +
            `VALUES (${picks.join(", ")})`
        );
        seeded[`${schema}.${table}`] = 1;
    }

    // ── The generated schema, as codegen would declare it ────────────────────
    //
    // Read from the catalogue rather than by running codegen. The generated
    // schema describes the database this release provisions, so the catalogue IS
    // the answer codegen is trying to produce — and reading it here means the
    // snapshot cannot inherit a codegen bug that would make the replay agree with
    // itself for the wrong reason.
    const catalogue = await client.query<{ schema: string; table: string; column: string }>(`
        SELECT table_schema AS schema, table_name AS table, column_name AS column
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name, ordinal_position
    `);
    const generatedSchema: Record<string, string[]> = {};
    for (const row of catalogue.rows) {
        // `rebase` is the framework's own schema; a project's generated file
        // declares the project's tables.
        if (row.schema === "rebase") continue;
        const key = row.schema === "public" ? row.table : `${row.schema}.${row.table}`;
        (generatedSchema[key] ??= []).push(row.column);
    }

    // ── Dump ─────────────────────────────────────────────────────────────────
    console.log("[record] Dumping…");
    const dumpArgs = [
        "--no-owner", "--no-privileges", "--no-tablespaces", "--no-comments",
        // `--inserts` rather than the default COPY. A snapshot is restored by
        // `client.query(sql)` in the replay, and node-postgres speaks the simple
        // query protocol: a `COPY … FROM stdin` block needs the copy protocol,
        // and its `\.` terminator comes back as `syntax error at or near "\"`.
        // Same reason the `\restrict` preamble a pg18 dump emits is filtered out
        // below — psql meta-commands are not SQL.
        "--inserts",
        container.connectionString.replace("localhost", "host.docker.internal")
    ];
    const { stdout: dump } = await execa("docker", [
        "run", "--rm", "--add-host", "host.docker.internal:host-gateway",
        "postgres:18-alpine", "pg_dump", ...dumpArgs
    ], { maxBuffer: 64 * 1024 * 1024 });

    const cleaned = dump
        .split("\n")
        .filter(line => !/^(SET |SELECT pg_catalog\.set_config|--|\\)/.test(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!/CREATE TABLE/i.test(cleaned)) {
        throw new Error("The dump contains no CREATE TABLE — nothing was provisioned.");
    }

    // ── Write ────────────────────────────────────────────────────────────────
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
        path.join(outDir, "schema.sql"),
        `-- Recorded by tooling/scripts/record-project-snapshot.mts from @rebasepro/server-postgres v${pkg.version}.\n` +
        "-- Do not hand-edit: this is a record of a database that shipped, and editing it to make\n" +
        "-- a test pass un-tests every upgrade path through it.\n\n" +
        `${cleaned}\n`
    );
    fs.writeFileSync(path.join(outDir, "collections.json"), `${JSON.stringify(serializable(FIXTURE), null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "generated-schema.json"), `${JSON.stringify(generatedSchema, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify({
        frameworkVersion: pkg.version,
        authSchemaVersion: AUTH_SCHEMA_VERSION,
        collections: FIXTURE.length,
        seededRows: seeded
    }, null, 2)}\n`);

    const total = fs.readdirSync(SNAPSHOT_DIR).filter(f =>
        fs.statSync(path.join(SNAPSHOT_DIR, f)).isDirectory()
    ).length;
    console.log(
        `\n\x1b[32m✓\x1b[0m Recorded ${path.relative(ROOT, outDir)}\n` +
        `  ${Object.keys(generatedSchema).length} table(s), ` +
        `${Object.values(seeded).reduce((a, b) => a + b, 0)} seeded row(s).\n` +
        `  ${total} project snapshot(s) now in the upgrade matrix.\n\n` +
        "  Verify it replays before committing:\n" +
        "    pnpm --filter @rebasepro/server-postgres test:e2e project-upgrade\n"
    );
} finally {
    await client?.end().catch(() => {});
    await stopPgContainer(container.containerName);
}
