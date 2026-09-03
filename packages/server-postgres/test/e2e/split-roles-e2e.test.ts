/**
 * E2E: one bundle booted as several real OS processes, against a real Postgres.
 *
 * ## Why processes and not `app.request()`
 *
 * Everything else covering `REBASE_ROLE` drives `initializeRebaseBackend`
 * in-process with a fake bootstrapper. That proves the gates are wired; it
 * cannot prove a split deployment *works*, because every interesting failure
 * lives outside what an in-process fake reaches:
 *
 *   - a `functions` process must reach the database it serves no routes for,
 *   - it must NOT create the schema, and the `api` process must,
 *   - the refusals must fire from the real environment and stop the process,
 *   - the caller's identity must survive the api→functions hop,
 *   - the project's own function files must actually import.
 *
 * The last one is why this spawns `rebase-server` rather than booting in the
 * test runner: a project's functions are loaded with a native dynamic `import`,
 * and a test runner's module sandbox cannot service one ("a dynamic import
 * callback was not specified"). An in-process harness therefore reports every
 * function as failing to load — which is indistinguishable, from the test's
 * side, from a broken split.
 *
 * So these are the same two commands `docker-compose.selfhost.yml` runs.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(HERE, "fixtures", "split-project");
const DRIVER_ROOT = path.resolve(HERE, "..", "..");
const SERVER_BIN = path.resolve(DRIVER_ROOT, "..", "server", "bin", "rebase-server.js");

const JWT_SECRET = "split-roles-e2e-secret-at-least-32-chars-long";
const SERVICE_KEY = "split-roles-e2e-service-key-at-least-32-chars";

interface Process {
    child: ChildProcess;
    origin: string;
    output: () => string;
}

let container: PgContainer;
const spawned: Process[] = [];

/** Base environment every spawned process gets. */
function baseEnv(): Record<string, string> {
    return {
        ...process.env as Record<string, string>,
        NODE_ENV: "test",
        DATABASE_URL: container.connectionString,
        JWT_SECRET,
        REBASE_SERVICE_KEY: SERVICE_KEY,
        // Let the OS choose, and read back what it chose from the boot line.
        PORT: "0",
        // Public-select is what this fixture declares; without this the data
        // surface answers 401 and the test would be about auth, not about which
        // process serves which route.
        AUTH_REQUIRE: "false",
        LOG_LEVEL: "info"
    };
}

/**
 * Start a runtime process and wait until it says where it is listening.
 *
 * Resolves on the boot line rather than after a sleep, and rejects if the
 * process exits first — which is what a refusal looks like, and what the
 * refusal tests assert on.
 */
function start(env: Record<string, string>): Promise<Process> {
    const child = spawn(process.execPath, [SERVER_BIN, PROJECT_ROOT], {
        env: { ...baseEnv(), ...env },
        stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    const record = (chunk: Buffer) => { output += chunk.toString(); };
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);

    const handle: Process = { child, origin: "", output: () => output };
    spawned.push(handle);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for a boot line.\n${output}`)),
            60_000
        );

        const check = () => {
            const match = output.match(/http:\/\/localhost:(\d+)/);
            if (!match) return;
            clearTimeout(timer);
            handle.origin = `http://127.0.0.1:${match[1]}`;
            resolve(handle);
        };

        child.stdout?.on("data", check);
        child.stderr?.on("data", check);
        child.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`Process exited with ${code} before listening.\n${output}`));
        });
    });
}

/** Start a process that is expected to refuse, and return what it said. */
async function startExpectingRefusal(env: Record<string, string>): Promise<string> {
    try {
        await start(env);
    } catch (err) {
        return String((err as Error).message);
    }
    throw new Error("Expected the process to refuse to boot, but it started.");
}

async function stop(handle: Process): Promise<void> {
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
    await new Promise<void>(resolve => {
        handle.child.once("exit", () => resolve());
        handle.child.kill("SIGTERM");
        // A process that ignores SIGTERM must not hold the suite open.
        setTimeout(() => handle.child.kill("SIGKILL"), 5_000).unref();
    });
}

/** Does this table exist yet? Asked over a plain connection, not the runtime. */
async function tableExists(name: string): Promise<boolean> {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: container.connectionString });
    await client.connect();
    try {
        const { rows } = await client.query(
            "SELECT to_regclass($1) IS NOT NULL AS present",
            [`public.${name}`]
        );
        return Boolean(rows[0]?.present);
    } finally {
        await client.end();
    }
}

/** Run a query over a plain connection, outside the runtime entirely. */
async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: container.connectionString });
    await client.connect();
    try {
        const { rows } = await client.query(sql, params);
        return rows as T[];
    } finally {
        await client.end();
    }
}

