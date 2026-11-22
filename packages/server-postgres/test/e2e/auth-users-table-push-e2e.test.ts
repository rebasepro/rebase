/**
 * `rebase db push` leaves the `rebase.users` auth created exactly as it was.
 *
 * Two projects, each against a database where auth has already made its
 * users table (a project that booted once, or adopted from a headless one):
 *  - one that declares no `users.ts`, so nothing declares the table;
 *  - one with the scaffold's `users.ts`, added after the fact.
 * And the scaffold's `users.ts` through the migration path: `db generate`
 * then `db migrate` over the same kind of database; and `schema introspect`,
 * which writes `users.ts` only with `--users`.
 * Atlas's plan must not touch the table, its columns, constraints and indexes
 * must be what they were after the push (which also gives the table its
 * declared policies), and a second push must find nothing to do. Planned with
 * the real Atlas binary against a real Postgres, which is what decides whether
 * an `ALTER COLUMN id TYPE uuid` — the old scaffold's — would happen.
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
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { closeAppClients } from "../../src/cli-helpers";
import { ensureAuthTablesExist } from "../../src/auth/ensure-tables";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");
const templateUsers = path.join(monorepoRoot, "packages", "cli", "templates", "template", "backend", "schema", "users.ts");

const POSTS_TS = `import { col, defineTable } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text(),
        ownerId: col.text().onCreateUser()
    },
    rls: [{ operation: "all", ownerField: "ownerId" }]
});
`;

/** Everything about `rebase.users` a push could change: columns, constraints, indexes. */
async function usersShape(connectionString: string): Promise<unknown> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
        const columns = await client.query(
            "SELECT column_name, udt_name, is_nullable, column_default FROM information_schema.columns " +
            "WHERE table_schema = 'rebase' AND table_name = 'users' ORDER BY column_name"
        );
        const constraints = await client.query(
            "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint " +
            "WHERE conrelid = 'rebase.users'::regclass ORDER BY conname"
        );
        const indexes = await client.query(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'rebase' AND tablename = 'users' ORDER BY indexname"
        );
        return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
    } finally {
        await client.end();
    }
}

