/**
 * E2E: a deployment whose database changes only through somebody else's change
 * process — `REBASE_PROVISION=false` — as real processes, against a real
 * Postgres.
 *
 * ## What it proves
 *
 * 1. **The provisioning run's recording is the schema.** A run with
 *    `REBASE_PROVISION_ONLY=true` and `REBASE_PROVISION_SQL_OUT` against one
 *    empty database writes a script; `psql` applies that script to a second
 *    empty database, and the runtime then serves from it. Nothing else touched
 *    the second database, so whatever the runtime needed, the script had.
 * 2. **The serving process issues no schema change at all.** Not "fails
 *    harmlessly for lack of privilege" — which is what deployments did before
 *    this existed, by accident — but sends none. Measured by Postgres itself:
 *    the serving role has `log_statement = 'all'`, and every statement it sent
 *    over the whole run, boot and requests, is read back out of the server log.
 *    The role also lacks CREATE on the database and both schemas, so a
 *    statement the log somehow missed would still have failed loudly.
 * 3. **What it cannot work without is refused by name**, not met as a 500:
 *    a database with no auth tables, and a request role that can reach the
 *    framework's session and key tables, which no provisioning boot is left to
 *    revoke.
 *
 * Spawns `rebase-server` rather than booting in the test runner, for the reason
 * `split-roles-e2e.test.ts` gives: the driver and the project's functions load
 * through native dynamic `import`, which a test runner's module sandbox cannot
 * service. So this runs the built dist — build `@rebasepro/server-postgres...`
 * first.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import pg from "pg";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { splitStatements } from "../../../server/src/boot/schema-change-recorder.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "split-project");
const DRIVER_ROOT = path.resolve(HERE, "..", "..");
const SERVER_BIN = path.resolve(DRIVER_ROOT, "..", "server", "bin", "rebase-server.js");

const JWT_SECRET = "provision-off-e2e-secret-at-least-32-chars-long";
const SERVICE_KEY = "provision-off-e2e-service-key-at-least-32-chars";
const CONSOLE_ROLE = "console";
const CONSOLE_PASSWORD = "console-e2e-password";

/** The statements a change process reviews — the same first keywords `isSchemaChange` refuses. */
const SCHEMA_CHANGE = /^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|DO|REINDEX|CLUSTER|SECURITY|IMPORT|REASSIGN)\b/i;

let container: PgContainer;
let workDir: string;
let projectDir: string;
let sqlFile: string;
let recorded = "";
const spawned: ChildProcess[] = [];

/** The container's URL, pointed at another database and, optionally, another role. */
function urlFor(database: string, user = "rebase", password = "rebase"): string {
    const url = new URL(container.connectionString);
    url.username = user;
    url.password = password;
    url.pathname = `/${database}`;
    return url.toString();
}

function baseEnv(databaseUrl: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        // The test decides every provisioning variable; none leaks in from the shell.
        if (value !== undefined && !key.startsWith("REBASE_PROVISION") && key !== "REBASE_MIGRATE_ON_BOOT") {
            env[key] = value;
        }
    }
    return {
        ...env,
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        JWT_SECRET,
        REBASE_SERVICE_KEY: SERVICE_KEY,
        PORT: "0",
        LOG_LEVEL: "info",
        // The shared counters are a table made on first use: one more thing a
        // process that provisions nothing must find already there.
        REBASE_RATE_LIMIT_STORE: "sql"
    };
}

interface Exited { code: number | null; output: string }

/** Run a process to completion — a provisioning run, or one expected to refuse. */
function runToExit(env: Record<string, string>): Promise<Exited> {
    const child = spawn(process.execPath, [SERVER_BIN, projectDir], { env, stdio: ["ignore", "pipe", "pipe"] });
    spawned.push(child);
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Timed out waiting for the process to exit.\n${output}`));
        }, 120_000);
        child.once("exit", (code) => {
            clearTimeout(timer);
            resolve({ code, output });
        });
    });
}

interface Serving { origin: string; output: () => string; child: ChildProcess }

/** Start a serving process and wait for the line that says where it listens. */
function start(env: Record<string, string>): Promise<Serving> {
    const child = spawn(process.execPath, [SERVER_BIN, projectDir], { env, stdio: ["ignore", "pipe", "pipe"] });
    spawned.push(child);
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for a boot line.\n${output}`)), 90_000);
        const check = () => {
            const match = output.match(/http:\/\/localhost:(\d+)/);
            if (!match) return;
            clearTimeout(timer);
            resolve({ origin: `http://127.0.0.1:${match[1]}`, output: () => output, child });
        };
        child.stdout?.on("data", check);
        child.stderr?.on("data", check);
        child.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`Process exited with ${code} before listening.\n${output}`));
        });
    });
}

