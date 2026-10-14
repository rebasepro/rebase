import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";

/**
 * The `ts-morph` hint works where it is printed, and is printed only where the
 * editor is wanted.
 *
 * `rebase dev` printed `Schema Editor disabled: … Run \`pnpm add -D
 * ts-morph@28.0.0\` to enable it.` on every boot of a headless project that has
 * collections (after `schema introspect`, say). Typed from the project root,
 * where a reader types it, pnpm refuses: `ERR_PNPM_ADDING_TO_ROOT`, since the
 * root is a workspace and the backend is its member `backend`. And a headless
 * project has no Studio, so nothing there would ever use the editor.
 *
 * Now the command names the member the backend runs in, in the project's own
 * package manager, and the warning waits until somebody asks for the editor.
 */

// The editor's routes import `ts-morph` at module scope; this is that import
// failing, as it does on a server without the optional peer installed.
jest.mock("../src/api/schema-editor-routes", () => {
    throw Object.assign(new Error("Cannot find package 'ts-morph' imported from schema-editor-routes"), { code: "ERR_MODULE_NOT_FOUND" });
});

import { devDependencyInstallCommand } from "../src/utils/dev-dependency-command";
import { createRebaseBackend, logger, type HonoEnv, type RebaseBackend } from "../src/index";
import { generateAccessToken, configureJwt } from "../src/auth/jwt";
import { _resetRebaseMock } from "../src/singleton";

/** A scaffold-shaped project: a workspace root, its `backend` member, a lockfile. */
function project(lockfile: string, options: { workspace?: "pnpm" | "package.json" | false } = {}): { root: string; backend: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ts-morph-hint-"));
    const backend = path.join(root, "backend");
    fs.mkdirSync(path.join(backend, "src"), { recursive: true });
    fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: "backend" }));
    const workspace = options.workspace ?? "pnpm";
    if (workspace === "pnpm") fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - backend\n");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(workspace === "package.json" ? { name: "app", workspaces: ["backend"] } : { name: "app" }));
    fs.writeFileSync(path.join(root, lockfile), "");
    return { root, backend };
}

const made: string[] = [];
afterEach(() => {
    while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true });
});

describe("the install command, typed from the project root", () => {
    it("adds to the backend member of a pnpm workspace, which a bare `pnpm add` at the root refuses", () => {
        const { root, backend } = project("pnpm-lock.yaml");
        made.push(root);

        expect(devDependencyInstallCommand("ts-morph@28.0.0", path.join(backend, "src"))).toBe("pnpm --dir backend add -D ts-morph@28.0.0");
    });

    it("speaks the project's own package manager", () => {
        const npm = project("package-lock.json", { workspace: "package.json" });
        const yarn = project("yarn.lock", { workspace: "package.json" });
        const bun = project("bun.lock", { workspace: "package.json" });
        made.push(npm.root, yarn.root, bun.root);

        expect(devDependencyInstallCommand("ts-morph@28.0.0", npm.backend)).toBe("npm install -D ts-morph@28.0.0 -w backend");
        expect(devDependencyInstallCommand("ts-morph@28.0.0", yarn.backend)).toBe("yarn --cwd backend add -D ts-morph@28.0.0");
        expect(devDependencyInstallCommand("ts-morph@28.0.0", bun.backend)).toBe("bun add -d ts-morph@28.0.0 --cwd backend");
    });

    it("is the plain add where the backend is the project itself", () => {
        const { root } = project("pnpm-lock.yaml", { workspace: false });
        made.push(root);

        expect(devDependencyInstallCommand("ts-morph@28.0.0", root)).toBe("pnpm add -D ts-morph@28.0.0");
        expect(devDependencyInstallCommand("ts-morph@28.0.0", path.join(root, "backend"))).toBe("pnpm add -D ts-morph@28.0.0");
    });

    it("quotes a member path that is not one shell word", () => {
        const { root } = project("pnpm-lock.yaml");
        made.push(root);
        const odd = path.join(root, "my backend");
        fs.mkdirSync(odd);
        fs.writeFileSync(path.join(odd, "package.json"), "{}");

        expect(devDependencyInstallCommand("ts-morph@28.0.0", odd)).toBe("pnpm --dir 'my backend' add -D ts-morph@28.0.0");
    });
});