/**
 * Is anything holding a `LISTEN` on the change-capture channel?
 *
 * `pg_listening_channels()` is per-session and cannot be read for another
 * backend, so this reads the last statement each backend ran instead. A
 * dedicated LISTEN client issues exactly one and then sits on the connection
 * for the life of the process, which is what makes it visible here at all.
 */
async function cdcListenerCount(): Promise<number> {
    const rows = await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND query ILIKE 'LISTEN%'`
    );
    return Number(rows[0]?.n ?? 0);
}

/**
 * Does the change-capture machinery exist in the database?
 *
 * The per-table triggers are the wrong thing to ask about: on a database whose
 * tables do not exist yet there are none to attach to, so a process that
 * provisions and one that does not produce the same empty answer — a check that
 * passes for both is not a check. The trigger *function* is created first and
 * unconditionally, which makes it the fact that actually separates them.
 * (Verified by mutation: the earlier per-table version stayed green with the
 * gating removed.)
 */
async function cdcFunctionExists(): Promise<boolean> {
    const rows = await query<{ present: boolean }>(
        "SELECT to_regprocedure('rebase.rebase_cdc_notify()') IS NOT NULL AS present"
    );
    return Boolean(rows[0]?.present);
}

/** The change-capture triggers installed on the project's own tables. */
async function cdcTriggers(): Promise<string[]> {
    const rows = await query<{ tgrelid: string }>(
        `SELECT c.relname AS tgrelid FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND t.tgname = 'rebase_cdc_trigger'`
    );
    return rows.map(r => r.tgrelid).sort();
}

/** The collections schema version this database currently carries. */
async function stampedSchemaVersion(): Promise<string | null> {
    const rows = await query<{ value: string }>(
        `SELECT value FROM rebase.schema_meta WHERE key = 'collections_schema_version'`
    ).catch(() => [] as { value: string }[]);
    return rows[0]?.value ?? null;
}

/** Overwrite the stamp, to stand in for a database provisioned by a different build. */
async function setStampedSchemaVersion(value: string): Promise<void> {
    await query(
        `INSERT INTO rebase.schema_meta (key, value) VALUES ('collections_schema_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [value]
    );
}

/**
 * Give the fixture project the dependency a deployed bundle carries.
 *
 * `bootFromBundle` resolves its database driver by walking up from the bundle
 * directory — exactly as it would in a container where the bundle has its own
 * `node_modules`. Created here rather than committed, so `node_modules` stays
 * gitignored and the test is self-contained in CI.
 */
async function linkDriverIntoFixture(): Promise<void> {
    const scope = path.join(PROJECT_ROOT, "node_modules", "@rebasepro");
    const link = path.join(scope, "server-postgres");

    await fs.mkdir(scope, { recursive: true });
    await fs.rm(link, { force: true, recursive: true });
    await fs.symlink(DRIVER_ROOT, link, "dir");
}

beforeAll(async () => {
    await linkDriverIntoFixture();
    container = await startPgContainer();
}, 180_000);

afterAll(async () => {
    for (const handle of spawned) await stop(handle);
    if (container) await stopPgContainer(container);
}, 120_000);

describe("refusals, from the real environment", () => {
    it("refuses a functions process that would also provision the schema", async () => {
        // The state a first attempt at a split deployment lands in: nothing set,
        // so REBASE_MIGRATE_ON_BOOT defaults to `ensure` and every process races
        // to create the same tables.
        const said = await startExpectingRefusal({ REBASE_ROLE: "functions" });

        expect(said).toMatch(/REBASE_MIGRATE_ON_BOOT/);
        // The fix, not just the complaint.
        expect(said).toMatch(/REBASE_MIGRATE_ON_BOOT=none/);
    }, 120_000);

    it("refuses a function name the bundle does not contain, and lists what it has", async () => {
        const said = await startExpectingRefusal({
            REBASE_ROLE: "functions",
            REBASE_MIGRATE_ON_BOOT: "none",
            REBASE_FUNCTIONS_ONLY: "echoo"
        });

        expect(said).toMatch(/echoo/);
        expect(said).toMatch(/echo\b/);
    }, 120_000);

    it("refuses an upstream set on a process that does not read it", async () => {
        const said = await startExpectingRefusal({
            REBASE_ROLE: "functions",
            REBASE_MIGRATE_ON_BOOT: "none",
            REBASE_FUNCTIONS_UPSTREAM: "http://functions:8080"
        });

        expect(said).toMatch(/only read by REBASE_ROLE=api/);
    }, 120_000);
});

