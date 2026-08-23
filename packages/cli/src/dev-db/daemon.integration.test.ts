/**
 * The managed database, end to end — a real daemon, a real socket, real SQL.
 *
 * These are slow (a first boot runs initdb) and they are worth it, because
 * every cheap version of them passes while the feature is broken. The unit
 * tests around this one check that a state record is parsed correctly; only
 * starting the thing proves that a developer typing `rebase dev` on a machine
 * with no Postgres and no Docker ends up with a database.
 *
 * Two assertions carry the most weight:
 *
 * - **RLS is really enforced.** `SET LOCAL ROLE` inside a transaction is how
 *   `PostgresBackendDriver` isolates every request, and the product's central
 *   claim is that authorization lives in the database. A managed database that
 *   silently failed to apply policies would make local development *disprove*
 *   the thing it is meant to demonstrate.
 *
 * - **A second command adopts the first one's daemon.** Two processes opening
 *   one PGlite data directory would corrupt it, so `rebase db push` while
 *   `rebase dev` runs must find the existing daemon rather than start a second.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { MANAGED_POOL_MAX } from "./constraints";
import {
    ensureManagedDatabase,
    findRunningDaemon,
    managedUrl,
    resetManagedDatabase,
    resolveSpawn,
    stopManagedDatabase
} from "./daemon";
import { acquireStartLock, dataDir, readState, releaseStartLock, startLockFile } from "./state";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * A source entry that calls `entry()`, standing in for `bin/rebase.js`.
 *
 * The daemon is started by re-invoking the CLI, and in this repository the CLI
 * is TypeScript. Under a test runner `process.argv[1]` is the runner itself,
 * which exists and would therefore be spawned with `__dev-db-daemon` — so the
 * entry is injected rather than detected.
 */
const CLI_ENTRY = path.join(HERE, "__fixtures__", "cli-entry.ts");

/** First boot runs initdb; measured at ~11s cold and ~4s warm on a laptop. */
const BOOT_TIMEOUT = 90_000;

let root: string;
const pools: pg.Pool[] = [];

function connect(url: string): pg.Pool {
    // One connection, always. Two concurrent transactions deadlock the socket
    // multiplexer — see `constraints.ts`.
    const pool = new pg.Pool({ connectionString: url, max: MANAGED_POOL_MAX, connectionTimeoutMillis: 10_000 });
    pools.push(pool);

    return pool;
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-daemon-")));
});

afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end().catch(() => undefined)));
    await stopManagedDatabase(root).catch(() => undefined);
    // The daemon may still be flushing when it exits, and removing a Postgres
    // data directory out from under it raises ENOTEMPTY. Retry briefly rather
    // than failing a passing test on teardown.
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
            break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
});

describe("resolveSpawn", () => {
    it("runs a published JavaScript entry with node directly", () => {
        expect(resolveSpawn("/app/node_modules/@rebasepro/cli/bin/rebase.js")).toEqual({
            execPath: process.execPath,
            prefixArgs: []
        });
    });

    it("registers a TypeScript loader for a source entry", () => {
        // Inside the monorepo the entry is TypeScript, which plain node cannot
        // load; without this the daemon exits instantly with a syntax error.
        expect(resolveSpawn("/repo/packages/cli/src/cli.ts").prefixArgs).toEqual(["--import", "tsx"]);
    });
});

describe("managedUrl", () => {
    it("addresses loopback only", () => {
        // The managed database must never be reachable from the network: it has
        // no password, because it is not meant to leave the machine.
        expect(managedUrl(5555)).toBe("postgresql://postgres@127.0.0.1:5555/postgres");
    });
});

describe("the managed database", () => {
    it("starts from nothing and serves SQL", { timeout: BOOT_TIMEOUT }, async () => {
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        expect(database.started).toBe(true);
        expect(database.port).toBeGreaterThan(0);

        const { rows } = await connect(database.url).query<{ version: string }>("select version()");

        // The same major as the `postgres:18-alpine` the eject template ships,
        // so schema behaviour does not diverge between dev and compose.
        expect(rows[0].version).toContain("PostgreSQL 18");
    });

    it("writes a gitignore beside the data, which must never be committed", { timeout: BOOT_TIMEOUT }, async () => {
        await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        expect(fs.readFileSync(path.join(root, ".rebase", ".gitignore"), "utf8")).toContain("*");
    });

    it("can install the extensions search collections need", { timeout: BOOT_TIMEOUT }, async () => {
        // PGlite resolves extensions from bundles handed to its constructor, so
        // a missing one fails at migration time with `extension "pg_trgm" is
        // not available` — which reads like a broken database rather than a
        // missing import.
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const pool = connect(database.url);

        await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        await pool.query("CREATE EXTENSION IF NOT EXISTS unaccent");

        const installed = await pool.query<{ extname: string }>("select extname from pg_extension order by 1");
        expect(installed.rows.map((row) => row.extname)).toEqual(expect.arrayContaining(["pg_trgm", "unaccent"]));
        expect((await pool.query<{ v: string }>("select unaccent('Málagá') v")).rows[0].v).toBe("Malaga");
    });

    it("enforces row-level security under SET LOCAL ROLE", { timeout: BOOT_TIMEOUT }, async () => {
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const pool = connect(database.url);

        await pool.query("CREATE ROLE rebase_user NOLOGIN");
        await pool.query("CREATE TABLE orders (id int primary key, tenant text)");
        await pool.query("INSERT INTO orders VALUES (1,'acme'),(2,'globex'),(3,'acme')");
        await pool.query("GRANT SELECT ON orders TO rebase_user");
        await pool.query("ALTER TABLE orders ENABLE ROW LEVEL SECURITY");
        await pool.query("ALTER TABLE orders FORCE ROW LEVEL SECURITY");
        await pool.query(
            "CREATE POLICY p ON orders FOR SELECT TO rebase_user USING (tenant = current_setting('app.tenant', true))"
        );

        // The owner sees everything, which is what makes the next part meaningful.
        expect((await pool.query<{ c: number }>("select count(*)::int c from orders")).rows[0].c).toBe(3);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query('SET LOCAL ROLE "rebase_user"');
            await client.query("SELECT set_config('app.tenant','acme',true)");

            const who = await client.query<{ current_user: string }>("select current_user");
            const scoped = await client.query<{ c: number }>("select count(*)::int c from orders");
            const crossTenant = await client.query<{ c: number }>(
                "select count(*)::int c from orders where tenant = 'globex'"
            );

            expect(who.rows[0].current_user).toBe("rebase_user");
            expect(scoped.rows[0].c).toBe(2);
            expect(crossTenant.rows[0].c).toBe(0);

            await client.query("ROLLBACK");
        } finally {
            client.release();
        }
    });

    it("serves concurrent queries by queueing them", { timeout: BOOT_TIMEOUT }, async () => {
        // Correct but serialized. The pool limit is what turns the multiplexer's
        // deadlock into ordinary queueing.
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const pool = connect(database.url);

        const results = await Promise.all(
            Array.from({ length: 6 }, (_, i) => pool.query<{ n: number }>("select $1::int n", [i]))
        );

        expect(results.map((result) => result.rows[0].n)).toEqual([0, 1, 2, 3, 4, 5]);
    });
});

