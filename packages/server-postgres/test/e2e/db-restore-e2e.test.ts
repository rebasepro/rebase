/**
 * `rebase db restore`, run as a developer runs it, against a real Postgres.
 *
 * - Into a database that already holds what the backup creates, without
 *   `--clean`: it ended in pg_restore's `schema "rebase" already exists` and
 *   execa's `Command failed with exit code 1: …/pg_restore …`, with no word
 *   about `--clean` or a new database, after the cluster roles had been
 *   applied. It now refuses first, naming both ways round it, and changes
 *   nothing.
 * - With no terminal and no `--yes`: "Aborted. No changes were made." never
 *   said to pass `--yes`, as `db reset`, `db pull` and `db branch prune` do.
 * - With `--clean`, over a database `rebase db migrate` had run on: pg_restore
 *   dropped every table the backup holds, then stopped at `DROP SCHEMA rebase`,
 *   which `rebase.atlas_schema_revisions` blocked, and said "What it restored
 *   before that stays" about a database it had emptied. It now replaces the
 *   backup's schemas whole, as one transaction with the restore, says first
 *   what that drops that the backup lacks, and a restore that stops changes
 *   nothing.
 *
 * Requires Docker and the Postgres client tools (`pg_dump`, `pg_restore`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { imageForLocalClient, startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");
const cliScript = path.join(pkgRoot, "src", "cli.ts");
const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
const atlasBin = path.join(pkgRoot, "node_modules", ".bin", "atlas");

const SEED_SQL = `
CREATE SCHEMA rebase;
CREATE TABLE rebase.users (id serial PRIMARY KEY, email text NOT NULL);
CREATE TABLE public.posts (id serial PRIMARY KEY, title text NOT NULL);
CREATE FUNCTION rebase.uid() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE TYPE rebase.role AS ENUM ('admin', 'editor');
INSERT INTO rebase.users (email) VALUES ('ada@shop.test');
INSERT INTO public.posts (title) VALUES ('one'), ('two');
`;

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

describe("rebase db restore", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let backend: string;
    let dumpFile: string;

    const urlFor = (db: string) => container.connectionString.replace(/\/rebase\?/, `/${db}?`);

    const cliOn = (db: string, args: string[]) =>
        execa(tsxBin, [cliScript, ...args], {
            cwd: backend, env: cleanEnv(urlFor(db)), reject: false, stdin: "ignore", all: true
        });

    const cli = (args: string[]) => cliOn("rebase", args);

    const sqlIn = async <T extends Record<string, unknown>>(db: string, text: string): Promise<T[]> => {
        const client = new pg.Client({ connectionString: urlFor(db) });
        await client.connect();
        try {
            return (await client.query<T>(text)).rows;
        } finally {
            await client.end();
        }
    };

    const exists = async (db: string, relation: string): Promise<boolean> =>
        (await sqlIn<{ present: boolean }>(db, `SELECT to_regclass('${relation}') IS NOT NULL AS present`))[0].present;

    const databases = async (): Promise<string[]> =>
        (await admin.query<{ datname: string }>("SELECT datname FROM pg_database ORDER BY datname")).rows.map(r => r.datname);

    const postsIn = async (db: string): Promise<number> =>
        Number((await sqlIn<{ n: string }>(db, "SELECT count(*) AS n FROM public.posts"))[0].n);

    beforeAll(async () => {
        // pg_dump must be at least as new as the server; see imageForLocalClient.
        container = await startPgContainer({ image: await imageForLocalClient() });
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(SEED_SQL);

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-restore-e2e-"));
        backend = path.join(base, "backend");
        fs.mkdirSync(backend, { recursive: true });
        fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: "restore-e2e-backend", type: "module" }));

        const backupDir = path.join(base, "backups");
        const backup = await cli(["db", "backup", "--out", backupDir]);
        expect(backup.exitCode, backup.all).toBe(0);
        const dump = fs.readdirSync(backupDir).find(name => name.endsWith(".dump"));
        expect(dump, backup.all).toBeDefined();
        dumpFile = path.join(backupDir, dump!);
    }, 120_000);

    afterAll(async () => {
        if (admin) try { await admin.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("refuses a restore over what the database already holds, before anything is applied", async () => {
        const restored = await cli(["db", "restore", dumpFile, "--yes"]);
        const said = restored.all ?? "";

        expect(restored.exitCode, said).toBe(1);
        expect(said).toMatch(/"rebase" already holds schema rebase, table public\.posts, table rebase\.users, which this backup creates/);
        expect(said).toMatch(/Nothing was restored or changed/);
        expect(said).toContain(`rebase db restore ${dumpFile} --clean`);
        expect(said).toContain(`rebase db restore ${dumpFile} --create-db --target-db <new name>`);
        // Refused before the roles step, and in its own words.
        expect(said).not.toMatch(/Roles: \d+ applied/);
        expect(said).not.toMatch(/Command failed/);
        expect(said).not.toMatch(/already exists/);
        expect(await postsIn("rebase")).toBe(2);
    }, 120_000);

    // The table of contents is read before anything runs, and a dump cut
    // short in it failed there with execa's `Command failed … pg_restore
    // --list …` and pg_restore's raw line, which said neither what is wrong
    // with the file nor that nothing had changed.
    it("refuses a truncated dump before anything is applied, and says it is truncated", async () => {
        const truncated = path.join(path.dirname(dumpFile), "truncated.dump");
        fs.writeFileSync(truncated, fs.readFileSync(dumpFile).subarray(0, 12));

        const restored = await cli(["db", "restore", truncated, "--clean", "--yes"]);
        const said = restored.all ?? "";

        expect(restored.exitCode, said).toBe(1);
        expect(said).toMatch(/truncated\.dump is truncated: it ends before pg_restore can read what it holds/);
        expect(said).toMatch(/Nothing was restored or changed\./);
        expect(said).not.toMatch(/Command failed/);
        expect(said).not.toMatch(/Roles: \d+ applied/);
        expect(await postsIn("rebase")).toBe(2);
    }, 120_000);

    it("with no terminal and no --yes, refuses and says to pass --yes", async () => {
        const restored = await cli(["db", "restore", dumpFile, "--create-db", "--target-db", "restored_untyped"]);
        const said = restored.all ?? "";

        expect(restored.exitCode, said).toBe(1);
        expect(said).toMatch(/Nothing was restored: there is no terminal to confirm on/);
        expect(said).toMatch(/Re-run with --yes to restore into "restored_untyped"/);
        expect(await databases()).not.toContain("restored_untyped");
    }, 120_000);

    it("restores into a new database, and over the old one with --clean", async () => {
        const fresh = await cli(["db", "restore", dumpFile, "--create-db", "--target-db", "restored_fresh", "--yes"]);
        expect(fresh.exitCode, fresh.all).toBe(0);
        expect(await postsIn("restored_fresh")).toBe(2);

        await admin.query("INSERT INTO public.posts (title) VALUES ('three')");
        const clean = await cli(["db", "restore", dumpFile, "--clean", "--yes"]);
        expect(clean.exitCode, clean.all).toBe(0);
        expect(await postsIn("rebase")).toBe(2);
    }, 180_000);

    it("with --clean, replaces a database `db migrate` has run on, and names what the backup does not hold", async () => {
        const restored = await cli(["db", "restore", dumpFile, "--create-db", "--target-db", "migrated", "--yes"]);
        expect(restored.exitCode, restored.all).toBe(0);

        // `rebase db migrate --baseline`, as on any project: it writes
        // `rebase.atlas_schema_revisions`, which the backup was taken before.
        const migrations = path.join(backend, "drizzle", "migrations");
        fs.mkdirSync(migrations, { recursive: true });
        fs.writeFileSync(path.join(migrations, "20260101000000_init.sql"), "SELECT 1;\n");
        await execa(atlasBin, ["migrate", "hash", "--dir", "file://drizzle/migrations"], { cwd: backend });
        const migrated = await cliOn("migrated", ["db", "migrate", "--baseline", "20260101000000"]);
        expect(migrated.exitCode, migrated.all).toBe(0);
        expect(await exists("migrated", "rebase.atlas_schema_revisions")).toBe(true);
        // And a table a newer runtime adds, which references one of the backup's.
        await sqlIn("migrated", "CREATE TABLE rebase.sessions (id serial PRIMARY KEY, user_id integer REFERENCES rebase.users(id))");
        await sqlIn("migrated", "INSERT INTO public.posts (title) VALUES ('three')");
        // And what is not a relation: a helper function, a type, a free sequence.
        await sqlIn("migrated", `
            CREATE FUNCTION rebase.local_helper() RETURNS integer LANGUAGE sql AS 'SELECT 2';
            CREATE TYPE rebase.local_kind AS ENUM ('x');
            CREATE SEQUENCE rebase.local_counter;
        `);

        const clean = await cli(["db", "restore", dumpFile, "--target-db", "migrated", "--clean", "--yes"]);
        const said = clean.all ?? "";

        expect(clean.exitCode, said).toBe(0);
        expect(said).toMatch(/--clean replaces schema rebase whole, so it also drops what this backup does not hold:/);
        expect(said).toContain("table rebase.atlas_schema_revisions");
        expect(said).toContain("table rebase.sessions");
        expect(said).toContain("function rebase.local_helper");
        expect(said).toContain("type rebase.local_kind");
        expect(said).toContain("sequence rebase.local_counter");
        // What the backup holds is not named: its function and type, and the
        // sequences its serial columns own.
        expect(said).not.toContain("function rebase.uid");
        expect(said).not.toContain("type rebase.role");
        expect(said).not.toContain("sessions_id_seq");
        expect(said).toMatch(/Restore completed into "migrated"/);
        expect(await postsIn("migrated")).toBe(2);
        expect(await exists("migrated", "rebase.users")).toBe(true);
        expect(await exists("migrated", "rebase.atlas_schema_revisions")).toBe(false);
        expect(await exists("migrated", "rebase.sessions")).toBe(false);
        const [{ helper }] = await sqlIn<{ helper: boolean }>("migrated", "SELECT to_regproc('rebase.local_helper') IS NOT NULL AS helper");
        expect(helper).toBe(false);
    }, 180_000);

    it("a --clean restore that stops is rolled back whole, and says the database is as it was", async () => {
        await admin.query("CREATE DATABASE moods");
        await sqlIn("moods", `
            CREATE SCHEMA rebase;
            CREATE TABLE rebase.users (id serial PRIMARY KEY, email text NOT NULL);
            CREATE TYPE public.mood AS ENUM ('calm', 'loud');
            CREATE TABLE public.posts (id serial PRIMARY KEY, title text NOT NULL, mood public.mood);
            INSERT INTO public.posts (title) VALUES ('one'), ('two');
        `);
        const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-restore-moods-"));
        const backedUp = await cliOn("moods", ["db", "backup", "--out", backupDir]);
        expect(backedUp.exitCode, backedUp.all).toBe(0);
        const moodsDump = path.join(backupDir, fs.readdirSync(backupDir).find(name => name.endsWith(".dump"))!);

        const restored = await cli(["db", "restore", moodsDump, "--create-db", "--target-db", "moods_copy", "--yes"]);
        expect(restored.exitCode, restored.all).toBe(0);
        await sqlIn("moods_copy", `
            INSERT INTO public.posts (title) VALUES ('three');
            CREATE TABLE rebase.local_only (id integer);
            CREATE TABLE public.mood_log (felt public.mood);
        `);

        // `public.mood_log` needs the type the dump drops and creates again,
        // so the restore stops there — after the schemas it replaces were
        // dropped, inside the transaction that rolls them back.
        const clean = await cli(["db", "restore", moodsDump, "--target-db", "moods_copy", "--clean", "--yes"]);
        const said = clean.all ?? "";

        expect(clean.exitCode, said).toBe(1);
        expect(said).toMatch(/cannot drop type public\.mood because other objects depend on it/);
        expect(said).toMatch(/Nothing was restored or changed: the restore ran as one transaction, and it was rolled back/);
        expect(said).not.toMatch(/What it restored before that stays/);
        expect(await postsIn("moods_copy")).toBe(3);
        expect(await exists("moods_copy", "rebase.users")).toBe(true);
        expect(await exists("moods_copy", "rebase.local_only")).toBe(true);
        expect(await exists("moods_copy", "public.mood_log")).toBe(true);
    }, 180_000);
});
