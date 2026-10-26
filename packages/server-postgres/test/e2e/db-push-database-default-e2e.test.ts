/**
 * E2E: `rebase db push` leaves alone the DEFAULT of a column declared
 * `databaseDefault: true`.
 *
 * The flag says the database fills the column and somebody else wrote its
 * DEFAULT. The planner writes none for it, so `schema.sql` had the column
 * without one, and Atlas planned `ALTER COLUMN … DROP DEFAULT` on the next
 * push. The API kept letting creates through without the field, and the
 * database then refused every one of them on NOT NULL.
 *
 * A column without the flag is the control: its hand-written DEFAULT is not
 * declared anywhere, and the push still removes it.
 *
 * Requires Docker, or `REBASE_E2E_PG_URL` naming a Postgres server this suite
 * may create (and drop) a database on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");

const ITEMS = `
const items = {
    name: "Items",
    slug: "items",
    table: "items",
    properties: {
        id:    { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        code:  { name: "Code", type: "string", validation: { required: true }, databaseDefault: true },
        seqno: { name: "Seq", type: "number", databaseDefault: true }
    }
};
export default items;
`;

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

describe("db push and databaseDefault: true", () => {
    let container: PgContainer | undefined;
    let external: { admin: string; database: string } | undefined;
    let connectionString: string;
    let db: pg.Client;
    let workDir: string;
    let collectionsDir: string;

    beforeAll(async () => {
        const server = process.env.REBASE_E2E_PG_URL;
        if (server) {
            const database = `rebase_push_dbdefault_${crypto.randomUUID().slice(0, 8)}`;
            const admin = new pg.Client({ connectionString: server });
            await admin.connect();
            await admin.query(`CREATE DATABASE "${database}"`);
            await admin.end();
            const url = new URL(server);
            url.pathname = `/${database}`;
            connectionString = url.toString();
            external = { admin: server, database };
        } else {
            container = await startPgContainer();
            connectionString = container.connectionString;
        }
        db = new pg.Client({ connectionString });
        await db.connect();

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-push-dbdefault-"));
        workDir = path.join(base, "backend");
        collectionsDir = path.join(base, "config", "collections");
        fs.mkdirSync(workDir, { recursive: true });
        fs.mkdirSync(collectionsDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, "package.json"), JSON.stringify({ name: "e2e-push-dbdefault", type: "module" }));
        fs.writeFileSync(path.join(collectionsDir, "package.json"), JSON.stringify({ type: "module" }));
        fs.writeFileSync(path.join(collectionsDir, "items.js"), ITEMS);
        fs.writeFileSync(path.join(collectionsDir, "index.js"), `import items from "./items.js";\nexport default [items];\n`);
    }, 90_000);

    afterAll(async () => {
        if (db) await db.end().catch(() => undefined);
        if (container) await stopPgContainer(container.containerName);
        if (external) {
            const admin = new pg.Client({ connectionString: external.admin });
            await admin.connect();
            await admin.query(`DROP DATABASE IF EXISTS "${external.database}" WITH (FORCE)`);
            await admin.query(`DROP DATABASE IF EXISTS "${external.database}_dev_diff" WITH (FORCE)`);
            await admin.end();
        }
    }, 30_000);

    function runPush(extra: string[] = []) {
        return execa(
            path.join(monorepoRoot, "node_modules", ".bin", "tsx"),
            [path.join(pkgRoot, "src", "cli.ts"), "db", "push", "--collections", collectionsDir, ...extra],
            { cwd: workDir, env: cleanEnv(connectionString), reject: false, stdin: "ignore", all: true }
        );
    }

    async function defaults(): Promise<Record<string, string | null>> {
        const res = await db.query<{ column_name: string; column_default: string | null }>(
            `SELECT column_name, column_default FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'items'`
        );
        return Object.fromEntries(res.rows.map(row => [row.column_name, row.column_default]));
    }

    it("keeps the DEFAULT the database holds, and still drops one nothing declares", async () => {
        const created = await runPush();
        expect(created.exitCode, created.all).toBe(0);

        // Somebody else writes the DEFAULTs: the reason the flag exists.
        await db.query(`
            CREATE SEQUENCE items_seqno_seq;
            ALTER TABLE items ALTER COLUMN code SET DEFAULT ('X-' || gen_random_uuid()::text);
            ALTER TABLE items ALTER COLUMN seqno SET DEFAULT nextval('items_seqno_seq');
            ALTER TABLE items ALTER COLUMN title SET DEFAULT 'undeclared';
        `);
        const before = await defaults();

        const dry = await runPush(["--dry-run"]);
        expect(dry.exitCode, dry.all).toBe(0);
        expect(dry.all).not.toMatch(/ALTER COLUMN "code" DROP DEFAULT/);
        expect(dry.all).toMatch(/ALTER COLUMN "title" DROP DEFAULT/);

        const pushed = await runPush();
        expect(pushed.exitCode, pushed.all).toBe(0);
        const after = await defaults();
        expect(after.code).toBe(before.code);
        expect(after.seqno).toBe(before.seqno);
        expect(after.title).toBeNull();

        // What the DEFAULT is for: a create that leaves the field out.
        const row = await db.query<{ code: string }>(`INSERT INTO items (title) VALUES ('t') RETURNING code`);
        expect(row.rows[0].code).toMatch(/^X-[0-9a-f-]{36}$/);

        // And the push after it has nothing left to do.
        const again = await runPush(["--dry-run"]);
        expect(again.exitCode, again.all).toBe(0);
        expect(again.all).not.toMatch(/DROP DEFAULT/);
    }, 240_000);
});