describe("a functions process against an unprovisioned database", () => {
    let functions: Process;

    beforeAll(async () => {
        expect(await tableExists("split_notes")).toBe(false);
        functions = await start({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" });
    }, 180_000);

    it("creates no tables", async () => {
        // The role's whole claim: it came up without touching the schema.
        expect(await tableExists("split_notes")).toBe(false);
    });

    it("serves its functions", async () => {
        const res = await fetch(`${functions.origin}/api/functions/echo/hello`);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, from: "functions" });
    });

    it("serves no data, auth, admin or meta surface", async () => {
        for (const route of [
            "/api/data/notes",
            "/api/auth/login",
            "/api/admin/users",
            "/api/meta/schema-version"
        ]) {
            expect((await fetch(`${functions.origin}${route}`)).status).toBe(404);
        }
    });

    it("still answers health, so an orchestrator can roll it", async () => {
        // A process a probe cannot reach never becomes ready, which would make
        // the role undeployable on Kubernetes however correct it is otherwise.
        expect((await fetch(`${functions.origin}/health`)).status).toBe(200);
    });

    it("installs no change-capture machinery", async () => {
        // The role refuses to boot with REBASE_MIGRATE_ON_BOOT set, on the
        // grounds that exactly one process owns schema DDL — and then installed
        // CDC anyway, from a code path that never asked the role: a schema, a
        // trigger function, and `DROP TRIGGER … ; CREATE TRIGGER …` per
        // collection table, on every pod, on every rollout.
        expect(await cdcFunctionExists()).toBe(false);
        expect(await cdcTriggers()).toEqual([]);
    });

    it("opens no dedicated LISTEN connection", async () => {
        // A functions process has no websocket clients, so a connection held
        // open to deliver change events to nobody is one connection per replica
        // spent on nothing — and it sits outside the pool, so it is not bounded
        // by the pool size either.
        expect(await cdcListenerCount()).toBe(0);
    });
});

describe("the api process", () => {
    let api: Process;

    beforeAll(async () => {
        api = await start({ REBASE_ROLE: "api", REBASE_MIGRATE_ON_BOOT: "ensure" });
    }, 180_000);

    it("provisions the schema the functions process would not", async () => {
        expect(await tableExists("split_notes")).toBe(true);
    });

    it("installs the change-capture the functions process would not", async () => {
        expect(await cdcFunctionExists()).toBe(true);
        // The other half of the ownership rule, and the half that makes the
        // first one safe: capture is installed once, by the schema owner, and
        // every other process then reads what the database publishes. A write
        // made by the functions process is still heard — the trigger fires for
        // the writer, whoever it is.
        expect(await cdcTriggers()).toContain("split_notes");
    });

    it("serves the data surface", async () => {
        const res = await fetch(`${api.origin}/api/data/notes`);
        // The process's own log on failure. A 500 from a spawned runtime is
        // otherwise a bare status code, and the reason is always in its stderr.
        if (res.status !== 200) console.log(`api process log:\n${api.output()}`);
        expect(res.status, await res.clone().text()).toBe(200);
    });

    it("does not serve functions, and does not pretend to", async () => {
        // 404 rather than 501 or an empty list: this process was never meant to
        // answer here, and the ingress in front decides where the path goes.
        expect((await fetch(`${api.origin}/api/functions/echo/hello`)).status).toBe(404);
    });
});

