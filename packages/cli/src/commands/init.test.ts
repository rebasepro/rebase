/**
 * Tests for `rebase init` — the project scaffolding command.
 *
 * These verify that init produces a correct, buildable project structure
 * with all placeholders replaced and secrets generated.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { cp } from "fs/promises";
import { configureEnvFile } from "./init.js";

let tmpDir: string;

// Resolve the template dir the same way the CLI does
function findCliRoot(): string {
    let dir = path.resolve(__dirname, "..");
    while (dir !== path.parse(dir).root) {
        if (path.basename(dir) === "cli") return dir;
        dir = path.dirname(dir);
    }
    throw new Error("Could not find CLI root");
}

const TEMPLATE_DIR = path.join(findCliRoot(), "templates", "template");

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-test-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true,
force: true });
});

/**
 * Helper: simulate what `createProject` does without spawning git/pnpm.
 * Copies the template and runs placeholder replacement.
 */
async function simulateInit(projectName: string): Promise<string> {
    const targetDir = path.join(tmpDir, projectName);
    fs.mkdirSync(targetDir, { recursive: true });

    await cp(TEMPLATE_DIR, targetDir, {
        recursive: true,
        filter: (source: string) => {
            const basename = path.basename(source);
            return basename !== "node_modules" && basename !== ".DS_Store";
        }
    });

    // Replace placeholders
    const filesToProcess = [
        "package.json",
        "frontend/package.json",
        "backend/package.json",
        "config/package.json",
        "frontend/index.html",
        "README.md"
    ];

    for (const file of filesToProcess) {
        const fullPath = path.join(targetDir, file);
        if (!fs.existsSync(fullPath)) continue;
        let content = fs.readFileSync(fullPath, "utf-8");
        content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
        fs.writeFileSync(fullPath, content, "utf-8");
    }

    return targetDir;
}

// =============================================================================
// Template structure
// =============================================================================

describe("template structure", () => {
    it("contains all required directories", () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "config"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "config", "collections"))).toBe(true);
    });

    it("contains essential config files", () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "package.json"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, ".env.example"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "docker-compose.yml"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "pnpm-workspace.yaml"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, ".gitignore"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "README.md"))).toBe(true);
    });

    it("contains backend entry point and schema", () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "src", "index.ts"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "src", "schema.generated.ts"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "drizzle.config.ts"))).toBe(true);
    });

    it("contains frontend entry point", () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend", "src", "App.tsx"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend", "src", "main.tsx"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend", "vite.config.ts"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend", "index.html"))).toBe(true);
    });

    it("contains a functions/ directory with an example", () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "functions"))).toBe(true);
        const functions = fs.readdirSync(path.join(TEMPLATE_DIR, "backend", "functions"));
        expect(functions.length).toBeGreaterThan(0);
    });

    it("contains Dockerfiles for production deployment", () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "Dockerfile"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend", "Dockerfile"))).toBe(true);
    });
});

// =============================================================================
// Placeholder replacement
// =============================================================================

describe("placeholder replacement", () => {
    it("replaces {{PROJECT_NAME}} in root package.json", async () => {
        const targetDir = await simulateInit("my-cool-app");
        const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf-8"));
        expect(pkg.name).toBe("my-cool-app");
        expect(JSON.stringify(pkg)).not.toContain("{{PROJECT_NAME}}");
    });

    it("replaces {{PROJECT_NAME}} in backend package.json", async () => {
        const targetDir = await simulateInit("test-project");
        const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "backend", "package.json"), "utf-8"));
        expect(pkg.name).toBe("test-project-backend");
    });

    it("replaces {{PROJECT_NAME}} in frontend package.json", async () => {
        const targetDir = await simulateInit("test-project");
        const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "frontend", "package.json"), "utf-8"));
        expect(pkg.name).toBe("test-project-frontend");
    });

    it("replaces {{PROJECT_NAME}} in config package.json", async () => {
        const targetDir = await simulateInit("test-project");
        const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "config", "package.json"), "utf-8"));
        expect(pkg.name).toBe("test-project-config");
    });

    it("replaces {{PROJECT_NAME}} in README.md", async () => {
        const targetDir = await simulateInit("my-blog");
        const readme = fs.readFileSync(path.join(targetDir, "README.md"), "utf-8");
        expect(readme).toContain("# my-blog");
        expect(readme).not.toContain("{{PROJECT_NAME}}");
    });

    it("leaves no unreplaced placeholders in any processed file", async () => {
        const targetDir = await simulateInit("clean-app");
        const filesToCheck = [
            "package.json",
            "frontend/package.json",
            "backend/package.json",
            "config/package.json",
            "README.md"
        ];

        for (const file of filesToCheck) {
            const fullPath = path.join(targetDir, file);
            if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, "utf-8");
                expect(content).not.toContain("{{PROJECT_NAME}}");
            }
        }
    });
});

