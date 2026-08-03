import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execa } from "execa";
import pg from "pg";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { cliRoot, getCleanEnv, killTree, linkLocalPackages } from "./helpers.js";

describe("Rebase CLI E2E Integration Suite", () => {
    let pgContainer: PgContainer;
    let tempDir: string;
    let scaffoldedDir: string;
    let dbClient: pg.Client;

    beforeAll(async () => {
        // Spin up the temporary Postgres container
        pgContainer = await startPgContainer();

        // Create temporary directory for project scaffolding
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cli-e2e-"));
        scaffoldedDir = path.join(tempDir, "my-app");

        let connectAttempts = 0;
        const maxConnectAttempts = 5;
        while (connectAttempts < maxConnectAttempts) {
            try {
                dbClient = new pg.Client({
                    connectionString: pgContainer.connectionString
                });
                await dbClient.connect();
                break;
            } catch (e) {
                connectAttempts++;
                if (connectAttempts === maxConnectAttempts) throw e;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }, 180_000); // 3-minute setup allowance

    afterAll(async () => {
        // Close database connection
        if (dbClient) {
            try {
                await dbClient.end();
            } catch (e) {
                // ignore
            }
        }

        // Clean up temporary Postgres container
        if (pgContainer) {
            await stopPgContainer(pgContainer.containerName);
        }

        // Clean up scaffolded directory
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true,
force: true });
            } catch (e) {
                console.error(`Failed to clean up temporary folder: ${tempDir}`, e);
            }
        }
    }, 60_000);

    it("should scaffold project, install workspace dependencies, run database operations, and perform auth password reset", async () => {
        const cliBin = path.join(cliRoot, "bin", "rebase.js");
        const cleanEnv = getCleanEnv();

        console.log("1. Scaffolding project via rebase init...");
        // Do NOT pass --install so we can link local workspace packages first
        await execa("node", [
            cliBin,
            "init",
            "my-app",
            "--yes",
            "--database-url",
            pgContainer.connectionString
        ], {
            cwd: tempDir,
            env: cleanEnv
        });

        expect(fs.existsSync(scaffoldedDir)).toBe(true);
        expect(fs.existsSync(path.join(scaffoldedDir, "package.json"))).toBe(true);
        expect(fs.existsSync(path.join(scaffoldedDir, "pnpm-workspace.yaml"))).toBe(true);

        console.log("2. Linking local monorepo packages in package.json files...");
        linkLocalPackages(scaffoldedDir);

        console.log("3. Installing dependencies in scaffolded project...");
        await execa("pnpm", ["install"], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });

        console.log("4. Running schema generate...");
        await execa("node", [
            cliBin,
            "schema",
            "generate",
            "--collections",
            "../config/collections"
        ], {
            cwd: scaffoldedDir,
            env: cleanEnv
        });

        const generatedSchemaPath = path.join(scaffoldedDir, "backend", "src", "schema.generated.ts");
        expect(fs.existsSync(generatedSchemaPath)).toBe(true);
        console.log("=== GENERATED SCHEMA CONTENT ===");
        console.log(fs.readFileSync(generatedSchemaPath, "utf-8"));
        console.log("=================================");

        console.log("5. Verifying that the generated schema builds...");
        await execa("pnpm", ["exec", "tsc", "--noEmit"], {
            cwd: path.join(scaffoldedDir, "backend"),
            env: cleanEnv
        });

        console.log("6. Running db push to migrate the database schema...");
        await execa("node", [
            cliBin,
            "db",
            "push",
            "--collections",
            "../config/collections",
            "--force"
        ], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });

        console.log("6.5. Bootstrapping Rebase backend briefly to initialize auth tables...");
        // `rebase dev --backend-only` from the project root. 3fbe27a2b moved the
        // scaffolded backend onto the managed runtime and dropped its `dev`
        // script — the root's `rebase dev` runs it now — so `pnpm run dev` in
        // `backend/` died with ERR_PNPM_NO_SCRIPT before a server ever started.
        // (Same fix as `startBackend` in helpers.ts; this suite predates that
        // helper and boots its own.)
        const backendProcess = execa("node", [cliBin, "dev", "--backend-only"], {
            cwd: scaffoldedDir,
            env: cleanEnv,
            detached: true // so killTree can reap the tsx/backend it spawns
        });

        await new Promise<void>((resolve, reject) => {
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    killTree(backendProcess, "SIGKILL");
                    reject(new Error("Timeout waiting for backend to bootstrap auth tables"));
                }
            }, 45000);

            backendProcess.stdout?.on("data", (data) => {
                const output = data.toString();
                console.log("[BACKEND OUT]", output.trim());
                if (output.includes("Auth tables ready") || output.includes("Server running at")) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        setTimeout(() => {
                            killTree(backendProcess, "SIGKILL");
                            resolve();
                        }, 2000);
                    }
                }
            });

            backendProcess.stderr?.on("data", (data) => {
                console.error("[BACKEND ERR]", data.toString().trim());
            });

            backendProcess.catch((err) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                reject(err);
            });
        });

        console.log("7. Querying database tables and indices to verify creation...");
        const tablesRes = await dbClient.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema IN ('public', 'rebase')
        `);
        const tables = tablesRes.rows.map(r => `${r.table_schema}.${r.table_name}`);

        console.log("Detected tables:", tables);
        expect(tables).toContain("rebase.users");
        expect(tables).toContain("rebase.refresh_tokens");
        expect(tables).toContain("rebase.password_reset_tokens");
        expect(tables).toContain("rebase.app_config");
        expect(tables).toContain("public.authors");
        expect(tables).toContain("public.posts");
        expect(tables).toContain("public.tags");

        // Verify indexes
        const indexesRes = await dbClient.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE schemaname = 'rebase'
        `);
        const indexNames = indexesRes.rows.map(r => r.indexname);
        console.log("Detected indexes:", indexNames);
        expect(indexNames).toContain("idx_refresh_tokens_hash");
        expect(indexNames).toContain("idx_refresh_tokens_user");
        expect(indexNames).toContain("idx_password_reset_tokens_hash");
        expect(indexNames).toContain("idx_password_reset_tokens_user");

        console.log("8. Inserting a mock user...");
        const mockUserId = crypto.randomUUID();
        const mockEmail = "e2e-user@rebase.pro";
        const initialPasswordHash = "initial_unhashed_placeholder";

        await dbClient.query(`
            INSERT INTO rebase.users (id, email, password_hash, display_name, email_verified, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `, [mockUserId, mockEmail, initialPasswordHash, "E2E Test User", true, "{}"]);

        const insertCheck = await dbClient.query("SELECT password_hash FROM rebase.users WHERE id = $1", [mockUserId]);
        expect(insertCheck.rows[0].password_hash).toBe(initialPasswordHash);

        console.log("9. Resetting user password via CLI...");
        await execa("node", [
            cliBin,
            "auth",
            "reset-password",
            "--email",
            mockEmail,
            "--password",
            "SuperSecretPassword123!"
        ], {
            cwd: scaffoldedDir,
            env: cleanEnv
        });

        console.log("10. Verifying that the password hash was updated in the database...");
        const selectRes = await dbClient.query("SELECT password_hash FROM rebase.users WHERE id = $1", [mockUserId]);
        const updatedHash = selectRes.rows[0].password_hash;

        expect(updatedHash).toBeDefined();
        expect(updatedHash).not.toBe(initialPasswordHash);
        expect(updatedHash.length).toBeGreaterThan(20); // Password hashes are typically much longer

        console.log("11. Testing CLI help and version commands...");
        // `stdio: "inherit"` captures nothing, so the results these were assigned
        // to were empty and then unasserted — the steps proved only that the
        // processes exited 0. Capture the output and check what it is for.
        const helpRes = await execa("node", [cliBin, "--help"], { cwd: scaffoldedDir,
env: cleanEnv });
        for (const command of ["init", "dev", "build", "db", "schema", "generate-sdk"]) {
            expect(helpRes.stdout).toContain(command);
        }

        const versionRes = await execa("node", [cliBin, "--version"], { cwd: scaffoldedDir,
env: cleanEnv });
        expect(versionRes.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

        console.log("12. Testing generate-sdk command...");
        await execa("node", [
            cliBin,
            "generate-sdk"
        ], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });
        expect(fs.existsSync(path.join(scaffoldedDir, "generated", "sdk", "database.types.ts"))).toBe(true);
        expect(fs.existsSync(path.join(scaffoldedDir, "generated", "sdk", "README.md"))).toBe(true);

        console.log("13. Testing doctor command...");
        await execa("node", [
            cliBin,
            "doctor"
        ], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });

        console.log("14. Testing db generate migrations...");
        await execa("node", [
            cliBin,
            "db",
            "generate",
            "--collections",
            "../config/collections"
        ], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });
        // Verify that migration files are created under backend/drizzle
        const drizzleDir = path.join(scaffoldedDir, "backend", "drizzle");
        expect(fs.existsSync(drizzleDir)).toBe(true);
        const files = fs.readdirSync(drizzleDir);
        expect(files.some(f => f.endsWith(".sql"))).toBe(true);

        console.log("15. Dropping tables to test db migrate from scratch...");
        await dbClient.query("DROP TABLE IF EXISTS posts_tags CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS posts CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS authors CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS tags CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS rebase.users CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS rebase.branches CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS rebase.user_identities CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS rebase.refresh_tokens CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS rebase.password_reset_tokens CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS rebase.app_config CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS rebase.entity_history CASCADE");
        await dbClient.query("DROP SCHEMA IF EXISTS rebase CASCADE");
        await dbClient.query("DROP TABLE IF EXISTS __drizzle_migrations CASCADE");
        await dbClient.query("DROP TYPE IF EXISTS posts_status CASCADE");

        console.log("15b. Testing db migrate...");
        await execa("node", [
            cliBin,
            "db",
            "migrate"
        ], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });

        console.log("16. Disconnecting dbClient to enable database branching templates...");
        await dbClient.end();

        console.log("17. Testing db branch create, list, and delete...");
        await execa("node", [
            cliBin,
            "db",
            "branch",
            "create",
            "e2e-test-branch"
        ], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });

        // Captured, not inherited: `list` has to actually report the branch that
        // was just created, and report it gone once it is deleted. Inheriting
        // stdio left `listRes` empty and unasserted, so create/list/delete
        // passed as long as three processes exited 0 — including if `create`
        // created nothing.
        const listRes = await execa("node", [
            cliBin,
            "db",
            "branch",
            "list"
        ], {
            cwd: scaffoldedDir,
            env: cleanEnv
        });
        // `e2etestbranch`, not `e2e-test-branch`: `sanitizeBranchName` strips
        // everything outside [a-zA-Z0-9_] so the name can back a `rb_<name>`
        // database, and it is the *sanitized* form that gets recorded. Create,
        // list and delete all sanitize alike, so a hyphenated name works end to
        // end — it is only ever displayed stripped.
        //
        // Asserted on the hyphenated input on purpose: that is the case where
        // the two forms differ, and pinning it here is what would catch the
        // stripping changing, or becoming inconsistent between the verbs.
        const SANITIZED = "e2etestbranch";
        expect(listRes.stdout).toContain(SANITIZED);

        await execa("node", [
            cliBin,
            "db",
            "branch",
            "delete",
            "e2e-test-branch"
        ], {
            cwd: scaffoldedDir,
            stdio: "inherit",
            env: cleanEnv
        });

        const afterDelete = await execa("node", [
            cliBin,
            "db",
            "branch",
            "list"
        ], {
            cwd: scaffoldedDir,
            env: cleanEnv
        });
        // Was `not.toContain("e2e-test-branch")`, which passed without proving
        // anything: `list` never prints the hyphenated form, so the assertion
        // held whether or not the delete did a thing. Same string `list` is
        // checked for above, which is the only one that can go absent.
        expect(afterDelete.stdout).not.toContain(SANITIZED);
    }, 240_000); // 4 minutes total execution allowance
});