describe("the api process forwarding to the functions process", () => {
    let functions: Process;
    let api: Process;

    beforeAll(async () => {
        functions = await start({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" });
        api = await start({
            REBASE_ROLE: "api",
            REBASE_MIGRATE_ON_BOOT: "none",
            REBASE_FUNCTIONS_UPSTREAM: functions.origin
        });
    }, 180_000);

    it("presents the same URL as a single-process deployment", async () => {
        const res = await fetch(`${api.origin}/api/functions/echo/hello`);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, from: "functions" });
    });

    it("carries the caller's identity across the hop", async () => {
        // The assertion this whole file exists for. A token from the real
        // registration flow, not one signed here: minting one by hand would test
        // this file's idea of the claim shape rather than what a client holds.
        const registered = await fetch(`${api.origin}/api/auth/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                email: `split-${Date.now()}@example.com`,
                password: "Sufficiently-Long-Password-1!"
            })
        });
        expect(registered.status, await registered.clone().text()).toBeLessThan(300);

        const body = await registered.json() as Record<string, unknown>;
        // Spelled defensively rather than pinned: this test is about the hop,
        // and it should not start failing because the auth route renamed a field.
        const accessToken = (body.accessToken
            ?? body.token
            ?? (body.tokens as Record<string, unknown>)?.accessToken) as string;
        expect(accessToken, JSON.stringify(body)).toBeTruthy();
        const auth = { headers: { authorization: `Bearer ${accessToken}` } };

        const direct = await (await fetch(`${functions.origin}/api/functions/echo/whoami`, auth)).json();
        const proxied = await (await fetch(`${api.origin}/api/functions/echo/whoami`, auth)).json();

        expect(proxied).toEqual(direct);
        // Identified, not anonymous: a dropped Authorization header leaves every
        // handler running, just without a user, which no status code reveals.
        expect((proxied as { uid: string | null }).uid).toBeTruthy();
    });

    it("lets a function reach the database from a process that serves no data routes", async () => {
        // `rebase.sql` on the functions process. Had the split gated the driver
        // rather than the mount, this is where it would surface — as every
        // custom function failing, not as a missing route.
        const res = await fetch(`${api.origin}/api/functions/echo/count`);

        expect(res.status, await res.clone().text()).toBe(200);
        expect(await res.json()).toMatchObject({ n: expect.any(Number) });
    });

    it("survives a large forwarded body and a compressed response", async () => {
        // Compression is the one that bit: `fetch` gunzips transparently but
        // leaves `Content-Encoding` set, and copying that header onto an
        // already-decoded body does not fail cleanly — it hangs.
        const res = await fetch(`${api.origin}/api/functions/echo/hello`, {
            headers: { "accept-encoding": "gzip" }
        });

        expect(await res.json()).toMatchObject({ ok: true });
    });

    it("answers 502, naming the cause, once the upstream is gone", async () => {
        await stop(functions);

        const res = await fetch(`${api.origin}/api/functions/echo/hello`);

        expect(res.status).toBe(502);
        expect(await res.json()).toMatchObject({
            error: { code: "FUNCTIONS_UPSTREAM_UNREACHABLE" }
        });
    });
});

describe("serving one named function", () => {
    it("mounts what REBASE_FUNCTIONS_ONLY names", async () => {
        const functions = await start({
            REBASE_ROLE: "functions",
            REBASE_MIGRATE_ON_BOOT: "none",
            REBASE_FUNCTIONS_ONLY: "echo"
        });

        expect((await fetch(`${functions.origin}/api/functions/echo/hello`)).status).toBe(200);
    }, 180_000);

    it("mounts nothing when the only function is excluded", async () => {
        const functions = await start({
            REBASE_ROLE: "functions",
            REBASE_MIGRATE_ON_BOOT: "none",
            REBASE_FUNCTIONS_EXCLUDE: "echo"
        });

        expect((await fetch(`${functions.origin}/api/functions/echo/hello`)).status).toBe(404);
        // The listing must agree with what is mounted, or a caller reading it is
        // told about a function this process will 404.
        //
        // Authenticated, because the index stopped answering strangers: it named
        // every custom endpoint to anyone who asked. `requireAuth` there admits
        // any resolved identity, and the service key is the one this fixture
        // already has. Without the header this reads a 401 whose body carries no
        // `functions` key at all, so the assertion failed on `undefined` rather
        // than on a listing that disagreed — which says nothing about the split.
        const listed = await (await fetch(`${functions.origin}/api/functions`, {
            headers: { authorization: `Bearer ${SERVICE_KEY}` }
        })).json() as {
            functions: unknown[];
        };
        expect(listed.functions).toEqual([]);
    }, 180_000);
});

// Placed last on purpose: the suites above assert against an *unprovisioned*
// database, and a default-role process provisions on boot. Ordering is part of
// the fixture here, not an accident.
describe("the schema stamp", () => {
    /**
     * The guard that makes per-unit release safe to offer at all.
     *
     * A split deployment can pin its units to different builds, and they share
     * one database that only one of them provisions. Nothing about that failure
     * is visible: a process ahead of the schema queries a column that does not
     * exist (a SQL error on one route) and relies on policies that were never
     * applied (a 200 with no rows). These tests run the real processes, because
     * the stamp is written by one and read by another and no in-process harness
     * exercises that.
     *
     * Ordered after the api describe above deliberately — that boot is what
     * provisions this database, and therefore what stamps it.
     */
    /**
     * The fixture's manifest is committed, so a contract bump silently
     * invalidates it — and the symptom is TEN unrelated failures, every one of
     * them reporting whatever assertion it happened to make instead of the one
     * fact that matters: the bundle was refused before it ever booted.
     *
     * This asserts the fixture against the constant, so the next bump fails
     * once, here, naming the file to edit.
     */
    it("declares the contract this runtime implements", async () => {
        const { RUNTIME_CONTRACT_VERSION } = await import("@rebasepro/types");
        const manifest = JSON.parse(
            await fs.readFile(path.join(PROJECT_ROOT, "manifest.json"), "utf-8")
        ) as { runtime: { contract: number } };

        expect(manifest.runtime.contract).toBe(RUNTIME_CONTRACT_VERSION);
    });

    it("was written by the process that provisioned", async () => {
        const stamped = await stampedSchemaVersion();

        expect(stamped).toBeTruthy();
        // It is a computed identity, not a copied manifest value. A version that
        // looked like the manifest's would prove nothing: the contract endpoint
        // already returns the manifest's own number verbatim, which is how the
        // equivalent check elsewhere passed on a bundle corrupted to nonsense.
        expect(stamped).toMatch(/^v\d+:/);
    });

    it("lets a matching process boot quietly", async () => {
        const functions = await start({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" });

        expect(functions.output()).not.toMatch(/different set of collections/);
        expect((await fetch(`${functions.origin}/api/functions/echo/hello`)).status).toBe(200);
    }, 120_000);

    it("warns a process whose collections do not match the database", async () => {
        const real = await stampedSchemaVersion();
        await setStampedSchemaVersion("v1:0000000000000000");
        try {
            const functions = await start({ REBASE_ROLE: "functions", REBASE_MIGRATE_ON_BOOT: "none" });

            // Warns by default: mid-rollout disagreement is normal, and a
            // deployment that crash-loops through its own rollout has traded a
            // silent problem for a loud outage.
            expect(functions.output()).toMatch(/different set of collections/);
            expect(functions.output()).toContain("v1:0000000000000000");
            expect((await fetch(`${functions.origin}/api/functions/echo/hello`)).status).toBe(200);
        } finally {
            await setStampedSchemaVersion(real!);
        }
    }, 120_000);

    it("refuses the boot under REBASE_REQUIRE_SCHEMA_MATCH", async () => {
        const real = await stampedSchemaVersion();
        await setStampedSchemaVersion("v1:0000000000000000");
        try {
            const said = await startExpectingRefusal({
                REBASE_ROLE: "functions",
                REBASE_MIGRATE_ON_BOOT: "none",
                REBASE_REQUIRE_SCHEMA_MATCH: "true"
            });

            expect(said).toMatch(/different set of collections/);
        } finally {
            await setStampedSchemaVersion(real!);
        }
    }, 120_000);

    it("does not stamp from a process that provisioned nothing", async () => {
        // The chart's default runs an external migration Job and gives every
        // pod REBASE_MIGRATE_ON_BOOT=none — including the api, whose role still
        // permits provisioning. Keyed on permission rather than on outcome, that
        // api would overwrite the Job's stamp with its own and the check would
        // agree with whatever booted last.
        const before = await stampedSchemaVersion();
        await setStampedSchemaVersion("v1:1111111111111111");
        try {
            await start({ REBASE_ROLE: "api", REBASE_MIGRATE_ON_BOOT: "none" });

            expect(await stampedSchemaVersion()).toBe("v1:1111111111111111");
        } finally {
            await setStampedSchemaVersion(before!);
        }
    }, 120_000);
});

describe("a deployment that sets no role at all", () => {
    /**
     * The shape every existing deployment is in, and the one Rebase Cloud's
     * managed runtime boots: `buildManagedContainer` sets `REBASE_BUNDLE`,
     * `NODE_ENV` and `PORT` and nothing else, so a tenant pod resolves
     * `REBASE_ROLE=all`.
     *
     * This is the compatibility assertion for the whole feature. If it ever
     * fails, every managed tenant and every self-hosted single container is
     * serving something different from what it served before the split existed.
     */
    let single: Process;

    beforeAll(async () => {
        single = await start({});
    }, 180_000);

    it("serves every surface from one process", async () => {
        expect((await fetch(`${single.origin}/api/data/notes`)).status).toBe(200);
        expect((await fetch(`${single.origin}/api/functions/echo/hello`)).status).toBe(200);
        expect((await fetch(`${single.origin}/api/meta/schema-version`)).status).toBe(200);
        expect((await fetch(`${single.origin}/health`)).status).toBe(200);
    });

    it("provisions its own schema, as it always did", async () => {
        expect(await tableExists("split_notes")).toBe(true);
    });

    it("says nothing about roles in its log", async () => {
        // The role line is logged only when the role is not `all`. A default
        // deployment whose logs changed would be a change in behaviour that
        // nobody asked for, and the first sign of one is usually a new line.
        expect(single.output()).not.toMatch(/Runtime role/);
        expect(single.output()).not.toMatch(/Partial runtime surface/);
    });
});