// =============================================================================
// Collection definitions
// =============================================================================

describe("template collections", () => {
    it("has a collections index that exports an array", () => {
        const indexPath = path.join(TEMPLATE_DIR, "config", "collections", "index.ts");
        const content = fs.readFileSync(indexPath, "utf-8");
        expect(content).toContain("export");
        expect(content).toContain("collections");
    });

    it("has at least posts, authors, and tags collections", () => {
        const collectionsDir = path.join(TEMPLATE_DIR, "config", "collections");
        const files = fs.readdirSync(collectionsDir).filter(f => f.endsWith(".ts") && f !== "index.ts");
        const basenames = files.map(f => f.replace(".ts", ""));

        expect(basenames).toContain("posts");
        expect(basenames).toContain("authors");
        expect(basenames).toContain("tags");
    });

    it("each collection file exports a valid EntityCollection shape", () => {
        const collectionsDir = path.join(TEMPLATE_DIR, "config", "collections");
        const files = fs.readdirSync(collectionsDir).filter(f => f.endsWith(".ts") && f !== "index.ts");

        for (const file of files) {
            const content = fs.readFileSync(path.join(collectionsDir, file), "utf-8");
            // Check required EntityCollection fields are present
            expect(content).toContain("name:");
            expect(content).toContain("slug:");
            expect(content).toContain("properties:");
            expect(content).toContain("EntityCollection");
        }
    });

    it("posts collection demonstrates an enum property", () => {
        const postsPath = path.join(TEMPLATE_DIR, "config", "collections", "posts.ts");
        const content = fs.readFileSync(postsPath, "utf-8");
        expect(content).toContain("enum:");
        expect(content).toContain("draft");
        expect(content).toContain("published");
    });

    it("posts collection demonstrates a relation to authors", () => {
        const postsPath = path.join(TEMPLATE_DIR, "config", "collections", "posts.ts");
        const content = fs.readFileSync(postsPath, "utf-8");
        expect(content).toContain('type: "relation"');
        expect(content).toContain("authorsCollection");
    });

    it("posts collection demonstrates a many-to-many relation to tags", () => {
        const postsPath = path.join(TEMPLATE_DIR, "config", "collections", "posts.ts");
        const content = fs.readFileSync(postsPath, "utf-8");
        expect(content).toContain("tagsCollection");
        expect(content).toContain("\"many\"");
    });
});

// =============================================================================
// Package.json structure
// =============================================================================