describe("the rebase.users auth created, and the tools that declare it", () => {
    let container: PgContainer;
    let base: string;
    const cliScript = path.join(pkgRoot, "src", "cli.ts");

    beforeAll(async () => {
        container = await startPgContainer();
        base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-builtin-users-"));
    }, 90_000);

    afterAll(async () => {
        await closeAppClients();
        if (container) await stopPgContainer(container.containerName);
        if (base) fs.rmSync(base, { recursive: true, force: true });
    }, 30_000);

    /** A fresh database in the container, with `rebase.users` made by auth. */
    async function databaseWithAuthUsers(name: string): Promise<string> {
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        try {
            await admin.query(`CREATE DATABASE "${name}"`);
        } finally {
            await admin.end();
        }
        const url = new URL(container.connectionString);
        url.pathname = `/${name}`;
        const client = new pg.Client({ connectionString: url.toString() });
        await client.connect();
        try {
            await ensureAuthTablesExist(drizzle(client));
        } finally {
            await client.end();
        }
        return url.toString();
    }

    /** A project's backend/ with these schema files. */
    function project(name: string, files: Record<string, string>): string {
        const workDir = path.join(base, name, "backend");
        const schemaDir = path.join(workDir, "schema");
        fs.mkdirSync(schemaDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, "package.json"), JSON.stringify({ name: `e2e-${name}`, type: "module" }));
        for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(schemaDir, file), text);
        return workDir;
    }

    async function push(workDir: string, databaseUrl: string, extra: string[] = []) {
        return db(workDir, databaseUrl, ["push", ...extra]);
    }

    /** The environment a CLI run gets: no package-manager variables, workspace packages from source. */
    function cleanEnv(): Record<string, string> {
        const env = { ...process.env } as Record<string, string>;
        for (const key of Object.keys(env)) {
            if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
        }
        // Workspace packages from source: a worktree has no `dist`.
        env.TSX_TSCONFIG_PATH = path.join(monorepoRoot, "tsconfig.typecheck.json");
        return env;
    }

    async function db(workDir: string, databaseUrl: string, args: string[]) {
        const env = cleanEnv();
        env.DATABASE_URL = databaseUrl;
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        return execa(tsxBin, [cliScript, "db", ...args], { cwd: workDir, env, reject: false, stdin: "ignore", all: true });
    }

    async function expectPushLeavesUsersAlone(workDir: string, databaseUrl: string): Promise<void> {
        const before = await usersShape(databaseUrl);

        const plan = await push(workDir, databaseUrl, ["--dry-run"]);
        expect(plan.exitCode, plan.all).toBe(0);
        // Atlas's plan, the table DDL: nothing on rebase.users. (The policy
        // step after it does name the table — it gets its declared policies
        // and RLS, as any declared users table does; that is not the table.)
        const atlasPlan = (plan.all ?? "").split("Planned row-level security changes:")[0];
        expect(atlasPlan).toContain("--dry-run — nothing was applied");
        expect(atlasPlan).not.toMatch(/"rebase"\."users"|rebase\.users/);

        const applied = await push(workDir, databaseUrl);
        expect(applied.exitCode, applied.all).toBe(0);
        expect(await usersShape(databaseUrl)).toEqual(before);

        const again = await push(workDir, databaseUrl);
        expect(again.exitCode, again.all).toBe(0);
        expect(again.all).toContain("Schema is synced");
        expect(await usersShape(databaseUrl)).toEqual(before);
    }

    it("without a users.ts: it leaves the table alone", async () => {
        const databaseUrl = await databaseWithAuthUsers("no_users_ts");
        const workDir = project("no-users-ts", {
            "posts.ts": POSTS_TS,
            "index.ts": `export { posts } from "./posts";\n`
        });
        await expectPushLeavesUsersAlone(workDir, databaseUrl);
    }, 240_000);

    it("with the scaffold's users.ts: it plans nothing against it", async () => {
        const databaseUrl = await databaseWithAuthUsers("template_users_ts");
        const workDir = project("template-users-ts", {
            "posts.ts": POSTS_TS,
            "users.ts": fs.readFileSync(templateUsers, "utf8"),
            "index.ts": `export { posts } from "./posts";\nexport { users } from "./users";\n`
        });
        await expectPushLeavesUsersAlone(workDir, databaseUrl);
    }, 240_000);

    it("with the scaffold's users.ts: db generate writes a migration db migrate applies over it", async () => {
        const databaseUrl = await databaseWithAuthUsers("template_users_ts_migrate");
        const workDir = project("template-users-ts-migrate", {
            "posts.ts": POSTS_TS,
            "users.ts": fs.readFileSync(templateUsers, "utf8"),
            "index.ts": `export { posts } from "./posts";\nexport { users } from "./users";\n`
        });
        const before = await usersShape(databaseUrl);

        const generated = await db(workDir, databaseUrl, ["generate", "init"]);
        expect(generated.exitCode, generated.all).toBe(0);
        const migrations = path.join(workDir, "drizzle", "migrations");
        const written = fs.readdirSync(migrations).filter(file => file.endsWith(".sql"));
        expect(written).toHaveLength(1);
        const migration = fs.readFileSync(path.join(migrations, written[0]), "utf8");
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS "rebase"."users" (');

        const migrated = await db(workDir, databaseUrl, ["migrate"]);
        expect(migrated.exitCode, migrated.all).toBe(0);
        expect(await usersShape(databaseUrl)).toEqual(before);
    }, 240_000);

    it("schema introspect writes users.ts only when asked with --users", async () => {
        const databaseUrl = await databaseWithAuthUsers("introspect_users");
        const client = new pg.Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            await client.query("CREATE TABLE public.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text); ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;");
        } finally {
            await client.end();
        }
        const introspect = async (name: string, extra: string[]) => {
            const workDir = project(name, {});
            const run = await execa(path.join(monorepoRoot, "node_modules", ".bin", "tsx"),
                [cliScript, "schema", "introspect", "--no-data-inference", ...extra],
                { cwd: workDir, env: { ...cleanEnv(), DATABASE_URL: databaseUrl }, reject: false, stdin: "ignore", all: true });
            expect(run.exitCode, run.all).toBe(0);
            return { run, schemaDir: path.join(workDir, "schema") };
        };

        const without = await introspect("introspect-default", []);
        expect(fs.existsSync(path.join(without.schemaDir, "posts.ts"))).toBe(true);
        expect(fs.existsSync(path.join(without.schemaDir, "users.ts"))).toBe(false);
        expect(without.run.all).toContain("run again with --users");

        const asked = await introspect("introspect-users", ["--users"]);
        const users = fs.readFileSync(path.join(asked.schemaDir, "users.ts"), "utf8");
        expect(users).toContain("defineAuthTable(\"users\"");
        expect(users).toContain("col.text().primaryKey().default(sql`gen_random_uuid()::text`)");
        expect(fs.readFileSync(path.join(asked.schemaDir, "index.ts"), "utf8")).toContain("./users");
    }, 240_000);
});
