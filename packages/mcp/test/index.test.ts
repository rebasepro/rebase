import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    server,
    ALL_TOOLS,
    detectPackageManager,
    getExecCommand,
    getRunCommand,
    isLoopbackHost,
    isLocalTarget,
    assertDestructiveTargetIsLocal,
    DESTRUCTIVE_TOOLS
} from "../src/index";
import type { PackageManager } from "../src/index";
import { resolve } from "node:path";

// Mock the child_process spawn for CLI tools
const mockSpawn = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn()
};
vi.mock("node:child_process", () => ({
    spawn: vi.fn(() => mockSpawn)
}));

// Redirect the project registry (~/.rebase/projects.json) into a temp dir.
// Tools like rebase_project_add persist to it, and a test suite has no business
// rewriting the developer's real project list.
vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
        ...actual,
        homedir: () => `${actual.tmpdir()}/rebase-mcp-test-home`
    };
});

// Mock the Rebase Client SDK
const mockClient = {
    auth: {
        getUser: vi.fn().mockResolvedValue({ uid: "admin-id", email: "admin@rebase.pro", roles: ["admin"] })
    },
    data: {
        collection: vi.fn(() => ({
            find: vi.fn().mockResolvedValue([{ id: "doc-1",
title: "Test Doc" }]),
            findById: vi.fn().mockResolvedValue({ id: "doc-1",
title: "Test Doc" }),
            create: vi.fn().mockResolvedValue({ id: "doc-2",
title: "New Doc" }),
            update: vi.fn().mockResolvedValue({ id: "doc-1",
title: "Updated Doc" }),
            delete: vi.fn().mockResolvedValue(undefined)
        }))
    },
    admin: {
        listUsers: vi.fn().mockResolvedValue([{ email: "user@rebase.pro" }]),
        createUser: vi.fn().mockResolvedValue({ email: "new@rebase.pro" }),
        updateUser: vi.fn().mockResolvedValue({ userId: "1",
email: "updated@rebase.pro" }),
        deleteUser: vi.fn().mockResolvedValue(true),
        listRoles: vi.fn().mockResolvedValue(["admin", "user"]),
        listUsersPaginated: vi.fn().mockResolvedValue({ users: [{ uid: "user-1", email: "user@rebase.pro" }], total: 1, limit: 25, offset: 0 }),
        resetPassword: vi.fn().mockResolvedValue({ user: { uid: "user-1", email: "user@rebase.pro" }, temporaryPassword: "TmpPass123!" })
    },
    cron: {
        listJobs: vi.fn().mockResolvedValue({ jobs: [{ jobId: "cleanup", enabled: true }] }),
        getJob: vi.fn().mockResolvedValue({ job: { jobId: "cleanup", enabled: true } }),
        triggerJob: vi.fn().mockResolvedValue({ log: { status: "success" }, job: { jobId: "cleanup" } }),
        getJobLogs: vi.fn().mockResolvedValue({ logs: [{ message: "Job finished" }] }),
        toggleJob: vi.fn().mockResolvedValue({ job: { jobId: "cleanup", enabled: false } })
    },
    storage: {
        listObjects: vi.fn().mockResolvedValue({ objects: [{ key: "file.png" }] }),
        deleteObject: vi.fn().mockResolvedValue(undefined),
        getSignedUrl: vi.fn().mockResolvedValue({ url: "http://tempurl" })
    },
    functions: {
        invoke: vi.fn().mockResolvedValue({ result: "success" })
    }
};

vi.mock("@rebasepro/client", () => ({
    createRebaseClient: () => mockClient
}));

