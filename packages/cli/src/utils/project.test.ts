/**
 * Tests for CLI project discovery utilities.
 *
 * These verify that the CLI can correctly locate project roots,
 * backend/frontend directories, env files, and backend plugins
 * in various directory structures.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
    findProjectRoot,
    findBackendDir,
    findFrontendDir,
    findEnvFile,
    getActiveBackendPlugin,
    readEnvFile,
    dependenciesNotInstalled
} from "./project";

let tmpDir: string;

function createDir(...parts: string[]): string {
    const dir = path.join(tmpDir, ...parts);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function writeJSON(filePath: string, data: Record<string, unknown>): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function writeFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cli-test-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true,
force: true });
});

// =============================================================================
// findProjectRoot
// =============================================================================

describe("findProjectRoot", () => {
    it("returns null when no project structure exists", () => {
        const emptyDir = createDir("empty-project");
        expect(findProjectRoot(emptyDir)).toBeNull();
    });

    /*
     * `rebase.json` is the primary marker — the only one `rebase init` writes,
     * and the one that makes a **frontend-only** repository discoverable at all:
     * such a repo has no `backend/`, no `config/`, and no "backend" workspace,
     * so it matches none of the heuristics below it.
     *
     * Nothing covered it. Found by mutation: making the manifest branch
     * unreachable left the whole CLI suite green, while every command in a repo
     * that has only a manifest would have failed with "Could not find a Rebase
     * project root".
     */
    it("finds root by a rebase.json alone, with no package.json beside it", () => {
        const projectDir = createDir("frontend-only");
        writeJSON(path.join(projectDir, "rebase.json"), { app: "shop" });

        expect(findProjectRoot(projectDir)).toBe(projectDir);
    });

    it("finds a rebase.json root from a nested subdirectory", () => {
        const projectDir = createDir("frontend-only-nested");
        writeJSON(path.join(projectDir, "rebase.json"), { app: "shop" });
        const deep = createDir("frontend-only-nested", "src", "views");

        expect(findProjectRoot(deep)).toBe(projectDir);
    });

    it("prefers the nearest rebase.json over an outer workspace root", () => {
        // An app nested inside a monorepo owns itself: the manifest beside it
        // is the project, not the workspace root several levels up.
        const outer = createDir("monorepo");
        writeJSON(path.join(outer, "package.json"), { name: "mono",
workspaces: ["backend"] });
        createDir("monorepo", "backend");

        const inner = createDir("monorepo", "apps", "shop");
        writeJSON(path.join(inner, "rebase.json"), { app: "shop" });

        expect(findProjectRoot(inner)).toBe(inner);
    });

    it("finds root by backend/ + config/ sibling directories", () => {
        const projectDir = createDir("my-app");
        createDir("my-app", "backend");
        createDir("my-app", "config");
        writeJSON(path.join(projectDir, "package.json"), { name: "my-app" });

        expect(findProjectRoot(projectDir)).toBe(projectDir);
    });

    it("finds root from a nested subdirectory", () => {
        const projectDir = createDir("my-app");
        createDir("my-app", "backend", "src");
        createDir("my-app", "config");
        writeJSON(path.join(projectDir, "package.json"), { name: "my-app" });

        const nestedDir = path.join(projectDir, "backend", "src");
        expect(findProjectRoot(nestedDir)).toBe(projectDir);
    });

    it("finds root via workspaces array containing 'backend'", () => {
        const projectDir = createDir("workspace-app");
        writeJSON(path.join(projectDir, "package.json"), {
            name: "workspace-app",
            workspaces: ["backend", "frontend", "config"]
        });

        expect(findProjectRoot(projectDir)).toBe(projectDir);
    });

    it("finds root via workspaces wildcard pattern", () => {
        const projectDir = createDir("wildcard-app");
        writeJSON(path.join(projectDir, "package.json"), {
            name: "wildcard-app",
            workspaces: ["packages/*", "backend"]
        });

        expect(findProjectRoot(projectDir)).toBe(projectDir);
    });

    it("does NOT match a directory with only backend/ (no config/)", () => {
        const projectDir = createDir("partial-app");
        createDir("partial-app", "backend");
        writeJSON(path.join(projectDir, "package.json"), { name: "partial" });

        expect(findProjectRoot(projectDir)).toBeNull();
    });

    it("ignores malformed package.json gracefully", () => {
        const projectDir = createDir("broken-app");
        createDir("broken-app", "backend");
        createDir("broken-app", "config");
        writeFile(path.join(projectDir, "package.json"), "{ not valid json }}}");

        // Should still match via sibling directory check (which doesn't require valid JSON)
        // Actually, the code reads package.json first — but if parse fails, it continues
        // to check the sibling directory condition.
        expect(findProjectRoot(projectDir)).toBe(projectDir);
    });
});

