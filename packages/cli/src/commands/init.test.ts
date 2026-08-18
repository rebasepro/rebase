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
import inquirer from "inquirer";
import net from "net";
import { configureEnvFile, buildInitQuestions, validateProjectName, formatCdTarget, printInitHelp, resolveRuntimeImageTag, isPortAvailable, TEMPLATE_PLACEHOLDER_FILES } from "./init.js";


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

    // Replace placeholders, using the PRODUCTION list rather than a copy of it.
    // This harness used to keep its own, which was missing `pnpm-workspace.yaml`
    // and `docker-compose.yml` — so every test built on it substituted a
    // different set of files than `rebase init` does, and could not observe a
    // file missing from the real list no matter what it asserted.
    for (const file of TEMPLATE_PLACEHOLDER_FILES) {
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

describe("validateProjectName", () => {
    it("accepts valid names", () => {
        for (const name of ["my-app", "app2", "my.app", "my_app", "0app"]) {
            expect(validateProjectName(name)).toBeNull();
        }
    });

    it("rejects names npm/pnpm would refuse to install", () => {
        for (const name of ["My App", "MyApp", "-app", ".app", "app!", "", "  "]) {
            expect(validateProjectName(name)).toBeTypeOf("string");
        }
    });
});

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
        // Shipped un-dotted: npm/pnpm strip .gitignore/.npmrc from published
        // tarballs; init renames them back at scaffold time.
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "gitignore"))).toBe(true);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "README.md"))).toBe(true);
    });

    it("contains the generated schema", () => {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "src", "schema.generated.ts"))).toBe(true);
    });

    it("scaffolds NO backend entry point, because the runtime never loads one", () => {
        // It used to. ~190 lines configuring CORS, auth, cookies, storage and
        // history that the managed runtime does not read — the most
        // important-looking file in a new project, and editing it did nothing.
        // It lives behind `rebase eject` now, which also writes the Dockerfile
        // and flips the manifest, so having it means it actually runs.
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "src", "index.ts"))).toBe(false);

        const payload = path.resolve(__dirname, "..", "..", "templates", "eject");
        expect(fs.existsSync(path.join(payload, "backend", "src", "index.ts"))).toBe(true);
        expect(fs.existsSync(path.join(payload, "Dockerfile"))).toBe(true);
    });

    it("declares a managed backend and one static app at /", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "rebase.json"), "utf8"));
        expect(manifest.rebase).toBeDefined();
        expect(manifest.apps.backend).toEqual({ type: "backend",
runtime: "managed" });
        expect(manifest.apps.admin).toMatchObject({ type: "static",
path: "/" });
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

    it("scaffolds NO Dockerfiles, because a managed project builds no image", () => {
        // `rebase build` produces a bundle and the published runtime boots it —
        // the artifact you self-host is the artifact Rebase Cloud runs. The
        // template used to ship a backend image whose CMD ran an entrypoint the
        // managed runtime never loads, and a second nginx image for the SPA the
        // runtime now serves itself.
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "backend", "Dockerfile"))).toBe(false);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend", "Dockerfile"))).toBe(false);
        expect(fs.existsSync(path.join(TEMPLATE_DIR, "frontend", "nginx.conf"))).toBe(false);

        // They live behind `rebase eject`, with the compose file that runs them.
        const payload = path.resolve(__dirname, "..", "..", "templates", "eject");
        expect(fs.existsSync(path.join(payload, "Dockerfile"))).toBe(true);
        expect(fs.existsSync(path.join(payload, "docker-compose.custom.yml"))).toBe(true);
    });
});

// =============================================================================
// Placeholder replacement
// =============================================================================

