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
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        resolveProjectRef: vi.fn(async () => "proj_1")
    };
});

// Telemetry stood in, so a test can see which events a deploy records.
vi.mock("../../telemetry", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../telemetry")>();
    return { ...actual, recordEvent: vi.fn(async () => undefined) };
});

// The real builder unless a test says otherwise, so a test can see what it was asked for.
vi.mock("../../bundle", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../bundle")>();
    return { ...actual, buildBundle: vi.fn(actual.buildBundle) };
});

import * as context from "./context";
import { deployCommand } from "./deploy";
import { buildBundle } from "../../bundle";
import { recordEvent } from "../../telemetry";

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
let contextArchive: Buffer | undefined;
let bundleArchive: Buffer | undefined;

function write(root: string, relative: string, content: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function bundle(kind: "backend" | "static", deps: Record<string, unknown> = { declared: {} }): void {
    write(bundleDir, "manifest.json", JSON.stringify({
        bundleFormat: 2,
        runtime: { range: "^1", builtAgainst: "0.21.0", contract: 1 },
        schemaVersion: "v1:abc",
        app: kind === "backend" ? "backend" : "web",
        kind,
        hooks: { native: false },
        deps,
        build: { cli: "0.21.0", node: "22", createdAt: "2026-09-15T00:00:00Z" }
    }));
    write(bundleDir, "config/index.js", "export default {};\n");
}

/** Route the uploads; `sourceStatus` decides how the source one answers. */
function controlPlane(sourceStatus = 200): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        requests.push(url);
        if (url.includes("/deploy/bundle/upload")) {
            bundleArchive = Buffer.from(init?.body as Uint8Array);
            return new Response(JSON.stringify({ bundleId: "b1" }));
        }
        if (url.includes("/deploy/upload")) {
            // `--source`: the build context. Kept, so a test can read what left.
            contextArchive = Buffer.from(init?.body as Uint8Array);
            return new Response(JSON.stringify({ source: "gs://contexts/build-contexts/proj_1/c.tar.gz" }));
        }
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
    contextArchive = undefined;
    bundleArchive = undefined;
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

/** The entries of an uploaded archive, without directories or the `./` prefix. */
function archiveEntries(archive: Buffer | undefined): string[] {
    expect(archive).toBeDefined();
    const tar = path.join(bundleDir, "..", `${path.basename(bundleDir)}-read.tar.gz`);
    fs.writeFileSync(tar, archive!);
    try {
        return execFileSync("tar", ["-tzf", tar], { encoding: "utf8" })
            .split("\n")
            .filter(entry => entry !== "" && !entry.endsWith("/"))
            .map(entry => entry.replace(/^\.\//, ""))
            .sort();
    } finally {
        fs.rmSync(tar, { force: true });
    }
}

/**
 * `rebase build` vendors the bundle's dependencies so a pod untars and boots,
 * rather than spending 35-55s of every start in `npm install`. The upload left
 * `node_modules` out, so the install was paid at every deploy and still at
 * every pod start.
 */
describe("a vendored bundle", () => {
    it("uploads the dependency tree the build installed", async () => {
        bundle("backend", { declared: { pg: "^8.22.0" }, vendored: true, vendorTarget: { os: "linux", cpu: "x64", node: "22" } });
        write(bundleDir, "node_modules/pg/package.json", "{\"name\":\"pg\"}");
        write(bundleDir, "node_modules/pg/node_modules/pg-types/index.js", "module.exports = {};");
        controlPlane();

        await deploy("--no-source");

        expect(archiveEntries(bundleArchive)).toEqual([
            "config/index.js",
            "manifest.json",
            "node_modules/pg/node_modules/pg-types/index.js",
            "node_modules/pg/package.json"
        ]);
    });

    it("uploads no node_modules the build did not vendor", async () => {
        bundle("backend", { declared: { pg: "^8.22.0" } });
        write(bundleDir, "node_modules/pg/package.json", "{\"name\":\"pg\"}");
        controlPlane();

        await deploy("--no-source");

        expect(archiveEntries(bundleArchive)).toEqual(["config/index.js", "manifest.json"]);
    });
});

/**
 * `rebase build` refused a project whose manifests declare ranges of one
 * dependency that no single version satisfies; `rebase cloud deploy` builds its
 * own bundle and shipped it, half the project compiled against a version the
 * runtime will never install.
 */
describe("a deploy that builds its own bundle", () => {
    it("refuses dependency ranges no single version satisfies, before anything is uploaded", async () => {
        write(project, "rebase.json", JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed" } } }));
        write(project, "package.json", JSON.stringify({ dependencies: { dotenv: "^16.0.0" } }));
        write(project, "backend/package.json", JSON.stringify({ dependencies: { dotenv: "^17.4.2" } }));
        write(project, "config/collections/posts.ts", "export default {};\n");
        controlPlane();

        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "--no-follow"], "shop"))
            .rejects.toMatchObject({ code: 1 });

        expect(said.join("\n")).toMatch(/no single version satisfies[\s\S]*dotenv/);
        expect(requests).toEqual([]);
        expect(invoke).not.toHaveBeenCalled();
    });
});

/**
 * Two of the deploy's own remedies named flags it refused: a frontend that
 * failed to fold said "pass --no-static", and a schema that failed to
 * generate said "pass --skip-schema", and each answered "unknown or
 * unexpected option". They are `rebase build`'s flags, and a deploy builds
 * its own bundle.
 */
describe("the build flags a deploy's remedies name", () => {
    function projectWithFailingFrontend(): void {
        write(project, "rebase.json", JSON.stringify({
            rebase: "^1",
            apps: {
                backend: { type: "backend", runtime: "managed" },
                web: { type: "static", root: "frontend", build: "exit 7", output: "frontend/dist", path: "/" }
            }
        }));
    }

    it("deploys the API alone with --no-static, and skips the schema with --skip-schema", async () => {
        projectWithFailingFrontend();
        bundle("backend");
        vi.mocked(buildBundle).mockImplementationOnce(async () => ({
            outDir: bundleDir,
            manifest: JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8")),
            collectionCount: 0,
            vendor: { vendored: false, skipped: "the bundle declares no dependencies" }
        }));
        controlPlane();

        await deployCommand(["node", "rebase", "cloud", "deploy", "--no-static", "--skip-schema", "--no-source", "--no-follow"], "shop");

        expect(vi.mocked(buildBundle).mock.calls[0][0]).toMatchObject({ skipSchema: true });
        // The frontend's build fails, so the deploy only got here without it.
        expect(triggered().bundleId).toBe("b1");
    });

    it("refuses --no-static for a static app, which is nothing but its frontend", async () => {
        projectWithFailingFrontend();
        controlPlane();

        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "web", "--no-static", "--no-follow"], "shop"))
            .rejects.toMatchObject({ code: 1 });
        expect(said.join("\n")).toContain("\"web\" is a static app");
        expect(requests).toEqual([]);
    });
});

