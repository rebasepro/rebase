/**
 * `rebase cloud deploy --preview`, with the control plane stood in.
 *
 * The property everything here holds is that a preview never reaches
 * production: it is triggered through `previews`, never `deploy`; it uploads
 * no rebuild source (which a platform upgrade would rebuild production from)
 * and registers no apps; and a control plane that does not know previews
 * refuses it rather than deploying it somewhere else. The other half is that it
 * reports the preview's own address, not production's.
 *
 * The bundle is prebuilt (`--bundle-dir`), so nothing here compiles a project.
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

vi.mock("../../telemetry", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../telemetry")>();
    return { ...actual, recordEvent: vi.fn(async () => undefined) };
});

import * as context from "./context";
import { deployCommand, resolvePreviewRequest } from "./deploy";
import { normalizePreviewName, previewFrom, PREVIEW_DEPLOYMENTS_COLLECTION } from "./previews";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const PREVIEW = {
    name: "new-quiz",
    url: "https://songbuzz--new-quiz.rebase.website",
    app: "backend",
    backend: "preview",
    status: "deploying",
    expiresAt: "2026-10-27T10:00:00.000Z"
};

let project: string;
let bundleDir: string;
let cwd: string;
let said: string[];
let stdout: string[];
let invoke: ReturnType<typeof vi.fn>;
let requests: string[];
/** Which collection each row read went to, in order. */
let readsFrom: string[];
/** What a deployment row reads as while followed. */
let row: Record<string, unknown> | undefined;
/** What the preview's own health route answers once its build has finished. */
let previewHealth: Response | (() => Response);
/** The previews `GET previews/:id` lists. */
let listed: unknown[];
/** What `pricing/quote` answers a batch of project rows with. */
let quote: (rows: Array<Record<string, unknown>>) => unknown;
/** Each `pricing/quote` request: its credential, if any, and its body. */
let quoteRequests: Array<{ authorization: string | null; body: Array<Record<string, unknown>> }>;

function write(root: string, relative: string, content: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function bundle(kind: "backend" | "static"): void {
    write(bundleDir, "manifest.json", JSON.stringify({
        bundleFormat: 2,
        runtime: { range: "^1", builtAgainst: "0.25.1", contract: 1 },
        schemaVersion: "v1:abc",
        app: kind === "backend" ? "backend" : "game",
        kind,
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "0.25.1", node: "22", createdAt: "2026-10-20T00:00:00Z" }
    }));
    write(bundleDir, "config/index.js", "export default {};\n");
}

beforeEach(() => {
    vi.clearAllMocks();
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-preview-src-")));
    bundleDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-preview-bundle-")));
    // SongBuzz's shape: a managed backend, and a static game at the root.
    write(project, "rebase.json", JSON.stringify({
        rebase: "^1",
        apps: {
            backend: { type: "backend", runtime: "managed" },
            game: { type: "static", root: "web", build: "node scripts/sync-web.mjs", output: "web", path: "/" }
        }
    }));
    write(project, "backend/src/index.ts", "export {};\n");
    cwd = process.cwd();
    process.chdir(project);

    said = [];
    stdout = [];
    requests = [];
    readsFrom = [];
    row = undefined;
    previewHealth = () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    const capture = (...args: unknown[]) => { said.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Exited(code ?? 0);
    }) as never);
    context.setJsonModeForTest(false);

    quoteRequests = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        requests.push(url);
        if (url === "https://cp.example/api/functions/pricing/quote") {
            quoteRequests.push({ authorization: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) });
            return new Response(JSON.stringify(quote(JSON.parse(String(init?.body)))));
        }
        if (url.includes("/deploy/bundle/upload")) return new Response(JSON.stringify({ bundleId: "b1" }));
        if (url.includes("/deploy/source/upload")) return new Response(JSON.stringify({ sourceId: "0123456789abcdef0123456789abcdef" }));
        if (url === `${PREVIEW.url}/api/health`) return typeof previewHealth === "function" ? previewHealth() : previewHealth;
        return new Response("not found", { status: 404 });
    }));

    listed = [PREVIEW];
    quote = (rows) => ({ quotes: rows.map(r => ({ lines: [], totalEur: 30 + 4.5 * Number(r.backendPreviews), backendPreviews: r.backendPreviews })) });
    invoke = vi.fn(async (name: string, _body: unknown, options?: { method?: string }) => {
        if (name === "previews" && options?.method === "GET") return { previews: listed };
        return name === "previews"
            ? { success: true, deployment: { id: "pd1" }, preview: PREVIEW }
            : { success: true, deployment: { id: "d1" }, managed: true };
    });
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: {
            auth: { getSession: () => ({ accessToken: "tok", expiresAt: Date.now() + 60 * 60_000 }) },
            data: {
                collection: (name: string) => ({
                    findById: async () => {
                        readsFrom.push(name);
                        if (name === "projects") return { id: "proj_1", subdomain: "songbuzz" };
                        return row;
                    },
                    find: async () => ({ data: [] })
                })
            },
            functions: { invoke }
        },
        url: "https://cp.example"
    });
});

