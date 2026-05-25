import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { execa } from "execa";
import pg from "pg";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliRoot = path.resolve(__dirname, "../../");

function getCleanEnv(): Record<string, string> {
    const cleanEnv = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(cleanEnv)) {
        if (
            key.startsWith("npm_") ||
            key.startsWith("PNPM_") ||
            key.startsWith("pnpm_") ||
            key.startsWith("NPM_")
        ) {
            delete cleanEnv[key];
        }
    }
    cleanEnv.REBASE_E2E = "true";
    return cleanEnv;
}

function linkLocalPackages(projectPath: string) {
    const pkgPaths = [
        path.join(projectPath, "package.json"),
        path.join(projectPath, "backend", "package.json"),
        path.join(projectPath, "frontend", "package.json"),
        path.join(projectPath, "config", "package.json")
    ];

    const rootDir = path.resolve(cliRoot, "../.."); // `/Users/francesco/rebase`

    for (const pkgPath of pkgPaths) {
        if (!fs.existsSync(pkgPath)) continue;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        
        const updateDeps = (deps: Record<string, string> | undefined) => {
            if (!deps) return;
            for (const [name, version] of Object.entries(deps)) {
                if (name.startsWith("@rebasepro/")) {
                    const localPath = path.join(rootDir, "packages", name.replace("@rebasepro/", ""));
                    deps[name] = `link:${localPath}`;
                }
            }
        };

        updateDeps(pkg.dependencies);
        updateDeps(pkg.devDependencies);
        updateDeps(pkg.peerDependencies);

        // For the root package.json of the scaffolded project, add hono and drizzle-orm to devDependencies
        // and add pnpm overrides to ensure workspace consistency
        if (pkgPath === path.join(projectPath, "package.json")) {
            if (!pkg.devDependencies) {
                pkg.devDependencies = {};
            }
            pkg.devDependencies["hono"] = `link:${path.join(rootDir, "node_modules", "hono")}`;
            pkg.devDependencies["drizzle-orm"] = `link:${path.join(rootDir, "node_modules", "drizzle-orm")}`;

            if (!pkg.pnpm) {
                pkg.pnpm = {};
            }
            pkg.pnpm.overrides = {
                "hono": `link:${path.join(rootDir, "node_modules", "hono")}`,
                "drizzle-orm": `link:${path.join(rootDir, "node_modules", "drizzle-orm")}`
            };
        }

        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4), "utf-8");
    }
}

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

        // Set up database client connection
        dbClient = new pg.Client({
            connectionString: pgContainer.connectionString
        });
        await dbClient.connect();
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
                fs.rmSync(tempDir, { recursive: true, force: true });
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
        const backendProcess = execa("pnpm", ["run", "dev"], {
            cwd: path.join(scaffoldedDir, "backend"),
            env: cleanEnv
        });

        await new Promise<void>((resolve, reject) => {
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    backendProcess.kill();
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
                            backendProcess.kill();
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
        expect(tables).toContain("public.users");
        expect(tables).toContain("rebase.roles");
        expect(tables).toContain("rebase.user_roles");
        expect(tables).toContain("rebase.refresh_tokens");
        expect(tables).toContain("rebase.password_reset_tokens");
        expect(tables).toContain("rebase.app_config");
        expect(tables).toContain("public.authors");
        expect(tables).toContain("public.posts");
        expect(tables).toContain("public.tags");

        // Verify seeded roles
        const rolesRes = await dbClient.query("SELECT id, name FROM rebase.roles ORDER BY id");
        const roles = rolesRes.rows.map(r => r.id);
        console.log("Detected roles:", roles);
        expect(roles).toContain("admin");
        expect(roles).toContain("editor");
        expect(roles).toContain("viewer");

        // Verify indexes
        const indexesRes = await dbClient.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE schemaname = 'rebase'
        `);
        const indexNames = indexesRes.rows.map(r => r.indexname);
        console.log("Detected indexes:", indexNames);
        expect(indexNames).toContain("idx_user_roles_user");
        expect(indexNames).toContain("idx_refresh_tokens_hash");
        expect(indexNames).toContain("idx_refresh_tokens_user");
        expect(indexNames).toContain("idx_password_reset_tokens_hash");
        expect(indexNames).toContain("idx_password_reset_tokens_user");

        console.log("8. Inserting a mock user...");
        const mockUserId = crypto.randomUUID();
        const mockEmail = "e2e-user@rebase.pro";
        const initialPasswordHash = "initial_unhashed_placeholder";

        await dbClient.query(`
            INSERT INTO public.users (id, email, password_hash, display_name, email_verified, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `, [mockUserId, mockEmail, initialPasswordHash, "E2E Test User", true, "{}"]);

        const insertCheck = await dbClient.query("SELECT password_hash FROM public.users WHERE id = $1", [mockUserId]);
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
        const selectRes = await dbClient.query("SELECT password_hash FROM public.users WHERE id = $1", [mockUserId]);
        const updatedHash = selectRes.rows[0].password_hash;
        
        expect(updatedHash).toBeDefined();
        expect(updatedHash).not.toBe(initialPasswordHash);
        expect(updatedHash.length).toBeGreaterThan(20); // Password hashes are typically much longer
    }, 180_000); // 3 minutes total execution allowance
});