// =============================================================================
// findBackendDir / findFrontendDir
// =============================================================================

describe("findBackendDir", () => {
    it("returns the backend path when it exists", () => {
        const projectDir = createDir("app");
        createDir("app", "backend");

        expect(findBackendDir(projectDir)).toBe(path.join(projectDir, "backend"));
    });

    it("returns null when no backend directory exists", () => {
        const projectDir = createDir("app");
        expect(findBackendDir(projectDir)).toBeNull();
    });
});

describe("findFrontendDir", () => {
    it("returns the frontend path when it exists", () => {
        const projectDir = createDir("app");
        createDir("app", "frontend");

        expect(findFrontendDir(projectDir)).toBe(path.join(projectDir, "frontend"));
    });

    it("returns null when no frontend directory exists", () => {
        const projectDir = createDir("app");
        expect(findFrontendDir(projectDir)).toBeNull();
    });
});

// =============================================================================
// findEnvFile
// =============================================================================

describe("findEnvFile", () => {
    it("finds .env at the project root", () => {
        const projectDir = createDir("env-app");
        writeFile(path.join(projectDir, ".env"), "JWT_SECRET=test");

        expect(findEnvFile(projectDir)).toBe(path.join(projectDir, ".env"));
    });

    it("falls back to backend/.env", () => {
        const projectDir = createDir("env-app2");
        createDir("env-app2", "backend");
        writeFile(path.join(projectDir, "backend", ".env"), "JWT_SECRET=test");

        expect(findEnvFile(projectDir)).toBe(path.join(projectDir, "backend", ".env"));
    });

    it("prefers root .env over backend/.env", () => {
        const projectDir = createDir("env-app3");
        createDir("env-app3", "backend");
        writeFile(path.join(projectDir, ".env"), "ROOT=true");
        writeFile(path.join(projectDir, "backend", ".env"), "BACKEND=true");

        expect(findEnvFile(projectDir)).toBe(path.join(projectDir, ".env"));
    });

    it("returns null when no .env exists", () => {
        const projectDir = createDir("no-env");
        expect(findEnvFile(projectDir)).toBeNull();
    });
});

// =============================================================================
// getActiveBackendPlugin
// =============================================================================

describe("getActiveBackendPlugin", () => {
    it("detects @rebasepro/server-postgres from dependencies", () => {
        const backendDir = createDir("plugin-app", "backend");
        writeJSON(path.join(backendDir, "package.json"), {
            name: "my-backend",
            dependencies: {
                "@rebasepro/server": "workspace:*",
                "@rebasepro/server-postgres": "workspace:*",
                "hono": "^4.0.0"
            }
        });

        expect(getActiveBackendPlugin(backendDir)).toBe("@rebasepro/server-postgres");
    });

    it("detects plugin from devDependencies", () => {
        const backendDir = createDir("dev-dep-app", "backend");
        writeJSON(path.join(backendDir, "package.json"), {
            name: "my-backend",
            dependencies: {
                "@rebasepro/server": "workspace:*"
            },
            devDependencies: {
                "@rebasepro/server-mongo": "^1.0.0"
            }
        });

        expect(getActiveBackendPlugin(backendDir)).toBe("@rebasepro/server-mongo");
    });

    it("ignores @rebasepro/server (not a driver)", () => {
        const backendDir = createDir("core-only", "backend");
        writeJSON(path.join(backendDir, "package.json"), {
            name: "my-backend",
            dependencies: {
                "@rebasepro/server": "workspace:*",
                "hono": "^4.0.0"
            }
        });

        expect(getActiveBackendPlugin(backendDir)).toBeNull();
    });

    it("returns null when no package.json exists", () => {
        const backendDir = createDir("no-pkg", "backend");
        expect(getActiveBackendPlugin(backendDir)).toBeNull();
    });

    it("returns null for malformed package.json", () => {
        const backendDir = createDir("bad-pkg", "backend");
        writeFile(path.join(backendDir, "package.json"), "not json");
        expect(getActiveBackendPlugin(backendDir)).toBeNull();
    });
});