describe("MCP Server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("registers all expected tools", () => {
        const toolNames = ALL_TOOLS.map(t => t.name);
        expect(toolNames).toContain("rebase_schema_generate");
        expect(toolNames).toContain("rebase_db_push");
        expect(toolNames).toContain("list_documents");
        expect(toolNames).toContain("get_document");
        expect(toolNames).toContain("create_document");
        expect(toolNames).toContain("update_document");
        expect(toolNames).toContain("delete_document");
        expect(toolNames).toContain("list_users");
        expect(toolNames).toContain("create_user");
        expect(toolNames).toContain("rebase_project_list");
        expect(toolNames).toContain("rebase_project_switch");
        expect(toolNames).toContain("rebase_project_add");
        expect(toolNames).toContain("rebase_project_remove");
        expect(toolNames).toContain("rebase_project_current");
        expect(toolNames).toContain("rebase_project_status");
        expect(toolNames).toContain("rebase_auth_reset_password");
    });

    it("handles list tools request", async () => {
        const handler = (server as any)._requestHandlers.get("tools/list");
        expect(handler).toBeDefined();

        const result = await handler({
            method: "tools/list"
        });
        expect(result.tools.length).toEqual(ALL_TOOLS.length);
    });

    it("routes call tool requests to client data operations", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        expect(handler).toBeDefined();

        // 1. get_document
        const getResult = await handler({
            method: "tools/call",
            params: {
                name: "get_document",
                arguments: { collection: "posts",
id: "1" }
            }
        });
        expect(getResult.content[0].text).toContain("doc-1");

        // 2. create_document
        const createResult = await handler({
            method: "tools/call",
            params: {
                name: "create_document",
                arguments: { collection: "posts",
data: { title: "New Doc" } }
            }
        });
        expect(createResult.content[0].text).toContain("doc-2");
    });

    it("routes call tool requests to admin operations", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        expect(handler).toBeDefined();

        // list_users
        const usersResult = await handler({
            method: "tools/call",
            params: {
                name: "list_users",
                arguments: {}
            }
        });
        expect(usersResult.content[0].text).toContain("user@rebase.pro");
    });

    it("routes call tool requests to storage, cron, and custom functions", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        expect(handler).toBeDefined();

        // 1. storage_list_objects
        const storageResult = await handler({
            method: "tools/call",
            params: {
                name: "storage_list_objects",
                arguments: { prefix: "img/" }
            }
        });
        expect(storageResult.content[0].text).toContain("file.png");

        // 2. cron_list_jobs
        const cronResult = await handler({
            method: "tools/call",
            params: {
                name: "cron_list_jobs",
                arguments: {}
            }
        });
        expect(cronResult.content[0].text).toContain("cleanup");

        // 3. invoke_function
        const funcResult = await handler({
            method: "tools/call",
            params: {
                name: "invoke_function",
                arguments: { name: "test-func", payload: { val: 1 } }
            }
        });
        expect(funcResult.content[0].text).toContain("success");
    });

    it("resets password via admin API", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        const result = await handler({
            method: "tools/call",
            params: {
                name: "rebase_auth_reset_password",
                arguments: { email: "user@rebase.pro", password: "NewPass123!" }
            }
        });
        expect(mockClient.admin.listUsersPaginated).toHaveBeenCalledWith({ search: "user@rebase.pro", limit: 1 });
        expect(mockClient.admin.resetPassword).toHaveBeenCalledWith("user-1", { password: "NewPass123!" });
        expect(result.content[0].text).toContain("Password reset");
    });

    it("routes list_roles to admin.listRoles", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        const result = await handler({
            method: "tools/call",
            params: { name: "list_roles", arguments: {} }
        });
        expect(mockClient.admin.listRoles).toHaveBeenCalled();
        expect(result.content[0].text).toContain("admin");
    });

    describe("Project management tools", () => {
        it("lists projects including default", async () => {
            const handler = (server as any)._requestHandlers.get("tools/call");
            const result = await handler({
                method: "tools/call",
                params: { name: "rebase_project_list", arguments: {} }
            });
            const data = JSON.parse(result.content[0].text);
            expect(data.projects.length).toBeGreaterThanOrEqual(1);
            expect(data.activeProject).toBeDefined();
        });

        it("shows current project details", async () => {
            const handler = (server as any)._requestHandlers.get("tools/call");
            const result = await handler({
                method: "tools/call",
                params: { name: "rebase_project_current", arguments: {} }
            });
            const data = JSON.parse(result.content[0].text);
            expect(data.name).toBeDefined();
            expect(data.baseUrl).toBeDefined();
        });

        it("rejects removing the default project", async () => {
            const handler = (server as any)._requestHandlers.get("tools/call");
            const result = await handler({
                method: "tools/call",
                params: { name: "rebase_project_remove", arguments: { name: "default" } }
            });
            expect(result.content[0].text).toContain("Cannot remove");
        });
    });

    it("verifies admin role for database branching operations", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        expect(handler).toBeDefined();

        // Make user a non-admin
        mockClient.auth.getUser.mockResolvedValueOnce({ uid: "user-id", email: "user@rebase.pro", roles: ["user"] });

        const resultErr = await handler({
            method: "tools/call",
            params: {
                name: "rebase_db_branch_list",
                arguments: {}
            }
        });
        expect(resultErr.isError).toBe(true);
        expect(resultErr.content[0].text).toContain("Admin authorization failed: Access denied: User does not have the 'admin' role.");

        // As an admin, it should execute the CLI command
        mockClient.auth.getUser.mockResolvedValueOnce({ uid: "admin-id", email: "admin@rebase.pro", roles: ["admin"] });
        
        // Mock stdout capture for spawn
        mockSpawn.on.mockImplementation((event: string, callback: any) => {
            if (event === "close") {
                setTimeout(() => callback(0), 10);
            }
            return mockSpawn;
        });

        const result = await handler({
            method: "tools/call",
            params: {
                name: "rebase_db_branch_list",
                arguments: {}
            }
        });
        expect(result.content[0].text).toBeDefined();
    });
});

