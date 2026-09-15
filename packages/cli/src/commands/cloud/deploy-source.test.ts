/**
 * `rebase cloud deploy` on the bundle path, with the control plane stood in.
 *
 * What these hold: the source travels beside a backend bundle and is named in
 * the trigger; a source that cannot travel costs a warning and never the
 * deploy; `--no-source` and a static app send none; and a bundle the control
 * plane refuses as a downgrade says how to get past it.
 *
 * The bundle is prebuilt (`--bundle-dir`), so nothing here compiles a project;
 * the packing is the real `tar`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        resolveProjectRef: vi.fn(async () => "proj_1")
    };
});

import * as context from "./context";
import { deployCommand } from "./deploy";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const SOURCE_ID = "0123456789abcdef0123456789abcdef";

let project: string;
let bundleDir: string;
let cwd: string;
let said: string[];
let invoke: ReturnType<typeof vi.fn>;
let requests: string[];

function write(root: string, relative: string, content: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function bundle(kind: "backend" | "static"): void {
    write(bundleDir, "manifest.json", JSON.stringify({
        bundleFormat: 2,
        runtime: { range: "^1", builtAgainst: "0.21.0", contract: 1 },
        schemaVersion: "v1:abc",
        app: kind === "backend" ? "backend" : "web",
        kind,
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "0.21.0", node: "22", createdAt: "2026-09-15T00:00:00Z" }
    }));
    write(bundleDir, "config/index.js", "export default {};\n");
}

/** Route the two uploads; `sourceStatus` decides how the source one answers. */
function controlPlane(sourceStatus = 200): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        requests.push(url);
        if (url.includes("/deploy/bundle/upload")) return new Response(JSON.stringify({ bundleId: "b1" }));
        if (url.includes("/deploy/source/upload")) {
            return sourceStatus === 200
                ? new Response(JSON.stringify({ sourceId: SOURCE_ID }))
                : new Response("the archive store is down", { status: sourceStatus });
        }
        return new Response("not found", { status: 404 });
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-deploy-src-")));
    bundleDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-deploy-bundle-")));
    write(project, "rebase.json", JSON.stringify({
        rebase: "^1",
        apps: {
            backend: { type: "backend", runtime: "managed" },
            web: { type: "static", root: "frontend", output: "frontend/dist", path: "/" }
        }
    }));
    write(project, "backend/src/index.ts", "export {};\n");
    write(project, ".env", "SECRET=never\nVITE_API_URL=http://localhost:3001\n");
    write(project, "frontend/.env.production", "VITE_TITLE=Shop\n");
    cwd = process.cwd();
    process.chdir(project);

    said = [];
    requests = [];
    const capture = (...args: unknown[]) => { said.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Exited(code ?? 0);
    }) as never);
    context.setJsonModeForTest(false);

    invoke = vi.fn(async () => ({ success: true, deployment: { id: "d1" }, managed: true }));
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: {
            auth: { getSession: () => ({ accessToken: "tok" }) },
            data: { collection: () => ({ findById: async () => undefined }) },
            functions: { invoke }
        },
        url: "https://cp.example"
    });
});

afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(bundleDir, { recursive: true, force: true });
});

function deploy(...flags: string[]): Promise<void> {
    return deployCommand(["node", "rebase", "cloud", "deploy", "--bundle", "--bundle-dir", bundleDir, "--no-follow", ...flags], "shop");
}

/** The body the deploy trigger was sent. */
function triggered(): Record<string, unknown> {
    expect(invoke).toHaveBeenCalledTimes(1);
    const [name, body] = invoke.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("deploy");
    return body;
}

describe("a backend bundle deploy", () => {
    it("uploads the source and names it in the trigger", async () => {
        bundle("backend");
        controlPlane();

        await deploy();

        expect(requests.some(url => url.includes("/deploy/source/upload?projectId=proj_1"))).toBe(true);
        expect(triggered().rebuildSource).toEqual({
            sourceId: SOURCE_ID,
            projectPath: "",
            // The static app's own production file, and never the root .env's
            // secret or its localhost API address.
            buildEnv: { VITE_TITLE: "Shop" }
        });
    });

    it("still deploys when the source upload fails, and says what that costs", async () => {
        bundle("backend");
        controlPlane(503);

        await deploy();

        const body = triggered();
        expect("rebuildSource" in body).toBe(false);
        expect(body.bundleId).toBe("b1");
        expect(said.join("\n")).toContain("Platform upgrades will not rebuild this project");
        expect(said.join("\n")).toContain("Managed deploy started");
    });

    it("sends no source with --no-source", async () => {
        bundle("backend");
        controlPlane();

        await deploy("--no-source");

        expect(requests.some(url => url.includes("/deploy/source/upload"))).toBe(false);
        expect("rebuildSource" in triggered()).toBe(false);
    });

    // The owner turned platform rebuilds off: the platform keeps no copy of
    // the source, so none is even packed, let alone sent.
    it("uploads no source for a project whose owner turned platform rebuilds off", async () => {
        bundle("backend");
        controlPlane();
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: {
                auth: { getSession: () => ({ accessToken: "tok" }) },
                data: { collection: () => ({ findById: async () => ({ id: "proj_1", platformRebuilds: false }) }) },
                functions: { invoke }
            },
            url: "https://cp.example"
        });

        await deploy();

        expect(requests.some(url => url.includes("/deploy/source/upload"))).toBe(false);
        expect("rebuildSource" in triggered()).toBe(false);
        expect(said.join("\n")).toContain("Platform rebuilds are off for this project");
    });

    it("asks for a downgrade only with --allow-downgrade", async () => {
        bundle("backend");
        controlPlane();

        await deploy("--allow-downgrade", "--no-source");
        expect(triggered().allowFrameworkDowngrade).toBe(true);
    });

    it("reads the project from its root, not from where the command was run", async () => {
        bundle("backend");
        controlPlane();
        process.chdir(path.join(project, "backend"));

        await deploy("--no-source");

        // Read from rebase.json at the root: from backend/ a synthesized
        // manifest would have declared nothing.
        expect(triggered().declaredApps).toEqual([
            { name: "backend", type: "backend" },
            { name: "web", type: "static" }
        ]);
    });
});

describe("a static bundle deploy", () => {
    it("uploads no source: there is nothing to rebuild", async () => {
        bundle("static");
        controlPlane();

        await deploy();

        expect(requests.some(url => url.includes("/deploy/source/upload"))).toBe(false);
        expect("rebuildSource" in triggered()).toBe(false);
    });
});

describe("a bundle refused as a downgrade", () => {
    it("prints the control plane's hint and both ways past it", async () => {
        bundle("backend");
        controlPlane();
        invoke.mockRejectedValueOnce(Object.assign(new Error("This bundle was built on 0.19.1; the project runs 0.21.0."), {
            status: 400,
            details: { intakeCode: "FRAMEWORK_DOWNGRADE", hint: "Rebuild it on 0.21.0 or later." }
        }));

        await expect(deploy("--no-source")).rejects.toMatchObject({ code: 1 });

        const text = said.join("\n");
        expect(text).toContain("the project runs 0.21.0");
        expect(text).toContain("Rebuild it on 0.21.0 or later.");
        expect(text).toContain("rebase upgrade");
        expect(text).toContain("--allow-downgrade");
    });
});

describe("contradictory flags", () => {
    it("refuses --source with --no-source before anything is uploaded", async () => {
        controlPlane();
        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "--source", ".", "--no-source"], "shop"))
            .rejects.toMatchObject({ code: 1 });
        expect(requests).toEqual([]);
    });
});