describe("template package.json contracts", () => {
    it("root package.json has all expected scripts", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
        expect(pkg.scripts.dev).toBe("rebase dev");
        expect(pkg.scripts["db:push"]).toBe("rebase db push --collections ../config/collections");
        expect(pkg.scripts["db:generate"]).toBe("rebase db generate --collections ../config/collections");
        expect(pkg.scripts["schema:generate"]).toBe("rebase schema generate --collections ../config/collections");
    });

    it("root package.json is marked as private", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
        expect(pkg.private).toBe(true);
    });

    it("root package.json is type: module (ESM)", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
        expect(pkg.type).toBe("module");
    });

    it("backend package.json has required dependencies", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "backend", "package.json"), "utf-8"));
        expect(pkg.dependencies).toHaveProperty("@rebasepro/server-core");
        expect(pkg.dependencies).toHaveProperty("@rebasepro/server-postgresql");
        expect(pkg.dependencies).toHaveProperty("hono");
        expect(pkg.dependencies).toHaveProperty("drizzle-orm");
    });

    it("frontend package.json has required dependencies", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "frontend", "package.json"), "utf-8"));
        expect(pkg.dependencies).toHaveProperty("@rebasepro/core");
        expect(pkg.dependencies).toHaveProperty("@rebasepro/auth");
        expect(pkg.dependencies).toHaveProperty("@rebasepro/client");
        expect(pkg.dependencies).toHaveProperty("react");
        expect(pkg.dependencies).toHaveProperty("react-dom");
    });

    it("config package.json depends on @rebasepro/types", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "config", "package.json"), "utf-8"));
        expect(pkg.dependencies).toHaveProperty("@rebasepro/types");
    });

    it("pnpm-workspace.yaml references all workspace packages", () => {
        const workspace = fs.readFileSync(path.join(TEMPLATE_DIR, "pnpm-workspace.yaml"), "utf-8");
        expect(workspace).toContain("backend");
        expect(workspace).toContain("frontend");
        expect(workspace).toContain("config");
    });
});

// =============================================================================
// Dual package manager compatibility
// =============================================================================

describe("dual PM compatibility", () => {
    describe("workspace configuration", () => {
        it("ships both pnpm-workspace.yaml AND workspaces in package.json", () => {
            // Both must coexist for the project to work with either PM
            expect(fs.existsSync(path.join(TEMPLATE_DIR, "pnpm-workspace.yaml"))).toBe(true);
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            expect(pkg.workspaces).toEqual(["frontend", "backend", "config"]);
        });

        it("pnpm-workspace.yaml and package.json workspaces define the same packages", () => {
            const workspace = fs.readFileSync(path.join(TEMPLATE_DIR, "pnpm-workspace.yaml"), "utf-8");
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            for (const ws of pkg.workspaces) {
                expect(workspace).toContain(ws);
            }
        });
    });

    describe("scripts are PM-agnostic", () => {
        it("root scripts use rebase CLI commands, not pnpm/npm directly", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            const pmSpecificPatterns = [
                /^pnpm\s/,
                /^npm\s/,
                /^npx\s/
            ];

            for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) {
                const cmd = scriptCmd as string;
                for (const pattern of pmSpecificPatterns) {
                    expect(
                        pattern.test(cmd),
                        `Script "${scriptName}" (${cmd}) should not start with a PM-specific command`
                    ).toBe(false);
                }
            }
        });

        it("dev script uses 'rebase dev'", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            expect(pkg.scripts.dev).toBe("rebase dev");
        });

        it("build script uses 'rebase build'", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            expect(pkg.scripts.build).toBe("rebase build");
        });

        it("start script uses 'rebase start'", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            expect(pkg.scripts.start).toBe("rebase start");
        });

        it("deploy script uses rebase commands", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            expect(pkg.scripts.deploy).toBe("rebase build && rebase start");
        });
    });

    describe("internal dependencies use '*' (not workspace:*)", () => {
        it("backend config dependency uses '*'", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "backend", "package.json"), "utf-8"));
            const configDep = Object.entries(pkg.dependencies).find(
                ([name]) => name.includes("-config")
            );
            expect(configDep).toBeTruthy();
            expect(configDep![1]).toBe("*");
        });

        it("frontend config dependency uses '*'", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "frontend", "package.json"), "utf-8"));
            const configDep = Object.entries(pkg.dependencies).find(
                ([name]) => name.includes("-config")
            );
            expect(configDep).toBeTruthy();
            expect(configDep![1]).toBe("*");
        });
    });

    describe(".npmrc configuration", () => {
        it("ships a .npmrc file", () => {
            expect(fs.existsSync(path.join(TEMPLATE_DIR, ".npmrc"))).toBe(true);
        });

        it(".npmrc enables link-workspace-packages for pnpm", () => {
            const npmrc = fs.readFileSync(path.join(TEMPLATE_DIR, ".npmrc"), "utf-8");
            expect(npmrc).toContain("link-workspace-packages=true");
        });
    });

    describe("README documents both package managers", () => {
        it("mentions both pnpm and npm", () => {
            const readme = fs.readFileSync(path.join(TEMPLATE_DIR, "README.md"), "utf-8");
            expect(readme).toContain("pnpm");
            expect(readme).toContain("npm");
        });

        it("does not contain any unreplaced PM placeholders", () => {
            const readme = fs.readFileSync(path.join(TEMPLATE_DIR, "README.md"), "utf-8");
            expect(readme).not.toContain("{{PACKAGE_MANAGER}}");
            expect(readme).not.toContain("{{INSTALL_CMD}}");
            expect(readme).not.toContain("{{RUN_DEV_CMD}}");
            expect(readme).not.toContain("{{PACKAGE_MANAGER_URL}}");
        });
    });

    describe("docker-compose is PM-agnostic", () => {
        it("does not reference pnpm or npm directly", () => {
            const compose = fs.readFileSync(path.join(TEMPLATE_DIR, "docker-compose.yml"), "utf-8");
            // Should use "rebase dev" not "pnpm dev" or "npm run dev"
            expect(compose).not.toMatch(/\bpnpm\b/);
            expect(compose).not.toMatch(/\bnpm\b/);
        });
    });
});

