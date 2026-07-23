/**
 * E2E test for `rebase db push`'s destructive-change safety gate.
 *
 * The highest silent-data-loss risk in the product was `db push` running
 * `atlas schema apply --auto-approve` with no confirmation — a removed field
 * compiles to `DROP COLUMN` and the column (and its data) vanish. This proves
 * the gate end-to-end against a real Postgres:
 *
 *   1. push a collection WITH a `note` column        → column created
 *   2. remove the field, push non-interactively      → REFUSED, column survives
 *   3. push again with --allow-destructive            → column dropped
 *
 * Requires Docker. Spins up a throwaway Postgres container and tears it down.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "../..");     // packages/server-postgres
const monorepoRoot = path.resolve(pkgRoot, "../..");  // repo root

/** Tasks collection; `withNote` toggles the destructive field. */
function tasksCollectionJs(withNote: boolean): string {
    const noteProp = withNote ? `        note:  { name: "Note",  type: "string" },\n` : "";
    return `
const tasksCollection = {
    name: "Tasks",
    singularName: "Task",
    slug: "tasks",
    table: "tasks",
    icon: "CheckCircle",
    group: "Core",
    properties: {
        id:    { name: "ID",    type: "string", isId: "uuid", validation: { required: true } },
        title: { name: "Title", type: "string", validation: { required: true } },
${noteProp}        done:  { name: "Done",  type: "boolean" }
    }
};
export default tasksCollection;
`;
}

function collectionsIndex(): string {
    return `import tasksCollection from "./tasks.js";\nexport default [tasksCollection];\n`;
}

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

describe("db push destructive-change gate E2E", () => {
    let container: PgContainer;
    let dbClient: pg.Client;
    let workDir: string;
    let collectionsDir: string;
    let env: Record<string, string>;
    const cliScript = path.join(pkgRoot, "src", "cli.ts");

    beforeAll(async () => {
        container = await startPgContainer();

        let attempts = 0;
        while (attempts < 10) {
            try {
                dbClient = new pg.Client({ connectionString: container.connectionString });
                await dbClient.connect();
                break;
            } catch {
                if (++attempts === 10) throw new Error("Could not connect to Postgres after retries");
                await new Promise((r) => setTimeout(r, 1000));
            }
        }

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-push-safety-"));
        workDir = path.join(base, "backend");
        collectionsDir = path.join(base, "config", "collections");
        fs.mkdirSync(workDir, { recursive: true });
        fs.mkdirSync(collectionsDir, { recursive: true });
        fs.writeFileSync(
            path.join(workDir, "package.json"),
            JSON.stringify({ name: "e2e-push-safety-backend", type: "module" }),
            "utf-8"
        );
        fs.writeFileSync(
            path.join(collectionsDir, "package.json"),
            JSON.stringify({ type: "module" }),
            "utf-8"
        );
        fs.writeFileSync(path.join(collectionsDir, "index.js"), collectionsIndex());

        env = cleanEnv(container.connectionString);
    }, 60_000);

    afterAll(async () => {
        if (dbClient) try { await dbClient.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    /**
     * Run `rebase db push` NON-INTERACTIVELY (stdin ignored ⇒ not a TTY) so
     * the gate's non-interactive branch is exercised. `reject: false` lets us
     * assert on the exit code; `all: true` merges stdout+stderr for message
     * checks.
     */
    function runPush(extra: string[] = []) {
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        return execa(
            tsxBin,
            [cliScript, "db", "push", "--collections", collectionsDir, ...extra],
            { cwd: workDir, env, reject: false, stdin: "ignore", all: true }
        );
    }

    async function noteColumnExists(): Promise<boolean> {
        const res = await dbClient.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'note'`
        );
        return res.rows.length > 0;
    }

    it("refuses to drop a column non-interactively, then drops it with --allow-destructive", async () => {
        // ── 1. Push WITH the note column ─────────────────────────────────
        fs.writeFileSync(path.join(collectionsDir, "tasks.js"), tasksCollectionJs(true));
        const first = await runPush();
        expect(first.exitCode).toBe(0);
        expect(await noteColumnExists()).toBe(true);

        // ── 2. Remove the field and push non-interactively → MUST refuse ──
        fs.writeFileSync(path.join(collectionsDir, "tasks.js"), tasksCollectionJs(false));
        const refused = await runPush();

        expect(refused.exitCode).not.toBe(0); // aborted
        expect(refused.all ?? "").toMatch(/destructive/i);
        // The safety net's whole point: the column and its data survive.
        expect(await noteColumnExists()).toBe(true);

        // ── 3. Opt in explicitly → the drop is applied ───────────────────
        const allowed = await runPush(["--allow-destructive"]);
        expect(allowed.exitCode).toBe(0);
        expect(await noteColumnExists()).toBe(false);
    }, 150_000);
});