afterEach(() => {
    process.chdir(cwd);
    context.setJsonModeForTest(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(bundleDir, { recursive: true, force: true });
});

function deploy(...flags: string[]): Promise<void> {
    return deployCommand(["node", "rebase", "cloud", "deploy", "--bundle-dir", bundleDir, ...flags], "songbuzz");
}

/**
 * The one trigger that was sent: its function, its body and its options. The
 * reads a preview's price takes afterwards (the previews list, the quote) are
 * not triggers.
 */
function triggered(): { name: string; body: Record<string, unknown>; options: unknown } {
    const triggers = invoke.mock.calls.filter(([, , options]) =>
        (options as { method?: string } | undefined)?.method !== "GET");
    expect(triggers).toHaveLength(1);
    const [name, body, options] = triggers[0] as [string, Record<string, unknown>, unknown];
    return { name, body, options };
}

/**
 * The batch of project rows the preview's price was asked for — with no
 * credential: the route is public, and a token would be refused on it.
 */
function quoted(): Array<Record<string, unknown>> {
    expect(quoteRequests).toHaveLength(1);
    expect(quoteRequests[0].authorization).toBeNull();
    return quoteRequests[0].body;
}

const routeMissing = () => Object.assign(new Error("No route for POST /api/functions/previews/proj_1 on this backend."), { status: 404 });

describe("a --preview deploy", () => {
    it("is triggered through `previews`, never `deploy`", async () => {
        bundle("backend");

        await deploy("--preview", "--no-follow");

        const { name, body, options } = triggered();
        expect(name).toBe("previews");
        expect(options).toEqual({ method: "POST", path: "proj_1" });
        expect(body).toMatchObject({ projectId: "proj_1", bundleId: "b1", app: "backend", client: "cli", preview: {} });
    });

    it("uploads no rebuild source and registers no apps — both would change production", async () => {
        bundle("backend");

        await deploy("--preview", "--no-follow");

        expect(requests.some(url => url.includes("/deploy/source/upload"))).toBe(false);
        const { body } = triggered();
        expect("rebuildSource" in body).toBe(false);
        expect("declaredApps" in body).toBe(false);
    });

    it("sends the name it was given, lowercased, so the next deploy of it updates the same address", async () => {
        bundle("backend");

        await deploy("--preview-name", "New-Quiz", "--no-follow");

        expect(triggered().body.preview).toEqual({ name: "new-quiz" });
    });

    it("previews a static app by name", async () => {
        bundle("static");

        await deploy("game", "--preview", "--no-follow");

        expect(triggered().body).toMatchObject({ app: "game", preview: {} });
    });

    it("prints the preview's address and says production did not change", async () => {
        bundle("backend");

        await deploy("--preview", "--no-follow");

        const out = said.join("\n");
        expect(out).toContain("https://songbuzz--new-quiz.rebase.website");
        expect(out).toContain("Production is unchanged");
        expect(out).not.toContain("Triggering managed deployment");
    });

    it("follows the build in preview-deployments, and reports the preview's address rather than production's", async () => {
        bundle("backend");
        row = { id: "pd1", status: "success", logs: "built\n" };

        await deploy("--preview");

        expect(readsFrom).toContain(PREVIEW_DEPLOYMENTS_COLLECTION);
        expect(readsFrom).not.toContain("deployments");
        const out = said.join("\n");
        expect(out).toContain("Preview deployed");
        expect(out).toContain("https://songbuzz--new-quiz.rebase.website");
        // The production verdict, and the production address under it, are
        // the other branch.
        expect(out).not.toContain("Deployment succeeded");
    });

    it("checks that the preview answers before calling it live, as a production deploy does", async () => {
        bundle("backend");
        row = { id: "pd1", status: "success", logs: "built\n" };

        await deploy("--preview");

        expect(requests).toContain(`${PREVIEW.url}/api/health`);
        expect(said.join("\n")).toMatch(/Live: the preview answers/);
    });

    it("says so when the preview does not answer yet, and still succeeds — the build did", async () => {
        bundle("backend");
        row = { id: "pd1", status: "success", logs: "built\n" };
        previewHealth = () => new Response("<html>default backend - 404</html>", { status: 404 });

        await deploy("--preview", "--live-timeout", "0.01");

        const out = said.join("\n");
        expect(out).toContain("Preview deployed");
        expect(out).toMatch(/Not confirmed live after .*health check answered 404/);
        // Not production's status command: it says nothing about a preview.
        expect(out).not.toContain("rebase cloud status");
    });

    it("skips the check with --live-timeout 0, and carries the verdict in JSON", async () => {
        bundle("backend");
        row = { id: "pd1", status: "success", logs: "built\n" };
        context.setJsonModeForTest(true);

        await deploy("--preview");

        expect(JSON.parse(stdout.join(""))).toMatchObject({ success: true, following: true, live: true, liveChecks: [{ live: true }] });
        stdout.length = 0;
        requests.length = 0;

        await deploy("--preview", "--live-timeout", "0");
        expect(requests).not.toContain(`${PREVIEW.url}/api/health`);
        expect(JSON.parse(stdout.join(""))).toMatchObject({ success: true, live: null });
    });

    it("exits non-zero when the preview's build fails", async () => {
        bundle("backend");
        row = { id: "pd1", status: "failed", logs: "boom\n" };

        await expect(deploy("--preview")).rejects.toMatchObject({ code: 1 });
        expect(said.join("\n")).toContain("Deployment failed");
    });

    it("carries the preview in its JSON result", async () => {
        bundle("backend");
        context.setJsonModeForTest(true);

        await deploy("--preview", "--no-follow");

        expect(JSON.parse(stdout.join(""))).toMatchObject({
            success: true,
            deploymentId: "pd1",
            following: false,
            preview: { name: "new-quiz", url: PREVIEW.url, backend: "preview", deploymentId: "pd1" }
        });
    });
});

describe("what a preview costs", () => {
    it("states the control plane's quote for one backend preview, not a number of its own", async () => {
        bundle("backend");

        await deploy("--preview", "--no-follow");

        // The project's own row, priced without and with one preview.
        expect(quoted().map(row => [row.id, row.backendPreviews])).toEqual([["proj_1", 0], ["proj_1", 1]]);
        const out = said.join("\n");
        expect(out).toContain("€4.50/month");
        expect(out).toContain("rebase cloud previews delete new-quiz");
    });

    it("adds what all the project's backend previews cost together when it runs more than one", async () => {
        bundle("backend");
        listed = [PREVIEW, { ...PREVIEW, name: "old-quiz", url: "https://songbuzz--old-quiz.rebase.website" }];

        await deploy("--preview", "--no-follow");

        expect(quoted().map(row => row.backendPreviews)).toEqual([0, 1, 2]);
        expect(said.join("\n")).toMatch(/runs 2 backend previews: €9\.00\/month together/);
    });

    it("carries the cost in the JSON result of a followed preview", async () => {
        bundle("backend");
        row = { id: "pd1", status: "success", logs: "built\n" };
        context.setJsonModeForTest(true);

        await deploy("--preview", "--live-timeout", "0");

        expect(JSON.parse(stdout.join(""))).toMatchObject({
            success: true,
            cost: { perPreviewMonthlyEur: 4.5, backendPreviews: 1, previewsMonthlyEur: 4.5, docs: expect.stringContaining("#preview-a-change") }
        });
    });

    it("prints the documented rule and the docs link when the control plane does not price previews", async () => {
        bundle("backend");
        // An older quote: the same total whatever the count, and no echo of it.
        quote = (rows) => ({ quotes: rows.map(() => ({ lines: [], totalEur: 30 })) });
        context.setJsonModeForTest(true);

        await deploy("--preview", "--no-follow");

        const result = JSON.parse(stdout.join("")) as { cost: { perPreviewMonthlyEur: number | null; rule: string } };
        expect(result.cost.perPreviewMonthlyEur).toBeNull();
        expect(result.cost.rule).toContain("one app unit at the default size");
    });

    it("says nothing about a price, and asks for none, for a preview that is only files", async () => {
        bundle("static");
        invoke.mockImplementation(async (name: string, _body: unknown, options?: { method?: string }) => {
            if (name === "previews" && options?.method !== "GET") {
                return { success: true, deployment: { id: "pd1" }, preview: { ...PREVIEW, app: "game", backend: "production" } };
            }
            return {};
        });

        await deploy("game", "--preview", "--no-follow");

        expect(quoteRequests).toHaveLength(0);
        expect(said.join("\n")).not.toContain("/month");
    });
});

describe("refusing a preview", () => {
    it("on a control plane without previews, and never falls back to a production deploy", async () => {
        bundle("backend");
        invoke.mockImplementation(async () => { throw routeMissing(); });

        await expect(deploy("--preview", "--no-follow")).rejects.toThrow(Exited);

        expect(invoke.mock.calls.map(([name]) => name)).toEqual(["previews"]);
        const out = said.join("\n");
        expect(out).toContain("does not serve preview deployments");
        expect(out).toContain("Nothing was deployed");
    });

    it("reads today's FUNCTION_NOT_FOUND envelope as the same missing route", async () => {
        bundle("backend");
        invoke.mockImplementation(async () => {
            throw Object.assign(new Error("No function named 'previews'."), { status: 404, code: "FUNCTION_NOT_FOUND" });
        });
        context.setJsonModeForTest(true);

        await expect(deploy("--preview", "--no-follow")).rejects.toThrow(Exited);

        expect(invoke.mock.calls.map(([name]) => name)).toEqual(["previews"]);
        expect(JSON.parse(stdout.join(""))).toMatchObject({ error: { code: "previews_unavailable" } });
    });

    it("says previews_unavailable in JSON mode", async () => {
        bundle("backend");
        invoke.mockImplementation(async () => { throw routeMissing(); });
        context.setJsonModeForTest(true);

        await expect(deploy("--preview", "--no-follow")).rejects.toThrow(Exited);

        expect(JSON.parse(stdout.join(""))).toMatchObject({ error: { code: "previews_unavailable" } });
    });

    it("when the answer names no address to report", async () => {
        bundle("backend");
        invoke.mockResolvedValue({ success: true, deployment: { id: "pd1" } });
        context.setJsonModeForTest(true);

        await expect(deploy("--preview", "--no-follow")).rejects.toThrow(Exited);

        expect(JSON.parse(stdout.join(""))).toMatchObject({ error: { code: "invalid_response" } });
    });

    it("passes an intake refusal through with its code", async () => {
        bundle("backend");
        invoke.mockImplementation(async () => {
            throw Object.assign(new Error("Previews are capped at 3 per project."), {
                status: 409,
                details: { intakeCode: "PREVIEW_LIMIT", hint: "Delete one with `rebase cloud previews delete <name>`." }
            });
        });
        context.setJsonModeForTest(true);

        await expect(deploy("--preview", "--no-follow")).rejects.toThrow(Exited);

        expect(JSON.parse(stdout.join(""))).toMatchObject({
            error: { code: "PREVIEW_LIMIT", hint: expect.stringContaining("previews delete") }
        });
    });

    it("of a static app on its own, on a cloud that serves no static site by itself, with what to do instead", async () => {
        bundle("static");
        invoke.mockImplementation(async () => {
            throw Object.assign(new Error("This control plane does not serve static sites on their own yet."), {
                status: 409,
                details: {
                    intakeCode: "PREVIEW_STATIC_UNSERVED",
                    hint: "Preview the backend with its static apps folded in (`rebase cloud deploy --preview`): the preview pod serves them."
                }
            });
        });
        context.setJsonModeForTest(true);

        await expect(deploy("game", "--preview", "--no-follow")).rejects.toThrow(Exited);

        const { error } = JSON.parse(stdout.join("")) as { error: { code: string; message: string; hint: string } };
        expect(error.code).toBe("PREVIEW_STATIC_UNSERVED");
        expect(error.message).toContain("not available on this cloud yet");
        // Both ways forward: a project with no backend cannot take the first.
        expect(error.hint).toContain("rebase cloud deploy --preview");
        expect(error.hint).toContain("rebase cloud deploy <app>");
    });

    it("for a container-image backend, without recommending a static app's own preview", async () => {
        write(project, "rebase.json", JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend" } } }));

        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "--preview"], "songbuzz"))
            .rejects.toThrow(Exited);

        expect(said.join("\n")).not.toContain("<app> --preview");
    });

    it.each([
        ["--source", "."],
        ["--eject"]
    ])("with %s, before anything is built or sent", async (...flags) => {
        bundle("backend");

        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "--preview", ...flags], "songbuzz"))
            .rejects.toThrow(Exited);

        expect(said.join("\n")).toContain("--preview cannot be combined with");
        expect(requests).toEqual([]);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("for a backend that builds a container image", async () => {
        write(project, "rebase.json", JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend" } } }));

        await expect(deployCommand(["node", "rebase", "cloud", "deploy", "--preview"], "songbuzz"))
            .rejects.toThrow(Exited);

        expect(said.join("\n")).toContain("Previews are built from managed bundles");
        expect(requests).toEqual([]);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("named with something that cannot be part of a hostname", async () => {
        bundle("backend");

        await expect(deploy("--preview-name", "a--b")).rejects.toThrow(Exited);

        expect(requests).toEqual([]);
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe("resolvePreviewRequest", () => {
    it("is a production deploy when neither flag is given", () => {
        expect(resolvePreviewRequest({})).toBeUndefined();
    });

    it("lets the control plane name a bare --preview", () => {
        expect(resolvePreviewRequest({ "--preview": true })).toEqual({});
    });

    it("reads a name alone as a preview", () => {
        expect(resolvePreviewRequest({ "--preview-name": "feature-x" })).toEqual({ name: "feature-x" });
    });
});

describe("normalizePreviewName", () => {
    it.each([
        ["new-quiz", "new-quiz"],
        ["  Feature-42 ", "feature-42"],
        ["a", "a"],
        ["x".repeat(24), "x".repeat(24)]
    ])("accepts %j as %j", (raw, name) => {
        expect(normalizePreviewName(raw)).toBe(name);
    });

    it.each([
        "",
        "x".repeat(25),
        "feature/x",
        "new_quiz",
        "-lead",
        "trail-",
        "a--b"
    ])("refuses %j", (raw) => {
        expect(() => normalizePreviewName(raw)).toThrow(Exited);
    });
});

describe("previewFrom", () => {
    it("reads camel or snake columns and puts a scheme on a bare host", () => {
        expect(previewFrom({ name: "x", url: "shop--x.rebase.website", deployment_id: 7, expires_at: "2026-10-27" }))
            .toMatchObject({ url: "https://shop--x.rebase.website", deploymentId: "7", expiresAt: "2026-10-27" });
    });

    it("is null without a name or an address", () => {
        expect(previewFrom({ name: "x" })).toBeNull();
        expect(previewFrom({ url: "https://shop--x.rebase.website" })).toBeNull();
        expect(previewFrom("x")).toBeNull();
    });

    it("drops a backend it does not recognise rather than guess", () => {
        expect(previewFrom({ name: "x", url: "https://a", backend: "staging" })?.backend).toBeNull();
    });
});
