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

const SEED_SQL = `
CREATE SCHEMA rebase;
CREATE TABLE rebase.users (id serial PRIMARY KEY, email text NOT NULL);
CREATE TABLE public.posts (id serial PRIMARY KEY, title text NOT NULL);
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

    const cli = (args: string[]) =>
        execa(tsxBin, [cliScript, ...args], {
            cwd: backend, env: cleanEnv(container.connectionString), reject: false, stdin: "ignore", all: true
        });

    const databases = async (): Promise<string[]> =>
        (await admin.query<{ datname: string }>("SELECT datname FROM pg_database ORDER BY datname")).rows.map(r => r.datname);

    const postsIn = async (db: string): Promise<number> => {
        const client = new pg.Client({ connectionString: container.connectionString.replace(/\/rebase\?/, `/${db}?`) });
        await client.connect();
        try {
            return Number((await client.query("SELECT count(*) AS n FROM public.posts")).rows[0].n);
        } finally {
            await client.end();
        }
    };

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
});
