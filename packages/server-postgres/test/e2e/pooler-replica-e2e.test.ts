/**
 * E2E: the runtime behind PgBouncer in transaction mode, with a hot standby
 * serving reads — the database a Rebase Cloud tenant gets once its app can run
 * more than one instance.
 *
 * `fixtures/pooler-replica/docker-compose.yml` is a primary, a standby
 * streaming from it, and PgBouncer in front of both (`rebase` → primary,
 * `rebase_ro` → standby), as `postgres-pooler-rw` / `-ro` are in a tenant
 * namespace. The pooler ignores no startup parameter the runtime could send,
 * so a pool that still carried `statement_timeout` or `options=-c
 * search_path` in its startup packet is refused at connect.
 *
 * The backend boots for real — tables, policies, the restricted role, change
 * capture — with `DATABASE_URL` on the pooler (`pooled`), the direct URL on
 * the primary, and the read URL on the standby's pooler. What must hold:
 *
 * - The boot, and every request, works through the pooler; the role's default
 *   `search_path` is set for statements outside a transaction.
 * - A `LISTEN` is held on the direct connection, and is heard.
 * - The SQL console runs on a session of its own on the direct connection:
 *   its `SET ROLE` reaches its statements and no pooled connection; a cancel
 *   stops it; a cursor reads a result across batches.
 * - An index build runs on the direct connection, and leaves no session
 *   advisory lock behind on a server connection the pooler hands out.
 * - Authenticated reads are served by the standby, with RLS enforced there; a
 *   principal that just wrote reads from the primary until the sticky window
 *   ends, and nobody else does.
 * - `/metrics` gets the read and session pools, and a sample of the server
 *   including the standby's lag.
 *
 * Requires Docker with Compose.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import pg from "pg";
import { Hono } from "hono";
import { isSQLAdmin, type CollectionConfig, type DataDriver, type DatabaseAdmin, type SecurityRule, type SQLAdmin, type User } from "@rebasepro/types";

import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { testUser } from "./test-user.js";
import { tablesFrom } from "../helpers/tables.js";
import { tablesFromCollections } from "../helpers/tables.js";

const COMPOSE_FILE = fileURLToPath(new URL("./fixtures/pooler-replica/docker-compose.yml", import.meta.url));
const PROJECT = `${process.env.REBASE_E2E_CONTAINER_PREFIX || "rebase-db-e2e-"}pooler-${crypto.randomUUID().slice(0, 8)}`;
const STICKY_MS = 3_000;

const compose = (...args: string[]) => execa("docker", ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, ...args]);

/** The stack outlives a killed runner unless something takes it down. */
function reapOnExit(): void {
    const reap = () => {
        spawnSync("docker", ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, "down", "-v", "--remove-orphans"], { stdio: "ignore" });
    };
    process.once("exit", reap);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.once(signal, () => {
            reap();
            process.kill(process.pid, signal);
        });
    }
}

async function hostPort(service: string, port: number): Promise<number> {
    const { stdout } = await compose("port", service, String(port));
    const match = /:(\d+)\s*$/.exec(stdout.trim());
    if (!match) throw new Error(`No host port for ${service}:${port} in "${stdout}"`);
    return Number(match[1]);
}

async function containerIp(service: string): Promise<string> {
    const { stdout: id } = await compose("ps", "-q", service);
    const { stdout } = await execa("docker", ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", id.trim()]);
    return stdout.trim();
}

async function waitFor(predicate: () => Promise<boolean>, message: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await predicate()) return;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${message}`);
        await new Promise(r => setTimeout(r, 100));
    }
}

const url = (port: number, database: string) => `postgresql://rebase:rebase@localhost:${port}/${database}?sslmode=disable`;

async function query<T extends pg.QueryResultRow>(connectionString: string, text: string, params: unknown[] = []): Promise<T[]> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
        return (await client.query<T>(text, params)).rows;
    } finally {
        await client.end();
    }
}

const ownerRules: SecurityRule[] = [
    { name: "owner_select", operation: "select", ownerField: "ownerId" },
    { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
    { name: "owner_update", operation: "update", ownerField: "ownerId" },
    { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
];

const notes: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    securityRules: ownerRules,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        title: { name: "Title", type: "string" }
    },
    indexes: [{ on: ["title"], reason: "title lookups" }]
};

const ALICE: User = testUser("alice", ["user"]);
const BOB: User = testUser("bob", ["user"]);