describe("detectPackageManager", () => {
    it("detects pnpm from pnpm-lock.yaml", () => {
        // The test project itself uses pnpm (has pnpm-workspace.yaml)
        const result = detectPackageManager(resolve(__dirname, "../../.."));
        expect(result).toBe("pnpm");
    });

    it("returns pnpm as default when no lock file is found", () => {
        // Use /tmp which shouldn't have any lock files
        const result = detectPackageManager("/tmp/nonexistent-project-" + Date.now());
        expect(result).toBe("pnpm");
    });
});

describe("getExecCommand", () => {
    it("returns pnpm exec for pnpm", () => {
        const result = getExecCommand("pnpm");
        expect(result).toEqual({ command: "pnpm", args: ["exec"] });
    });

    it("returns yarn exec for yarn", () => {
        const result = getExecCommand("yarn");
        expect(result).toEqual({ command: "yarn", args: ["exec"] });
    });

    it("returns npx with no args prefix for npm", () => {
        const result = getExecCommand("npm");
        expect(result).toEqual({ command: "npx", args: [] });
    });
});

describe("getRunCommand", () => {
    it("returns pnpm run for pnpm", () => {
        const result = getRunCommand("pnpm");
        expect(result).toEqual({ command: "pnpm", args: ["run"] });
    });

    it("returns yarn run for yarn", () => {
        const result = getRunCommand("yarn");
        expect(result).toEqual({ command: "yarn", args: ["run"] });
    });

    it("returns npm run for npm", () => {
        const result = getRunCommand("npm");
        expect(result).toEqual({ command: "npm", args: ["run"] });
    });
});

describe("isLoopbackHost", () => {
    it.each([
        "localhost",
        "LOCALHOST",
        "api.localhost",
        "127.0.0.1",
        "127.1.2.3",
        "::1",
        "[::1]",
        "0.0.0.0"
    ])("treats %s as loopback", (host) => {
        expect(isLoopbackHost(host)).toBe(true);
    });

    it.each([
        "example.com",
        "api.staging.rebase.pro",
        // Private ranges are NOT loopback — a 10.x host is as likely to be a
        // shared cluster as a laptop.
        "10.0.0.1",
        "192.168.1.5",
        "postgres-rw.tenant.svc.cluster.local",
        // Near-misses that must not be mistaken for the real thing.
        "notlocalhost",
        "localhost.evil.com",
        "1127.0.0.1"
    ])("treats %s as remote", (host) => {
        expect(isLoopbackHost(host)).toBe(false);
    });
});

describe("isLocalTarget", () => {
    it("accepts local http and postgres URLs", () => {
        expect(isLocalTarget("http://localhost:3001")).toBe(true);
        expect(isLocalTarget("postgres://user:pw@127.0.0.1:5432/app")).toBe(true);
    });

    it("rejects remote URLs", () => {
        expect(isLocalTarget("https://api.example.com")).toBe(false);
        expect(isLocalTarget("postgresql://u:p@db.prod.example.com:5432/app")).toBe(false);
    });

    it("treats an unverifiable value as remote, not local", () => {
        expect(isLocalTarget("")).toBe(false);
        expect(isLocalTarget("not a url")).toBe(false);
    });
});

describe("DESTRUCTIVE_TOOLS", () => {
    it("covers the data-losing tools on both dispatch paths", () => {
        expect(DESTRUCTIVE_TOOLS).toMatchObject({
            rebase_db_push: "db",
            rebase_db_migrate: "db",
            rebase_db_branch_delete: "db",
            delete_document: "http",
            delete_user: "http",
            storage_delete_object: "http",
            rebase_auth_reset_password: "http"
        });
    });

    it("leaves read-only and additive tools ungated", () => {
        for (const name of ["list_documents", "get_document", "create_document", "rebase_db_branch_list", "rebase_doctor"]) {
            expect(DESTRUCTIVE_TOOLS[name]).toBeUndefined();
        }
    });

    it("names only tools that actually exist", () => {
        // A rename that misses this map silently un-gates the tool, which is
        // the one failure mode the gate cannot report on its own.
        const registered = new Set(ALL_TOOLS.map((t) => t.name));
        for (const name of Object.keys(DESTRUCTIVE_TOOLS)) {
            expect(registered).toContain(name);
        }
    });
});

