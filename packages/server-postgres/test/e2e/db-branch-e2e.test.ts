/**
 * `rebase db branch` beside a client that holds the source open, and from a
 * checkout switched to a branch.
 *
 * - `create --force` disconnected the other sessions once, then copied. A
 *   client that reconnects — a running `rebase dev`'s realtime listener does —
 *   was back before `CREATE DATABASE … TEMPLATE` counted the sessions in about
 *   three tries of twenty, and the error then said to re-run with `--force`.
 *   The source now refuses new connections for the copy, and is opened again
 *   after. Here the client is back 50 ms after each disconnect, which failed
 *   every time.
 * - With `--force` passed, a refusal never says to pass `--force`.
 * - `prune --older-than 0d --yes` dropped the branch the checkout was switched
 *   to, which `delete` refuses. The CLI names that database to the driver
 *   (`REBASE_ACTIVE_BRANCH_DATABASE`), which keeps it and says so — and `list`
 *   marks it, where every branch had the same bullet.
 * - A forced create stopped mid-copy by anything but Ctrl-C or SIGTERM — a
 *   closed terminal (SIGHUP), a SIGKILL — left its source refusing every
 *   connection, and no command opened it again or said how. It now opens it on
 *   every signal Node can catch, the next `branch` command opens what a SIGKILL
 *   left closed, and the connection banner names both ways.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { runPluginCommand } from "../../src/cli.js";
import { checkDatabaseConnectivity, diagnoseDbError } from "../../src/cli-errors.js";
import { BranchService, reopenClosedDatabases } from "../../src/services/BranchService.js";
import { DatabasePoolManager } from "../../src/databasePoolManager.js";
import { resolveTsxLoader } from "../../src/tsx-loader.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

class Exited extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

/**
 * A client that is back 50 ms after it is disconnected — well inside the
 * settle `--force` allows before the copy — and, refused, tries again a second
 * later, as any client with a backoff does (the realtime listener waits 3 s).
 */
function stickyClient(connectionString: string, name: string) {
    let stopped = false;
    let current: pg.Client | undefined;
    let reconnects = 0;
    let refused = 0;
    const later = (ms: number) => setTimeout(() => void connect(), ms);
    const connect = async (): Promise<void> => {
        if (stopped) return;
        const client = new pg.Client({ connectionString, application_name: name });
        client.on("error", () => undefined);
        client.on("end", () => {
            if (stopped || client !== current) return;
            current = undefined;
            reconnects += 1;
            later(50);
        });
        try {
            await client.connect();
            current = client;
        } catch {
            refused += 1;
            later(1_000);
        }
    };
    return {
        start: connect,
        get reconnects() { return reconnects; },
        get refused() { return refused; },
        connected: () => current !== undefined,
        async stop() {
            stopped = true;
            await current?.end().catch(() => undefined);
        }
    };
}