describe("behind PgBouncer in transaction mode, with a hot standby (E2E)", () => {
    let primaryUrl: string;
    let standbyUrl: string;
    let pooledUrl: string;
    let pooledReadUrl: string;
    let poolerIp: string;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let adapter: ReturnType<typeof createPostgresAdapter>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    let admin: SQLAdmin;
    const originalNodeEnv = process.env.NODE_ENV;

    const scoped = async (user: User): Promise<DataDriver> =>
        (backend.driver as DataDriver & { withAuth(user: User): Promise<DataDriver> }).withAuth(user);
    const titles = async (user: User): Promise<string[]> =>
        (await (await scoped(user)).fetchCollection({ path: "notes" })).map(row => String(row.title)).sort();

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        reapOnExit();
        await compose("up", "-d", "--wait");
        const [primaryPort, standbyPort, poolerPort] = await Promise.all([
            hostPort("primary", 5432), hostPort("standby", 5432), hostPort("pooler", 6432)
        ]);
        primaryUrl = url(primaryPort, "rebase");
        standbyUrl = url(standbyPort, "rebase");
        pooledUrl = url(poolerPort, "rebase");
        pooledReadUrl = url(poolerPort, "rebase_ro");
        poolerIp = await containerIp("pooler");

        connection = createPostgresDatabaseConnection(pooledUrl, undefined, { pooled: true });
        adapter = createPostgresAdapter({
            connection: connection.db,
            connectionString: connection.connectionString,
            directConnectionString: primaryUrl,
            readConnectionString: pooledReadUrl,
            pooled: true,
            // The lag guard is the unit tests' (read-routing.test.ts): here a
            // paused standby must keep serving, which is what shows it serves.
            readRouting: { stickyMs: STICKY_MS, maxLagMs: 600_000 }
        });
        backend = await initializeRebaseBackend({
            app: new Hono(),
            server: createServer(),
            ...tablesFrom([notes]),
            database: adapter
        });
        const candidate: DatabaseAdmin | undefined = backend.driver.admin;
        if (!isSQLAdmin(candidate)) throw new Error("the Postgres driver has no SQL admin");
        admin = candidate;
    }, 300_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await compose("down", "-v", "--remove-orphans").catch(() => {});
    }, 120_000);

    it("boots and serves through the pooler, and gives the role a default search_path", async () => {
        // The boot getting here is the first half: the pooler refuses a startup
        // packet carrying session settings. The second: statements outside a
        // transaction resolve unqualified names in `public`.
        const settings = await query<{ setconfig: string[] }>(primaryUrl,
            "SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole " +
            "JOIN pg_database d ON d.oid = s.setdatabase WHERE r.rolname = 'rebase' AND d.datname = 'rebase'");
        expect(settings[0]?.setconfig.join(",")).toMatch(/search_path=.*public/);
        expect(await titles(ALICE)).toEqual([]);
    });

    it("holds a LISTEN on the direct connection, and hears it", async () => {
        const heard: string[] = [];
        const stop = await admin.listen!("pooler_e2e", payload => heard.push(payload));
        try {
            await query(pooledUrl, "SELECT pg_notify('pooler_e2e', 'over the pooler')");
            await waitFor(async () => heard.includes("over the pooler"), "the notification");
            const listeners = await query<{ addr: string | null }>(primaryUrl,
                "SELECT client_addr::text AS addr FROM pg_stat_activity WHERE query ILIKE 'LISTEN%'");
            expect(listeners.length).toBeGreaterThan(0);
            for (const listener of listeners) expect(listener.addr).not.toBe(poolerIp);
        } finally {
            await stop();
        }
    });

    it("runs a SQL console script on a session of its own, as the role it asked for, leaking it nowhere", async () => {
        const result = await admin.runSqlScript!(
            "SELECT current_user AS who, host(inet_client_addr()) AS addr", { role: "rebase_user" });
        expect(result.rows[0]?.who).toBe("rebase_user");
        expect(result.rows[0]?.addr).not.toBe(poolerIp);

        const owners = await Promise.all(Array.from({ length: 20 }, () =>
            connection.pool.query<{ who: string }>("SELECT current_user AS who")));
        expect(new Set(owners.map(r => r.rows[0].who))).toEqual(new Set(["rebase"]));
    });

    it("cancels a console run, and reads a whole result through a cursor", async () => {
        const controller = new AbortController();
        const started = Date.now();
        const run = admin.runSqlScript!("SELECT pg_sleep(30)", { signal: controller.signal });
        setTimeout(() => controller.abort(), 500);
        await expect(run).rejects.toThrow(/cancel/i);
        expect(Date.now() - started).toBeLessThan(10_000);

        const cursor = await admin.openSqlCursor!("SELECT g FROM generate_series(1, 2500) g", { batchSize: 1000 });
        let rows = 0;
        try {
            for (let batch = await cursor.read(); batch; batch = await cursor.read()) rows += batch.length;
        } finally {
            await cursor.close();
        }
        expect(rows).toBe(2500);
    });

    it("builds an index on a connection of its own on the direct URL, not through the pooler", async () => {
        const [{ name }] = await query<{ name: string }>(primaryUrl,
            "SELECT indexname AS name FROM pg_indexes WHERE tablename = 'notes' AND indexname LIKE 'notes_title_ix_%'");
        await query(primaryUrl, `DROP INDEX "${name}"`);
        // Enough rows that the build is on the server long enough to be seen.
        await query(primaryUrl,
            "INSERT INTO notes (id, owner_id, title) SELECT gen_random_uuid(), 'nobody', md5(g::text) || md5((g * 7)::text) " +
            "FROM generate_series(1, 400000) g");

        // Who runs the build: watched from the primary while it happens.
        const builders = new Set<string>();
        let watching = true;
        const watch = (async () => {
            while (watching) {
                for (const row of await query<{ addr: string | null }>(primaryUrl,
                    "SELECT host(client_addr) AS addr FROM pg_stat_activity WHERE query ILIKE 'CREATE INDEX%'")) {
                    builders.add(row.addr ?? "local");
                }
                await new Promise(r => setTimeout(r, 10));
            }
        })();
        try {
            // A later boot's ensure: the table exists, so the index is built in
            // the background once the policies step is done.
            await adapter.ensureCollectionSchema!(tablesFromCollections([notes]).tables);
            await adapter.ensureTablePolicies!(tablesFromCollections([notes]).tables);
            await waitFor(async () => (await query<{ valid: boolean }>(primaryUrl,
                "SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1",
                [name])).some(r => r.valid), "the index to be built", 90_000);
        } finally {
            watching = false;
            await watch;
        }

        expect(builders.size).toBeGreaterThan(0);
        expect([...builders]).not.toContain(poolerIp);
        const locks = await query<{ n: number }>(primaryUrl, "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'");
        expect(locks[0].n).toBe(0);
        await query(primaryUrl, "DELETE FROM notes WHERE owner_id = 'nobody'");
    }, 180_000);

    it("serves reads from the standby under RLS, and a writer's own reads from the primary until the window ends", async () => {
        await query(primaryUrl, "INSERT INTO notes (id, owner_id, title) VALUES (gen_random_uuid(), 'alice', 'alice-1'), (gen_random_uuid(), 'bob', 'bob-1')");
        await waitFor(async () => (await query<{ n: number }>(standbyUrl,
            "SELECT count(*)::int AS n FROM notes")).at(0)?.n === 2, "the standby to replay the seed");
        expect(await titles(BOB)).toEqual(["bob-1"]);

        // The standby stops replaying: what it serves from now on is frozen.
        await query(standbyUrl, "SELECT pg_wal_replay_pause()");
        try {
            await (await scoped(ALICE)).save({ path: "notes", values: { ownerId: "alice", title: "alice-2" }, status: "new" });
            await query(primaryUrl, "INSERT INTO notes (id, owner_id, title) VALUES (gen_random_uuid(), 'bob', 'bob-2')");

            // Alice wrote, so she reads her write — from the primary.
            expect(await titles(ALICE)).toEqual(["alice-1", "alice-2"]);
            // Bob did not: his read is the standby's, frozen before bob-2.
            expect(await titles(BOB)).toEqual(["bob-1"]);

            await new Promise(r => setTimeout(r, STICKY_MS + 500));
            // The window is over: Alice is served by the standby too.
            expect(await titles(ALICE)).toEqual(["alice-1"]);

            // …and the sample says how far behind it is.
            await waitFor(async () => ((await admin.sampleHealth!()).replicaLagSeconds ?? 0) > 0, "the standby's lag to show");
        } finally {
            await query(standbyUrl, "SELECT pg_wal_replay_resume()");
        }
        await waitFor(async () => (await titles(BOB)).join(",") === "bob-1,bob-2", "the standby to catch up");
    });

    it("reports the read and session pools and a sample of the server", async () => {
        const pools = admin.poolStats!().map(p => p.pool).sort();
        expect(pools).toEqual(["read", "session"]);
        const sample = await admin.sampleHealth!();
        expect(sample.maxConnections).toBe(60);
        expect(sample.sizeBytes).toBeGreaterThan(0);
        expect(Object.values(sample.connections ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        expect(sample.replicaLagSeconds).toBeGreaterThanOrEqual(0);
    });

    it("closes the read and session pools with the server's pool", async () => {
        await backend.shutdown(1_000);
        await connection.pool.end();
        expect(admin.poolStats!().every(p => p.total === 0)).toBe(true);
    });
});