describe("assertDestructiveTargetIsLocal", () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalOptOut = process.env.REBASE_MCP_ALLOW_REMOTE_WRITES;

    beforeEach(() => {
        delete process.env.DATABASE_URL;
        delete process.env.REBASE_MCP_ALLOW_REMOTE_WRITES;
    });

    afterEach(() => {
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
        if (originalOptOut === undefined) delete process.env.REBASE_MCP_ALLOW_REMOTE_WRITES;
        else process.env.REBASE_MCP_ALLOW_REMOTE_WRITES = originalOptOut;
    });

    it("refuses a db tool when DATABASE_URL is remote", () => {
        process.env.DATABASE_URL = "postgresql://app:hunter2@db.prod.example.com:5432/app";
        expect(() => assertDestructiveTargetIsLocal("rebase_db_push"))
            .toThrow(/Refusing to run "rebase_db_push"/);
    });

    it("does not leak the database password into the refusal", () => {
        process.env.DATABASE_URL = "postgresql://app:hunter2@db.prod.example.com:5432/app";
        try {
            assertDestructiveTargetIsLocal("rebase_db_push");
            throw new Error("expected a refusal");
        } catch (err) {
            const msg = (err as Error).message;
            expect(msg).toContain("db.prod.example.com");
            expect(msg).not.toContain("hunter2");
        }
    });

    it("allows a db tool when DATABASE_URL is local", () => {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/app";
        expect(() => assertDestructiveTargetIsLocal("rebase_db_push")).not.toThrow();
    });

    it("allows a db tool when no DATABASE_URL is configured at all", () => {
        expect(() => assertDestructiveTargetIsLocal("rebase_db_push")).not.toThrow();
    });

    it("honours the REBASE_MCP_ALLOW_REMOTE_WRITES opt-out", () => {
        process.env.DATABASE_URL = "postgresql://app:pw@db.prod.example.com:5432/app";
        process.env.REBASE_MCP_ALLOW_REMOTE_WRITES = "true";
        expect(() => assertDestructiveTargetIsLocal("rebase_db_push")).not.toThrow();
    });

    it("ignores tools that are not destructive", () => {
        process.env.DATABASE_URL = "postgresql://app:pw@db.prod.example.com:5432/app";
        expect(() => assertDestructiveTargetIsLocal("rebase_db_branch_list")).not.toThrow();
        expect(() => assertDestructiveTargetIsLocal("list_documents")).not.toThrow();
    });
});

describe("destructive-tool gate via the call handler", () => {
    const handler = () => (server as any)._requestHandlers.get("tools/call");
    const originalDatabaseUrl = process.env.DATABASE_URL;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
        // Leave the default project active for any test that runs after this one.
        await handler()({
            method: "tools/call",
            params: { name: "rebase_project_switch", arguments: { name: "default" } }
        });
    });

    it("refuses rebase_db_push against a remote DATABASE_URL", async () => {
        process.env.DATABASE_URL = "postgresql://app:pw@db.prod.example.com:5432/app";

        const result = await handler()({
            method: "tools/call",
            params: { name: "rebase_db_push", arguments: {} }
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Refusing to run \"rebase_db_push\"");
        expect(result.content[0].text).toContain("REBASE_MCP_ALLOW_REMOTE_WRITES");
    });

    it("refuses delete_document once the active project points at a remote backend", async () => {
        await handler()({
            method: "tools/call",
            params: {
                name: "rebase_project_add",
                arguments: { name: "prod", baseUrl: "https://api.example.com", token: "rk_live_scoped" }
            }
        });
        await handler()({
            method: "tools/call",
            params: { name: "rebase_project_switch", arguments: { name: "prod" } }
        });

        const result = await handler()({
            method: "tools/call",
            params: { name: "delete_document", arguments: { collection: "posts", id: "1" } }
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Refusing to run \"delete_document\"");
        expect(result.content[0].text).toContain("https://api.example.com");
        expect(mockClient.data.collection).not.toHaveBeenCalled();
    });

    it("still allows delete_document against the local default project", async () => {
        const result = await handler()({
            method: "tools/call",
            params: { name: "delete_document", arguments: { collection: "posts", id: "1" } }
        });

        expect(result.isError).toBeUndefined();
        expect(mockClient.data.collection).toHaveBeenCalledWith("posts");
    });
});