/**
 * How the CLI reads a project's `.env`.
 *
 * It read it four different ways: `dotenv` in `start`, a hand-rolled
 * `indexOf("=")` loop in `api-keys`, a single-key regex in `auth`, and its own
 * splitting in `cloud env`. `dotenv` is a declared dependency of this package,
 * so three of those existed for no reason and diverged from the one that is
 * correct — with the result that the same project worked under `rebase start`
 * and failed under `rebase api-keys list`.
 */
describe("readEnvFile", () => {
    function writeEnv(contents: string): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-env-"));
        fs.writeFileSync(path.join(root, ".env"), contents, "utf-8");
        return root;
    }

    it("reads a plain assignment", () => {
        expect(readEnvFile(writeEnv("REBASE_SERVICE_KEY=sk_abc\n")).REBASE_SERVICE_KEY).toBe("sk_abc");
    });

    it("reads a line written with `export`", () => {
        // Common in a file meant to be `source`d as well as loaded. The
        // hand-rolled parser keyed this as `export REBASE_SERVICE_KEY`, so the
        // command reported the key as not configured while it was right there.
        expect(readEnvFile(writeEnv("export REBASE_SERVICE_KEY=sk_abc\n")).REBASE_SERVICE_KEY).toBe("sk_abc");
    });

    it("drops a trailing comment instead of putting it in the value", () => {
        // Worse than being unset: the comment travelled into an Authorization
        // header, and the request came back 401 with nothing pointing here.
        expect(readEnvFile(writeEnv("REBASE_SERVICE_KEY=sk_abc # prod key\n")).REBASE_SERVICE_KEY).toBe("sk_abc");
    });

    it("keeps a value that legitimately contains a hash inside quotes", () => {
        expect(readEnvFile(writeEnv('PASSWORD="p#ssw0rd"\n')).PASSWORD).toBe("p#ssw0rd");
    });

    it("keeps a value containing an equals sign", () => {
        expect(readEnvFile(writeEnv("DATABASE_URL=postgres://u:p@h/db?a=b\n")).DATABASE_URL)
            .toBe("postgres://u:p@h/db?a=b");
    });

    it("returns an empty object when there is no env file", () => {
        expect(readEnvFile(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-env-")))).toEqual({});
    });
});

describe("dependenciesNotInstalled", () => {
    /**
     * Six commands each had their own wording for one state, and none named the
     * remedy: "Could not find CLI entry point for @rebasepro/server-postgres",
     * "Could not find tsx binary", "Could not find tsx binary for backend". All
     * three mean the same thing on a fresh clone — the one thing a checkout
     * does not carry is `node_modules/` — and all three read as Rebase being
     * broken rather than as a step nobody has run yet.
     */
    it("names the install command and the directory to run it in", () => {
        const root = createDir("shop");
        writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

        expect(dependenciesNotInstalled(root)).toBe(
            `Dependencies are not installed — run \`pnpm install\` in ${root}`
        );
    });

    it("follows the lock file the project already has", () => {
        // The directory matters as much as the command: the working directory
        // is usually `backend/` or `frontend/`, where an install would create a
        // second, wrong node_modules instead of fixing the first one.
        const root = createDir("npm-shop");
        writeFile(path.join(root, "package-lock.json"), "{}\n");

        expect(dependenciesNotInstalled(root)).toContain("`npm install`");
        expect(dependenciesNotInstalled(root)).toContain(root);
    });
});
