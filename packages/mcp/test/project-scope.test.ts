/**
 * Which project a tool call acts on (`project-scope.ts`), and the reproduction
 * of the incident that made it per call: a machine-wide server, switched to one
 * customer's Cloud project in an earlier session, answered `rebase_cloud_status`
 * for that project in a session working in a directory linked to another.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockSpawn = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { on: vi.fn(), end: vi.fn() },
    on: vi.fn()
};
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => mockSpawn) }));
vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => `${actual.tmpdir()}/rebase-mcp-scope-test-home` };
});
vi.mock("@rebasepro/client", () => ({ createRebaseClient: () => ({}) }));

import { spawn } from "node:child_process";
import { toolCallHandler } from "./helpers/server-handlers";
import { decideProjectScope, readCloudLink, type CloudLink, type ScopeEntry, type ScopeInput } from "../src/project-scope";

const TRIP = "35e08cdc-0000-4000-8000-000000000001";
const SONG = "3e2b3b47-0000-4000-8000-000000000002";

const tripLink: CloudLink = { projectId: TRIP, slug: "triptelier", url: "https://app.rebase.pro", root: "/work/triptelier" };

const entries: Record<string, ScopeEntry> = {
    default: { name: "default", projectDir: "/home/me/.rebase/agent" },
    "cloud:songbuzz": { name: "cloud:songbuzz", projectDir: "/home/me/.rebase/agent", cloud: { host: "https://app.rebase.pro", projectId: SONG } },
    "cloud:triptelier": { name: "cloud:triptelier", projectDir: "/home/me/.rebase/agent", cloud: { host: "https://app.rebase.pro", projectId: TRIP } },
    local: { name: "local", projectDir: "/work/triptelier" }
};

function input(over: Partial<ScopeInput>): ScopeInput {
    return {
        tool: "rebase_cloud_status",
        isWrite: false,
        entries,
        activeName: "default",
        activeChosenThisRun: false,
        callerLink: null,
        callerRoot: null,
        linkOf: (dir) => (dir === "/work/triptelier" ? tripLink : null),
        ...over
    };
}

describe("decideProjectScope", () => {
    it("refuses when the active project is not the one the session's directory is linked to", () => {
        const decision = decideProjectScope(input({ activeName: "cloud:songbuzz", callerLink: tripLink, callerRoot: "/work/triptelier" }));
        expect(decision.kind).toBe("refuse");
        if (decision.kind === "refuse") {
            expect(decision.message).toContain("triptelier");
            expect(decision.message).toContain("cloud:songbuzz");
            expect(decision.message).toContain("Nothing was done");
        }
    });

    it("refuses a named project that differs from the directory's link, even a registered one", () => {
        for (const requested of ["cloud:songbuzz", "songbuzz", SONG]) {
            const decision = decideProjectScope(input({ requested, callerLink: tripLink, callerRoot: "/work/triptelier" }));
            expect(decision.kind, requested).toBe("refuse");
        }
        // Not registered at all, while the directory is linked: still refused, never looked up.
        expect(decideProjectScope(input({ requested: "someone-else", callerLink: tripLink })).kind).toBe("refuse");
    });

    it("accepts a named project that is the directory's link, by entry name, slug or id", () => {
        expect(decideProjectScope(input({ requested: "triptelier", callerLink: tripLink }))).toEqual({ kind: "entry", name: "cloud:triptelier" });
        expect(decideProjectScope(input({ requested: TRIP, callerLink: tripLink }))).toEqual({ kind: "entry", name: "cloud:triptelier" });
        const unregistered = { ...entries };
        delete unregistered["cloud:triptelier"];
        expect(decideProjectScope(input({ entries: unregistered, requested: "triptelier", callerLink: tripLink }))).toEqual({ kind: "link", link: tripLink });
    });

    it("follows the directory's link when the server was started somewhere else and points at no Cloud project", () => {
        expect(decideProjectScope(input({ activeName: "default", callerLink: tripLink, callerRoot: "/work/triptelier" })))
            .toEqual({ kind: "link", link: tripLink });
    });

    it("keeps a local project whose directory is the linked checkout", () => {
        expect(decideProjectScope(input({ activeName: "local", callerLink: tripLink, callerRoot: "/work/triptelier" })))
            .toEqual({ kind: "entry", name: "local" });
    });

    it("lets a Cloud project remembered from an earlier session be read, never written, without a name", () => {
        expect(decideProjectScope(input({ activeName: "cloud:songbuzz" }))).toEqual({ kind: "entry", name: "cloud:songbuzz" });
        expect(decideProjectScope(input({ activeName: "cloud:songbuzz", tool: "delete_user", isWrite: true })).kind).toBe("refuse");
        // Selected in this session: the session asked for it.
        expect(decideProjectScope(input({ activeName: "cloud:songbuzz", tool: "delete_user", isWrite: true, activeChosenThisRun: true })))
            .toEqual({ kind: "entry", name: "cloud:songbuzz" });
        // Named in the call: the same.
        expect(decideProjectScope(input({ activeName: "default", requested: "songbuzz", tool: "delete_user", isWrite: true })))
            .toEqual({ kind: "entry", name: "cloud:songbuzz" });
    });

    it("looks up a Cloud project the registry does not hold, only when no link could contradict it", () => {
        expect(decideProjectScope(input({ requested: "newproj" }))).toEqual({ kind: "lookup", ref: "newproj" });
    });
});

describe("readCloudLink", () => {
    it("reads the link at the project root above a subdirectory, and ignores a self-hosted link", () => {
        const root = mkdtempSync(join(tmpdir(), "rebase-scope-link-"));
        try {
            writeFileSync(join(root, "rebase.json"), "{}");
            mkdirSync(join(root, ".rebase"));
            mkdirSync(join(root, "backend", "functions"), { recursive: true });
            writeFileSync(join(root, ".rebase", "cloud.json"), JSON.stringify({ url: "https://app.rebase.pro", projectId: TRIP, slug: "triptelier" }));
            expect(readCloudLink(join(root, "backend", "functions"))).toMatchObject({ projectId: TRIP, slug: "triptelier" });
            writeFileSync(join(root, ".rebase", "cloud.json"), JSON.stringify({ mode: "direct", projectId: "", apiUrl: "https://api.example.com" }));
            expect(readCloudLink(root)).toBeNull();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("the server, booted the way a machine-wide install runs", () => {
    const home = join(tmpdir(), "rebase-mcp-scope-test-home");
    const registryPath = join(home, ".rebase", "projects.json");
    let saved: string | null = null;
    let agentDir = "";
    let tripDir = "";
    const cwd = process.cwd();

    beforeEach(() => {
        mkdirSync(join(home, ".rebase"), { recursive: true });
        saved = existsSync(registryPath) ? readFileSync(registryPath, "utf8") : null;
        agentDir = mkdtempSync(join(tmpdir(), "rebase-scope-agent-"));
        tripDir = realpathSync(mkdtempSync(join(tmpdir(), "rebase-scope-trip-")));
        writeFileSync(join(tripDir, "rebase.json"), "{}");
        mkdirSync(join(tripDir, ".rebase"));
        writeFileSync(join(tripDir, ".rebase", "cloud.json"), JSON.stringify({ url: "https://app.rebase.pro", projectId: TRIP, slug: "triptelier" }));
        writeFileSync(registryPath, JSON.stringify({
            activeProject: "cloud:songbuzz",
            projects: {
                "cloud:songbuzz": {
                    name: "cloud:songbuzz",
                    projectDir: agentDir,
                    baseUrl: `https://app.rebase.pro/api/functions/studio/${SONG}/proxy`,
                    token: "",
                    cloud: { host: "https://app.rebase.pro", projectId: SONG },
                    addedAt: "2026-11-18T08:57:41.806Z"
                }
            }
        }));
        vi.mocked(spawn).mockClear();
    });

    afterEach(() => {
        process.chdir(cwd);
        if (saved === null) rmSync(registryPath, { force: true });
        else writeFileSync(registryPath, saved);
        rmSync(agentDir, { recursive: true, force: true });
        rmSync(tripDir, { recursive: true, force: true });
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    async function boot() {
        // The install's own directory, as the user-level config sets it.
        vi.stubEnv("REBASE_PROJECT_DIR", agentDir);
        vi.resetModules();
        return await import("../src/index");
    }

    it("refuses rebase_cloud_status for SongBuzz in a session working in the triptelier checkout, and spawns nothing", async () => {
        process.chdir(tripDir);
        const mod = await boot();
        const result = await toolCallHandler(mod.server)({ method: "tools/call", params: { name: "rebase_cloud_status", arguments: {} } });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/linked to the Rebase Cloud project "triptelier"/);
        expect(spawn).not.toHaveBeenCalled();
    });

    it("refuses a write naming SongBuzz from the triptelier checkout", async () => {
        process.chdir(tripDir);
        const mod = await boot();
        const result = await toolCallHandler(mod.server)({
            method: "tools/call",
            params: { name: "rebase_cloud_env_set", arguments: { project: "songbuzz", key: "A", value: "b", confirm: true } }
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Nothing was done");
        expect(spawn).not.toHaveBeenCalled();
    });

    it("acts on triptelier, in its checkout, when the call names it", async () => {
        process.chdir(tripDir);
        const mod = await boot();
        mockSpawn.on.mockImplementation((event: string, cb: (code: number) => void) => {
            if (event === "close") setTimeout(() => cb(0), 0);
            return mockSpawn;
        });
        await toolCallHandler(mod.server)({ method: "tools/call", params: { name: "rebase_cloud_status", arguments: { project: "triptelier" } } });
        const call = vi.mocked(spawn).mock.calls.at(-1)!;
        expect(call[1]).toEqual(expect.arrayContaining(["cloud", "status", "--json", "--project", TRIP]));
        expect(call[2]).toMatchObject({ cwd: tripDir });
    });

    it("advertises `project` on project-scoped tools, and not on the registry tools", async () => {
        const mod = await boot();
        const byName = new Map(mod.ALL_TOOLS.map((t) => [t.name, t.inputSchema.properties]));
        for (const name of ["delete_user", "rebase_cloud_status", "rebase_cloud_deploy", "rebase_db_push", "query_table"]) {
            expect(byName.get(name), name).toHaveProperty("project");
        }
        for (const name of ["rebase_project_switch", "rebase_cloud_projects_list", "rebase_cloud_provision"]) {
            expect(byName.get(name), name).not.toHaveProperty("project");
        }
    });
});
