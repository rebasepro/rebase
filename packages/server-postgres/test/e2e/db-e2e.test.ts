/**
 * E2E test for the database migration pipeline.
 *
 * Scenario 1 — Fresh database:
 *   Clean Postgres → db:generate → db:migrate → verify tables + auth bootstrap
 *
 * Scenario 2 — Incremental migration:
 *   Add a second collection → db:generate → db:migrate → verify new + old tables
 *
 * Requires Docker to be running. The test spins up a temporary Postgres
 * container and tears it down afterwards.
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
const pkgRoot = path.resolve(__dirname, "../..");               // packages/server-postgres
const monorepoRoot = path.resolve(pkgRoot, "../..");            // repo root

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal collection definition used by the tests. */
function tasksCollectionJs(): string {
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
        done:  { name: "Done",  type: "boolean" }
    }
};
export default tasksCollection;
`;
}

function notesCollectionJs(): string {
    return `
const notesCollection = {
    name: "Notes",
    singularName: "Note",
    slug: "notes",
    table: "notes",
    icon: "Notebook",
    group: "Core",
    properties: {
        id:      { name: "ID",      type: "string", isId: "uuid", validation: { required: true } },
        content: { name: "Content", type: "string" }
    }
};
export default notesCollection;
`;
}

function collectionsIndex(names: string[]): string {
    const imports = names.map(n => `import ${n}Collection from "./${n}.js";`).join("\n");
    const exports = names.map(n => `${n}Collection`).join(", ");
    return `${imports}\nexport default [${exports}];\n`;
}

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    // Strip pnpm/npm runner variables to avoid leaking the parent workspace context
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

// Resolve the CLI script path that the `rebase` command dispatches to
function resolveCliScript(): string {
    const cliScript = path.join(pkgRoot, "src", "cli.ts");
    if (!fs.existsSync(cliScript)) {
        throw new Error(`CLI script not found at ${cliScript}`);
    }
    return cliScript;
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("Database migration E2E", () => {
    let container: PgContainer;
    let dbClient: pg.Client;
    let workDir: string;          // temp directory acting as the "backend" cwd
    let collectionsDir: string;   // temp directory for collection definitions
    let env: Record<string, string>;

    beforeAll(async () => {
        // 1. Spin up Postgres container
        container = await startPgContainer();

        // 2. Connect with pg.Client for assertions (retry a few times)
        let connectAttempts = 0;
        const maxConnectAttempts = 10;
        while (connectAttempts < maxConnectAttempts) {
            try {
                dbClient = new pg.Client({ connectionString: container.connectionString });
                await dbClient.connect();
                break;
            } catch {
                connectAttempts++;
                if (connectAttempts === maxConnectAttempts) {
                    throw new Error("Could not connect to Postgres after retries");
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // 3. Create temp working directory structure:
        //      workDir/                  ← acts like app/backend
        //      workDir/../config/collections/  ← collection definitions
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-e2e-"));
        workDir = path.join(base, "backend");
        collectionsDir = path.join(base, "config", "collections");
        fs.mkdirSync(workDir, { recursive: true });
        fs.mkdirSync(collectionsDir, { recursive: true });

        // Create a minimal package.json so tsx can resolve modules
        fs.writeFileSync(
            path.join(workDir, "package.json"),
            JSON.stringify({ name: "e2e-test-backend", type: "module" }),
            "utf-8"
        );

        // Collections dir also needs type:module for .js ESM imports
        fs.writeFileSync(
            path.join(collectionsDir, "package.json"),
            JSON.stringify({ type: "module" }),
            "utf-8"
        );

        env = cleanEnv(container.connectionString);
    }, 60_000);

    afterAll(async () => {
        if (dbClient) try { await dbClient.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    // Resolve tsx binary from the monorepo
    function tsx(...args: string[]) {
        const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");
        return execa(tsxBin, args, { cwd: workDir, env, stdio: "inherit" });
    }

    // ── Scenario 1: Fresh database ──────────────────────────────────────

    it("should generate and apply the initial migration on an empty database", async () => {
        const cliScript = resolveCliScript();

        // Write a single collection
        fs.writeFileSync(path.join(collectionsDir, "tasks.js"), tasksCollectionJs());
        fs.writeFileSync(path.join(collectionsDir, "index.js"), collectionsIndex(["tasks"]));

        // ── db:generate ──
        console.log("[e2e] Running db generate…");
        await tsx(cliScript, "db", "generate", "--collections", collectionsDir, "init");

        // Verify migration file was created
        const migrationsDir = path.join(workDir, "drizzle", "migrations");
        expect(fs.existsSync(migrationsDir)).toBe(true);
        const sqlFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql"));
        expect(sqlFiles.length).toBe(1);
        expect(sqlFiles[0]).toContain("init");

        // Verify the migration contains our table
        const migrationSql = fs.readFileSync(path.join(migrationsDir, sqlFiles[0]), "utf-8");
        expect(migrationSql).toContain("CREATE TABLE");
        expect(migrationSql).toContain("tasks");

        // ── db:migrate ──
        console.log("[e2e] Running db migrate…");
        await tsx(cliScript, "db", "migrate");

        // Verify collection table was created
        const tablesAfterMigrate = await dbClient.query(`
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema IN ('public', 'rebase')
            ORDER BY table_schema, table_name
        `);
        const tableList = tablesAfterMigrate.rows.map(
            (r: { table_schema: string; table_name: string }) =>
                `${r.table_schema}.${r.table_name}`
        );
        console.log("[e2e] Tables after migrate:", tableList);
        expect(tableList).toContain("public.tasks");

        // Verify atlas_schema_revisions is in the rebase schema, NOT public
        expect(tableList).toContain("rebase.atlas_schema_revisions");
        expect(tableList.filter(t => t === "public.atlas_schema_revisions")).toHaveLength(0);

        // ── Auth bootstrap (ensureAuthTablesExist) ──
        console.log("[e2e] Testing auth table bootstrap…");
        const { ensureAuthTablesExist } = await import("../../src/auth/ensure-tables.js");
        const { drizzle } = await import("drizzle-orm/node-postgres");
        const pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        try {
            await ensureAuthTablesExist(db);
        } finally {
            await pool.end();
        }

        // Verify auth tables were created
        const authTablesRes = await dbClient.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'rebase'
            ORDER BY table_name
        `);
        const authTables = authTablesRes.rows.map((r: { table_name: string }) => r.table_name);
        console.log("[e2e] Auth tables:", authTables);

        expect(authTables).toContain("users");
        expect(authTables).toContain("user_identities");
        expect(authTables).toContain("refresh_tokens");
        expect(authTables).toContain("password_reset_tokens");

        // Verify user registration works (INSERT into users)
        const insertRes = await dbClient.query(`
            INSERT INTO rebase.users (email, password_hash, email_verified, metadata)
            VALUES ('e2e@test.com', 'hash123', true, '{}'::jsonb)
            RETURNING id, email
        `);
        expect(insertRes.rows.length).toBe(1);
        expect(insertRes.rows[0].email).toBe("e2e@test.com");
    }, 120_000);

    // ── Scenario 2: Incremental migration ───────────────────────────────

    it("should generate and apply an incremental migration preserving existing data", async () => {
        const cliScript = resolveCliScript();

        // Add a second collection
        fs.writeFileSync(path.join(collectionsDir, "notes.js"), notesCollectionJs());
        fs.writeFileSync(
            path.join(collectionsDir, "index.js"),
            collectionsIndex(["tasks", "notes"])
        );

        // ── db:generate (incremental) ──
        console.log("[e2e] Running incremental db generate…");
        await tsx(cliScript, "db", "generate", "--collections", collectionsDir, "add_notes");

        // Verify a SECOND migration file was created
        const migrationsDir = path.join(workDir, "drizzle", "migrations");
        const sqlFiles = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith(".sql"))
            .sort();
        expect(sqlFiles.length).toBe(2);
        expect(sqlFiles[1]).toContain("add_notes");

        // ── db:migrate (incremental) ──
        console.log("[e2e] Running incremental db migrate…");
        await tsx(cliScript, "db", "migrate");

        // Verify both tables exist
        const tablesRes = await dbClient.query(`
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        const publicTables = tablesRes.rows.map(
            (r: { table_name: string }) => r.table_name
        );
        console.log("[e2e] Public tables after incremental migrate:", publicTables);

        expect(publicTables).toContain("tasks");
        expect(publicTables).toContain("notes");

        // Verify existing data survived (the user inserted in scenario 1)
        const userRes = await dbClient.query(
            "SELECT email FROM rebase.users WHERE email = 'e2e@test.com'"
        );
        expect(userRes.rows.length).toBe(1);
    }, 120_000);
});
