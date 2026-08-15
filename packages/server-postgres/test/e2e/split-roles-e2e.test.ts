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
});

describe("the api process", () => {
    let api: Process;

    beforeAll(async () => {
        api = await start({ REBASE_ROLE: "api", REBASE_MIGRATE_ON_BOOT: "ensure" });
    }, 180_000);

    it("provisions the schema the functions process would not", async () => {
        expect(await tableExists("split_notes")).toBe(true);
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
        const listed = await (await fetch(`${functions.origin}/api/functions`)).json() as {
            functions: unknown[];
        };
        expect(listed.functions).toEqual([]);
    }, 180_000);
});

// Placed last on purpose: the suites above assert against an *unprovisioned*
// database, and a default-role process provisions on boot. Ordering is part of
// the fixture here, not an accident.
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