// =============================================================================
// .env.example
// =============================================================================

describe(".env.example", () => {
    it("contains all required environment variables", () => {
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.example"), "utf-8");
        expect(envContent).toContain("DATABASE_URL");
        expect(envContent).toContain("JWT_SECRET");
        expect(envContent).toContain("PORT");
        expect(envContent).toContain("NODE_ENV");
        expect(envContent).toContain("VITE_API_URL");
    });

    it("contains setup instructions for required values", () => {
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.example"), "utf-8");
        expect(envContent).toContain("required");
    });
    it("has optional SMTP section commented out", () => {
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.example"), "utf-8");
        expect(envContent).toContain("# SMTP_HOST");
    });

    it("does not contain Docker-specific POSTGRES_USER or POSTGRES_PASSWORD vars", () => {
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.example"), "utf-8");
        // These should no longer appear — Docker Compose uses its own defaults
        expect(envContent).not.toMatch(/^POSTGRES_USER=/m);
        expect(envContent).not.toMatch(/^POSTGRES_PASSWORD=/m);
        expect(envContent).not.toMatch(/^POSTGRES_DB=/m);
        expect(envContent).not.toMatch(/^POSTGRES_PORT=/m);
        expect(envContent).not.toMatch(/^FRONTEND_PORT=/m);
    });

    it("configureEnvFile successfully generates a valid .env", async () => {
        const targetDir = await simulateInit("env-test-app");
        // simulateInit does not call configureEnvFile, so we call it manually
        await configureEnvFile(targetDir);

        const envPath = path.join(targetDir, ".env");
        expect(fs.existsSync(envPath)).toBe(true);

        // .env.example should still exist (it's copied, not moved)
        const envExamplePath = path.join(targetDir, ".env.example");
        expect(fs.existsSync(envExamplePath)).toBe(true);

        const envContent = fs.readFileSync(envPath, "utf-8");

        // Verify that JWT_SECRET is properly replaced (it should be 64 hex characters, so > 32 length)
        const jwtMatch = envContent.match(/^JWT_SECRET=(.*)$/m);
        expect(jwtMatch).toBeTruthy();
        expect(jwtMatch![1].length).toBeGreaterThanOrEqual(32);

        // Verify local default DB url
        const dbMatch = envContent.match(/^DATABASE_URL=(.*)$/m);
        expect(dbMatch).toBeTruthy();
        expect(dbMatch![1]).toContain("postgresql://rebase:");

        // Verify DATABASE_PASSWORD matches the one in DATABASE_URL
        const dbPasswordMatch = envContent.match(/^DATABASE_PASSWORD=(.*)$/m);
        expect(dbPasswordMatch).toBeTruthy();
        expect(dbMatch![1]).toContain(`postgresql://rebase:${dbPasswordMatch![1]}@`);
    });

    it("configureEnvFile correctly uses provided databaseUrl", async () => {
        const targetDir = await simulateInit("env-custom-db-app");
        const customDbUrl = "postgresql://user:pass@remote:5432/db";
        await configureEnvFile(targetDir, customDbUrl);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        const dbMatch = envContent.match(/^DATABASE_URL=(.*)$/m);
        expect(dbMatch).toBeTruthy();
        expect(dbMatch![1]).toBe(customDbUrl);
    });

    it("configureEnvFile throws an error if a multiline databaseUrl is provided", async () => {
        const targetDir = await simulateInit("env-malicious-db-app");
        const maliciousDbUrl = "postgresql://user:pass@remote:5432/db\nINJECTED_VAR=dangerous";
        await expect(configureEnvFile(targetDir, maliciousDbUrl)).rejects.toThrow("Invalid DATABASE_URL");
    });
});