const JWT_SECRET = "ts-morph-hint-test-secret-0123456789abcdef";

function driver(): DataDriver {
    return {
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 0,
        withAuth: async function (this: DataDriver) { return this; },
        admin: { executeSql: async () => [] }
    } as unknown as DataDriver;
}

const bootstrapper = {
    type: "postgres",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return { driver: driver(), collections: undefined, internals: {}, realtimeProvider: {} } as unknown as InitializedDriver;
    },
    async initializeAuth() {
        const authRepository = { getUserRoleIds: async () => ["admin"], getUserById: async () => ({ id: "admin-1" }) };
        return { userService: authRepository, authRepository };
    },
    getAdmin: () => ({ executeSql: async () => [] })
} as unknown as BackendBootstrapper;

describe("the warning, on a server without ts-morph", () => {
    const built: RebaseBackend[] = [];
    let cwd: string;
    let warn: jest.SpiedFunction<typeof logger.warn>;

    beforeEach(() => {
        cwd = process.cwd();
        warn = jest.spyOn(logger, "warn");
    });

    afterEach(async () => {
        process.chdir(cwd);
        while (built.length) await built.pop()!.shutdown(0);
        _resetRebaseMock();
        jest.restoreAllMocks();
    });

    async function serve(): Promise<Hono<HonoEnv>> {
        const { root, backend } = project("pnpm-lock.yaml");
        made.push(root);
        const collectionsDir = path.join(root, "config", "collections");
        fs.mkdirSync(collectionsDir, { recursive: true });
        // `rebase dev` runs the backend in its member directory.
        process.chdir(backend);
        const instance = await createRebaseBackend({
            collections: [{ name: "Posts", slug: "posts", table: "posts", properties: { id: { name: "ID", type: "string", isId: "uuid" } } } as unknown as CollectionConfig],
            collectionsDir,
            bootstrappers: [bootstrapper],
            auth: { jwtSecret: JWT_SECRET },
            cronPersistence: false,
            provision: false
        } as never);
        built.push(instance);
        const app = new Hono<HonoEnv>();
        instance.mount(app);
        return app;
    }

    const said = () => warn.mock.calls.map(call => String(call[0])).filter(line => line.includes("ts-morph"));

    it("is not said at boot: a project with no Studio never asks for the editor", async () => {
        await serve();

        expect(said()).toEqual([]);
    });

    it("is said once, when the editor is asked for, with the command that works from the project root", async () => {
        const app = await serve();
        configureJwt({ secret: JWT_SECRET, accessExpiresIn: "1h" });
        const auth = { headers: { authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}` } };

        const status = await (await app.request("/api/admin/schema-editor/status", auth)).json() as { enabled: boolean; code: string; reason: string };
        expect(status).toMatchObject({ enabled: false, code: "SCHEMA_EDITOR_MISSING_DEPENDENCY" });
        expect(status.reason).toContain("pnpm --dir backend add -D ts-morph@28.0.0");
        expect(status.reason).not.toMatch(/`pnpm add -D ts-morph/);

        await app.request("/api/admin/schema/status", auth);
        await app.request("/api/admin/schema-editor/status", auth);

        expect(said()).toHaveLength(1);
        expect(said()[0]).toContain("pnpm --dir backend add -D ts-morph@28.0.0");
    });

    it("is not said to a caller the editor's gate refuses", async () => {
        const app = await serve();

        expect((await app.request("/api/admin/schema-editor/status")).status).toBe(401);
        expect(said()).toEqual([]);
    });
});
