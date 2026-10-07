/**
 * What a `rebase db push` costs around the work itself.
 *
 * Every step of a push used to open its own connection to the database: the
 * auth bootstrap, the connectivity probe, each catalogue read behind Atlas's
 * excludes, and every step after the apply. 21 on a fresh push, 16 on one that
 * changed nothing — against a hosted Postgres over TLS, four or five round
 * trips each before the first query. And each of the two generators ran as a
 * tsx process of its own. These count both, on a real database and the real
 * Atlas binary.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { closeAppClients, withAppClient } from "../../src/cli-helpers";
import { pinSearchPath } from "../../src/connection";
import { ensureCollectionPolicies } from "../../src/schema/ensure-collection-policies";
import { loadCollectionsFromDirectory } from "@rebasepro/server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");

const AUTHORS_JS = `
const authorsCollection = {
    name: "Authors",
    slug: "authors",
    table: "authors",
    securityRules: [{ operation: "select", access: "public" }],
    properties: {
        id:   { name: "ID",   type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" }
    }
};
export default authorsCollection;
`;

const POSTS_JS = `
import authorsCollection from "./authors.js";
const postsCollection = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    securityRules: [{ operation: "all", ownerField: "owner_id" }],
    properties: {
        id:       { name: "ID",    type: "string", isId: "uuid" },
        title:    { name: "Title", type: "string" },
        owner_id: { name: "Owner", type: "string" },
        author:   { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authorsCollection } }
    }
};
export default postsCollection;
`;

/** Appends every process the driver spawns to `$SPAWN_LOG`, one JSON argv per line. */
const RECORD_SPAWNS = `
const childProcess = require("child_process");
const fs = require("fs");
const { syncBuiltinESMExports } = require("module");
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) {
    const original = childProcess[name];
    childProcess[name] = function (command, args, ...rest) {
        const argv = Array.isArray(args) ? args : [];
        fs.appendFileSync(process.env.SPAWN_LOG, JSON.stringify([String(command), ...argv.map(String)]) + "\\n");
        return original.call(this, command, args, ...rest);
    };
}
syncBuiltinESMExports();
`;