// =============================================================================
// Docker
// =============================================================================

describe("docker-compose.yml", () => {
    it("defines db, backend, and frontend services", () => {
        const compose = fs.readFileSync(path.join(TEMPLATE_DIR, "docker-compose.yml"), "utf-8");
        expect(compose).toContain("db:");
        expect(compose).toContain("backend:");
        expect(compose).toContain("frontend:");
    });

    it("backend depends on healthy db", () => {
        const compose = fs.readFileSync(path.join(TEMPLATE_DIR, "docker-compose.yml"), "utf-8");
        expect(compose).toContain("service_healthy");
    });

    it("uses persistent volumes", () => {
        const compose = fs.readFileSync(path.join(TEMPLATE_DIR, "docker-compose.yml"), "utf-8");
        expect(compose).toContain("postgres_data");
        expect(compose).toContain("uploads");
    });
});

// =============================================================================
// Scaffold security & quality (audit fixes)
// =============================================================================

describe("scaffold security defaults", () => {
    describe("users collection", () => {
        it("has securityRules defined", () => {
            const usersPath = path.join(TEMPLATE_DIR, "config", "collections", "users.ts");
            const content = fs.readFileSync(usersPath, "utf-8");
            expect(content).toContain("securityRules");
        });

        it("restricts all operations to admin role", () => {
            const usersPath = path.join(TEMPLATE_DIR, "config", "collections", "users.ts");
            const content = fs.readFileSync(usersPath, "utf-8");
            expect(content).toContain('"admin"');
            // Should not have access: "public" on users (sensitive fields)
            expect(content).not.toContain('access: "public"');
        });

        it("has autoValue on createdAt", () => {
            const usersPath = path.join(TEMPLATE_DIR, "config", "collections", "users.ts");
            const content = fs.readFileSync(usersPath, "utf-8");
            expect(content).toContain('autoValue: "on_create"');
        });
    });

    describe("backend template", () => {
        it("configures defaultSecurityRules", () => {
            const indexPath = path.join(TEMPLATE_DIR, "backend", "src", "index.ts");
            const content = fs.readFileSync(indexPath, "utf-8");
            expect(content).toContain("defaultSecurityRules");
        });

        it("does not silently fallback to a placeholder CORS domain", () => {
            const indexPath = path.join(TEMPLATE_DIR, "backend", "src", "index.ts");
            const content = fs.readFileSync(indexPath, "utf-8");
            // Should throw instead of silently using a non-existent domain
            expect(content).not.toMatch(/\|\|\s*["']https:\/\/yourdomain\.com["']/);
            expect(content).toContain("throw new Error");
        });
    });

    describe(".gitignore", () => {
        it("ignores both .rebase-dev-url and .rebase-dev-port", () => {
            const gitignore = fs.readFileSync(path.join(TEMPLATE_DIR, ".gitignore"), "utf-8");
            expect(gitignore).toContain(".rebase-dev-url");
            expect(gitignore).toContain(".rebase-dev-port");
        });
    });
});