describe("one daemon per project", () => {
    it("adopts a running daemon instead of starting a second", { timeout: BOOT_TIMEOUT }, async () => {
        // Two processes opening one PGlite data directory would corrupt it.
        const first = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const second = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        expect(second.started).toBe(false);
        expect(second.port).toBe(first.port);
        expect(second.pid).toBe(first.pid);
    });

    it("survives concurrent callers racing to start it", { timeout: BOOT_TIMEOUT }, async () => {
        // `rebase dev` and `rebase db push` in two terminals at once.
        const [a, b, c] = await Promise.all([
            ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true }),
            ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true }),
            ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true })
        ]);

        expect(new Set([a.port, b.port, c.port]).size).toBe(1);
        expect(new Set([a.pid, b.pid, c.pid]).size).toBe(1);
    });

    it("lets only one of many concurrent callers spawn a daemon", { timeout: BOOT_TIMEOUT }, async () => {
        // The bug this pins was real and silent: without an exclusive start
        // lock, `rebase dev` and `rebase db push` started in the same second
        // both saw no state file, both spawned, and two processes opened one
        // PGlite data directory. It first showed up as ENOTEMPTY during
        // cleanup; the harmful version is a corrupted database.
        const results = await Promise.all(
            Array.from({ length: 5 }, () => ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true }))
        );

        expect(new Set(results.map((r) => r.pid)).size).toBe(1);
        expect(results.filter((r) => r.started).length).toBe(1);
        // And the lock is not left behind for the next command to wait on.
        expect(fs.existsSync(startLockFile(root))).toBe(false);
    });

    it("breaks a start lock left behind by a process that died", { timeout: BOOT_TIMEOUT }, async () => {
        // A developer must never have to know this file exists to unstick their
        // project, so a lock with nothing behind it is broken by age.
        fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
        expect(acquireStartLock(root, 60_000)).toBe(true);

        // Zero staleness: any existing lock is expired, which is what a caller
        // that has already waited out the timeout concludes.
        expect(acquireStartLock(root, 0)).toBe(true);

        releaseStartLock(root);
        expect(fs.existsSync(startLockFile(root))).toBe(false);
    });

    it("discards a state file whose process is gone", { timeout: BOOT_TIMEOUT }, async () => {
        // A pid can be recycled after a reboot, so liveness is proved by asking
        // the daemon for its token rather than by the pid existing.
        await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        await stopManagedDatabase(root);

        expect(await findRunningDaemon(root)).toBeNull();
        expect(readState(root)).toBeNull();
    });

    it("rejects a state file whose token does not match", { timeout: BOOT_TIMEOUT }, async () => {
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const state = readState(root);
        expect(state).not.toBeNull();

        // Same live process, same ports, wrong token — which is what a recycled
        // port looks like. It must not be adopted.
        fs.writeFileSync(
            path.join(root, ".rebase", "pglite.json"),
            JSON.stringify({ ...state, token: "not-the-right-token" }),
            "utf8"
        );

        expect(await findRunningDaemon(root)).toBeNull();

        // Clean up the daemon the doctored file just orphaned.
        process.kill(database.pid, "SIGTERM");
    });
});

describe("lifecycle", () => {
    it("keeps data across a stop and start", { timeout: BOOT_TIMEOUT }, async () => {
        const first = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const pool = connect(first.url);
        await pool.query("CREATE TABLE kept (id int)");
        await pool.query("INSERT INTO kept VALUES (1),(2),(3)");
        await pool.end();
        pools.pop();

        await stopManagedDatabase(root);
        const second = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        const { rows } = await connect(second.url).query<{ c: number }>("select count(*)::int c from kept");
        expect(rows[0].c).toBe(3);
    });

    it("reports nothing to stop when nothing is running", async () => {
        expect(await stopManagedDatabase(root)).toBe(false);
    });

    it("removes the data directory on reset", { timeout: BOOT_TIMEOUT }, async () => {
        await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        expect(fs.existsSync(dataDir(root))).toBe(true);

        await resetManagedDatabase(root);

        expect(fs.existsSync(dataDir(root))).toBe(false);
        expect(readState(root)).toBeNull();
    });
});
