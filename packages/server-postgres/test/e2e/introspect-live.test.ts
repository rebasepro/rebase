/**
 * Introspection against a live PostgreSQL server.
 *
 * The jest suites read committed metadata; this one reads a database. The two
 * check different things, and the split is deliberate:
 *
 * - The queries themselves can only be wrong here. Partition exclusion, the
 *   partition-root mapping for foreign keys, `array_agg(…::text)` coming back as
 *   an array rather than the string `{a,b}`, `pg_get_constraintdef`'s rendering
 *   — every one of those is a fact about a real server, and a fixture inherits
 *   whatever the query did when it was captured.
 * - The committed fixtures can go stale. The last block re-captures pagila,
 *   chinook and northwind from their upstream SQL and compares against what is
 *   checked in, so a fixture cannot quietly drift away from the database it
 *   claims to describe.
 *
 * Needs a PostgreSQL server. It uses Docker when the daemon is up (as the other
 * e2e files do) and otherwise falls back to `INTROSPECT_TEST_DATABASE_URL` —
 * a superuser-capable connection string on any reachable server, which is how
 * it runs on a machine with Postgres installed but no Docker. With neither, the
 * suite skips and says so.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { buildTablesMap } from "../../src/schema/introspect-db-logic";
import { countRowsUpTo, readSchemaMetadata } from "../../src/schema/introspect-db-queries";
import { classifyTables, lookupCandidates, LOOKUP_MAX_ROWS } from "../../src/schema/introspect-db-structure";
import { parseCheckConstraints } from "../../src/schema/introspect-db-constraints";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "..", "fixtures", "real-schemas");
const CACHE_DIR = path.resolve(__dirname, "..", "..", "node_modules", ".cache", "real-schemas");

/**
 * The sample databases, and where their SQL comes from.
 *
 * Fetched rather than committed: they are third-party dumps of a size that does
 * not belong in this repository, and the fixture next to each one already
 * carries everything the offline tests need.
 */
const UPSTREAM = {
    pagila: [
        "https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-schema.sql",
        "https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-data.sql"
    ],
    chinook: ["https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_PostgreSql.sql"],
    northwind: ["https://raw.githubusercontent.com/pthom/northwind_psql/master/northwind.sql"]
} as const;

let admin: { url: string; container?: PgContainer } | undefined;
let skipReason = "";

/** Connection string for a database on the server under test. */
function urlFor(database: string): string {
    const base = new URL(admin!.url);
    base.pathname = `/${database}`;
    return base.toString();
}

async function withAdminClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: admin!.url });
    await client.connect();
    try {
        return await run(client);
    } finally {
        await client.end();
    }
}

/** Databases this run created, so `afterAll` can take them away again. */
const created = new Set<string>();

async function createDatabase(name: string): Promise<void> {
    await withAdminClient(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
        await client.query(`CREATE DATABASE "${name}"`);
    });
    created.add(name);
}

/** Runs a .sql file through psql, tolerating the errors sample dumps ship with. */
async function loadSql(database: string, sqlPath: string, stopOnError = true): Promise<void> {
    const result = await execa("psql", [
        ...(stopOnError ? ["-v", "ON_ERROR_STOP=1"] : []),
        "-q", "-d", urlFor(database), "-f", sqlPath
    ], { reject: stopOnError });
    if (stopOnError && result.exitCode !== 0) throw new Error(result.stderr);
}

/** Downloads a sample dump once, then reuses the copy on disk. */
async function cachedDownload(url: string): Promise<string | null> {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const target = path.join(CACHE_DIR, path.basename(new URL(url).pathname));
    if (fs.existsSync(target) && fs.statSync(target).size > 0) return declaw(target);
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
        return declaw(target);
    } catch {
        return null;
    }
}

/**
 * Strips a dump's preamble if it creates and connects to a database of its own.
 *
 * Chinook's script opens with `DROP DATABASE IF EXISTS chinook; CREATE DATABASE
 * chinook; \c chinook`. This suite can be pointed at any reachable server via
 * `INTROSPECT_TEST_DATABASE_URL`, so running that verbatim would drop a
 * developer's `chinook` database — a test that destroys data outside the
 * databases it created is not one worth having. Everything after the `\c` runs
 * happily in a database this file made.
 */
