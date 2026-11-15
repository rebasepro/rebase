/**
 * `rebase db pull`'s restore, against a real Postgres in Docker.
 *
 * A pull replaces the local database's contents, and `pg_restore --clean` did
 * not: it drops the objects the dump holds, one by one and without CASCADE, so
 * anything local the source lacks gets in its way. After `rebase db migrate`
 * (which creates `rebase.atlas_schema_revisions`), every pull from a database
 * that had never run it ended in
 *
 *     ERROR:  cannot drop schema rebase because other objects depend on it
 *     ✗ pg_restore could not restore 2 object(s) — the errors are above.
 *       …and pull again.
 *
 * with every row in place, and pulling again failed the same way. A local
 * table referencing a pulled one blocked its DROP TABLE the same way.
 *
 * A pull into a Postgres older than 17 reported a failure with every table and
 * row in place: a pg_dump 17 or newer writes `SET transaction_timeout = 0;` at
 * the top of the dump, which such a server does not know, and pg_restore
 * counted that one statement as an error.
 *
 * Needs Docker and the PostgreSQL client tools. A missing client fails the
 * suite rather than skipping it: a skipped suite reports a pass.
 */
import { execa } from "execa";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dumpArgs, dumpEnv, findPgTool, restoreCopy, type PullPlan } from "./pull";

const container = `${process.env.REBASE_E2E_CONTAINER_PREFIX || "rebase-pull-it-"}${crypto.randomUUID().slice(0, 8)}`;
let base = "";
let work = "";

/** A database's URL on the container, by name. */
const url = (database: string, user = "rebase", password = "rebase") =>
    `postgresql://${user}:${password}@127.0.0.1:${new URL(base).port}/${database}?sslmode=disable`;

/** The same server's URL for another database on it. */
function at(server: string, database: string): string {
    const located = new URL(server);
    located.pathname = `/${database}`;
    return located.toString();
}

async function query(connectionString: string, text: string): Promise<pg.QueryResult> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
        return await client.query(text);
    } finally {
        await client.end();
    }
}

async function sql(database: string, text: string): Promise<pg.QueryResult> {
    return query(url(database), text);
}

