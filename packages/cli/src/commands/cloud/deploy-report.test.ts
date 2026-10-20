/**
 * What a followed `rebase cloud deploy` prints at the end, end to end.
 *
 * SongBuzz — a managed backend with a static "game" at `/`, live at
 * `songbuzz.rebase.website` — deployed many times and every run ended on
 * `{"success":true,…,"following":true,"status":"success","hosts":[]}`. Its
 * developer then checked each deploy with `curl`. These drive the real command
 * against a stood-in control plane and app, and read what a person would.
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
    return { ...actual,
recordEvent: vi.fn(async () => undefined) };
});

import * as context from "./context";
import { deployCommand } from "./deploy";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

let project: string;
let bundleDir: string;
let cwd: string;
let stdout: string[];
let deployment: { id: string; status: string; logs: string };
let health: () => Response;
let probes: string[];
let cpCounter = 0;

function write(root: string, relative: string, content: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

beforeEach(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-deploy-report-")));
    bundleDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-deploy-report-bundle-")));
    write(project, "rebase.json", JSON.stringify({
        rebase: "^1",
        apps: {
            backend: { type: "backend",
runtime: "managed" },
            game: { type: "static",
root: "game",
output: "game/dist",
path: "/" }
        }
    }));
    write(bundleDir, "manifest.json", JSON.stringify({
        bundleFormat: 2,
        runtime: { range: "^1",
builtAgainst: "0.25.1",
contract: 1 },
        schemaVersion: "v1:abc",
        app: "backend",
        kind: "backend",
        hooks: { native: false },
        deps: { declared: {} },
        entry: { config: "config/index.js",
static: [{ name: "game",
path: "/",
dir: "static/game",
spa: true }] },
        build: { cli: "0.25.1",
node: "22",
createdAt: "2026-10-20T00:00:00Z" }
    }));
    write(bundleDir, "config/index.js", "export default {};\n");
    write(bundleDir, "static/game/index.html", "<html></html>\n");
    cwd = process.cwd();
    process.chdir(project);

    stdout = [];
    probes = [];
    deployment = { id: "fb3c7442",
status: "success",
logs: "[10:00:00] 📦 Managed deploy\n✅ Live\n" };
    health = () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    const capture = (...args: unknown[]) => { stdout.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Exited(code ?? 0);
    }) as never);
    context.setJsonModeForTest(false);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/deploy/bundle/upload")) return new Response(JSON.stringify({ bundleId: "b1" }));
        if (url.includes("/deploy/source/upload")) return new Response(JSON.stringify({ sourceId: "0".repeat(32) }));
        probes.push(url);
        if (url === "https://songbuzz.rebase.website/api/health") return health();
        if (url === "https://songbuzz.rebase.website") return new Response("<html></html>", { status: 200 });
        return new Response("not found", { status: 404 });
    }));

    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: {
            auth: { getSession: () => ({ accessToken: "tok",
expiresAt: Date.now() + 60 * 60_000 }) },
            data: {
                collection: (name: string) => ({
                    findById: async () => name === "deployments" ? deployment : { subdomain: "songbuzz" },
                    find: async () => ({ data: [] })
                })
            },
            functions: {
                invoke: vi.fn(async (name: string) => name === "platform-config"
                    ? { tenantBaseDomain: "rebase.website" }
                    : { success: true,
deployment: { id: deployment.id },
managed: true,
hosts: [] })
            }
        },
        // A control plane of each test's own: its platform config is cached per URL.
        url: `https://cp-report-${++cpCounter}.example`
    });
});

afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(project, { recursive: true,
force: true });
    fs.rmSync(bundleDir, { recursive: true,
force: true });
});

function deploy(...flags: string[]): Promise<void> {
    return deployCommand(["node", "rebase", "cloud", "deploy", "--bundle-dir", bundleDir, "--no-source", ...flags], "songbuzz");
}

describe("a followed deploy that succeeded", () => {
    it("prints each app's URL and confirms the new version is live", async () => {
        await deploy();

        const out = plain(stdout.join("\n"));
        expect(out).toMatch(/✓ Deployed songbuzz in \d+s {2}\(deployment fb3c7442\)/);
        expect(out).toMatch(/game\s+static\s+https:\/\/songbuzz\.rebase\.website\s+live/);
        expect(out).toMatch(/backend\s+backend\s+https:\/\/songbuzz\.rebase\.website\/api\s+live/);
        expect(out).toContain("✓ Live: the new version answers on every address above.");
        expect(probes).toEqual(expect.arrayContaining([
            "https://songbuzz.rebase.website",
            "https://songbuzz.rebase.website/api/health"
        ]));
    });

    it("says it could not confirm, without failing a deploy that succeeded", async () => {
        health = () => new Response(JSON.stringify({ status: "degraded" }), { status: 503 });

        await deploy("--live-timeout", "0.01");

        const out = plain(stdout.join("\n"));
        expect(out).toMatch(/backend\s+backend\s+https:\/\/songbuzz\.rebase\.website\/api\s+not live: health check answered 503/);
        expect(out).toContain("⚠ Not confirmed live after 0s: backend (health check answered 503).");
    });

    it("skips the check on --live-timeout 0, and says so", async () => {
        await deploy("--live-timeout", "0");

        expect(probes).toEqual([]);
        expect(plain(stdout.join("\n"))).toContain("Live check skipped (--live-timeout 0).");
    });

    it("keeps the machine result behind --json, with the facts the summary prints", async () => {
        context.setJsonModeForTest(true);
        try {
            await deploy();
        } finally {
            context.setJsonModeForTest(false);
        }

        const result = JSON.parse(stdout.join(""));
        expect(result).toMatchObject({
            success: true,
            deploymentId: "fb3c7442",
            managed: true,
            following: true,
            status: "success",
            project: "songbuzz",
            hosts: [{ host: "songbuzz.rebase.website",
status: "verified" }],
            apps: [
                { name: "game",
type: "static",
url: "https://songbuzz.rebase.website" },
                { name: "backend",
type: "backend",
url: "https://songbuzz.rebase.website/api" }
            ],
            live: true
        });
        expect(result.liveChecks).toHaveLength(2);
        expect(typeof result.durationMs).toBe("number");
    });
});

describe("a followed deploy that failed", () => {
    beforeEach(() => {
        deployment = {
            id: "fb3c7442",
            status: "failed",
            logs: "[10:00:00] 📦 Managed deploy\n\n❌ Managed deploy failed: The new version did not become ready: CrashLoopBackOff\n"
        };
    });

    it("ends on one line naming the apps and the reason, and where to read more", async () => {
        await expect(deploy()).rejects.toThrow(Exited);

        const out = plain(stdout.join("\n"));
        expect(out).toContain(
            "✗ game + backend failed to deploy: Managed deploy failed: The new version did not become ready: CrashLoopBackOff"
        );
        expect(out).toContain("Full build log: `rebase cloud logs` (deployment fb3c7442).");
    });

    it("carries the same in its JSON error", async () => {
        context.setJsonModeForTest(true);
        try {
            await expect(deploy()).rejects.toThrow(Exited);
        } finally {
            context.setJsonModeForTest(false);
        }

        const { error } = JSON.parse(stdout.join(""));
        expect(error).toMatchObject({
            code: "deploy_failed",
            deploymentId: "fb3c7442",
            apps: ["game", "backend"],
            reason: "Managed deploy failed: The new version did not become ready: CrashLoopBackOff"
        });
    });
});
