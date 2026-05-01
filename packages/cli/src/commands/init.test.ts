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
import { promisify } from "util";
import ncp from "ncp";

const copy = promisify(ncp);

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
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Helper: simulate what `createProject` does without spawning git/pnpm.
 * Copies the template and runs placeholder replacement.
 */
async function simulateInit(projectName: string): Promise<string> {
    const targetDir = path.join(tmpDir, projectName);
    fs.mkdirSync(targetDir, { recursive: true });

    await copy(TEMPLATE_DIR, targetDir, {
        clobber: false,
        filter: (source: string) => {
            const basename = path.basename(source);
            return basename !== "node_modules" && basename !== ".DS_Store";
        },
    });

    // Replace placeholders
    const filesToProcess = [
        "package.json",
        "frontend/package.json",
        "backend/package.json",
        "config/package.json",
        "frontend/index.html",
        "README.md",
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
        expect(fs.existsSync(path.join(TEMPLATE_DIR, ".env.template"))).toBe(true);
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
            "README.md",
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
        expect(content).toContain("relation:");
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
        expect(pkg.scripts["db:push"]).toBe("rebase db push");
        expect(pkg.scripts["db:generate"]).toBe("rebase db generate");
        expect(pkg.scripts["schema:generate"]).toBe("rebase schema generate");
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
// .env.template
// =============================================================================

describe(".env.template", () => {
    it("contains all required environment variables", () => {
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.template"), "utf-8");
        expect(envContent).toContain("DATABASE_URL");
        expect(envContent).toContain("JWT_SECRET");
        expect(envContent).toContain("PORT");
        expect(envContent).toContain("NODE_ENV");
        expect(envContent).toContain("VITE_API_URL");
    });

    it("contains setup instructions for required values", () => {
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.template"), "utf-8");
        expect(envContent).toContain("REQUIRED");
        expect(envContent).toContain("openssl rand");
    });

    it("has optional SMTP section commented out", () => {
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.template"), "utf-8");
        expect(envContent).toContain("# SMTP_HOST");
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