function declaw(file: string): string {
    const sql = fs.readFileSync(file, "utf-8");
    const connect = sql.match(/^\\c\s+\w+;?\s*$/m);
    if (!connect || connect.index === undefined) return file;

    const stripped = path.join(CACHE_DIR, `${path.basename(file, ".sql")}.body.sql`);
    fs.writeFileSync(stripped, sql.slice(connect.index + connect[0].length), "utf-8");
    return stripped;
}

async function readSchema(database: string) {
    const client = new pg.Client({ connectionString: urlFor(database) });
    await client.connect();
    try {
        const metadata = await readSchemaMetadata(client, "public");
        const tables = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);
        for (const table of lookupCandidates(metadata, tables)) {
            metadata.rowCounts[table] = await countRowsUpTo(client, "public", table, LOOKUP_MAX_ROWS);
        }
        return { metadata, tables, client };
    } finally {
        await client.end();
    }
}

beforeAll(async () => {
    const provided = process.env.INTROSPECT_TEST_DATABASE_URL;
    if (provided) {
        admin = { url: provided };
    } else {
        try {
            await execa("docker", ["info"], { stdio: "ignore" });
        } catch {
            skipReason = "no Docker daemon and INTROSPECT_TEST_DATABASE_URL is unset";
            return;
        }
        const container = await startPgContainer();
        admin = { url: container.connectionString, container };
    }

    try {
        await withAdminClient(async (client) => { await client.query("SELECT 1"); });
    } catch (err) {
        skipReason = `cannot reach the server: ${err instanceof Error ? err.message : String(err)}`;
        admin = undefined;
    }
}, 180_000);

afterAll(async () => {
    // A throwaway container takes its databases with it; a server reached
    // through INTROSPECT_TEST_DATABASE_URL belongs to somebody, and leaving six
    // databases on it is not this suite's to do.
    if (admin && !admin.container) {
        for (const name of created) {
            try {
                await withAdminClient(async (client) => {
                    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
                });
            } catch {
                // Best effort: a database still in use is not worth failing over.
            }
        }
    }
    if (admin?.container) await stopPgContainer(admin.container.containerName);
}, 120_000);