describe("db branch with other clients connected, and from a switched checkout", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let workDir: string;
    let stdout: string[];
    let stderr: string[];
    const original = { DATABASE_URL: process.env.DATABASE_URL, cwd: process.cwd() };
    const urlFor = (db: string) => container.connectionString.replace(/\/rebase\?/, `/${db}?`);

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: urlFor("postgres") });
        await admin.connect();
    }, 120_000);

    afterAll(async () => {
        if (admin) await admin.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    beforeEach(() => {
        process.env.DATABASE_URL = container.connectionString;
        delete process.env.REBASE_ACTIVE_BRANCH_DATABASE;
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-branch-force-"));
        process.chdir(workDir);
        stdout = [];
        stderr = [];
        vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => { stdout.push(parts.map(String).join(" ")); });
        vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); });
        vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); });
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exited(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.chdir(original.cwd);
        delete process.env.REBASE_ACTIVE_BRANCH_DATABASE;
        if (original.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = original.DATABASE_URL;
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    async function run(args: string[]): Promise<{ code: number | undefined; said: string }> {
        let code: number | undefined = 0;
        try {
            await runPluginCommand(args);
        } catch (error) {
            if (!(error instanceof Exited)) {
                stderr.push(error instanceof Error ? error.message : String(error));
                code = 1;
            } else {
                code = error.code;
            }
        }
        // eslint-disable-next-line no-control-regex
        return { code, said: [...stdout, ...stderr].join("\n").replace(/\x1b\[[0-9;]*m/g, "") };
    }

    const databases = async (): Promise<string[]> =>
        (await admin.query<{ datname: string }>("SELECT datname FROM pg_database ORDER BY 1")).rows.map(r => r.datname);

    it("create --force copies a source a client keeps reconnecting to, and opens it again after", async () => {
        const sticky = stickyClient(container.connectionString, "rebase-realtime:sticky");
        await sticky.start();
        try {
            const created = await run(["db", "branch", "create", "forced", "--force"]);

            expect(created.code, created.said).toBe(0);
            expect(created.said).toContain("Branch \"forced\" created successfully");
            expect(await databases()).toContain("rb_forced");
            // Open again: the client is back, and anyone else can connect.
            const allow = await admin.query<{ datallowconn: boolean }>("SELECT datallowconn FROM pg_database WHERE datname = 'rebase'");
            expect(allow.rows[0].datallowconn).toBe(true);
            await vi.waitFor(() => expect(sticky.connected()).toBe(true), { timeout: 5_000 });
            expect(sticky.reconnects).toBeGreaterThan(0);
            // Kept out while the copy ran.
            expect(sticky.refused).toBeGreaterThan(0);
        } finally {
            await sticky.stop();
        }
    }, 60_000);

    it("a delete --force that cannot get the database to itself does not say to pass --force", async () => {
        expect((await run(["db", "branch", "create", "held"])).code).toBe(0);
        stdout.length = 0;
        stderr.length = 0;
        const sticky = stickyClient(urlFor("rb_held"), "rebase-realtime:held");
        await sticky.start();
        try {
            const deleted = await run(["db", "branch", "delete", "held", "--force"]);

            expect(deleted.code, deleted.said).toBe(1);
            expect(deleted.said).toContain("still had connections after they were disconnected");
            expect(deleted.said).toContain("rebase-realtime:held");
            expect(deleted.said).toContain("They reconnected as fast as they were disconnected");
            expect(deleted.said).not.toContain("--force");
        } finally {
            await sticky.stop();
        }
    }, 90_000);

    it("prune keeps the branch this checkout is switched to, says so, and list marks it", async () => {
        expect((await run(["db", "branch", "create", "mine"])).code).toBe(0);
        expect((await run(["db", "branch", "create", "other"])).code).toBe(0);
        process.env.REBASE_ACTIVE_BRANCH_DATABASE = "rb_mine";

        const listed = await run(["db", "branch", "list"]);
        expect(listed.said).toMatch(/● mine \(current — this checkout is on it\)/);
        expect(listed.said).not.toMatch(/● other \(current/);

        stdout.length = 0;
        const pruned = await run(["db", "branch", "prune", "--older-than", "0d", "--yes"]);
        expect(pruned.code, pruned.said).toBe(0);
        expect(pruned.said).toContain("mine — this checkout is switched to it, so it is kept");
        expect(pruned.said).toContain("rebase db branch switch --off");
        expect(pruned.said).toMatch(/● other — 0 days old; branch and database will be dropped/);
        const left = await databases();
        expect(left).toContain("rb_mine");
        expect(left).not.toContain("rb_other");
    }, 60_000);

    describe("a forced create stopped part-way", () => {
        /**
         * A source big enough that its copy lasts long enough to signal in
         * the middle of: ~100 MB, about a second.
         */
        const SOURCE = "big";

        beforeAll(async () => {
            await admin.query(`CREATE DATABASE "${SOURCE}"`);
            const filler = new pg.Client({ connectionString: urlFor(SOURCE) });
            await filler.connect();
            await filler.query("CREATE TABLE filler AS SELECT g AS id, repeat(md5(g::text), 30) AS pad FROM generate_series(1, 100000) g");
            await filler.end();
        }, 120_000);

        const allowsConnections = async (database: string): Promise<boolean> =>
            (await admin.query<{ datallowconn: boolean }>("SELECT datallowconn FROM pg_database WHERE datname = $1", [database]))
                .rows[0].datallowconn;

        /** The forced create, as its own Node process from source — one process, so a signal reaches it and not a relay. */
        function spawnForcedCreate(name: string) {
            const loader = resolveTsxLoader();
            if (!loader) throw new Error("tsx's loader did not resolve");
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(process.env)) {
                if (value !== undefined && !/^(npm_|pnpm_)|^VITEST/i.test(key)) env[key] = value;
            }
            Object.assign(env, {
                DATABASE_URL: urlFor(SOURCE),
                // `@rebasepro/*` from this checkout's source, as the vitest aliases do.
                TSX_TSCONFIG_PATH: path.resolve(pkgRoot, "../../tsconfig.typecheck.json")
            });
            return execa(process.execPath, ["--import", loader, path.join(pkgRoot, "src/cli.ts"), "db", "branch", "create", name, "--force"], {
                cwd: workDir, env, reject: false, all: true
            });
        }

        /** Until Postgres is copying `SOURCE` into `rb_<name>` — mid-copy, with the source closed. */
        async function untilCopying(name: string): Promise<void> {
            const deadline = Date.now() + 60_000;
            for (;;) {
                const copying = await admin.query(
                    "SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND query = $1",
                    [`CREATE DATABASE "rb_${name}" TEMPLATE "${SOURCE}"`]
                );
                if (copying.rows.length > 0) return;
                if (Date.now() > deadline) throw new Error(`the copy into rb_${name} never started`);
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }

        /** Until no copy is running: Postgres finishes one whose client is gone. */
        async function untilNoCopy(): Promise<void> {
            await vi.waitFor(async () => {
                const copying = await admin.query("SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND query LIKE 'CREATE DATABASE%'");
                expect(copying.rows).toHaveLength(0);
            }, { timeout: 60_000, interval: 50 });
        }

        it("a SIGHUP mid-copy opens the source again before the process ends", async () => {
            const child = spawnForcedCreate("hup");
            await untilCopying("hup");
            expect(await allowsConnections(SOURCE)).toBe(false);

            child.kill("SIGHUP");
            const ended = await child;

            // Ended by the signal it was sent, re-raised once the source was open.
            expect(ended.signal, ended.all).toBe("SIGHUP");
            expect(await allowsConnections(SOURCE)).toBe(true);
            const client = new pg.Client({ connectionString: urlFor(SOURCE) });
            await client.connect();
            await client.end();
            await untilNoCopy();
        }, 120_000);

        it("after a SIGKILL mid-copy, the next branch command opens the source again and says why", async () => {
            const child = spawnForcedCreate("killed");
            await untilCopying("killed");
            child.kill("SIGKILL");
            await child;
            await untilNoCopy();
            // Nothing can catch a SIGKILL: the source is left closed.
            expect(await allowsConnections(SOURCE)).toBe(false);

            process.env.DATABASE_URL = urlFor(SOURCE);
            const listed = await run(["db", "branch", "list"]);

            expect(listed.code, listed.said).toBe(0);
            expect(listed.said).toContain(`"${SOURCE}" was refusing every connection — an interrupted \`rebase db branch create --force\` had closed it for the copy. It is open again.`);
            expect(await allowsConnections(SOURCE)).toBe(true);

            // Said once, for a database that was closed, and never otherwise.
            stdout.length = 0;
            stderr.length = 0;
            const again = await run(["db", "branch", "list"]);
            expect(again.code, again.said).toBe(0);
            expect(again.said).not.toContain("was refusing every connection");
        }, 120_000);

        it("a forced create opens a source it found closed, and leaves no signal handler behind", async () => {
            await admin.query(`ALTER DATABASE "${SOURCE}" ALLOW_CONNECTIONS false`);
            const before = Object.fromEntries((["SIGHUP", "SIGINT", "SIGTERM", "SIGQUIT"] as const).map((s) => [s, process.listenerCount(s)]));
            const pool = new pg.Pool({ connectionString: container.connectionString, max: 3 });
            const poolManager = new DatabasePoolManager(container.connectionString);
            try {
                // The service itself, past the CLI's own reopening, as a run
                // whose source was closed by a killed one meets it.
                const service = new BranchService(drizzle(pool), poolManager);
                await service.ensureBranchMetadataTable();
                await service.createBranch("from_closed", { source: SOURCE, force: true });
            } finally {
                await poolManager.shutdown();
                await pool.end();
            }

            expect(await databases()).toContain("rb_from_closed");
            expect(await allowsConnections(SOURCE)).toBe(true);
            const after = Object.fromEntries((["SIGHUP", "SIGINT", "SIGTERM", "SIGQUIT"] as const).map((s) => [s, process.listenerCount(s)]));
            expect(after).toEqual(before);
        }, 120_000);

        /**
         * The lock a forced create holds on its source from close to reopen:
         * `BranchService`'s `COPY_LOCK_CLASS`, keyed by the source's name, in
         * the `postgres` database.
         */
        const COPY_LOCK = "SELECT pg_advisory_lock(1380074289, hashtext($1))";

        /** A client in `postgres` holding the copy lock on `SOURCE`, as a live forced create does. */
        async function holdingTheCopyLock(): Promise<pg.Client> {
            const holder = new pg.Client({ connectionString: urlFor("postgres") });
            await holder.connect();
            await holder.query(COPY_LOCK, [SOURCE]);
            return holder;
        }

        // The self-heal every branch command runs opened a source a live
        // forced create had just closed, in the settle before its copy starts,
        // and the copy then failed on the clients that came back.
        it("the self-heal leaves a source a live forced create holds closed, and opens it once released", async () => {
            const holder = await holdingTheCopyLock();
            await admin.query(`ALTER DATABASE "${SOURCE}" ALLOW_CONNECTIONS false`);
            try {
                expect(await reopenClosedDatabases(urlFor(SOURCE))).toEqual({ reopened: [], failed: [] });
                expect(await allowsConnections(SOURCE)).toBe(false);
            } finally {
                await holder.end();
            }

            expect(await reopenClosedDatabases(urlFor(SOURCE))).toEqual({ reopened: [SOURCE], failed: [] });
            expect(await allowsConnections(SOURCE)).toBe(true);
        }, 60_000);

        // A second forced create on the same source found it closed by the
        // first, copied beside it, and opened it under it.
        it("a forced create waits for another to finish with the source before it closes it", async () => {
            const holder = await holdingTheCopyLock();
            const pool = new pg.Pool({ connectionString: container.connectionString, max: 3 });
            const poolManager = new DatabasePoolManager(container.connectionString);
            let created: Promise<unknown> | undefined;
            try {
                const service = new BranchService(drizzle(pool), poolManager);
                await service.ensureBranchMetadataTable();
                const creating = service.createBranch("waited", { source: SOURCE, force: true });
                created = creating;
                creating.catch(() => undefined);
                await new Promise((resolve) => setTimeout(resolve, 750));

                expect(await allowsConnections(SOURCE)).toBe(true);
                expect(await databases()).not.toContain("rb_waited");

                await holder.end();
                await created;
            } finally {
                await holder.end().catch(() => undefined);
                await created?.catch(() => undefined);
                await poolManager.shutdown();
                await pool.end();
            }

            expect(await databases()).toContain("rb_waited");
            expect(await allowsConnections(SOURCE)).toBe(true);
            const locks = await admin.query("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 1380074289");
            expect(locks.rows).toHaveLength(0);
        }, 120_000);

        it("the connection banner names the command and the statement that open a closed database", async () => {
            await admin.query(`ALTER DATABASE "${SOURCE}" ALLOW_CONNECTIONS false`);
            try {
                const probe = new pg.Client({ connectionString: urlFor(SOURCE) });
                probe.on("error", () => undefined);
                const refused = await probe.connect().then(() => null, (error: unknown) => error);
                expect(refused).not.toBeNull();
                const banner = diagnoseDbError(refused, urlFor(SOURCE)) ?? "";
                expect(banner).toContain(`Database "${SOURCE}" at`);
                expect(banner).toContain("is closed to new connections");
                expect(banner).toContain("rebase db branch list");
                expect(banner).toContain(`ALTER DATABASE "${SOURCE}" ALLOW_CONNECTIONS true;`);

                // And the check every driver command runs first stops on it, saying the same.
                await expect(checkDatabaseConnectivity(urlFor(SOURCE))).rejects.toThrow(Exited);
                const said = stderr.join("\n");
                expect(said).toContain("rebase db branch list");
                expect(said).toContain(`ALTER DATABASE "${SOURCE}" ALLOW_CONNECTIONS true;`);
            } finally {
                await admin.query(`ALTER DATABASE "${SOURCE}" ALLOW_CONNECTIONS true`);
            }
        }, 60_000);
    });
});
