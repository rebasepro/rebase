/**
 * A cloud project's bearer is the CLI's credential for the control plane the
 * project is registered on, and no other.
 *
 * The data tools reach a project registered by `rebase_project_use_cloud`
 * through the Studio proxy on its control plane, with the token
 * `rebase cloud access-token` mints in the project's directory. One cached
 * token served every project: after `rebase_project_use_cloud` in a directory
 * whose CLI targets one control plane, switching to a project registered on
 * another sent the first control plane's session token to the second.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { rmSync } from "node:fs";

const paths = vi.hoisted(() => {
    // `node:` imports are not available inside `vi.hoisted` before the mocks
    // below are set, so the paths are plain strings off the OS temp root.
    const root = `${process.env.TMPDIR || "/tmp"}/rebase-mcp-w3-cloud-${process.pid}`;
    return { root, home: `${root}/home`, dirA: `${root}/project-a`, hostA: "https://cp-a.example", hostB: "https://app.rebase.pro" };
});

const HOST_A = paths.hostA;

vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    const fs = await import("node:fs");
    fs.mkdirSync(`${paths.home}/.rebase`, { recursive: true });
    fs.writeFileSync(`${paths.home}/.rebase/projects.json`, JSON.stringify({
        projects: {
            "cloud:alpha": {
                name: "cloud:alpha",
                projectDir: paths.dirA,
                baseUrl: `${paths.hostA}/api/functions/studio/p-alpha/proxy`,
                token: "",
                cloud: { host: paths.hostA, projectId: "p-alpha" },
                addedAt: "2026-11-01T00:00:00.000Z"
            }
        },
        activeProject: "default"
    }));
    return { ...actual, homedir: () => paths.home };
});

/** What each directory's CLI answers `rebase cloud access-token` with. */
function accessTokenFor(cwd: string): { host: string; accessToken: string } {
    return cwd === paths.dirA
        ? { host: paths.hostA, accessToken: "token-for-a" }
        : { host: paths.hostB, accessToken: "token-for-b" };
}

vi.mock("node:child_process", () => ({
    spawn: vi.fn((_cmd: string, argv: string[], options: { cwd: string }) => {
        const stdout = argv.includes("access-token")
            ? JSON.stringify({ ...accessTokenFor(options.cwd), expiresAt: null })
            : JSON.stringify({ projects: [{ id: "p-beta", name: "Beta", slug: "beta", host: null, status: "running" }] });
        const child = {
            stdout: { on: (event: string, cb: (d: Buffer) => void) => { if (event === "data") setTimeout(() => cb(Buffer.from(stdout)), 0); } },
            stderr: { on: () => {} },
            stdin: { on: () => {}, end: () => {} },
            on: (event: string, cb: (code: number) => void) => { if (event === "close") setTimeout(() => cb(0), 5); return child; }
        };
        return child;
    })
}));

const created = vi.hoisted(() => [] as Array<{ baseUrl: string; token?: string }>);
vi.mock("@rebasepro/client", () => ({
    createRebaseClient: (opts: { baseUrl: string; token?: string }) => {
        created.push({ baseUrl: opts.baseUrl, token: opts.token });
        return { data: { collection: () => ({ find: async () => ({ data: [] }) }) } };
    }
}));

import { server } from "../src/index";
import { toolCallHandler } from "./helpers/server-handlers";

const call = (name: string, args: Record<string, unknown>) =>
    toolCallHandler(server)({ method: "tools/call", params: { name, arguments: args } });

afterAll(() => rmSync(paths.root, { recursive: true, force: true }));

describe("a cloud project's bearer", () => {
    beforeEach(() => {
        created.length = 0;
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ state: "ok" }), { status: 200 })));
    });

    it("comes from the control plane that project is registered on, after another project's token was minted", async () => {
        // This directory's CLI targets HOST_B: its token is minted and kept.
        const used = await call("rebase_project_use_cloud", { project: "beta" });
        expect(used.isError).toBeFalsy();

        const switched = await call("rebase_project_switch", { name: "cloud:alpha" });
        expect(switched.isError).toBeFalsy();
        const listed = await call("list_documents", { collection: "posts" });
        expect(listed.isError, listed.content[0].text).toBeFalsy();

        const toAlpha = created.filter((c) => c.baseUrl.startsWith(HOST_A));
        expect(toAlpha.length).toBeGreaterThan(0);
        for (const client of toAlpha) expect(client.token).toBe("token-for-a");
        expect(created.some((c) => c.baseUrl.startsWith(HOST_A) && c.token === "token-for-b")).toBe(false);
    });

    it("is what rebase_schema_plan sends to a cloud project's proxy", async () => {
        await call("rebase_project_switch", { name: "cloud:alpha" });
        const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ statements: [] }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const planned = await call("rebase_schema_plan", { collectionId: "posts", collection: { slug: "posts" } });

        expect(planned.isError, planned.content[0].text).toBeFalsy();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${HOST_A}/api/functions/studio/p-alpha/proxy/api/admin/schema/plan`);
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-for-a");
    });
});