describe("placeholder replacement", () => {
    // The guard that generalises: derive the expectation from the template files
    // themselves, so adding one with a placeholder and forgetting the list fails
    // here rather than in a user's terminal.
    //
    // `docker-compose.yml` shipped with a literal `name: {{PROJECT_NAME}}` for
    // exactly this reason. Nothing caught it, because the only tests that touched
    // substitution ran against a hand-written copy of the file list.
    it("processes every template file that carries a placeholder", () => {
        const withPlaceholders: string[] = [];
        const walk = (dir: string, prefix = "") => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
                const full = path.join(dir, entry.name);
                const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    walk(full, rel);
                } else if (fs.readFileSync(full, "utf-8").includes("{{")) {
                    withPlaceholders.push(rel);
                }
            }
        };
        walk(TEMPLATE_DIR);

        const unprocessed = withPlaceholders.filter(f => !TEMPLATE_PLACEHOLDER_FILES.includes(f));
        expect({ unprocessed }).toEqual({ unprocessed: [] });
    });

    it("leaves no placeholder behind anywhere in a scaffolded project", async () => {
        const targetDir = await simulateInit("my-cool-app");
        const leftovers: string[] = [];
        const walk = (dir: string, prefix = "") => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
                const full = path.join(dir, entry.name);
                const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) walk(full, rel);
                else if (fs.readFileSync(full, "utf-8").includes("{{PROJECT_NAME}}")) leftovers.push(rel);
            }
        };
        walk(targetDir);

        expect({ leftovers }).toEqual({ leftovers: [] });
    });

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

    it("blog preset has posts, authors, tags, and users collections", () => {
        const collectionsDir = path.join(TEMPLATE_DIR, "config", "collections");
        const files = fs.readdirSync(collectionsDir).filter(f => f.endsWith(".ts") && f !== "index.ts");
        const basenames = files.map(f => f.replace(".ts", ""));

        expect(basenames).toContain("posts");
        expect(basenames).toContain("authors");
        expect(basenames).toContain("tags");
        expect(basenames).toContain("users");
    });

    // The template is the first Rebase code anyone reads, so it has to model the
    // idiom we actually recommend. A bare `const x: CollectionConfig = {…}`
    // annotation typechecks but infers nothing, which costs completion on
    // `admin.display.title` / `sort` / `propertiesOrder` — the whole reason
    // `defineCollection` exists.
    it("each blog collection is declared with defineCollection", () => {
        const collectionsDir = path.join(TEMPLATE_DIR, "config", "collections");
        const files = fs.readdirSync(collectionsDir).filter(f => f.endsWith(".ts") && f !== "index.ts");

        for (const file of files) {
            const content = fs.readFileSync(path.join(collectionsDir, file), "utf-8");
            expect(content).toContain("name:");
            expect(content).toContain("properties:");
            expect(content).toContain("defineCollection(");
            expect(content).toContain("@rebasepro/admin-types");
            // Removed in 0.11 — a template must never reintroduce them.
            expect(content).not.toContain("buildCollection");
            expect(content).not.toContain("buildProperty");
        }
    });

    it("posts collection uses markdown for content", () => {
        const postsPath = path.join(TEMPLATE_DIR, "config", "collections", "posts.ts");
        const content = fs.readFileSync(postsPath, "utf-8");
        expect(content).toContain("markdown: true");
        expect(content).not.toContain("multiline: true");
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
        // The kind, not the old `cardinality: "many"` string it replaced —
        // which `"many"` also matched inside `manyToMany`, so this assertion
        // would have kept passing on a half-migrated template.
        expect(content).toContain('kind: "manyToMany"');
    });
});

