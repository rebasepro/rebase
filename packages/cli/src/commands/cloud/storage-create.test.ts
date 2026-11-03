/**
 * `rebase cloud storage create`, run through the real dispatcher.
 *
 * Managed storage reaches a tenant one of two ways: an S3 key (Garage), or a
 * GCS bucket granted to the project's workload identity, which has no key at
 * all. The command must say which, and never claim a secret was stored for a
 * bucket that has none.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../telemetry", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../telemetry")>();
    return { ...actual, recordEvent: vi.fn(async () => undefined) };
});

import { cloudCommand } from "./index";

const CP = "https://cp.example";
const PROJECT_ID = "proj_1";

let provisioned: Record<string, unknown>;
let stdout: string[];
let stderr: string[];
let home: string;
let cwd: string;
let savedEnv: Record<string, string | undefined>;

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function respond(method: string, url: URL): Response {
    const p = url.pathname;
    if (p === "/api/data/projects") return json(200, { data: [{ id: PROJECT_ID, subdomain: "shop", name: "Shop" }], meta: { hasMore: false } });
    if (p === `/api/data/projects/${PROJECT_ID}`) return json(200, { id: PROJECT_ID, subdomain: "shop" });
    if (p === `/api/functions/storage-provision/${PROJECT_ID}` && method === "POST") {
        return json(200, { success: true, data: provisioned });
    }
    return json(404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${p} on this backend.` } });
}

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-storage-home-")));
    cwd = process.cwd();
    process.chdir(home);
    savedEnv = { HOME: process.env.HOME, REBASE_TOKEN: process.env.REBASE_TOKEN, REBASE_JSON: process.env.REBASE_JSON };
    process.env.HOME = home;
    process.env.REBASE_TOKEN = "rk_live_token";
    // Human output unless a test passes --json: stdout is not a TTY here.
    process.env.REBASE_JSON = "0";

    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { stderr.push(String(chunk)); return true; }) as never);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        respond(init?.method ?? "GET", new URL(String(input)))));
});

afterEach(() => {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(home, { recursive: true, force: true });
});

const create = (...flags: string[]) =>
    cloudCommand("storage", ["node", "rebase", "cloud", "storage", "create", "--project", "shop", "--url", CP, ...flags]);

describe("rebase cloud storage create", () => {
    it("says a workload-identity bucket has no key, rather than that one was stored", async () => {
        provisioned = {
            bucketName: "tsp-tenant-0123456789ab", region: "europe-west1",
            access: "workload-identity", endpoint: null, accessKeyId: null
        };
        await create();
        const out = [...stdout, ...stderr].join("\n");
        expect(out).toContain("tsp-tenant-0123456789ab");
        expect(out).toContain("workload identity (no key)");
        expect(out).not.toMatch(/secret key is stored/i);
    });

    it("reports the access kind in --json", async () => {
        provisioned = {
            bucketName: "tsp-tenant-0123456789ab", region: "europe-west1",
            access: "workload-identity", endpoint: null, accessKeyId: null
        };
        await create("--json");
        const out = JSON.parse(stdout.join("")) as Record<string, unknown>;
        expect(out).toMatchObject({ access: "workload-identity", accessKeyId: null, secretAccessKey: null });
    });

    it("keeps the stored-secret note for a keyed bucket, including from a control plane that sends no access field", async () => {
        provisioned = {
            bucketName: "shop-tenant-0123456789ab", region: "fsn1",
            endpoint: "https://s3.fsn1.example", accessKeyId: "GK123"
        };
        await create();
        const out = [...stdout, ...stderr].join("\n");
        expect(out).toContain("GK123");
        expect(out).toMatch(/secret key is stored encrypted/i);
        expect(out).not.toContain("workload identity");
    });
});