/**
 * `cli.deploy` is the event that says whether anyone ever ships, and it was
 * recorded on the source-build path alone. A bundle deploy (the default for
 * every scaffold, which declares `runtime: managed`) never recorded one, and a
 * followed deploy that failed exited before recording anything on either path,
 * so the event could not say how often a deploy fails.
 */
describe("the cli.deploy event", () => {
    /** A client whose deployment row reads back as `status`. */
    function deploymentEnds(status: string): void {
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: {
                auth: { getSession: () => ({ accessToken: "tok" }) },
                data: {
                    collection: (name: string) => ({
                        findById: async () => (name === "deployments" ? { id: "d1", status, logs: "built\n" } : undefined)
                    })
                },
                functions: { invoke }
            },
            url: "https://cp.example"
        });
    }

    function recorded(): Array<Record<string, unknown>> {
        return vi.mocked(recordEvent).mock.calls
            .filter(([event]) => event === "cli.deploy")
            .map(([, properties]) => properties as Record<string, unknown>);
    }

    it("is recorded for a bundle deploy", async () => {
        bundle("backend");
        controlPlane();

        await deploy("--no-source");

        expect(recorded()).toEqual([expect.objectContaining({
            followed: false,
            status: "not_followed",
            deduplicated: false,
            framework_version: "0.21.0"
        })]);
    });

    it("records a followed bundle deploy that failed, before exiting non-zero", async () => {
        bundle("backend");
        controlPlane();
        deploymentEnds("failed");

        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "--bundle", "--bundle-dir", bundleDir, "--no-source"], "shop"))
            .rejects.toMatchObject({ code: 1 });

        expect(recorded()).toEqual([expect.objectContaining({ followed: true, status: "failed" })]);
    });

    it("records a followed source deploy that failed", async () => {
        write(project, "rebase.json", JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend" } } }));
        controlPlane();
        deploymentEnds("failed");

        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "--source", "."], "shop"))
            .rejects.toMatchObject({ code: 1 });

        expect(recorded()).toEqual([expect.objectContaining({ followed: true, status: "failed" })]);
    });
});

