/**
 * E2E: `openRebase` opens a project's data from a script — reads and writes,
 * a user's view under row-level security, `close()` — and changes nothing in
 * the database by opening it. A write to a `history: true` collection is
 * audited as a server write is, or refused where it could not be.
 *
 * Opening a driver used to mean the server's boot in miniature: it created the
 * restricted role requests run as, the branch-metadata table, channel-history
 * tables and change-capture triggers, read `DATABASE_READ_URL` and `REALTIME_*`
 * from the environment, and could open a `LISTEN` connection. A REPL pointed at
 * a production database had no business doing any of that.
 *
 * Imported from the package entry, the way a script would.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";
import { logger } from "@rebasepro/server";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { consoleCommand } from "../../src/cli-console.js";
import { HistoryService } from "../../src/history/HistoryService.js";

const notesCollection: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" },
        { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        title: { name: "Title", type: "string" }
    }
};

/** An audited collection: every write leaves an entry in `rebase.entity_history`. */
const ledgerCollection: CollectionConfig = {
    name: "Ledger",
    slug: "ledger",
    table: "ledger",
    history: true,
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" },
        { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        amount: { name: "Amount", type: "number" }
    }
};

/**
 * What a server boot does to a fresh database: the collections' tables, the
 * RLS runtime and policies, the restricted role — and, with `history`, the
 * history table and its function.
 */
async function provision(url: string, collections: CollectionConfig[], options: { history: boolean }): Promise<void> {
    const conn = createPostgresDatabaseConnection(url);
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
        const driverResult = await bootstrapper.initializeDriver({
            collections,
            realtime: { subscribe: false, provision: false }
        });
        await bootstrapper.ensureCollectionSchema!(collections, driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await bootstrapper.ensureCollectionPolicies!(collections, driverResult);
        await bootstrapper.finalizeSecurityPosture!(driverResult);
        if (options.history) await bootstrapper.initializeHistory!(true, driverResult);
    } finally {
        await conn.pool.end();
    }
}

/** Connections from openRebase's own pool carry this name, so they can be counted. */
const APP_NAME = "open-rebase-e2e";

/** Everything opening could have created: tables, roles, functions, triggers, schemas. */
async function catalogue(client: pg.Client): Promise<Record<string, string[]>> {
    const list = async (query: string) => (await client.query<{ name: string }>(query)).rows.map(r => r.name).sort();
    return {
        tables: await list("SELECT schemaname || '.' || tablename AS name FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"),
        roles: await list("SELECT rolname AS name FROM pg_roles"),
        schemas: await list("SELECT nspname AS name FROM pg_namespace"),
        functions: await list("SELECT n.nspname || '.' || p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')"),
        triggers: await list("SELECT tgrelid::regclass::text || '.' || tgname AS name FROM pg_trigger WHERE NOT tgisinternal")
    };
}

async function connectionsFromOpenRebase(client: pg.Client): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1", [APP_NAME]
    );
    return rows[0].n;
}

/** The connection string for database `name` in the container, tagged with {@link APP_NAME}. */
function urlFor(container: PgContainer, name: string, appName?: string): string {
    const url = new URL(container.connectionString);
    url.pathname = `/${name}`;
    if (appName) url.searchParams.set("application_name", appName);
    return url.toString();
}