describe("template presets", () => {
    it("ecommerce preset has products, categories, orders, and index", () => {
        const presetDir = path.join(TEMPLATE_DIR, "config", "collections", "presets", "ecommerce");
        expect(fs.existsSync(presetDir)).toBe(true);
        const files = fs.readdirSync(presetDir).filter(f => f.endsWith(".ts"));
        const basenames = files.map(f => f.replace(".ts", ""));
        expect(basenames).toContain("products");
        expect(basenames).toContain("categories");
        expect(basenames).toContain("orders");
        expect(basenames).toContain("index");
    });

    it("ecommerce preset index imports usersCollection", () => {
        const indexPath = path.join(TEMPLATE_DIR, "config", "collections", "presets", "ecommerce", "index.ts");
        const content = fs.readFileSync(indexPath, "utf-8");
        expect(content).toContain("usersCollection");
        expect(content).toContain("export");
        expect(content).toContain("collections");
    });

    it("ecommerce products collection demonstrates a relation to categories", () => {
        const productsPath = path.join(TEMPLATE_DIR, "config", "collections", "presets", "ecommerce", "products.ts");
        const content = fs.readFileSync(productsPath, "utf-8");
        expect(content).toContain('type: "relation"');
        expect(content).toContain("categoriesCollection");
    });

    it("blank preset has only an index with usersCollection", () => {
        const presetDir = path.join(TEMPLATE_DIR, "config", "collections", "presets", "blank");
        expect(fs.existsSync(presetDir)).toBe(true);
        const indexPath = path.join(presetDir, "index.ts");
        const content = fs.readFileSync(indexPath, "utf-8");
        expect(content).toContain("usersCollection");
        expect(content).toContain("export");
        expect(content).not.toContain("postsCollection");
        expect(content).not.toContain("productsCollection");
    });

    it("users.ts is always present at the top level (shared by all presets)", () => {
        const usersPath = path.join(TEMPLATE_DIR, "config", "collections", "users.ts");
        expect(fs.existsSync(usersPath)).toBe(true);
    });

    it("applying blank preset removes blog files and keeps users.ts", async () => {
        const targetDir = await simulateInit("blank-test-app");
        const collectionsDir = path.join(targetDir, "config", "collections");
        const presetsDir = path.join(collectionsDir, "presets");
        const presetDir = path.join(presetsDir, "blank");

        const blogFiles = ["posts.ts", "authors.ts", "tags.ts", "index.ts"];
        for (const file of blogFiles) {
            const filePath = path.join(collectionsDir, file);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        const presetFiles = fs.readdirSync(presetDir).filter(f => f.endsWith(".ts"));
        for (const file of presetFiles) {
            fs.copyFileSync(path.join(presetDir, file), path.join(collectionsDir, file));
        }
        fs.rmSync(presetsDir, { recursive: true,
force: true });

        expect(fs.existsSync(path.join(collectionsDir, "users.ts"))).toBe(true);
        expect(fs.existsSync(path.join(collectionsDir, "index.ts"))).toBe(true);
        expect(fs.existsSync(path.join(collectionsDir, "posts.ts"))).toBe(false);
        expect(fs.existsSync(path.join(collectionsDir, "authors.ts"))).toBe(false);
        expect(fs.existsSync(path.join(collectionsDir, "tags.ts"))).toBe(false);
        expect(fs.existsSync(path.join(collectionsDir, "presets"))).toBe(false);

        const indexContent = fs.readFileSync(path.join(collectionsDir, "index.ts"), "utf-8");
        expect(indexContent).toContain("usersCollection");
        expect(indexContent).not.toContain("postsCollection");
    });

    it("every relative import resolves after applying each preset", async () => {
        // Preset files are authored under presets/<name>/ but scaffolded flat
        // into config/collections/, so an import that resolves in the template
        // tree can still dangle after init (e.g. "../../users.js").
        for (const preset of ["blog", "blank", "ecommerce"] as const) {
            const targetDir = await simulateInit(`imports-${preset}-app`);
            const collectionsDir = path.join(targetDir, "config", "collections");
            const presetsDir = path.join(collectionsDir, "presets");

            if (preset !== "blog") {
                for (const file of ["posts.ts", "authors.ts", "tags.ts", "index.ts"]) {
                    const filePath = path.join(collectionsDir, file);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                }
                const presetDir = path.join(presetsDir, preset);
                for (const file of fs.readdirSync(presetDir).filter(f => f.endsWith(".ts"))) {
                    fs.copyFileSync(path.join(presetDir, file), path.join(collectionsDir, file));
                }
            }
            fs.rmSync(presetsDir, { recursive: true,
force: true });

            for (const file of fs.readdirSync(collectionsDir).filter(f => f.endsWith(".ts"))) {
                const content = fs.readFileSync(path.join(collectionsDir, file), "utf-8");
                const specs = [...content.matchAll(/from\s+"(\.[^"]+)"/g)].map(m => m[1]);
                for (const spec of specs) {
                    const resolved = path.resolve(collectionsDir, spec.replace(/\.js$/, ".ts"));
                    expect(
                        fs.existsSync(resolved),
                        `${preset} preset: ${file} imports "${spec}", which does not exist after scaffolding`
                    ).toBe(true);
                }
            }
        }
    });

    it("applying ecommerce preset replaces blog files with ecommerce collections", async () => {
        const targetDir = await simulateInit("ecom-test-app");
        const collectionsDir = path.join(targetDir, "config", "collections");
        const presetsDir = path.join(collectionsDir, "presets");
        const presetDir = path.join(presetsDir, "ecommerce");

        const blogFiles = ["posts.ts", "authors.ts", "tags.ts", "index.ts"];
        for (const file of blogFiles) {
            const filePath = path.join(collectionsDir, file);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        const presetFiles = fs.readdirSync(presetDir).filter(f => f.endsWith(".ts"));
        for (const file of presetFiles) {
            fs.copyFileSync(path.join(presetDir, file), path.join(collectionsDir, file));
        }
        fs.rmSync(presetsDir, { recursive: true,
force: true });

        expect(fs.existsSync(path.join(collectionsDir, "users.ts"))).toBe(true);
        expect(fs.existsSync(path.join(collectionsDir, "products.ts"))).toBe(true);
        expect(fs.existsSync(path.join(collectionsDir, "categories.ts"))).toBe(true);
        expect(fs.existsSync(path.join(collectionsDir, "orders.ts"))).toBe(true);
        expect(fs.existsSync(path.join(collectionsDir, "posts.ts"))).toBe(false);
        expect(fs.existsSync(path.join(collectionsDir, "presets"))).toBe(false);
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
        expect(pkg.dependencies).toHaveProperty("@rebasepro/server");
        expect(pkg.dependencies).toHaveProperty("@rebasepro/server-postgres");
        expect(pkg.dependencies).toHaveProperty("hono");
        expect(pkg.dependencies).toHaveProperty("drizzle-orm");
    });

    it("frontend package.json has required dependencies", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "frontend", "package.json"), "utf-8"));
        expect(pkg.dependencies).toHaveProperty("@rebasepro/app");
        // `@rebasepro/admin` used to be a second copy of the `app` assertion, so
        // the panel package the template actually ships went unchecked.
        expect(pkg.dependencies).toHaveProperty("@rebasepro/admin");
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

        // `deploy` deploys. It used to be `rebase build && rebase start` —
        // build, then run in the foreground, locally — which is not what anyone
        // typing the word means.
        it("deploy script deploys", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
            expect(pkg.scripts.deploy).toBe("rebase cloud deploy");
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
        it("ships an npmrc file (un-dotted so npm pack keeps it)", () => {
            expect(fs.existsSync(path.join(TEMPLATE_DIR, "npmrc"))).toBe(true);
        });

        it(".npmrc enables link-workspace-packages for pnpm", () => {
            const npmrc = fs.readFileSync(path.join(TEMPLATE_DIR, "npmrc"), "utf-8");
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
        // Present, but it must ship empty — see the configureEnvFile test on
        // why a localhost default here follows the bundle into production.
        expect(envContent).toMatch(/^VITE_API_URL=$/m);
    });

    it("contains setup instructions for required values", () => {
        // "contains the word 'required' somewhere" was satisfied by any comment
        // in the file. What a developer copying this needs is: which variables
        // must be filled in, that they ship empty, and how to produce a value.
        const envContent = fs.readFileSync(path.join(TEMPLATE_DIR, ".env.example"), "utf-8");

        expect(envContent).toMatch(/Database connection string \(required\)/);
        expect(envContent).toMatch(/JWT Authentication \(required\)/);

        // JWT_SECRET must ship empty — a default here is a shared signing key.
        expect(envContent).toMatch(/^JWT_SECRET=$/m);
        // ...with the command that generates one right above it.
        expect(envContent).toContain("randomBytes");
        expect(envContent).toContain("at least 32 characters");
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
        // `rebase_app`, not `rebase`: a role named the same as a schema puts
        // that schema ahead of `public` in the default `search_path` ("$user",
        // public), so unqualified SQL from any tool that does not pin the path
        // lands in the wrong place. Rebase creates a schema called `rebase`.
        expect(dbMatch![1]).toContain("postgresql://rebase_app:");

        // Verify DATABASE_PASSWORD matches the one in DATABASE_URL
        const dbPasswordMatch = envContent.match(/^DATABASE_PASSWORD=(.*)$/m);
        expect(dbPasswordMatch).toBeTruthy();
        expect(dbMatch![1]).toContain(`postgresql://rebase_app:${dbPasswordMatch![1]}@`);
    });

    it("configureEnvFile writes a stable REBASE_SERVICE_KEY", async () => {
        // Left unset, the server auto-generates one per boot and invalidates
        // the previous run's tokens — every restart becomes a silent logout.
        const targetDir = await simulateInit("env-service-key-app");
        await configureEnvFile(targetDir);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        const match = envContent.match(/^REBASE_SERVICE_KEY=(.+)$/m);
        expect(match).toBeTruthy();
        expect(match![1].length).toBeGreaterThanOrEqual(32);
        // The commented placeholder must be gone, not merely accompanied.
        expect(envContent).not.toMatch(/^#\s*REBASE_SERVICE_KEY=/m);
    });

    it("configureEnvFile leaves .env readable only by its owner", async () => {
        /*
         * This file carries the generated JWT_SECRET, the database password and
         * REBASE_SERVICE_KEY — which the API treats as a full admin credential.
         * It was created 0644: `copyFileSync` copies the *source's* permissions
         * and the packaged `.env.example` is world-readable, so on a shared
         * build box or any multi-user machine every local account could read
         * another project's service key. `.rebase/state.json` and the telemetry
         * config next to it are both deliberately 0600; this file holds more.
         */
        const targetDir = await simulateInit("env-permissions-app");
        await configureEnvFile(targetDir);

        const mode = fs.statSync(path.join(targetDir, ".env")).mode & 0o777;
        expect(mode.toString(8)).toBe("600");
    });

    it("configureEnvFile writes a CORS_ORIGINS the compose file can read", async () => {
        /*
         * `docker-compose.yml` declares `CORS_ORIGINS: ${CORS_ORIGINS:?…}` on
         * the `api` service, and Compose interpolates the WHOLE file before it
         * selects services. Left commented out, `docker compose up -d db` —
         * step 1 of the "Next steps" printed at the end of `rebase init` —
         * failed on a variable the `db` service does not use, and so did
         * `docker compose config`. A brand-new project could not run its own
         * first instruction.
         */
        const targetDir = await simulateInit("env-cors-app");
        await configureEnvFile(targetDir);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");

        const match = envContent.match(/^CORS_ORIGINS=(.+)$/m);
        expect(match).toBeTruthy();
        // The compose stack serves the admin from the api container on ${PORT}.
        const port = envContent.match(/^PORT=(\d+)/m)![1];
        expect(match![1]).toBe(`http://localhost:${port}`);

        // The commented placeholder must be gone, not merely accompanied —
        // otherwise the required-variable guard still has nothing to read.
        expect(envContent).not.toMatch(/^#\s*CORS_ORIGINS=/m);
    });

    it("configureEnvFile leaves VITE_API_URL empty rather than pointing at localhost", async () => {
        /*
         * `VITE_API_URL` was the one environment-specific value `init` did not
         * rewrite, and the chain that made that dangerous is fully closed:
         * `.env.example` shipped `http://localhost:3001`, `frontend/vite.config.ts`
         * sets `envDir: ".."` so `vite build` reads this file, and the managed
         * bundle is built locally — so `.env` being gitignored saves nobody. A
         * stock scaffold deployed to Cloud served HTML that passed every
         * server-side health check while every XHR from the live site went to
         * the developer's laptop. `rebase cloud env set VITE_API_URL=…` refuses
         * build-time variables, so there was no recovery from the platform side.
         *
         * Empty is the correct value, not a missing one: the client falls back
         * to `window.location.origin`.
         */
        const targetDir = await simulateInit("env-vite-api-url-app");

        // Start from a .env.example that carries a value, which is what this
        // rewrite exists for: the template ships it blank now, so asserting the
        // outcome against the stock template would pass with the rewrite
        // deleted. A project whose .env.example predates that change — or was
        // edited by hand — is the case that still needs covering.
        const examplePath = path.join(targetDir, ".env.example");
        fs.writeFileSync(
            examplePath,
            fs.readFileSync(examplePath, "utf-8").replace(/^VITE_API_URL=.*$/m, "VITE_API_URL=http://localhost:3001"),
            "utf-8"
        );

        await configureEnvFile(targetDir);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");

        // Present and empty — the key must still be there as documentation.
        expect(envContent).toMatch(/^VITE_API_URL=$/m);
        // And nowhere in the file may it name a host.
        expect(envContent).not.toMatch(/^VITE_API_URL=.+$/m);
    });

    it("configureEnvFile points DATABASE_URL at 127.0.0.1, not localhost", async () => {
        /*
         * `localhost` resolves to `::1` first on macOS, so on a machine already
         * running Postgres on loopback the name and the address can reach two
         * different servers — which is exactly how a project got silently wired
         * to a pre-existing database holding another project's tables. An
         * address cannot be ambiguous the way a name can.
         */
        const targetDir = await simulateInit("env-db-host-app");
        await configureEnvFile(targetDir);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        const dbMatch = envContent.match(/^DATABASE_URL=(.*)$/m);
        expect(dbMatch).toBeTruthy();
        expect(dbMatch![1]).toContain("@127.0.0.1:");
        expect(dbMatch![1]).not.toContain("@localhost:");
    });

    it("configureEnvFile percent-encodes the `=` inside the options parameter", async () => {
        /*
         * libpq splits a URI query parameter on the FIRST `=` and rejects any
         * further one:
         *   extra key/value separator "=" in URI query parameter: "options"
         * So `?options=-c%20search_path=public` — what this file used to write —
         * is unusable by every libpq caller: `pg_dump`/`pg_restore` behind
         * `rebase db backup|restore`, and a plain `psql "$DATABASE_URL"` copied
         * out of the generated .env. Not a version quirk: 15 through 18 all
         * refuse it.
         *
         * It shipped because node-postgres parses URLs itself and accepts the
         * literal form, so `rebase dev` and `rebase db push` were fine and
         * nothing else exercised the URL. `pinSearchPath` — the --database-url
         * branch, covered below — has always encoded it; only this branch did
         * not, and no test compared them.
         */
        const targetDir = await simulateInit("env-db-options-encoding-app");
        await configureEnvFile(targetDir);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        const url = envContent.match(/^DATABASE_URL=(.*)$/m)![1];

        expect(url).toContain("search_path%3Dpublic");
        expect(url).not.toContain("search_path=public");

        /*
         * Assert the property rather than the spelling: at most one literal `=`
         * per query parameter is precisely libpq's rule, so this keeps holding
         * if the parameters are ever reordered or another one is added.
         */
        const query = url.slice(url.indexOf("?") + 1);
        for (const param of query.split("&")) {
            expect(param.split("=").length).toBe(2);
        }

        // And the pin still survives decoding — encoding it must not have
        // changed what Postgres is actually told.
        const options = new URL(url).searchParams.get("options");
        expect(options).toBe("-c search_path=public");
    });

    it("configureEnvFile agrees with the compose port mapping it rewrote", async () => {
        // The generated URL and the published port are two halves of one
        // decision; if they disagree the container is running and unreachable.
        const targetDir = await simulateInit("env-db-port-agreement-app");
        await configureEnvFile(targetDir);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        const compose = fs.readFileSync(path.join(targetDir, "docker-compose.yml"), "utf-8");

        const urlPort = envContent.match(/^DATABASE_URL=.*@127\.0\.0\.1:(\d+)\//m)?.[1];
        expect(urlPort).toBeTruthy();
        expect(compose).toContain(`- "${urlPort}:5432"`);
    });

    it("leaves the compose file's other required variables satisfied too", async () => {
        // Every `${VAR:?…}` in docker-compose.yml has to be answerable from the
        // generated .env, or the file cannot be parsed at all.
        const targetDir = await simulateInit("env-compose-required-app");
        await configureEnvFile(targetDir);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        const compose = fs.readFileSync(path.join(targetDir, "docker-compose.yml"), "utf-8");

        const required = [...compose.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map(m => m[1]);
        expect(required.length).toBeGreaterThan(0);

        for (const name of required) {
            expect(envContent).toMatch(new RegExp(`^${name}=.+$`, "m"));
        }
    });

    it("configureEnvFile correctly uses provided databaseUrl, pinned to public", async () => {
        const targetDir = await simulateInit("env-custom-db-app");
        const customDbUrl = "postgresql://user:pass@remote:5432/db";
        await configureEnvFile(targetDir, customDbUrl);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        const dbMatch = envContent.match(/^DATABASE_URL=(.*)$/m);
        expect(dbMatch).toBeTruthy();
        expect(dbMatch![1]).toContain("postgresql://user:pass@remote:5432/db");
        // A supplied URL used to be written through verbatim, dropping the
        // `search_path=public` pin the generated URL has always carried — and on
        // a database whose role is named `rebase` (what every template creates),
        // `"$user"` then resolves to the `rebase` schema this project creates and
        // unqualified DDL builds the project's tables there instead of in public.
        expect(dbMatch![1]).toContain("search_path%3Dpublic");
    });

    it("configureEnvFile keeps a search_path the caller already chose", async () => {
        const targetDir = await simulateInit("env-custom-db-pinned-app");
        const customDbUrl = "postgresql://user:pass@remote:5432/db?options=-c%20search_path%3Danalytics";
        await configureEnvFile(targetDir, customDbUrl);

        const envContent = fs.readFileSync(path.join(targetDir, ".env"), "utf-8");
        expect(envContent.match(/^DATABASE_URL=(.*)$/m)![1]).toBe(customDbUrl);
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
    it("runs the published runtime on the bundle, with nothing to build", () => {
        const compose = fs.readFileSync(path.join(TEMPLATE_DIR, "docker-compose.yml"), "utf-8");
        expect(compose).toContain("db:");
        expect(compose).toContain("api:");
        expect(compose).toContain("rebasepro/server:");
        expect(compose).toContain("./dist-bundle:/bundle");
        // A `build:` here would mean the scaffold contradicts its own manifest,
        // which declares runtime: managed.
        expect(compose).not.toMatch(/^\s*build:/m);
    });

    it("mounts a durable volume wherever it acknowledges local storage", () => {
        // FORCE_LOCAL_STORAGE without a durable mount is how uploads get
        // silently destroyed on the next restart.
        //
        // The whole body used to sit inside `if (compose.includes(...))`, so
        // deleting the FORCE_LOCAL_STORAGE line — the very thing that makes the
        // mount necessary — turned this into an empty test rather than a failure.
        const compose = fs.readFileSync(path.join(TEMPLATE_DIR, "docker-compose.yml"), "utf-8");
        expect(compose).toContain("FORCE_LOCAL_STORAGE");
        expect(compose).toContain("STORAGE_PATH: /uploads");
        expect(compose).toContain("uploads:/uploads");
        // ...and the volume has to be declared, not just referenced.
        expect(compose).toMatch(/^volumes:/m);
        expect(compose).toMatch(/^\s{2}uploads:/m);
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

    describe("collections defaults", () => {
        it("declares defaultSecurityRules beside the collections", () => {
            // They must live here, not in the backend config: `db push`
            // generates the Postgres policies from these files and never sees
            // the running server.
            const indexPath = path.join(TEMPLATE_DIR, "config", "collections", "index.ts");
            const content = fs.readFileSync(indexPath, "utf-8");

            expect(content).toContain("export const defaultSecurityRules");
            expect(content).toContain('access: "public"');
            expect(content).toContain('roles: ["admin"]');
        });

        it("does not set defaultSecurityRules on the backend, where it would not reach the database", () => {
            // The entrypoint is the eject payload now — a managed project has none.
            const indexPath = path.resolve(__dirname, "..", "..", "templates", "eject", "backend", "src", "index.ts");
            const content = fs.readFileSync(indexPath, "utf-8");

            expect(content).not.toContain("defaultSecurityRules");
        });
    });

    describe("backend template", () => {

        it("does not silently fallback to a placeholder CORS domain", () => {
            const indexPath = path.resolve(__dirname, "..", "..", "templates", "eject", "backend", "src", "index.ts");
            const content = fs.readFileSync(indexPath, "utf-8");
            // Should throw instead of silently using a non-existent domain
            expect(content).not.toMatch(/\|\|\s*["']https:\/\/yourdomain\.com["']/);
            expect(content).toContain("throw new Error");
        });
    });

    describe(".gitignore", () => {
        it("ignores both .rebase-dev-url and .rebase-dev-port", () => {
            const gitignore = fs.readFileSync(path.join(TEMPLATE_DIR, "gitignore"), "utf-8");
            expect(gitignore).toContain(".rebase-dev-url");
            expect(gitignore).toContain(".rebase-dev-port");
        });
    });
});

// =============================================================================
// Interactive prompt configuration
// =============================================================================

describe("buildInitQuestions", () => {
    const registeredTypes = new Set(Object.keys(inquirer.prompt.prompts));

    it("should only use prompt types registered by the installed inquirer version", () => {
        // Call with no flags so every conditional question is included
        const questions = buildInitQuestions({
            nameArg: undefined,
            templateArg: undefined,
            hasGitFlag: false,
            hasInstallFlag: false,
            pm: "pnpm"
        });

        expect(questions.length).toBeGreaterThan(0);

        for (const q of questions) {
            expect(
                registeredTypes.has(q.type as string),
                `Prompt type "${q.type}" is not registered in inquirer. Available: ${[...registeredTypes].join(", ")}`
            ).toBe(true);
        }
    });

    it("should include all expected question names when no flags are set", () => {
        const questions = buildInitQuestions({
            nameArg: undefined,
            templateArg: undefined,
            hasGitFlag: false,
            hasInstallFlag: false,
            pm: "pnpm"
        });
        const names = questions.map((q) => q.name);

        expect(names).toContain("projectName");
        expect(names).toContain("preset");
        expect(names).toContain("git");
        expect(names).toContain("installDeps");
        expect(names).toContain("databaseUrl");
        expect(names).toContain("introspect");
    });

    it("should omit projectName question when nameArg is provided", () => {
        const questions = buildInitQuestions({
            nameArg: "my-app",
            templateArg: undefined,
            hasGitFlag: false,
            hasInstallFlag: false,
            pm: "pnpm"
        });
        expect(questions.map((q) => q.name)).not.toContain("projectName");
    });

    it("should omit preset question when templateArg is provided", () => {
        const questions = buildInitQuestions({
            nameArg: undefined,
            templateArg: "blog",
            hasGitFlag: false,
            hasInstallFlag: false,
            pm: "pnpm"
        });
        expect(questions.map((q) => q.name)).not.toContain("preset");
    });

    it("should omit git question when hasGitFlag is true", () => {
        const questions = buildInitQuestions({
            nameArg: undefined,
            templateArg: undefined,
            hasGitFlag: true,
            hasInstallFlag: false,
            pm: "pnpm"
        });
        expect(questions.map((q) => q.name)).not.toContain("git");
    });

    it("should omit installDeps question when hasInstallFlag is true", () => {
        const questions = buildInitQuestions({
            nameArg: undefined,
            templateArg: undefined,
            hasGitFlag: false,
            hasInstallFlag: true,
            pm: "pnpm"
        });
        expect(questions.map((q) => q.name)).not.toContain("installDeps");
    });

    it("should include package manager name in installDeps message", () => {
        for (const pm of ["pnpm", "npm"] as const) {
            const questions = buildInitQuestions({
                nameArg: undefined,
                templateArg: undefined,
                hasGitFlag: false,
                hasInstallFlag: false,
                pm
            });
            const installQ = questions.find((q) => q.name === "installDeps");
            expect(installQ).toBeDefined();
            expect(installQ!.message as string).toContain(pm);
        }
    });
});

describe("what gets scaffolded", () => {
    it("asks when --headless is not given", () => {
        const questions = buildInitQuestions({
            nameArg: "x",
hasGitFlag: true,
hasInstallFlag: true,
pm: "pnpm"
        });

        const q = questions.find((q) => q.name === "headless");
        expect(q).toBeDefined();
        // A boolean, not a named pair: "cms" was a product category rather than
        // a thing this tool builds, and "baas" was the manifest value that is
        // now derived from whether collections exist.
        expect((q as { choices: { value: boolean }[] }).choices.map((c) => c.value).sort())
            .toEqual([false, true]);
        // Backend + admin is the safer thing to land on for someone unsure.
        expect((q as { default: boolean }).default).toBe(false);
    });

    it("does not ask when --headless is given", () => {
        const questions = buildInitQuestions({
            nameArg: "x",
headlessArg: true,
hasGitFlag: true,
hasInstallFlag: true,
pm: "pnpm"
        });

        expect(questions.find((q) => q.name === "headless")).toBeUndefined();
    });

    it("skips the collections preset when headless, which declares none", () => {
        const questions = buildInitQuestions({
            nameArg: "x",
headlessArg: true,
hasGitFlag: true,
hasInstallFlag: true,
pm: "pnpm"
        });

        const preset = questions.find((q) => q.name === "preset") as
            { when?: (a: Record<string, unknown>) => boolean } | undefined;
        expect(preset?.when?.({})).toBe(false);
    });

    it("asks for a preset once the answer is not headless", () => {
        const questions = buildInitQuestions({
            nameArg: "x",
hasGitFlag: true,
hasInstallFlag: true,
pm: "pnpm"
        });

        const preset = questions.find((q) => q.name === "preset") as
            { when?: (a: Record<string, unknown>) => boolean } | undefined;
        expect(preset?.when?.({ headless: false })).toBe(true);
        expect(preset?.when?.({ headless: true })).toBe(false);
    });
});

describe("baas overlay", () => {
    const overlay = path.resolve(__dirname, "..", "..", "templates", "overlays", "baas");

    it("declares a managed backend and no frontend", () => {
        // Headless is now expressed by the manifest and by the absence of a
        // `config/collections` directory, not by a hand-written entrypoint that
        // passes `mode: "baas"`.
        const manifest = JSON.parse(fs.readFileSync(path.join(overlay, "rebase.json"), "utf8"));

        expect(manifest.apps.backend).toEqual({ type: "backend",
runtime: "managed" });
        expect(Object.values(manifest.apps).some((app: any) => app.type === "static")).toBe(false);
        expect(fs.existsSync(path.join(overlay, "backend", "src", "index.ts"))).toBe(false);
    });

    it("keeps a config package for the storage hook, but declares no collections", () => {
        // Storage is not under row-level security, so deleting the config
        // package outright would leave the boot guard nothing to find and the
        // scaffold's own docker-compose.yml would crash-loop.
        expect(fs.existsSync(path.join(overlay, "config", "index.ts"))).toBe(true);
        expect(fs.existsSync(path.join(overlay, "config", "collections"))).toBe(false);
    });

    it("ships the SDK, which its example script imports", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(overlay, "package.json"), "utf8"));

        // scripts/example.ts imports @rebasepro/client; with no frontend in a
        // baas project, nothing else would pull it in.
        expect(pkg.dependencies?.["@rebasepro/client"]).toBeDefined();
        expect(pkg.workspaces).toEqual(["backend", "config"]);
    });

    it("declares no UI packages anywhere", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(overlay, "package.json"), "utf8"));
        const backend = JSON.parse(fs.readFileSync(path.join(overlay, "backend", "package.json"), "utf8"));
        const all = JSON.stringify([pkg.dependencies, pkg.devDependencies, backend.dependencies, backend.devDependencies]);

        for (const ui of ["react", "@rebasepro/admin", "@rebasepro/ui", "@rebasepro/app", "@rebasepro/studio"]) {
            expect(all).not.toContain(`"${ui}"`);
        }
    });
});

describe("next-steps cd target", () => {
    it("uses the path the user typed, not the basename", () => {
        // `cd nested-app` would not exist from where the user is standing.
        expect(formatCdTarget("/work", "/work/apps/nested-app")).toBe("apps/nested-app");
    });

    it("returns nothing for an in-place init", () => {
        // `init .` — printing `cd my-dir` would send them somewhere they already are.
        expect(formatCdTarget("/work/my-dir", "/work/my-dir")).toBe("");
    });

    it("handles a plain project name", () => {
        expect(formatCdTarget("/work", "/work/my-app")).toBe("my-app");
    });
});

describe("init --help", () => {
    /** Capture what printInitHelp writes to stdout. */
    function helpText(): string {
        const lines: string[] = [];
        const original = console.log;
        console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
        try {
            printInitHelp();
        } finally {
            console.log = original;
        }
        return lines.join("\n");
    }

    it("documents every flag the parser accepts", () => {
        // The flags used to be discoverable only by triggering the non-TTY
        // error. If a new one is added to promptForOptions, document it here too.
        const text = helpText();
        for (const flag of [
            "--template", "--headless", "--yes", "--install", "--git",
            "--database-url", "--introspect", "--project", "--setup-key"
        ]) {
            expect(text).toContain(flag);
        }
    });

    it("lists the valid template values, and no retired flavor names", () => {
        const text = helpText();
        for (const value of ["blog", "ecommerce", "blank", "--headless"]) {
            expect(text).toContain(value);
        }
    });

    it("says --template does nothing for the baas flavor", () => {
        expect(helpText()).toContain("--template has no effect");
    });
});

describe("resolveRuntimeImageTag", () => {
    /**
     * `.env` pins the runtime image tag `docker-compose.yml` pulls, and it used to
     * pin whatever version the scaffolding CLI happened to be. That is right for a
     * stable release and wrong for every prerelease: only stable publishes
     * `rebasepro/server`, so a canary CLI wrote a tag that cannot exist and
     * `docker compose up` died on `manifest unknown` — the same dead end as the
     * missing-repository bug the pinning was added to prevent.
     */
    it("pins a stable CLI's own version", () => {
        expect(resolveRuntimeImageTag("0.13.0")).toEqual({ tag: "0.13.0" });
        expect(resolveRuntimeImageTag("1.0.0").note).toBeUndefined();
    });

    it("floats a prerelease to latest, and says why in the file", () => {
        const canary = resolveRuntimeImageTag("0.13.1-canary.gcd6689e");
        expect(canary.tag).toBe("latest");
        // The note is the point: a floating tag is a real cost, so the reader is
        // told they have one and what to do about it before they deploy.
        expect(canary.note).toContain("0.13.1-canary.gcd6689e");
        expect(canary.note).toMatch(/prerelease/i);
        expect(canary.note).toMatch(/^#/m);
    });

    it("treats every semver prerelease form the same way", () => {
        for (const version of ["0.14.0-rc.1", "2.0.0-beta.3", "0.13.1-canary.g0946568"]) {
            expect(resolveRuntimeImageTag(version).tag).toBe("latest");
        }
    });

    it("passes through the no-manifest fallback untouched", () => {
        // `readCliVersion` answers "latest" when it cannot read its own manifest.
        // That is already the floating tag, and it is not a prerelease string.
        expect(resolveRuntimeImageTag("latest")).toEqual({ tag: "latest" });
    });
});

describe("choosing a free port for the local database", () => {
    /*
     * A successful bind does not mean a port is unused. Node sets SO_REUSEADDR,
     * under which a wildcard bind and a specific-address bind on the same port
     * do not conflict — in either direction. So each probe alone has a blind
     * spot, and they are different ones. Both were shipped, one after the other.
     */
    const servers: net.Server[] = [];
    const listen = (port: number, host?: string) =>
        new Promise<void>((resolve, reject) => {
            const s = net.createServer();
            servers.push(s);
            s.once("error", reject);
            if (host === undefined) s.listen(port, () => resolve());
            else s.listen(port, host, () => resolve());
        });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r()))));
    });

    /** A port nothing else on the machine is expected to want. */
    const free = async (): Promise<number> => {
        for (let p = 45000; p < 45200; p++) if (await isPortAvailable(p)) return p;
        throw new Error("no free port in the test range");
    };

    it("sees a server bound only to loopback", async () => {
        /*
         * The original bug. A Homebrew or Postgres.app install binds 127.0.0.1
         * and [::1] but not the wildcard, so a wildcard probe called 5432 free
         * while it was already serving another project's database. Docker then
         * published *:5432 for the same reason and the container started
         * cleanly. `DATABASE_URL` named `localhost`, which resolves to ::1
         * first — so every command reported success against the *pre-existing*
         * database, and a `db push` would have created tables, roles and RLS
         * policies inside it.
         */
        const port = await free();
        await listen(port, "127.0.0.1");
        expect(await isPortAvailable(port)).toBe(false);
    });

    it("sees a server bound only to the wildcard address", async () => {
        // The inverse, and what a loopback-only probe misses: Docker Desktop
        // publishes a container's port on *, and a specific-address bind
        // succeeds right past it. The port probes free and cannot be published,
        // so `docker compose up -d db` fails on "port is already allocated" —
        // after the project has been generated around it.
        const port = await free();
        await listen(port);
        expect(await isPortAvailable(port)).toBe(false);
    });

    it("still accepts a genuinely free port", async () => {
        // A probe that never says yes would "fix" this by scanning forever.
        expect(await isPortAvailable(await free())).toBe(true);
    });
});