/**
 * `--source <dir>` uploads a build context, and the control plane keeps it as
 * the project's source archive. It used to be `tar .` with the root
 * `.gitignore` read as tar globs: `.env.production` went up under the stock
 * `.gitignore`, and in a monorepo subfolder — whose `.gitignore` is at the
 * repository root — `.env` itself did.
 */
describe("a --source deploy", () => {
    /** The entries of the build context the control plane was sent. */
    const uploadedContext = (): string[] => archiveEntries(contextArchive);

    function sourceDeploy(dir: string): Promise<void> {
        return deployCommand(["node", "rebase", "cloud", "deploy", "--source", dir, "--no-follow"], "shop");
    }

    it("carries no env file and nothing the ignore files name", async () => {
        write(project, ".gitignore", ".env\n.env.local\n!.env.example\nuploads/\nbackups/\n");
        write(project, "backend/.gitignore", "fixtures/\n");
        write(project, ".rebaseignore", "docs/private/\n");
        write(project, ".env.production", "DATABASE_URL=postgres://prod\n");
        write(project, "backend/.env.production", "STRIPE_KEY=sk_live_x\n");
        write(project, ".env.example", "DATABASE_URL=\n");
        write(project, "Dockerfile", "FROM node:22\n");
        write(project, "backups/prod.dump", "PGDMP");
        write(project, "uploads/avatar.png", "png");
        write(project, "backend/fixtures/customers.csv", "a,b");
        write(project, "backend/.rebase-dev-secrets.json", "{}");
        write(project, "docs/private/notes.md", "# private");
        write(project, "docs/public.md", "# public");
        write(project, "node_modules/hono/index.js", "x");
        controlPlane();

        await sourceDeploy(".");

        expect(uploadedContext()).toEqual([
            ".env.example",
            ".gitignore",
            ".rebaseignore",
            "Dockerfile",
            "backend/.gitignore",
            "backend/src/index.ts",
            "docs/public.md",
            "rebase.json"
        ]);
        expect(triggered().source).toBe("gs://contexts/build-contexts/proj_1/c.tar.gz");
    });

    it("reads the repository's .gitignore for a subfolder, and roots the context at the subfolder", async () => {
        execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
        write(project, ".gitignore", "uploads/\n");
        write(project, "backend/.env", "SECRET=1\n");
        write(project, "backend/uploads/avatar.png", "png");
        write(project, "backend/Dockerfile", "FROM node:22\n");
        controlPlane();

        await sourceDeploy("backend");

        expect(uploadedContext()).toEqual(["Dockerfile", "src/index.ts"]);
    });
});

/**
 * In JSON mode stdout carries one value, and a deploy that fails still owes it:
 * a static app whose build command failed exited 1 with a red line on stderr
 * and nothing at all on stdout, so a CI step had no error object to read.
 */
describe("a static app deploy in JSON mode", () => {
    it("answers a failed build with the JSON error, and nothing else on stdout", async () => {
        write(project, "rebase.json", JSON.stringify({
            rebase: "^1",
            apps: { web: { type: "static", root: "frontend", build: "exit 3", output: "frontend/dist", path: "/" } }
        }));
        controlPlane();
        context.setJsonModeForTest(true);
        const stdout: string[] = [];
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);

        try {
            await expect(deployCommand(["node", "rebase", "cloud", "deploy", "web", "--no-follow"], "shop"))
                .rejects.toMatchObject({ code: 1 });
        } finally {
            context.setJsonModeForTest(false);
        }

        expect(JSON.parse(stdout.join(""))).toMatchObject({
            error: { message: expect.stringContaining("build command failed for \"web\"") }
        });
        expect(said.join("\n")).not.toContain("build command failed");
        expect(requests).toEqual([]);
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