describe("openRebase (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        );
        const setup = new pg.Client({ connectionString: container.connectionString });
        await setup.connect();
        await setup.query("CREATE DATABASE untouched");
        await setup.query("CREATE DATABASE app");
        await setup.query("CREATE DATABASE unaudited");
        await setup.end();
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await observer?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    describe("on a database no server has booted on", () => {
        let client: pg.Client;

        beforeAll(async () => {
            client = new pg.Client({ connectionString: urlFor(container, "untouched") });
            await client.connect();
            // A table with row-level security on and no Rebase anything around it.
            await client.query("CREATE TABLE public.notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, title text)");
            await client.query("ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY");
            await client.query("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'first')");
        });

        afterAll(async () => {
            await client?.end().catch(() => {});
        });

        it("creates nothing — no role, no schema, no function, no table, no trigger", async () => {
            const before = await catalogue(client);
            expect(before.roles).not.toContain("rebase_user");

            const rebase = await openRebase({ databaseUrl: urlFor(container, "untouched"), collections: [notesCollection] });
            try {
                expect(await rebase.sql("SELECT title FROM public.notes")).toEqual([{ title: "first" }]);
            } finally {
                await rebase.close();
            }

            expect(await catalogue(client)).toEqual(before);
        });

        it("reads no environment variable — a server's settings in the shell change nothing", async () => {
            // Each of these, read, would install capture triggers, dial a
            // replica that does not exist, or refuse to open over a number.
            vi.stubEnv("REALTIME_CDC", "trigger");
            vi.stubEnv("REALTIME_CHANNEL_BUS", "postgres");
            vi.stubEnv("DATABASE_READ_URL", "postgresql://nobody@127.0.0.1:1/nowhere");
            vi.stubEnv("REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET", "not-a-number");
            vi.stubEnv("REBASE_DB_POOL_MAX", "1");
            try {
                const before = await catalogue(client);
                const rebase = await openRebase({ databaseUrl: urlFor(container, "untouched"), collections: [notesCollection] });
                try {
                    expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes")).toEqual([{ n: 1 }]);
                } finally {
                    await rebase.close();
                }
                expect(await catalogue(client)).toEqual(before);
            } finally {
                vi.unstubAllEnvs();
            }
        });

        it("the hooks a boot runs after opening honour provision: false too — auth, history, the final posture", async () => {
            const before = await catalogue(client);
            const url = urlFor(container, "untouched");
            const conn = createPostgresDatabaseConnection(url);
            try {
                const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
                const driverResult = await bootstrapper.initializeDriver({
                    collections: [notesCollection],
                    provision: false,
                    realtime: false
                });
                const auth = await bootstrapper.initializeAuth!({}, driverResult);
                expect(auth?.userService).toBeDefined();
                const history = await bootstrapper.initializeHistory!(true, driverResult);
                // Attached, and refusing writes to audited collections up
                // front: there is no table to record into, and none is made.
                const service = history?.historyService;
                expect(service).toBeInstanceOf(HistoryService);
                if (service instanceof HistoryService) {
                    expect(() => service.assertRecordable("notes")).toThrow(/rebase\.entity_history table/);
                }
                await bootstrapper.finalizeSecurityPosture!(driverResult);
            } finally {
                await conn.pool.end();
            }
            expect(await catalogue(client)).toEqual(before);
        });

        it("refuses a user's request rather than run it with no policy applied", async () => {
            // The connection is a superuser, which bypasses row-level security,
            // and the restricted role it would switch to was never created.
            const rebase = await openRebase({ databaseUrl: urlFor(container, "untouched"), collections: [notesCollection] });
            try {
                const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
                await expect(ada.data.notes.find()).rejects.toThrow();
                const bob = await rebase.withAuth({ uid: "bob", roles: ["user"] });
                await expect(bob.data.notes.find()).rejects.toThrow();
            } finally {
                await rebase.close();
            }
        });
    });

    describe("on a database a server has provisioned", () => {
        let rebase: OpenedRebase;
        let before: Record<string, string[]>;

        beforeAll(async () => {
            const url = urlFor(container, "app");
            await provision(url, [notesCollection, ledgerCollection], { history: true });

            observer = new pg.Client({ connectionString: url });
            await observer.connect();
            before = await catalogue(observer);
            rebase = await openRebase({ databaseUrl: urlFor(container, "app", APP_NAME), collections: [notesCollection, ledgerCollection] });
        }, 120_000);

        afterAll(async () => {
            await rebase?.close();
        });

        it("writes and reads through dataAsAdmin, and runs SQL with params", async () => {
            const ada = await rebase.dataAsAdmin.notes.create({ ownerId: "ada", title: "ada's" });
            await rebase.dataAsAdmin.notes.create({ ownerId: "bob", title: "bob's" });
            expect(ada).toMatchObject({ ownerId: "ada", title: "ada's" });

            const all = await rebase.dataAsAdmin.notes.find();
            expect(all.data.map(row => row.title).sort()).toEqual(["ada's", "bob's"]);

            expect(await rebase.sql("SELECT title FROM public.notes WHERE owner_id = $1", { params: ["bob"] }))
                .toEqual([{ title: "bob's" }]);
        });

        it("withAuth sees and writes only what the user's policies allow", async () => {
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const mine = await ada.data.notes.find();
            expect(mine.data.map(row => row.title)).toEqual(["ada's"]);

            await expect(ada.data.notes.create({ ownerId: "bob", title: "forged" })).rejects.toThrow();
            expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title = 'forged'"))
                .toEqual([{ n: 0 }]);
        });

        it("records history for dataAsAdmin and withAuth writes, as a server write would, with who made them", async () => {
            const entries = async () => (await observer.query<{ entity_id: string; action: string; updated_by: string }>(
                "SELECT entity_id, action, updated_by FROM rebase.entity_history WHERE table_name = 'ledger' ORDER BY updated_at, action"
            )).rows;

            const byAdmin = await rebase.dataAsAdmin.ledger.create({ ownerId: "bob", amount: 10 });
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const byAda = await ada.data.ledger.create({ ownerId: "ada", amount: 5 });
            await ada.data.ledger.update(String(byAda.id), { amount: 7 });
            const gone = await ada.data.ledger.create({ ownerId: "ada", amount: 1 });
            await ada.data.ledger.delete(String(gone.id));

            const recorded = [
                { entity_id: String(byAdmin.id), action: "create", updated_by: "service" },
                { entity_id: String(byAda.id), action: "create", updated_by: "ada" },
                { entity_id: String(byAda.id), action: "update", updated_by: "ada" },
                { entity_id: String(gone.id), action: "create", updated_by: "ada" },
                { entity_id: String(gone.id), action: "delete", updated_by: "ada" }
            ];
            expect(await entries()).toEqual(recorded);

            // On the write's transaction: a batch that fails on its second
            // row — Bob's, which Ada's policy refuses — leaves neither row nor
            // the first row's entry.
            await expect(ada.data.ledger.createMany([
                { ownerId: "ada", amount: 1 },
                { ownerId: "bob", amount: 2 }
            ])).rejects.toThrow();
            expect(await entries()).toEqual(recorded);
            expect(await rebase.sql("SELECT count(*)::int AS n FROM public.ledger")).toEqual([{ n: 2 }]);
        });

        it("prunes nothing — the retention is the server's setting, which a script does not know", async () => {
            // An entry older than the default retention (90 days), which a
            // server configured to keep a year of history still holds.
            const row = await rebase.dataAsAdmin.ledger.create({ ownerId: "bob", amount: 1 });
            await observer.query(
                "UPDATE rebase.entity_history SET updated_at = now() - interval '200 days' WHERE table_name = 'ledger' AND entity_id = $1",
                [String(row.id)]
            );
            await rebase.dataAsAdmin.ledger.update(String(row.id), { amount: 2 });
            // A prune runs after the write returns, unawaited: give one the time to land.
            await new Promise(resolve => setTimeout(resolve, 500));
            const { rows } = await observer.query<{ action: string }>(
                "SELECT action FROM rebase.entity_history WHERE table_name = 'ledger' AND entity_id = $1 ORDER BY updated_at",
                [String(row.id)]
            );
            expect(rows.map(entry => entry.action)).toEqual(["create", "update"]);
        });

        it("refuses writes where entries could not ride the write's transaction — the function is missing", async () => {
            const signature = "rebase.record_history(text, text, text, text[], jsonb, jsonb, text, smallint)";
            await observer.query(`ALTER FUNCTION ${signature} RENAME TO record_history_hidden`);
            const unready = await openRebase({ databaseUrl: urlFor(container, "app"), collections: [notesCollection, ledgerCollection] });
            try {
                await expect(unready.dataAsAdmin.ledger.create({ ownerId: "bob", amount: 1 }))
                    .rejects.toMatchObject({ code: "HISTORY_UNAVAILABLE", message: expect.stringMatching(/rebase\.record_history function/) });
                // Only the audited collection is refused.
                await expect(unready.dataAsAdmin.notes.find()).resolves.toBeDefined();
                await expect(unready.dataAsAdmin.ledger.find()).resolves.toBeDefined();
            } finally {
                await unready.close();
                await observer.query("ALTER FUNCTION rebase.record_history_hidden(text, text, text, text[], jsonb, jsonb, text, smallint) RENAME TO record_history");
            }
        });

        it("finalizeSecurityPosture grants nothing after a provision: false open", async () => {
            // A privilege a provisioning boot would hand back, taken away.
            await observer.query("REVOKE SELECT ON public.notes FROM rebase_user");
            const url = urlFor(container, "app");
            const conn = createPostgresDatabaseConnection(url);
            try {
                const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
                const driverResult = await bootstrapper.initializeDriver({
                    collections: [notesCollection],
                    provision: false,
                    realtime: false
                });
                await bootstrapper.finalizeSecurityPosture!(driverResult);
                const { rows } = await observer.query<{ granted: boolean }>(
                    "SELECT has_table_privilege('rebase_user', 'public.notes', 'SELECT') AS granted"
                );
                expect(rows[0].granted).toBe(false);
            } finally {
                await conn.pool.end();
                await observer.query("GRANT SELECT ON public.notes TO rebase_user");
            }
        });

        it("leaves the connection's posture for the server boot to announce at info; openRebase logs it at debug", async () => {
            const info = vi.spyOn(logger, "info");
            const debug = vi.spyOn(logger, "debug");
            const posture = (spy: typeof info) => spy.mock.calls.filter(([message]) => /RLS enforcement/.test(String(message)));
            const url = urlFor(container, "app");
            try {
                const rebase = await openRebase({ databaseUrl: url, collections: [notesCollection] });
                await rebase.close();
                expect(posture(info)).toEqual([]);
                expect(posture(debug)).toHaveLength(1);

                info.mockClear();
                const conn = createPostgresDatabaseConnection(url);
                try {
                    const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
                    await bootstrapper.initializeDriver({ collections: [notesCollection], provision: false, realtime: false });
                } finally {
                    await conn.pool.end();
                }
                expect(posture(info)).toHaveLength(1);
            } finally {
                info.mockRestore();
                debug.mockRestore();
            }
        });

        it("has created nothing in the database by opening it", async () => {
            expect(await catalogue(observer)).toEqual(before);
        });

        describe("rebase console --eval (the driver's half)", () => {
            let collectionsDir: string;
            /** A project whose one collection keeps history. */
            let auditedDir: string;

            beforeAll(() => {
                // A project's collections directory, loaded by the loader `db push` uses.
                collectionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-console-"));
                fs.writeFileSync(path.join(collectionsDir, "package.json"), JSON.stringify({ type: "module" }));
                fs.writeFileSync(path.join(collectionsDir, "notes.js"), `export default ${JSON.stringify(notesCollection)};\n`);
                auditedDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-console-"));
                fs.writeFileSync(path.join(auditedDir, "package.json"), JSON.stringify({ type: "module" }));
                fs.writeFileSync(path.join(auditedDir, "ledger.js"), `export default ${JSON.stringify(ledgerCollection)};\n`);
            });

            afterAll(() => {
                fs.rmSync(collectionsDir, { recursive: true, force: true });
                fs.rmSync(auditedDir, { recursive: true, force: true });
            });

            /** One `rebase console --eval`, as the driver runs it: exit code and both streams. */
            async function evalInConsole(code: string, dir = collectionsDir): Promise<{ code: number; stdout: string; stderr: string }> {
                const stdout: string[] = [];
                const stderr: string[] = [];
                const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.join(" ")); });
                const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.join(" ")); });
                vi.stubEnv("DATABASE_URL", urlFor(container, "app"));
                vi.stubEnv("LOG_LEVEL", "error");
                try {
                    const exit = await consoleCommand(["console", "--eval", code, "--collections", dir]);
                    return { code: exit, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
                } finally {
                    vi.unstubAllEnvs();
                    log.mockRestore();
                    error.mockRestore();
                }
            }

            it("prints an expression's awaited value as JSON", async () => {
                const result = await evalInConsole("rebase.dataAsAdmin.notes.find()");
                expect(result.code).toBe(0);
                const parsed = JSON.parse(result.stdout) as { data: Array<{ title: string }> };
                expect(parsed.data.map(row => row.title).sort()).toEqual(["ada's", "bob's"]);
            });

            it("runs statements with top-level await, returning the result", async () => {
                const result = await evalInConsole(
                    "const ada = await rebase.withAuth({ uid: 'ada', roles: ['user'] });\n" +
                    "return (await ada.data.notes.find()).data.map(row => row.title);"
                );
                expect(result).toMatchObject({ code: 0 });
                expect(JSON.parse(result.stdout)).toEqual(["ada's"]);
            });

            it("has the project's collections and sql in scope", async () => {
                expect(JSON.parse((await evalInConsole("collections.map(c => c.slug)")).stdout)).toEqual(["notes"]);
                const counted = await evalInConsole("rebase.sql('SELECT count(*)::int AS n FROM public.notes WHERE owner_id = $1', { params: ['ada'] })");
                expect(JSON.parse(counted.stdout)).toEqual([{ n: 1 }]);
            });

            it("says why Postgres refused a query, and not the values it ran with", async () => {
                // Drizzle's own message is `Failed query: …` and a `params:`
                // line; the relation Postgres could not find is in its cause.
                const result = await evalInConsole("rebase.sql('SELECT * FROM nope_table WHERE owner_id = $1', { params: ['s3cret-token'] })");
                expect(result.code).toBe(1);
                expect(result.stdout).toBe("");
                expect(result.stderr.split("\n").slice(0, 2)).toEqual([
                    "relation \"nope_table\" does not exist (42P01)",
                    "  Failed query: SELECT * FROM nope_table WHERE owner_id = $1"
                ]);
                expect(result.stderr).not.toContain("s3cret-token");
            });

            it("records history for a write to an audited collection, as the service", async () => {
                const result = await evalInConsole(
                    "const row = await rebase.dataAsAdmin.ledger.create({ ownerId: 'bob', amount: 4 });\nreturn row.id;",
                    auditedDir
                );
                expect(result).toMatchObject({ code: 0 });
                const { rows } = await observer.query<{ action: string; updated_by: string }>(
                    "SELECT action, updated_by FROM rebase.entity_history WHERE table_name = 'ledger' AND entity_id = $1",
                    [String(JSON.parse(result.stdout))]
                );
                expect(rows).toEqual([{ action: "create", updated_by: "service" }]);
            });

            it("without --eval, is a REPL with rebase in scope and top-level await", async () => {
                const input = new PassThrough();
                const output = new PassThrough();
                const lines = [
                    "const rows = await rebase.sql('SELECT count(*)::int AS n FROM public.notes')",
                    "rows[0].n * 10",
                    ".exit"
                ];
                let transcript = "";
                // One line per prompt, as a person types: a line sent before the
                // previous one's await settles would be evaluated beside it.
                output.on("data", (chunk: Buffer) => {
                    transcript += String(chunk);
                    if (transcript.endsWith("rebase> ") && lines.length > 0) input.write(`${lines.shift()}\n`);
                });
                const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
                vi.stubEnv("DATABASE_URL", urlFor(container, "app"));
                vi.stubEnv("LOG_LEVEL", "error");
                try {
                    const exit = await consoleCommand(["console", "--collections", collectionsDir], { input, output });
                    expect(exit).toBe(0);
                } finally {
                    vi.unstubAllEnvs();
                    log.mockRestore();
                }
                expect(transcript).toContain("20");
                expect(transcript).not.toMatch(/Uncaught/);
            });

            it("with piped input, runs each line after the one before has settled, without colours", async () => {
                // Every line in one write, as `printf '…' | rebase console`
                // delivers them: the second reads what the first awaited.
                const input = new PassThrough();
                const output = new PassThrough();
                let transcript = "";
                output.on("data", (chunk: Buffer) => { transcript += String(chunk); });
                input.end([
                    "const { data } = await rebase.dataAsAdmin.notes.find({ limit: 2 })",
                    "data.length * 7",
                    "const [{ n }] = await rebase.sql('SELECT 6 * 7 AS n')",
                    "n",
                    "notes.missing.property",
                    "'still running'",
                    ".exit",
                    ""
                ].join("\n"));
                const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
                vi.stubEnv("DATABASE_URL", urlFor(container, "app"));
                vi.stubEnv("LOG_LEVEL", "error");
                try {
                    const exit = await consoleCommand(["console", "--collections", collectionsDir], { input, output });
                    expect(exit).toBe(0);
                } finally {
                    vi.unstubAllEnvs();
                    log.mockRestore();
                }
                expect(transcript).toContain("14");
                expect(transcript).toContain("42");
                // An error in one line is that line's answer, and the next still runs.
                expect(transcript.match(/Uncaught/g)).toHaveLength(1);
                expect(transcript).toMatch(/Uncaught ReferenceError: notes is not defined/);
                expect(transcript).toContain("'still running'");
                expect(transcript).not.toContain("\u001b[");
            });

            describe("as the CLI runs it: its own process, the project's .env loaded", () => {
                const packageRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
                let projectDir: string;

                beforeAll(() => {
                    // The scaffold's `.env` sets LOG_LEVEL=info.
                    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-console-cli-"));
                    fs.writeFileSync(path.join(projectDir, ".env"), "LOG_LEVEL=info\n");
                });

                afterAll(() => {
                    fs.rmSync(projectDir, { recursive: true, force: true });
                });

                /** `rebase console …` through the driver's entry point, from source, in the project directory. */
                function runConsole(args: string[], options: { env?: Record<string, string>; stdin?: string } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
                    const env: Record<string, string> = {};
                    for (const [key, value] of Object.entries(process.env)) {
                        if (value !== undefined && !["LOG_LEVEL", "NODE_ENV", "DATABASE_URL", "VITEST", "VITEST_WORKER_ID"].includes(key)) env[key] = value;
                    }
                    Object.assign(env, {
                        DATABASE_URL: urlFor(container, "app"),
                        // `@rebasepro/*` from this checkout's source, as the vitest aliases do.
                        TSX_TSCONFIG_PATH: path.resolve(packageRoot, "../../tsconfig.typecheck.json")
                    }, options.env);
                    return new Promise((resolve, reject) => {
                        // Node itself running tsx's CLI, resolved the way Node resolves
                        // it: this package does not declare tsx (the root does), so a
                        // `node_modules/.bin/tsx` here exists only as a stale shim, and
                        // not at all in a clean install.
                        const child = spawn(
                            process.execPath,
                            [createRequire(import.meta.url).resolve("tsx/cli"), path.join(packageRoot, "src/cli.ts"), "console", "--collections", collectionsDir, ...args],
                            { cwd: projectDir, env, stdio: ["pipe", "pipe", "pipe"] }
                        );
                        let stdout = "";
                        let stderr = "";
                        child.stdout.on("data", (chunk: Buffer) => { stdout += String(chunk); });
                        child.stderr.on("data", (chunk: Buffer) => { stderr += String(chunk); });
                        child.on("error", reject);
                        child.on("close", (code) => resolve({ code, stdout, stderr }));
                        child.stdin.end(options.stdin ?? "");
                    });
                }

                /**
                 * `node <script>` from source, in the project directory, with
                 * the same environment `runConsole` builds.
                 */
                function runScript(source: string, env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
                    const script = path.join(projectDir, `script-${crypto.randomUUID().slice(0, 8)}.mts`);
                    fs.writeFileSync(script, source);
                    const childEnv: Record<string, string> = {};
                    for (const [key, value] of Object.entries(process.env)) {
                        if (value !== undefined && !["LOG_LEVEL", "NODE_ENV", "DATABASE_URL", "VITEST", "VITEST_WORKER_ID"].includes(key)) childEnv[key] = value;
                    }
                    Object.assign(childEnv, {
                        DATABASE_URL: urlFor(container, "app"),
                        TSX_TSCONFIG_PATH: path.resolve(packageRoot, "../../tsconfig.typecheck.json")
                    }, env);
                    return new Promise((resolve, reject) => {
                        const child = spawn(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), script], {
                            cwd: projectDir, env: childEnv, stdio: ["ignore", "pipe", "pipe"]
                        });
                        let stdout = "";
                        let stderr = "";
                        child.stdout.on("data", (chunk: Buffer) => { stdout += String(chunk); });
                        child.stderr.on("data", (chunk: Buffer) => { stderr += String(chunk); });
                        child.on("error", reject);
                        child.on("close", (code) => resolve({ code, stdout, stderr }));
                    });
                }

                /**
                 * `tsx script.ts > out.json` held `ℹ️ [INFO] 🔐 RLS enforcement
                 * active…` before the script's own output: opening announced
                 * the connection's posture at info, which goes to stdout. That
                 * line is the server boot's to print; a script's open logs it
                 * at debug.
                 */
                it("a script that opens the project prints only its own output on stdout, under LOG_LEVEL=info", async () => {
                    const result = await runScript(
                        `import { openRebase } from ${JSON.stringify(path.join(packageRoot, "src/index.ts"))};\n` +
                        `const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL ?? "", collections: ${JSON.stringify([notesCollection])} });\n` +
                        "const [{ n }] = await rebase.sql(\"SELECT count(*)::int AS n FROM public.notes\");\n" +
                        "console.log(JSON.stringify({ n }));\n" +
                        "await rebase.close();\n",
                        { LOG_LEVEL: "info" }
                    );
                    expect(result.code).toBe(0);
                    expect(result.stdout).toMatch(/^\{"n":\d+\}\n$/);
                    expect(result.stdout + result.stderr).not.toMatch(/RLS enforcement/);
                }, 60_000);

                it("--eval prints the result and nothing else on stdout, under LOG_LEVEL=info, and no boot note at all", async () => {
                    const result = await runConsole(["--eval", "rebase.sql('SELECT count(*)::int AS n FROM public.notes')"]);
                    expect(result.code).toBe(0);
                    const parsed = JSON.parse(result.stdout) as Array<{ n: number }>;
                    expect(typeof parsed[0].n).toBe("number");
                    // The connection's posture is the server boot's to announce.
                    expect(result.stderr).not.toMatch(/RLS enforcement/);
                }, 60_000);

                it("--eval keeps stdout to the result under NODE_ENV=production too, where every level is a JSON line", async () => {
                    const result = await runConsole(["--eval", "6 * 7"], { env: { NODE_ENV: "production", LOG_LEVEL: "debug" } });
                    expect(result.code).toBe(0);
                    expect(JSON.parse(result.stdout)).toBe(42);
                    // At debug the posture is still there to read, on stderr.
                    expect(result.stderr).toMatch(/RLS enforcement active/);
                }, 60_000);

                it("piped into the REPL, runs the documented two-line example as typed", async () => {
                    const result = await runConsole([], {
                        stdin: "const { data } = await rebase.dataAsAdmin.notes.find({ limit: 3 })\ndata.map(n => n.ownerId).sort().join('+')\n.exit\n"
                    });
                    expect(result.code).toBe(0);
                    expect(result.stdout).toMatch(/'ada\+bob/);
                    expect(result.stdout).not.toMatch(/Uncaught/);
                    expect(result.stdout).not.toContain("\u001b[");
                    expect(result.stdout).not.toMatch(/\[INFO\]/);
                    // The banner is the console talking about itself: stderr,
                    // so `printf '…' | rebase console > out` holds only answers.
                    expect(result.stdout).not.toContain("rebase console —");
                    expect(result.stdout).not.toContain("Try:");
                    expect(result.stderr).toContain("rebase console —");
                }, 60_000);
            });

            it("exits 1 with the error on stderr, and nothing on stdout, when the code throws", async () => {
                const result = await evalInConsole("rebase.sql('SELECT * FROM no_such_table')");
                expect(result.code).toBe(1);
                expect(result.stdout).toBe("");
                expect(result.stderr).toMatch(/no_such_table/);
            });
        });

        it("close() releases the pool", async () => {
            expect(await connectionsFromOpenRebase(observer)).toBeGreaterThan(0);
            await rebase.close();
            await rebase.close();

            let left = await connectionsFromOpenRebase(observer);
            for (let attempt = 0; left > 0 && attempt < 50; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                left = await connectionsFromOpenRebase(observer);
            }
            expect(left).toBe(0);
            await expect(rebase.dataAsAdmin.notes.find()).rejects.toThrow();
        });
    });

    describe("on a database provisioned without history", () => {
        let rebase: OpenedRebase;
        let unaudited: pg.Client;
        let before: Record<string, string[]>;
        /** Every hook that ran: a refused write must run none. */
        const ran: string[] = [];

        beforeAll(async () => {
            const url = urlFor(container, "unaudited");
            await provision(url, [ledgerCollection], { history: false });
            unaudited = new pg.Client({ connectionString: url });
            await unaudited.connect();
            await unaudited.query("INSERT INTO public.ledger (owner_id, amount) VALUES ('ada', 1)");
            before = await catalogue(unaudited);
            rebase = await openRebase({
                databaseUrl: url,
                collections: [{
                    ...ledgerCollection,
                    callbacks: {
                        beforeSave: ({ values }) => { ran.push("beforeSave"); return values; },
                        afterSave: () => { ran.push("afterSave"); },
                        afterSaveError: () => { ran.push("afterSaveError"); },
                        beforeDelete: () => { ran.push("beforeDelete"); },
                        afterDelete: () => { ran.push("afterDelete"); }
                    }
                }]
            });
        }, 120_000);

        afterAll(async () => {
            await rebase?.close();
            await unaudited?.end().catch(() => {});
        });

        it("refuses a write to an audited collection with HISTORY_UNAVAILABLE, naming what is missing, and writes nothing", async () => {
            const refused = { code: "HISTORY_UNAVAILABLE", message: expect.stringMatching(/history: true[\s\S]*rebase\.entity_history table[\s\S]*provision: true/) };
            await expect(rebase.dataAsAdmin.ledger.create({ ownerId: "bob", amount: 3 })).rejects.toMatchObject(refused);
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const [row] = (await ada.data.ledger.find()).data;
            await expect(ada.data.ledger.create({ ownerId: "ada", amount: 4 })).rejects.toMatchObject(refused);
            await expect(ada.data.ledger.update(String(row.id), { amount: 9 })).rejects.toMatchObject(refused);
            await expect(ada.data.ledger.delete(String(row.id))).rejects.toMatchObject(refused);

            expect((await unaudited.query("SELECT owner_id, amount::int AS amount FROM public.ledger")).rows)
                .toEqual([{ owner_id: "ada", amount: 1 }]);
            expect(ran).toEqual([]);
        });

        it("still reads it, as the service and as a user", async () => {
            expect((await rebase.dataAsAdmin.ledger.find()).data).toHaveLength(1);
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            expect((await ada.data.ledger.find()).data.map(row => row.amount)).toEqual([1]);
        });

        it("has created nothing — no history table, no function", async () => {
            expect(await catalogue(unaudited)).toEqual(before);
            expect(before.tables).not.toContain("rebase.entity_history");
        });
    });
});