describe("db push overhead E2E", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let base: string;
    let workDir: string;
    let collectionsDir: string;
    let spawnLog: string;
    let preload: string;
    const cliScript = path.join(pkgRoot, "src", "cli.ts");

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        // Every connection the server accepts, in the container's log.
        await admin.query("ALTER SYSTEM SET log_connections = 'on'");
        await admin.query("SELECT pg_reload_conf()");

        base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-push-overhead-"));
        workDir = path.join(base, "backend");
        collectionsDir = path.join(base, "config", "collections");
        fs.mkdirSync(workDir, { recursive: true });
        fs.mkdirSync(collectionsDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, "package.json"), JSON.stringify({ name: "e2e-push-overhead", type: "module" }));
        fs.writeFileSync(path.join(collectionsDir, "package.json"), JSON.stringify({ type: "module" }));
        fs.writeFileSync(path.join(collectionsDir, "authors.js"), AUTHORS_JS);
        fs.writeFileSync(path.join(collectionsDir, "posts.js"), POSTS_JS);
        spawnLog = path.join(base, "spawns.log");
        preload = path.join(base, "record-spawns.cjs");
        fs.writeFileSync(preload, RECORD_SPAWNS);
    }, 90_000);

    afterAll(async () => {
        await closeAppClients();
        if (admin) await admin.end().catch(() => undefined);
        if (container) await stopPgContainer(container.containerName);
        if (base) fs.rmSync(base, { recursive: true, force: true });
    }, 30_000);

    function env(): Record<string, string> {
        const vars = { ...process.env } as Record<string, string>;
        for (const key of Object.keys(vars)) {
            if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete vars[key];
        }
        vars.DATABASE_URL = container.connectionString;
        // Workspace packages from source: a worktree has no `dist`.
        vars.TSX_TSCONFIG_PATH = path.join(monorepoRoot, "tsconfig.typecheck.json");
        vars.NODE_OPTIONS = `${vars.NODE_OPTIONS ?? ""} --require ${preload}`.trim();
        vars.SPAWN_LOG = spawnLog;
        return vars;
    }

    /** The `connection authorized` lines in the container's log so far. */
    async function authorizedConnections(): Promise<string[]> {
        const { all } = await execa("docker", ["logs", container.containerName], { all: true });
        return (all ?? "").split("\n").filter(line => line.includes("connection authorized"));
    }

    /** Push, and count the connections it made to the app database (not Atlas's scratch one). */
    async function push(extra: string[] = []) {
        fs.writeFileSync(spawnLog, "");
        const before = (await authorizedConnections()).length;
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        const result = await execa(tsxBin, [cliScript, "db", "push", "--collections", collectionsDir, ...extra], {
            cwd: workDir, env: env(), reject: false, stdin: "ignore", all: true
        });
        // The log is written as each backend starts; give the last one a moment.
        await new Promise(resolve => setTimeout(resolve, 300));
        const opened = (await authorizedConnections()).slice(before);
        const toApp = opened.filter(line => /database=rebase(?:\s|$)/.test(line));
        const spawned = fs.readFileSync(spawnLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as string[]);
        return { result, toApp, spawned };
    }

    /**
     * One of ours, and Atlas's own: it connects twice per plan, and a push
     * that changes something plans twice (the dry-run the destructive gate
     * reads, then the apply). 21 and 16 before the steps shared a connection.
     */
    it("opens one connection of its own, however many steps it runs", async () => {
        const fresh = await push();
        expect(fresh.result.exitCode, fresh.result.all).toBe(0);
        expect(fresh.toApp.length, fresh.toApp.join("\n")).toBeLessThanOrEqual(5);

        const unchanged = await push();
        expect(unchanged.result.exitCode, unchanged.result.all).toBe(0);
        expect(unchanged.result.all).toContain("Schema is synced");
        expect(unchanged.toApp.length, unchanged.toApp.join("\n")).toBeLessThanOrEqual(3);
    }, 180_000);

    it("starts no generator process: both generators run in the driver", async () => {
        const { result, spawned } = await push();
        expect(result.exitCode, result.all).toBe(0);
        const generators = spawned.filter(argv =>
            argv.some(arg => /schema[\\/](?:bin[\\/])?generate-(?:drizzle-schema|postgres-ddl)\.[jt]s$/.test(arg)));
        expect(generators).toEqual([]);
        // The recorder ran: Atlas is a spawned process.
        expect(spawned.some(argv => /atlas/.test(argv[0]))).toBe(true);
    }, 180_000);

    /**
     * The push stamps the policies it creates the way a boot does, so the
     * first boot after it — on its own connection, `search_path` pinned to
     * `public` while the push's role-named `rebase` schema led the default
     * path — re-applies none of them.
     */
    it("leaves the next boot nothing to re-apply in the policies step", async () => {
        const { result } = await push();
        expect(result.exitCode, result.all).toBe(0);

        const boot = new pg.Client({ connectionString: pinSearchPath(container.connectionString) });
        await boot.connect();
        try {
            const collections = await loadCollectionsFromDirectory(collectionsDir);
            const outcome = await ensureCollectionPolicies(
                { query: async <T>(text: string) => ({ rows: (await boot.query(text)).rows as T[] }) },
                collections
            );
            expect(outcome).toMatchObject({ policiesApplied: 0, unchanged: 2, failures: [], deferred: [] });
        } finally {
            await boot.end();
        }
    }, 180_000);

    /**
     * The btree Rebase derives for `posts.author_id` is missing on a table
     * that already exists — every table of a project upgraded across the
     * release that derives them. Left to Atlas it is a plain `CREATE INDEX`
     * inside the push's transaction, holding the table's writes for the whole
     * build. The push builds it CONCURRENTLY before Atlas plans, so Atlas
     * finds it and plans nothing; a dry-run only names it.
     */
    it("builds a missing foreign-key index ahead of the plan, and a dry-run only names it", async () => {
        const derivedIndex = async (): Promise<string | undefined> => (await admin.query<{ name: string }>(
            "SELECT indexname AS name FROM pg_indexes WHERE tablename = 'posts' AND indexname LIKE 'posts_author_id_ix_%'"
        )).rows[0]?.name;

        expect((await push()).result.exitCode).toBe(0);
        const name = await derivedIndex();
        expect(name).toBeDefined();
        await admin.query(`DROP INDEX "public"."${name}"`);

        const dry = await push(["--dry-run"]);
        expect(dry.result.exitCode, dry.result.all).toBe(0);
        expect(dry.result.all).toContain("would be built first");
        expect(dry.result.all).toContain(`public.${name}`);
        expect(await derivedIndex()).toBeUndefined();

        const real = await push();
        expect(real.result.exitCode, real.result.all).toBe(0);
        expect(real.result.all).toMatch(/Building 1 foreign-key index/);
        // Atlas found it already there: its plan was empty, so no apply ran.
        expect(real.result.all).toContain("Schema is synced");
        const { rows } = await admin.query<{ valid: boolean }>(
            "SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1",
            [name]
        );
        expect(rows).toEqual([{ valid: true }]);
    }, 240_000);

    /**
     * The connection outlives each step, so a step that fails inside a
     * transaction of its own must not leave the session aborted for the next
     * — `current transaction is aborted` on every step after the first error.
     */
    it("a step that fails mid-transaction leaves the connection usable", async () => {
        const url = container.connectionString;
        await expect(withAppClient(url, async client => {
            await client.query("BEGIN");
            await client.query("SELECT 1 / 0");
        })).rejects.toThrow(/division by zero/);

        const { rows } = await withAppClient(url, client => client.query<{ ok: number }>("SELECT 1 AS ok"));
        expect(rows).toEqual([{ ok: 1 }]);

        // And it was the same connection: nothing was reopened to get here.
        const pids = await Promise.all([1, 2].map(() =>
            withAppClient(url, async client => (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid)));
        expect(pids[0]).toBe(pids[1]);
    }, 60_000);
});