async function stop(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    });
}

/** Run SQL as the container's superuser, outside the runtime entirely. */
async function admin<T = Record<string, unknown>>(database: string, sql: string, params: unknown[] = []): Promise<T[]> {
    const client = new pg.Client({ connectionString: urlFor(database) });
    await client.connect();
    try {
        return (await client.query(sql, params)).rows as T[];
    } finally {
        await client.end();
    }
}

/**
 * Every statement the console role sent, as the server logged it.
 *
 * `log_statement = 'all'` is set on that role alone, so every `statement:` or
 * `execute …:` line in the log is one of its statements — the superuser this
 * test runs its own SQL as logs nothing. The first line of each is enough: the
 * keyword that makes a statement a schema change is its first word.
 */
async function statementsLoggedForConsole(): Promise<string[]> {
    const { stdout, stderr } = await execa("docker", ["logs", container.containerName]);
    return `${stdout}\n${stderr}`
        .split("\n")
        .map(line => line.match(/LOG:\s+(?:statement|execute [^:]*):\s(.*)$/)?.[1])
        .filter((statement): statement is string => statement !== undefined);
}

/** The first access token anywhere in an auth response body. */
function accessTokenIn(body: unknown): string | undefined {
    if (!body || typeof body !== "object") return undefined;
    for (const [key, value] of Object.entries(body)) {
        if (key === "accessToken" && typeof value === "string") return value;
        const nested = accessTokenIn(value);
        if (nested) return nested;
    }
    return undefined;
}