/** The major version of the local `pg_dump`. */
async function localClientMajor(): Promise<number> {
    const version = await findPgTool("pg_dump");
    const major = Number(/(\d+)(\.\d+)*\s*(\(|$)/.exec(version ?? "")?.[1] ?? Number.NaN);
    if (!version || !Number.isInteger(major) || !(await findPgTool("pg_restore"))) {
        throw new Error("pg_dump and pg_restore are needed on PATH for this suite (e.g. `brew install libpq`).");
    }
    return major;
}

/** The image whose major the local `pg_dump` can read: a client older than the server refuses it. */
async function imageForLocalClient(): Promise<string> {
    const major = await localClientMajor();
    return major >= 18 ? "postgres:18-alpine" : `postgres:${major}-alpine`;
}

/** Run `image` as `name` on a random local port: the URL of its `rebase` database, once a query answers there. */
async function startPostgres(name: string, image: string): Promise<string> {
    process.once("exit", () => spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" }));
    await execa("docker", [
        "run", "--rm", "-d", "--name", name,
        "-e", "POSTGRES_USER=rebase", "-e", "POSTGRES_PASSWORD=rebase", "-e", "POSTGRES_DB=rebase",
        "-p", "127.0.0.1::5432", image
    ]);
    const { stdout } = await execa("docker", ["port", name, "5432"]);
    const port = /:(\d+)\s*$/m.exec(stdout)?.[1];
    if (!port) throw new Error(`No published port in: ${stdout}`);
    const started = `postgresql://rebase:rebase@127.0.0.1:${port}/rebase?sslmode=disable`;

    // Ready means a query answers, not that the port listens: the image
    // restarts once during initialisation.
    for (let attempt = 0; ; attempt += 1) {
        try {
            await query(started, "SELECT 1");
            return started;
        } catch (error) {
            if (attempt > 60) throw error;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

beforeAll(async () => {
    base = await startPostgres(container, await imageForLocalClient());
    work = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-pull-it-"));
}, 120_000);

afterAll(async () => {
    if (work) fs.rmSync(work, { recursive: true, force: true });
    await execa("docker", ["rm", "-f", "-v", container], { reject: false });
});

/** What a project that has never run `rebase db migrate` holds. */
const SOURCE = `
    CREATE SCHEMA rebase;
    CREATE TABLE rebase.users (id serial PRIMARY KEY, email text UNIQUE NOT NULL);
    CREATE FUNCTION rebase.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TABLE public.posts (id serial PRIMARY KEY, title text, author int REFERENCES rebase.users(id));
    CREATE TRIGGER posts_touch BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION rebase.touch();
    ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY posts_read ON public.posts FOR SELECT USING (true);
    INSERT INTO rebase.users (email) VALUES ('a@example.com'), ('b@example.com');
    INSERT INTO public.posts (title, author) VALUES ('from the source', 1), ('also from the source', 2);
`;

let plan: PullPlan;
let dumpFile: string;

beforeEach(async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const source = `src_${tag}`;
    const target = `dst_${tag}`;
    await sql("rebase", `CREATE DATABASE ${source}`);
    await sql("rebase", `CREATE DATABASE ${target}`);
    await sql(source, SOURCE);

    // The local database: an older copy of the same project, then the things a
    // laptop grows that the source does not have.
    await sql(target, SOURCE.replace("'from the source'", "'stale local row'"));
    await sql(target, `
        CREATE TABLE rebase.atlas_schema_revisions (version text PRIMARY KEY);
        INSERT INTO rebase.atlas_schema_revisions VALUES ('20261014023350');
        CREATE TABLE public.comments (id serial PRIMARY KEY, post int REFERENCES public.posts(id));
        CREATE SCHEMA scratch;
        CREATE TABLE scratch.notes (id int);
    `);

    plan = { source: url(source), target: url(target), anonymize: false, schemas: [] };
    dumpFile = path.join(work, `${tag}.dump`);
    await execa("pg_dump", [...dumpArgs(plan), "--file", dumpFile], { env: dumpEnv(plan) });
});

async function tablesIn(database: string): Promise<string[]> {
    return tablesAt(url(database));
}

async function tablesAt(connectionString: string): Promise<string[]> {
    const { rows } = await query(connectionString, `
        SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`);
    return rows.map(row => String(row.name));
}

describe("restoreCopy", () => {
    it("replaces the local database's contents with the source's, local-only tables and all", async () => {
        const outcome = await restoreCopy(plan, dumpFile);

        // `notice` only when the local pg_dump is older than the server's minor (see attverNotice).
        expect(outcome).toEqual({
            cleared: true, started: true, failure: null, advice: null,
            ...(outcome.notice === undefined ? {} : { notice: expect.stringContaining("pg_attver") })
        });
        const target = new URL(plan.target).pathname.slice(1);
        expect(await tablesIn(target)).toEqual(["public.posts", "rebase.users"]);
        const titles = (await sql(target, "SELECT title FROM public.posts ORDER BY id")).rows.map(row => row.title);
        expect(titles).toEqual(["from the source", "also from the source"]);
        // What the source has besides rows came across too.
        expect((await sql(target, "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'posts'")).rows[0].n).toBe(1);
        expect((await sql(target, "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'posts_touch'")).rows[0].n).toBe(1);
    });

    it("succeeds the second time too", async () => {
        expect((await restoreCopy(plan, dumpFile)).failure).toBeNull();
        expect((await restoreCopy(plan, dumpFile)).failure).toBeNull();
    });

    it("replaces only the schemas a --schema pull copies", async () => {
        const partial: PullPlan = { ...plan, schemas: ["public"] };
        const partialDump = `${dumpFile}.public`;
        await execa("pg_dump", [...dumpArgs(partial), "--file", partialDump], { env: dumpEnv(partial) });
        const target = new URL(plan.target).pathname.slice(1);

        const outcome = await restoreCopy(partial, partialDump);

        expect(outcome.failure).toBeNull();
        expect(await tablesIn(target)).toEqual([
            "public.posts", "rebase.atlas_schema_revisions", "rebase.users", "scratch.notes"
        ]);
    });

    it("leaves the local database as it was when it cannot be emptied, and does not send you round again", async () => {
        // A role that may connect but owns nothing it would have to drop.
        const target = new URL(plan.target).pathname.slice(1);
        await sql("rebase", "DO $$ BEGIN CREATE ROLE pull_reader LOGIN PASSWORD 'reader'; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
        await sql(target, "GRANT USAGE ON SCHEMA public, rebase, scratch TO pull_reader");

        const outcome = await restoreCopy({ ...plan, target: url(target, "pull_reader", "reader") }, dumpFile);

        expect(outcome.cleared).toBe(false);
        expect(outcome.started).toBe(false);
        expect(outcome.failure).toMatch(/owner|permission/i);
        expect(outcome.advice).not.toMatch(/pull again\.?$/i);
        expect(await tablesIn(target)).toContain("rebase.atlas_schema_revisions");
        const titles = (await sql(target, "SELECT title FROM public.posts ORDER BY id")).rows.map(row => row.title);
        expect(titles[0]).toBe("stale local row");
    });
});

describe("restoreCopy into a PostgreSQL older than 17", () => {
    const older = `${container}-pg15`;
    let olderBase = "";

    beforeAll(async () => {
        olderBase = await startPostgres(older, "postgres:15-alpine");
    }, 120_000);

    afterAll(async () => {
        await execa("docker", ["rm", "-f", "-v", older], { reject: false });
    });

    it("succeeds with every table in place, and says why pg_restore's error was harmless", async () => {
        const target = at(olderBase, `dst_${crypto.randomUUID().slice(0, 8)}`);
        await query(olderBase, `CREATE DATABASE ${new URL(target).pathname.slice(1)}`);

        const outcome = await restoreCopy({ ...plan, target }, dumpFile);

        expect(outcome).toMatchObject({ cleared: true, started: true, failure: null, advice: null });
        // Only a pg_dump 17 or newer writes the SET; an older client's dump restores without an error.
        if ((await localClientMajor()) >= 17) expect(outcome.notice).toContain("SET transaction_timeout = 0");
        expect(await tablesAt(target)).toEqual(["public.posts", "rebase.users"]);
        const titles = (await query(target, "SELECT title FROM public.posts ORDER BY id")).rows.map(row => row.title);
        expect(titles).toEqual(["from the source", "also from the source"]);
        expect((await query(target, "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'posts'")).rows[0].n).toBe(1);
        expect((await query(target, "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'posts_touch'")).rows[0].n).toBe(1);
    });
});
