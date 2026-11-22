/**
 * E2E: a deploy that starts several instances at once applies each
 * `backend/sql` file once.
 *
 * A deploy boots every replica of the new revision together, against one
 * database, and every one of them provisions. The files are written to be run
 * again (`CREATE OR REPLACE`), but "run again" and "run at the same time" are
 * different claims: `CREATE TABLE IF NOT EXISTS` in two sessions at once is a
 * duplicate key on a catalogue index for the loser, and a file with an
 * `INSERT` would insert once per instance. So the files here are deliberately
 * the kind that break when run concurrently, and each instance is its own
 * bootstrapper on its own pool, the way separate pods are.
 *
 * Requires Docker.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { createServer } from "node:http";
import { Hono } from "hono";
import { col, defineTable } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper } from "../../src/PostgresBootstrapper.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { applySqlFiles, closeAppClients } from "../../src/cli-helpers.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";

const INSTANCES = 6;

let container: PgContainer;
let admin: pg.Client;
let sqlDir: string;
let database = 0;
const connections: ReturnType<typeof createPostgresDatabaseConnection>[] = [];

/** A fresh database per test, so each starts with no ledger. */
async function freshDatabase(): Promise<string> {
    const name = `sql_files_${++database}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(container.connectionString);
    url.pathname = `/${name}`;
    return url.toString();
}

/** One instance: its own pool and its own bootstrapper, as a pod has. */
function instance(url: string, dir: string | null = sqlDir) {
    const conn = createPostgresDatabaseConnection(url);
    connections.push(conn);
    return createPostgresBootstrapper({ connectionString: url, connection: conn.db, sqlDir: dir ?? undefined });
}

function write(name: string, sql: string): void {
    fs.writeFileSync(path.join(sqlDir, name), sql, "utf8");
}

/** Counts each time a file ran: an INSERT that a second run would repeat. */
const RUN_LOG = `
CREATE TABLE IF NOT EXISTS public.sql_runs (file text NOT NULL, at timestamptz NOT NULL DEFAULT now());
`;

beforeAll(async () => {
    container = await startPgContainer();
    admin = new pg.Client({ connectionString: container.connectionString });
    await admin.connect();
}, 120_000);

afterAll(async () => {
    await closeAppClients();
    await Promise.all(connections.map(conn => conn.pool.end().catch(() => undefined)));
    await admin?.end().catch(() => undefined);
    if (container) await stopPgContainer(container.containerName);
});

beforeEach(() => {
    sqlDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sql-files-boot-"));
});

describe("several instances booting at once", () => {
    it("apply each file once, and none of them fails", async () => {
        const url = await freshDatabase();
        write("010_runs.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('010');`);
        write("020_fn.sql", `
            CREATE OR REPLACE FUNCTION public.slugify(t text) RETURNS text
                LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(t, '[^a-zA-Z0-9]+', '-', 'g')) $$;
            INSERT INTO public.sql_runs (file) VALUES ('020');
        `);
        write("_draft.sql", "this is not SQL and is never run");

        const outcomes = await Promise.all(
            Array.from({ length: INSTANCES }, () => instance(url).ensureSqlFiles!(undefined))
        );

        const check = new pg.Client({ connectionString: url });
        await check.connect();
        try {
            const runs = await check.query<{ file: string; n: string }>(
                "SELECT file, count(*) AS n FROM public.sql_runs GROUP BY file ORDER BY file"
            );
            expect(runs.rows).toEqual([{ file: "010", n: "1" }, { file: "020", n: "1" }]);
            expect((await check.query("SELECT public.slugify('Hello World') AS s")).rows[0].s).toBe("hello-world");
            const ledger = await check.query<{ name: string }>("SELECT name FROM rebase.sql_files ORDER BY name");
            expect(ledger.rows.map(row => row.name)).toEqual(["010_runs.sql", "020_fn.sql"]);
        } finally {
            await check.end();
        }

        // Between them they ran each file exactly once; the rest found it done.
        const ran = outcomes.flatMap(outcome => outcome.applied).sort();
        expect(ran).toEqual(["010_runs.sql", "020_fn.sql"]);
        for (const outcome of outcomes) {
            expect([...outcome.applied, ...outcome.unchanged].sort()).toEqual(["010_runs.sql", "020_fn.sql"]);
        }
    }, 60_000);

    it("re-apply a changed file once, and leave the unchanged one alone", async () => {
        const url = await freshDatabase();
        write("010_runs.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('010');`);
        write("020_v.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('020 v1');`);
        await instance(url).ensureSqlFiles!(undefined);

        write("020_v.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('020 v2');`);
        const outcomes = await Promise.all(
            Array.from({ length: INSTANCES }, () => instance(url).ensureSqlFiles!(undefined))
        );
        expect(outcomes.flatMap(outcome => outcome.applied)).toEqual(["020_v.sql"]);

        const check = new pg.Client({ connectionString: url });
        await check.connect();
        try {
            const runs = await check.query<{ file: string }>("SELECT file FROM public.sql_runs ORDER BY file");
            expect(runs.rows.map(row => row.file)).toEqual(["010", "020 v1", "020 v2"]);
        } finally {
            await check.end();
        }
    }, 60_000);

    it("fail, naming the file, with it rolled back and the files before it kept", async () => {
        const url = await freshDatabase();
        write("010_ok.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('010');`);
        write("020_bad.sql", `
            CREATE TABLE public.half_done (id int);
            SELECT no_such_function();
        `);
        write("030_never.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('030');`);

        const results = await Promise.allSettled(
            Array.from({ length: 3 }, () => instance(url).ensureSqlFiles!(undefined))
        );
        for (const result of results) {
            expect(result.status).toBe("rejected");
            if (result.status === "rejected") {
                expect(String(result.reason)).toMatch(/backend\/sql\/020_bad\.sql failed, and was rolled back: .*no_such_function/);
            }
        }

        const check = new pg.Client({ connectionString: url });
        await check.connect();
        try {
            expect((await check.query("SELECT to_regclass('public.half_done') AS t")).rows[0].t).toBeNull();
            expect((await check.query("SELECT file FROM public.sql_runs")).rows).toEqual([{ file: "010" }]);
            const ledger = await check.query<{ name: string }>("SELECT name FROM rebase.sql_files ORDER BY name");
            expect(ledger.rows.map(row => row.name)).toEqual(["010_ok.sql"]);
        } finally {
            await check.end();
        }
    }, 60_000);

    it("wait for a file slower than the pool's statement budget instead of failing behind it", async () => {
        const url = await freshDatabase();
        write("010_slow.sql", `${RUN_LOG}SELECT pg_sleep(2); INSERT INTO public.sql_runs (file) VALUES ('010');`);
        // A pool whose requests get one second, as a request would: the file
        // runs for two, and the instances queued on the lock wait longer still.
        const slowPoolInstance = () => {
            const conn = createPostgresDatabaseConnection(url, undefined, { statementTimeout: 1_000, queryTimeout: 1_500 });
            connections.push(conn);
            return createPostgresBootstrapper({ connectionString: url, connection: conn.db, sqlDir });
        };
        const outcomes = await Promise.all(Array.from({ length: 3 }, () => slowPoolInstance().ensureSqlFiles!(undefined)));
        expect(outcomes.flatMap(outcome => outcome.applied)).toEqual(["010_slow.sql"]);
    }, 60_000);

    it("share the lock and the ledger with `rebase db push`", async () => {
        const url = await freshDatabase();
        write("010_runs.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('010');`);

        const [pushed, ...booted] = await Promise.all([
            applySqlFiles(url, sqlDir),
            ...Array.from({ length: 3 }, () => instance(url).ensureSqlFiles!(undefined))
        ]);
        const ran = [...pushed.apply.map(file => file.name), ...booted.flatMap(outcome => outcome.applied)];
        expect(ran).toEqual(["010_runs.sql"]);

        const check = new pg.Client({ connectionString: url });
        await check.connect();
        try {
            expect((await check.query("SELECT count(*)::int AS n FROM public.sql_runs")).rows[0].n).toBe(1);
        } finally {
            await check.end();
        }
    }, 60_000);

    it("prefer the directory the boot hands over to the adapter's own, and do nothing with neither", async () => {
        const url = await freshDatabase();
        write("010_runs.sql", `${RUN_LOG}INSERT INTO public.sql_runs (file) VALUES ('010');`);

        expect(await instance(url, null).ensureSqlFiles!(undefined)).toEqual({ applied: [], unchanged: [], removed: [] });
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sql-files-empty-"));
        expect((await instance(url, empty).ensureSqlFiles!(sqlDir)).applied).toEqual(["010_runs.sql"]);
    }, 60_000);
});

/**
 * The whole boot, as a deploy runs it: the tables, auth, the files, the
 * policies. The file calls `rebase.uid()` (so it must run after auth) and
 * defines the function a policy calls (so it must run before the policies,
 * whose `CREATE POLICY` validates it), and adds a CHECK to a declared table
 * (so it must run after the tables). Wrong in any direction, the boot fails.
 */
describe("a provisioning boot", () => {
    const notes = defineTable("notes", {
        columns: { id: col.serial().primaryKey(), body: col.text() },
        rls: [
            { operation: "select", access: "public" },
            { operation: "select", mode: "restrictive", using: "public.note_visible({body})" }
        ]
    });

    async function boot(url: string, options: { sqlDir?: string; adapterSqlDir?: string; provisionSchema?: boolean } = {}) {
        const conn = createPostgresDatabaseConnection(url);
        connections.push(conn);
        const backend = await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            tables: [notes],
            provisionSchema: options.provisionSchema ?? true,
            sqlDir: options.sqlDir,
            database: createPostgresAdapter({ connection: conn.db, connectionString: url, sqlDir: options.adapterSqlDir }),
            auth: { jwtSecret: "sql-files-boot-e2e-secret-long-enough-0123456", serviceKey: "sql-files-boot-e2e-service-key-0123456789abcd" }
        });
        await backend.shutdown(1_000).catch(() => undefined);
        _resetRebaseMock();
    }

    function writeProjectSql(): void {
        write("010_notes.sql", `
            CREATE OR REPLACE FUNCTION public.note_visible(body text) RETURNS boolean
                LANGUAGE sql STABLE AS $$ SELECT body IS DISTINCT FROM 'hidden' $$;
            CREATE OR REPLACE FUNCTION public.current_uid() RETURNS text
                LANGUAGE sql STABLE AS $$ SELECT rebase.uid()::text $$;
            ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_body_short;
            ALTER TABLE public.notes ADD CONSTRAINT notes_body_short CHECK (length(body) <= 20);
        `);
    }

    it("applies backend/sql after the tables and auth and before the policies, and not again on the next boot", async () => {
        process.env.NODE_ENV = "test";
        const url = await freshDatabase();
        writeProjectSql();
        await boot(url, { sqlDir });

        const check = new pg.Client({ connectionString: url });
        await check.connect();
        try {
            // After ONE boot: a policy step that ran before the file would have
            // been refused (the function did not exist yet) and logged, not
            // thrown — and a second boot would hide that by creating it then.
            const policies = await check.query<{ qual: string }>(
                "SELECT qual FROM pg_policies WHERE tablename = 'notes' AND permissive = 'RESTRICTIVE'"
            );
            expect(policies.rows[0]?.qual).toContain("note_visible");
            await expect(check.query("INSERT INTO public.notes (body) VALUES ('far too long to be allowed here')"))
                .rejects.toThrow(/notes_body_short/);
            const ledger = async () => (await check.query<{ name: string; applied_at: Date }>(
                "SELECT name, applied_at FROM rebase.sql_files"
            )).rows;
            const first = await ledger();
            expect(first.map(row => row.name)).toEqual(["010_notes.sql"]);

            await boot(url, { sqlDir });
            expect(await ledger()).toEqual(first);
        } finally {
            await check.end();
        }
    }, 120_000);

    it("reads the adapter's sqlDir when the boot names none (library mode)", async () => {
        process.env.NODE_ENV = "test";
        const url = await freshDatabase();
        writeProjectSql();
        await boot(url, { adapterSqlDir: sqlDir });

        const check = new pg.Client({ connectionString: url });
        await check.connect();
        try {
            expect((await check.query("SELECT name FROM rebase.sql_files")).rows).toEqual([{ name: "010_notes.sql" }]);
        } finally {
            await check.end();
        }
    }, 120_000);

    it("fails the boot when a file fails, naming it", async () => {
        process.env.NODE_ENV = "test";
        const url = await freshDatabase();
        write("010_broken.sql", "CREATE FUNCTION public.broken( RETURNS int;");
        await expect(boot(url, { sqlDir })).rejects.toThrow(/backend\/sql\/010_broken\.sql failed/);
        _resetRebaseMock();
    }, 120_000);
});