beforeAll(async () => {
    // A copy of the split-roles fixture whose one collection anyone may write:
    // this suite is about which statements reach the database, not who may
    // insert a row, and the role it serves as is filtered by RLS natively.
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "rebase-provision-off-"));
    projectDir = path.join(workDir, "project");
    await fs.cp(FIXTURE, projectDir, { recursive: true, filter: source => !source.includes(`${path.sep}node_modules`) });
    // Outside the repository nothing resolves by walking up, so the copy gets
    // the packages its files import, linked as an installed project has them.
    const SERVER_ROOT = path.resolve(DRIVER_ROOT, "..", "server");
    const modules = path.join(projectDir, "node_modules");
    await fs.mkdir(path.join(modules, "@rebasepro"), { recursive: true });
    for (const [name, target] of [
        ["@rebasepro/server-postgres", DRIVER_ROOT],
        ["@rebasepro/server", SERVER_ROOT],
        ["drizzle-orm", await fs.realpath(path.join(DRIVER_ROOT, "node_modules", "drizzle-orm"))],
        ["hono", await fs.realpath(path.join(SERVER_ROOT, "node_modules", "hono"))]
    ] as const) {
        await fs.symlink(target, path.join(modules, name), "dir");
    }
    await fs.writeFile(path.join(projectDir, "config", "collections", "notes.js"), `
export default {
    name: "Notes",
    singularName: "Note",
    slug: "notes",
    table: "split_notes",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    },
    securityRules: [{ operation: "all", access: "public" }]
};
`);
    sqlFile = path.join(workDir, "rebase-provisioning.sql");

    container = await startPgContainer();
    await admin("rebase", "CREATE DATABASE recorded_from");
    await admin("rebase", "CREATE DATABASE managed");
    await admin("rebase", "CREATE DATABASE bare");

    // ── 1. The provisioning run, recorded ────────────────────────────────────
    const run = await runToExit({
        ...baseEnv(urlFor("recorded_from")),
        REBASE_PROVISION_ONLY: "true",
        REBASE_PROVISION_SQL_OUT: sqlFile
    });
    if (run.code !== 0) throw new Error(`The provisioning run failed (${run.code}).\n${run.output}`);
    recorded = await fs.readFile(sqlFile, "utf-8");

    // ── 2. Applied by the change process, with psql ──────────────────────────
    await execa(
        "docker",
        ["exec", "-i", container.containerName, "psql", "-U", "rebase", "-d", "managed", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        { input: recorded }
    );

    // ── 3. The role the console serves as: may read and write, may create nothing
    const schemas = (await admin<{ name: string }>("managed", `
        SELECT nspname AS name FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
    `)).map(row => `"${row.name}"`).join(", ");
    for (const statement of [
        `CREATE ROLE ${CONSOLE_ROLE} LOGIN PASSWORD '${CONSOLE_PASSWORD}'`,
        "REVOKE ALL ON DATABASE managed FROM PUBLIC",
        `GRANT CONNECT ON DATABASE managed TO ${CONSOLE_ROLE}`,
        "REVOKE CREATE ON SCHEMA public FROM PUBLIC",
        `GRANT USAGE ON SCHEMA ${schemas} TO ${CONSOLE_ROLE}`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemas} TO ${CONSOLE_ROLE}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schemas} TO ${CONSOLE_ROLE}`,
        `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schemas} TO ${CONSOLE_ROLE}`,
        `ALTER ROLE ${CONSOLE_ROLE} SET log_statement = 'all'`
    ]) {
        await admin("managed", statement);
    }
}, 300_000);

afterAll(async () => {
    for (const child of spawned) await stop(child);
    if (container) await stopPgContainer(container.containerName);
    if (workDir) await fs.rm(workDir, { recursive: true, force: true });
}, 120_000);

describe("the provisioning run's recording", () => {
    it("is a script of the schema changes the run made, and nothing else", () => {
        expect(recorded).toMatch(/^-- Schema changes made by a Rebase provisioning run/);
        // The framework's own tables, the project's collection, its policies.
        expect(recorded).toMatch(/CREATE TABLE IF NOT EXISTS rebase\.api_keys/);
        expect(recorded).toMatch(/CREATE TABLE IF NOT EXISTS "rebase"\."idempotency_keys"/);
        expect(recorded).toMatch(/CREATE TABLE IF NOT EXISTS rebase\.rate_limit_hits/);
        expect(recorded).toMatch(/refresh_tokens/);
        expect(recorded).toMatch(/split_notes/);
        expect(recorded).toMatch(/CREATE POLICY/);
        // Rows are not schema; the first admin's password hash has no business
        // here. Read statement by statement — a function body is full of them.
        expect(splitStatements(recorded).filter(statement => /^(INSERT|UPDATE|DELETE)\b/i.test(statement))).toEqual([]);
        expect(recorded).not.toMatch(/scrypt|password_hash\s*=/i);
    });

    it("applied to an empty database by psql, leaves a role that may create nothing able to serve it", async () => {
        const [privileges] = await admin<Record<string, boolean>>("managed", `
            SELECT has_database_privilege($1, 'managed', 'CREATE') AS database,
                   has_database_privilege($1, 'managed', 'TEMP') AS temp,
                   has_schema_privilege($1, 'public', 'CREATE') AS public,
                   has_schema_privilege($1, 'rebase', 'CREATE') AS rebase
        `, [CONSOLE_ROLE]);
        expect(privileges).toEqual({ database: false, temp: false, public: false, rebase: false });
    });
});

describe("REBASE_PROVISION=false, serving", () => {
    it("signs up, writes with an Idempotency-Key, lists API keys — and sends no schema change at all", async () => {
        const serving = await start({
            ...baseEnv(urlFor("managed", CONSOLE_ROLE, CONSOLE_PASSWORD)),
            REBASE_PROVISION: "false"
        });
        try {
            expect(serving.output()).toContain("Provisioning is off");

            const registered = await fetch(`${serving.origin}/api/auth/register`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email: "cto@example.com", password: "A-long-enough-Password-1" })
            });
            const registeredBody: unknown = await registered.json();
            expect(registered.status, JSON.stringify(registeredBody)).toBeLessThan(300);
            const token = accessTokenIn(registeredBody);
            expect(token).toBeDefined();

            const write = () => fetch(`${serving.origin}/api/data/notes`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${token}`,
                    "idempotency-key": "provision-off-e2e-1"
                },
                body: JSON.stringify({ title: "first" })
            });
            const first = await write();
            expect(first.status, await first.clone().text()).toBe(201);
            // The same key again: replayed from the table the recording made,
            // not written twice.
            const replay = await write();
            expect(replay.status).toBeLessThan(300);
            const [notes] = await admin<{ n: number }>("managed", "SELECT count(*)::int AS n FROM split_notes");
            expect(notes.n).toBe(1);
            const [keys] = await admin<{ n: number }>("managed", "SELECT count(*)::int AS n FROM rebase.idempotency_keys");
            expect(keys.n).toBe(1);

            const apiKeys = await fetch(`${serving.origin}/api/admin/api-keys`, {
                headers: { authorization: `Bearer ${SERVICE_KEY}` }
            });
            expect(apiKeys.status, await apiKeys.clone().text()).toBe(200);
        } finally {
            await stop(serving.child);
        }

        // The recording was complete: nothing the process reached for, at boot
        // or on its first sweep, was missing.
        expect(serving.output()).not.toMatch(/is unavailable|does not exist|is out of date|Could not claim/);

        const logged = await statementsLoggedForConsole();
        // The measurement is live: boot and requests left a trail…
        expect(logged.some(statement => /rebase\.api_keys|"rebase"\."idempotency_keys"/.test(statement))).toBe(true);
        expect(logged.some(statement => /^\s*INSERT INTO "rebase"\."idempotency_keys"/.test(statement))).toBe(true);
        // …and not one statement on it changed the schema.
        expect(logged.filter(statement => SCHEMA_CHANGE.test(statement))).toEqual([]);
    }, 180_000);
});