// ═══════════════════════════════════════════════════════════════════════
// The queries, against a real server
// ═══════════════════════════════════════════════════════════════════════
describe("reading a live schema", () => {
    const DB = "rebase_introspect_live";

    beforeAll(async () => {
        if (!admin) return;
        await createDatabase(DB);
        await loadSql(DB, path.join(FIXTURE_DIR, "constraint-shapes.sql"));
        // Rows, so the code-list rule has a count to work with.
        const client = new pg.Client({ connectionString: urlFor(DB) });
        await client.connect();
        await client.query(
            "INSERT INTO constraint_shapes (id, price, status) SELECT g, 1.0, 'draft' FROM generate_series(1, 3) g"
        );
        await client.end();
    }, 120_000);

    it.runIf(!skipReason)("reads unique constraints as arrays, not as the literal `{a,b}`", async () => {
        // node-pg has no parser for an array of `name`, so the column list comes
        // back as a string unless the query casts it. Everything downstream
        // indexes it as an array and fails silently if it is not one.
        const { metadata } = await readSchema(DB);
        const unique = metadata.uniques.find((u) => u.table_name === "constraint_shapes");
        expect(Array.isArray(unique?.column_names)).toBe(true);
        expect(unique?.column_names).toEqual(["email_unique"]);
    });

    it.runIf(!skipReason)("reads table and column comments", async () => {
        const { metadata } = await readSchema(DB);
        const table = metadata.comments.find((c) => c.table_name === "constraint_shapes" && c.column_name === null);
        const column = metadata.comments.find((c) => c.column_name === "price");
        expect(table?.comment).toContain("CHECK shape");
        expect(column?.comment).toBe("Unit price, before tax.");
    });

    it.runIf(!skipReason)("reads the server's own rendering of every CHECK", async () => {
        const { metadata } = await readSchema(DB);
        const facts = parseCheckConstraints(metadata.checks).get("constraint_shapes");
        expect(facts?.get("price")).toEqual({ moreThan: 0 });
        expect(facts?.get("status")).toEqual({ enumValues: ["draft", "published", "archived"] });
        expect(facts?.get("slug")).toEqual({ lengthMin: 3, lengthMax: 64 });
    });

    it.runIf(!skipReason)("reads generated and identity metadata", async () => {
        const { metadata } = await readSchema(DB);
        const computed = metadata.columns.find((c) => c.column_name === "computed_total");
        expect(computed?.is_generated).toBe("ALWAYS");
        const price = metadata.columns.find((c) => c.column_name === "price");
        expect(price?.is_generated).toBe("NEVER");
    });

    it.runIf(!skipReason)("reads the delete rule that states ownership", async () => {
        const { metadata, tables } = await readSchema(DB);
        const childKey = metadata.fks.find((fk) => fk.table_name === "constraint_shapes_child");
        expect(childKey?.delete_rule).toBe("CASCADE");

        const child = classifyTables(metadata, tables).get("constraint_shapes_child");
        expect(child?.role).toBe("owned-child");
        expect(child?.owner?.evidence).toBe("cascade-delete");
    });

    it.runIf(!skipReason)("counts rows without scanning past the threshold", async () => {
        const client = new pg.Client({ connectionString: urlFor(DB) });
        await client.connect();
        try {
            await client.query("CREATE TABLE IF NOT EXISTS counting_probe (id integer)");
            await client.query("TRUNCATE counting_probe");
            await client.query("INSERT INTO counting_probe SELECT generate_series(1, 500)");

            // Capped at limit + 1: enough to answer "more than the limit?", and
            // never a full scan of a table that could hold a billion rows.
            expect(await countRowsUpTo(client, "public", "counting_probe", 10)).toBe(11);
            expect(await countRowsUpTo(client, "public", "counting_probe", 1000)).toBe(500);

            await client.query("DROP TABLE counting_probe");
        } finally {
            await client.end();
        }
    });

    it.runIf(!skipReason)("survives a schema with no tables at all", async () => {
        const empty = "rebase_introspect_empty";
        await createDatabase(empty);
        const client = new pg.Client({ connectionString: urlFor(empty) });
        await client.connect();
        try {
            const metadata = await readSchemaMetadata(client, "public");
            expect(metadata.tables).toEqual([]);
            const tables = buildTablesMap(metadata.tables, metadata.columns, metadata.pks, metadata.fks);
            expect(classifyTables(metadata, tables).size).toBe(0);
            expect(lookupCandidates(metadata, tables)).toEqual([]);
        } finally {
            await client.end();
        }
    }, 60_000);

    it.runIf(!skipReason)("reads a schema that does not exist as empty rather than erroring", async () => {
        const client = new pg.Client({ connectionString: urlFor(DB) });
        await client.connect();
        try {
            const metadata = await readSchemaMetadata(client, "no_such_schema");
            expect(metadata.tables).toEqual([]);
            expect(metadata.columns).toEqual([]);
        } finally {
            await client.end();
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Partitions, which only a real server can produce
// ═══════════════════════════════════════════════════════════════════════
describe("a partitioned table", () => {
    const DB = "rebase_introspect_partitions";

    beforeAll(async () => {
        if (!admin) return;
        await createDatabase(DB);
        const client = new pg.Client({ connectionString: urlFor(DB) });
        await client.connect();
        try {
            await client.query("CREATE TABLE customers (id integer PRIMARY KEY)");
            await client.query(`
                CREATE TABLE payments (
                    id integer NOT NULL,
                    customer_id integer NOT NULL,
                    paid_at date NOT NULL
                ) PARTITION BY RANGE (paid_at)
            `);
            // Declared on each partition and on none of them centrally — the
            // shape pagila has, and the one that loses `payments` its relations
            // when `pg_constraint` is read at face value.
            for (const [name, from, to] of [
                ["payments_2024", "2024-01-01", "2025-01-01"],
                ["payments_2025", "2025-01-01", "2026-01-01"],
                ["payments_2026", "2026-01-01", "2027-01-01"]
            ]) {
                await client.query(
                    `CREATE TABLE ${name} PARTITION OF payments FOR VALUES FROM ('${from}') TO ('${to}')`
                );
                await client.query(
                    `ALTER TABLE ${name} ADD CONSTRAINT ${name}_customer_fkey FOREIGN KEY (customer_id) REFERENCES customers (id)`
                );
            }
        } finally {
            await client.end();
        }
    }, 120_000);

    it.runIf(!skipReason)("returns the parent and none of the partitions", async () => {
        const { metadata } = await readSchema(DB);
        expect(metadata.tables.map((t) => t.table_name).sort()).toEqual(["customers", "payments"]);
    });

    it.runIf(!skipReason)("marks the parent as partitioned", async () => {
        const { metadata } = await readSchema(DB);
        expect(metadata.tables.find((t) => t.table_name === "payments")?.is_partitioned).toBe(true);
        expect(metadata.tables.find((t) => t.table_name === "customers")?.is_partitioned).toBe(false);
    });

    it.runIf(!skipReason)("attributes the partitions' foreign key to the parent, exactly once", async () => {
        const { metadata } = await readSchema(DB);
        const keys = metadata.fks.filter((fk) => fk.table_name === "payments");
        expect(keys).toHaveLength(1);
        expect(keys[0].foreign_table_name).toBe("customers");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// The committed fixtures still describe the databases they came from
// ═══════════════════════════════════════════════════════════════════════
describe("committed fixtures match a freshly loaded database", () => {
    const loaded = new Map<string, boolean>();
    let downloadReason = "";

    beforeAll(async () => {
        if (!admin) return;
        for (const [name, urls] of Object.entries(UPSTREAM)) {
            const files: string[] = [];
            for (const url of urls) {
                const file = await cachedDownload(url);
                if (!file) {
                    downloadReason = `could not fetch ${url}`;
                    break;
                }
                files.push(file);
            }
            if (files.length !== urls.length) continue;

            const database = `rebase_introspect_${name}`;
            await createDatabase(database);
            // `reject: false`: these are third-party dumps and some of their
            // statements fail against a stock server (pagila's vector index
            // needs an extension it does not create). The assertions below are
            // what decides whether enough loaded.
            for (const file of files) await loadSql(database, file, false);
            loaded.set(name, true);
        }
    }, 600_000);

    /**
     * Compares the shape of the capture, not every byte: a sample dump gains a
     * row or a comment upstream without that meaning the fixture is wrong. What
     * must not drift is what the tests reason about — which tables exist, how
     * they relate, and how they classify.
     */
    for (const name of ["pagila", "chinook", "northwind"] as const) {
        it.runIf(!skipReason)(`${name}`, async () => {
            if (!loaded.get(name)) {
                console.warn(`[introspect-live] skipping ${name}: ${downloadReason || "dump unavailable"}`);
                return;
            }
            const { metadata, tables } = await readSchema(`rebase_introspect_${name}`);
            const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf-8"));

            expect(metadata.tables.map((t) => t.table_name).sort())
                .toEqual(fixture.tables.map((t: { table_name: string }) => t.table_name).sort());

            const key = (fk: { table_name: string; column_name: string; foreign_table_name: string }) =>
                `${fk.table_name}.${fk.column_name}->${fk.foreign_table_name}`;
            expect(metadata.fks.map(key).sort()).toEqual(fixture.fks.map(key).sort());

            const fixtureTables = buildTablesMap(fixture.tables, fixture.columns, fixture.pks, fixture.fks);
            const live = classifyTables(metadata, tables);
            const captured = classifyTables(fixture, fixtureTables);
            for (const [table, classification] of captured) {
                expect(live.get(table)?.role).toBe(classification.role);
            }
        }, 120_000);
    }
});
