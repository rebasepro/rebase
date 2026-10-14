/**
 * `rebase db push` leaves a hand-written index alone whatever its name holds,
 * and a table no collection backs too.
 *
 * Every `--exclude` used to pass the name to Atlas as it stood, and Atlas reads
 * it as a glob split on `.`:
 *
 *  - an index called `tasks_title_idx[v1]` was excluded by a pattern whose
 *    `[v1]` is a class matching `v` or `1`. It matched nothing, Atlas planned
 *    `DROP INDEX`, and a drop of an index is not gated, so the push applied it
 *    without a word and exited 0;
 *  - a `.` in a name made one part too many, and Atlas refused every push on
 *    that database: `too many parts in pattern`.
 *
 * Requires Docker. Runs the driver CLI from source against a throwaway Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");
const cliScript = path.join(pkgRoot, "src", "cli.ts");
const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");

const TASKS_JS = `
export default {
    name: "Tasks",
    slug: "tasks",
    table: "tasks",
    properties: {
        id:    { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        note:  { name: "Note", type: "string" }
    }
};
`;

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

describe("db push keeps objects it does not own, whatever their names hold", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let backend: string;
    let collections: string;

    const push = () =>
        execa(tsxBin, [cliScript, "db", "push", "--collections", collections], {
            cwd: backend, env: cleanEnv(container.connectionString), reject: false, stdin: "ignore", all: true
        });

    const indexExists = async (name: string): Promise<boolean> => (await admin.query(
        "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tasks' AND indexname = $1", [name]
    )).rowCount === 1;

    const tableExists = async (name: string): Promise<boolean> => (await admin.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1", [name]
    )).rowCount === 1;

    beforeAll(async () => {
        container = await startPgContainer();
        for (let attempt = 1; ; attempt++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (error) {
                if (attempt >= 10) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-exclude-odd-names-"));
        backend = path.join(base, "backend");
        collections = path.join(base, "config", "collections");
        fs.mkdirSync(backend, { recursive: true });
        fs.mkdirSync(collections, { recursive: true });
        fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: "exclude-odd-names-backend", type: "module" }));
        fs.writeFileSync(path.join(collections, "package.json"), JSON.stringify({ type: "module" }));
        fs.writeFileSync(path.join(collections, "tasks.js"), TASKS_JS);
        fs.writeFileSync(path.join(collections, "index.js"), `import tasks from "./tasks.js";\nexport default [tasks];\n`);

        const created = await push();
        expect(created.exitCode, created.all).toBe(0);
    }, 300_000);

    afterAll(async () => {
        if (admin) try { await admin.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("keeps a hand-written index whose name is a glob", async () => {
        await admin.query(`CREATE INDEX "tasks_title_idx[v1]" ON public.tasks (title)`);

        const pushed = await push();
        expect(pushed.exitCode, pushed.all).toBe(0);
        expect(pushed.all).not.toMatch(/DROP INDEX/);
        expect(await indexExists("tasks_title_idx[v1]")).toBe(true);
    }, 300_000);

    it("pushes, and keeps them, when a name holds a dot", async () => {
        await admin.query(`CREATE INDEX "tasks.note [v2]*" ON public.tasks (note)`);
        await admin.query(`CREATE TABLE public."legacy.orders [v1]*" (id integer PRIMARY KEY)`);

        const pushed = await push();
        expect(pushed.exitCode, pushed.all).toBe(0);
        expect(pushed.all).not.toMatch(/too many parts/);
        expect(await indexExists("tasks.note [v2]*")).toBe(true);
        expect(await indexExists("tasks_title_idx[v1]")).toBe(true);
        expect(await tableExists("legacy.orders [v1]*")).toBe(true);
    }, 300_000);
});