describe("REBASE_PROVISION=false, refusing by name", () => {
    it("refuses a database with no auth tables, naming each, rather than failing every sign-in", async () => {
        const refused = await runToExit({ ...baseEnv(urlFor("bare")), REBASE_PROVISION: "false" });

        expect(refused.code).not.toBe(0);
        expect(refused.output).toContain("Auth cannot run on this database");
        expect(refused.output).toContain("\"rebase\".\"refresh_tokens\"");
        expect(refused.output).toContain("REBASE_PROVISION_ONLY=true");
        const [tables] = await admin<{ n: number }>("bare",
            "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'rebase')");
        expect(tables.n).toBe(0);
    }, 120_000);

    it("refuses to serve while the request role can read session tokens, with the REVOKE to run", async () => {
        await admin("managed", "GRANT SELECT ON rebase.refresh_tokens TO rebase_user");
        try {
            // As the superuser: requests then run as `rebase_user`, which is the
            // role whose reach a provisioning boot would have cut back.
            const refused = await runToExit({ ...baseEnv(urlFor("managed")), REBASE_PROVISION: "false" });

            expect(refused.code).not.toBe(0);
            // That table and no other: the recorded provisioning left nothing
            // else within the request role's reach.
            expect(refused.output).toContain("job payloads: rebase.refresh_tokens.\n");
            expect(refused.output).toContain("REVOKE ALL ON \"rebase\".\"refresh_tokens\" FROM rebase_user;");
        } finally {
            await admin("managed", "REVOKE ALL ON rebase.refresh_tokens FROM rebase_user");
        }
    }, 120_000);

    it("refuses a provisioning run that may not provision", async () => {
        const refused = await runToExit({
            ...baseEnv(urlFor("managed")),
            REBASE_PROVISION: "false",
            REBASE_PROVISION_ONLY: "true"
        });

        expect(refused.code).not.toBe(0);
        expect(refused.output).toContain("REBASE_PROVISION=false and REBASE_PROVISION_ONLY=true");
    }, 120_000);

    it("refuses a recording on a process that serves", async () => {
        const refused = await runToExit({
            ...baseEnv(urlFor("managed")),
            REBASE_PROVISION_SQL_OUT: path.join(workDir, "never.sql")
        });

        expect(refused.code).not.toBe(0);
        expect(refused.output).toContain("REBASE_PROVISION_SQL_OUT is written by a provisioning run");
        await expect(fs.stat(path.join(workDir, "never.sql"))).rejects.toThrow();
    }, 120_000);
});
