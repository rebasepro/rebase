/**
 * `rebase cloud storage` for Rebase Storage, run through the real dispatcher
 * against a fake control plane: what each action sends to `rebase-storage`,
 * what it prints, and what it refuses before sending anything.
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
import { resetDeprecationWarningsForTests } from "@rebasepro/common";
import {
    GB,
    egressThisMonth,
    monthlyCostEur,
    parseCorsFile,
    parseS3Url,
    s3EnvLines,
    setImportPollMsForTest,
    type StorageOverview,
    type StoragePricing
} from "./rebase-storage";

const CP = "https://cp.example";
const PROJECT_ID = "3f1c2a4e-1111-4222-8333-944455556666";
const FN = `/api/functions/rebase-storage/${PROJECT_ID}`;
const SECRET = "s3cr3t-value-never-echoed";

interface Sent {
    method: string;
    path: string;
    body: unknown;
}

let sent: Sent[];
let stdout: string[];
let stderr: string[];
let home: string;
let cwd: string;
let savedEnv: Record<string, string | undefined>;
let exitCode: number | undefined;
/** Overrides per `METHOD path`, answered before the defaults. */
let routes: Map<string, () => Response>;
let importPolls: string[];

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const PRICING: StoragePricing = {
    includedBytes: 10 * GB,
    overagePerGbMonthEur: 0.02,
    billsCurrentVersionsOnly: true,
    softDeleteDays: 30,
    egress: { fairUseGbPerMonth: 1000, reservedRateEurPerGb: 0.01, billed: false }
};

const OVERVIEW: StorageOverview = {
    endpoint: "https://s3.rebase.example",
    region: "eu-central",
    buckets: [{ id: "b1", name: "shop-assets", createdAt: "2026-11-01T10:00:00Z", cors: null }],
    keys: [{
        id: "k1", name: "app", accessKeyId: "RKAPP", permission: "read-write", bucket: "shop-assets",
        managed: false, createdAt: "2026-11-01T10:00:00Z", lastUsedAt: null
    }],
    usage: {
        capBytes: 50 * GB, currentBytes: 20 * GB, currentObjects: 1200, estimatedBytes: 20 * GB,
        noncurrentBytes: 0, measuredAt: "2026-11-22T03:00:00Z", egressBytesTotal: 7 * GB
    },
    limits: { defaultCapBytes: 50 * GB, maxCapBytes: 1000 * GB },
    pricing: PRICING
};

const ISSUED = {
    id: "k2", name: "ci", accessKeyId: "RKCI", secretAccessKey: "issued-secret", permission: "read" as const,
    bucket: "shop-assets", endpoint: OVERVIEW.endpoint, region: OVERVIEW.region
};

function respond(method: string, url: URL, body: unknown): Response {
    const p = url.pathname;
    if (p === "/api/data/projects") return json(200, { data: [{ id: PROJECT_ID, subdomain: "shop", name: "Shop" }], meta: { hasMore: false } });
    if (p === `/api/data/projects/${PROJECT_ID}`) return json(200, { id: PROJECT_ID, subdomain: "shop" });
    if (p === "/api/data/storages") return json(200, { data: [], meta: { hasMore: false } });
    if (p.startsWith("/api/functions/rebase-storage/")) {
        sent.push({ method, path: p.slice(FN.length), body });
        const override = routes.get(`${method} ${p.slice(FN.length)}`);
        if (override) return override();
        if (method === "GET" && p === FN) return json(200, OVERVIEW);
        if (method === "GET" && p === `${FN}/usage`) {
            const month = new Date().toISOString().slice(0, 7);
            return json(200, { usage: {}, days: [
                { day: `${month}-01`, requests: 10, egressBytes: 2 * GB, ingressBytes: 0, currentBytes: null },
                { day: "2000-01-01", requests: 10, egressBytes: 5 * GB, ingressBytes: 0, currentBytes: null }
            ] });
        }
        if (method === "POST" && p === `${FN}/buckets`) return json(201, { id: "b2", name: "new-bucket", createdAt: "2026-11-23T00:00:00Z", cors: null });
        if (method === "DELETE" && p.startsWith(`${FN}/buckets/`)) return json(200, { ok: true, deleted: "shop-assets", note: "Restorable for 30 days." });
        if (method === "PUT" && p.endsWith("/cors")) return json(200, { id: "b1", name: "shop-assets", cors: (body as { rules: unknown }).rules });
        if (method === "POST" && p === `${FN}/keys`) return json(201, ISSUED);
        if (method === "POST" && p.endsWith("/rotate")) return json(200, { ...ISSUED, secretAccessKey: "rotated-secret" });
        if (method === "DELETE" && p.startsWith(`${FN}/keys/`)) return json(200, { ok: true });
        if (method === "PUT" && p === `${FN}/limit`) {
            return json(200, { capBytes: Number((body as { capGb: number }).capGb) * GB, estimatedBytes: 20 * GB });
        }
        if (method === "POST" && p === `${FN}/imports`) return json(202, { importId: "imp_1", status: "queued" });
        if (method === "GET" && p === `${FN}/imports/imp_1`) {
            const status = importPolls.shift() ?? "done";
            return json(200, { status, copiedObjects: status === "done" ? 10 : 4, copiedBytes: 1024, totalObjects: 10 });
        }
    }
    return json(404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${p} on this backend.` } });
}

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-rstorage-home-")));
    cwd = process.cwd();
    process.chdir(home);
    savedEnv = {
        HOME: process.env.HOME,
        REBASE_TOKEN: process.env.REBASE_TOKEN,
        REBASE_JSON: process.env.REBASE_JSON,
        REBASE_IMPORT_SECRET_ACCESS_KEY: process.env.REBASE_IMPORT_SECRET_ACCESS_KEY
    };
    process.env.HOME = home;
    process.env.REBASE_TOKEN = "rk_live_token";
    process.env.REBASE_JSON = "0";
    delete process.env.REBASE_IMPORT_SECRET_ACCESS_KEY;

    sent = [];
    stdout = [];
    stderr = [];
    routes = new Map();
    importPolls = [];
    exitCode = undefined;
    setImportPollMsForTest(0);
    resetDeprecationWarningsForTests();
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        exitCode = code ?? 0;
        throw new Error(`exit ${exitCode}`);
    }) as typeof process.exit);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
        return respond(init?.method ?? "GET", new URL(String(input)), body);
    }));
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

/** Run `rebase cloud storage <words>` against the fake control plane; never throws on exit. */
async function storage(...words: string[]): Promise<void> {
    try {
        await cloudCommand("storage", ["node", "rebase", "cloud", "storage", ...words, "--project", "shop", "--url", CP]);
    } catch (error) {
        if (!(error instanceof Error && error.message.startsWith("exit "))) throw error;
    }
}

const out = () => [...stdout, ...stderr].join("\n");
const jsonOut = () => JSON.parse(stdout.join("")) as Record<string, unknown>;

describe("storage create <bucket>", () => {
    it("creates the bucket and points at the next step, with the endpoint", async () => {
        await storage("create", "new-bucket");
        expect(sent[0]).toMatchObject({ method: "POST", path: "/buckets", body: { name: "new-bucket" } });
        expect(out()).toContain("https://s3.rebase.example");
        expect(out()).toContain("rebase cloud storage keys create --bucket new-bucket");
        expect(out()).not.toMatch(/deprecated/i);
    });

    it("says a taken name is global, with code conflict", async () => {
        routes.set("POST /buckets", () => json(409, { error: { code: "conflict", message: "taken" } }));
        await storage("create", "taken", "--json");
        expect(exitCode).toBe(1);
        expect(jsonOut()).toMatchObject({ error: { code: "conflict" } });
    });

    it("answers not_configured when the platform has no Rebase Storage", async () => {
        routes.set("POST /buckets", () => json(501, { error: { code: "not_configured", message: "no" } }));
        await storage("create", "x", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "not_configured" } });
    });

    it("refuses a second name before calling anything", async () => {
        await storage("create", "a", "b", "--json");
        expect(exitCode).toBe(1);
        expect(sent).toEqual([]);
    });
});

describe("storage create with no name (deprecated)", () => {
    it("still provisions managed storage, and warns once that it is deprecated", async () => {
        const provision = vi.fn(() => json(200, { success: true, data: { bucketName: "tenant-1", region: "fsn1", endpoint: "https://s3", accessKeyId: "GK1" } }));
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.pathname === `/api/functions/storage-provision/${PROJECT_ID}`) return provision();
            return respond(init?.method ?? "GET", url, undefined);
        }));
        await storage("create");
        expect(provision).toHaveBeenCalledTimes(1);
        expect(out()).toContain("tenant-1");
        const warnings = stderr.filter(line => /Deprecated/.test(line));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("rebase cloud storage create <bucket>");
    });
});

describe("storage list", () => {
    it("shows the endpoint, buckets, a keys summary and a usage line", async () => {
        await storage();
        const text = out();
        expect(text).toContain("https://s3.rebase.example");
        expect(text).toContain("shop-assets");
        expect(text).toMatch(/Keys:.*1/);
        expect(text).toMatch(/20 GB of 50 GB cap \(40%\)/);
    });

    it("keeps the attached rows in --json, beside the overview", async () => {
        await storage("list", "--json");
        const o = jsonOut();
        expect(o).toMatchObject({ projectId: PROJECT_ID, stores: [], rebaseStorageUnavailable: null });
        expect((o.rebaseStorage as StorageOverview).endpoint).toBe(OVERVIEW.endpoint);
    });

    it("still lists the attached rows when the platform has no Rebase Storage", async () => {
        routes.set("GET ", () => json(501, { error: { code: "not_configured", message: "no" } }));
        await storage("--json");
        expect(exitCode).toBeUndefined();
        expect(jsonOut()).toMatchObject({ rebaseStorage: null, rebaseStorageUnavailable: "not_configured", stores: [] });
    });

    it("refuses an unknown action rather than listing", async () => {
        await storage("lsit", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "unknown_command" } });
    });
});

describe("storage delete", () => {
    it("refuses without --yes off a terminal, and sends nothing", async () => {
        await storage("delete", "shop-assets", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "confirmation_required" } });
        expect(sent).toEqual([]);
    });

    it("deletes with --yes", async () => {
        await storage("delete", "shop-assets", "--yes");
        expect(sent[0]).toMatchObject({ method: "DELETE", path: "/buckets/shop-assets" });
        expect(out()).toContain("Restorable for 30 days.");
    });

    it("needs a bucket", async () => {
        await storage("delete", "--yes", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "usage" } });
    });
});

describe("storage keys", () => {
    it("lists keys with no secret", async () => {
        await storage("keys");
        expect(out()).toContain("RKAPP");
        expect(out()).toContain("bucket shop-assets");
    });

    it("creates a read-only scoped key, and prints the secret once with .env lines and an aws example", async () => {
        await storage("keys", "create", "--read-only", "--bucket", "shop-assets", "--name", "ci");
        expect(sent[0]).toMatchObject({ method: "POST", path: "/keys", body: { name: "ci", permission: "read", bucket: "shop-assets" } });
        const text = out();
        expect(text).toMatch(/shown ONCE/);
        expect(text).toContain("S3_ENDPOINT=https://s3.rebase.example");
        expect(text).toContain("S3_BUCKET=shop-assets");
        expect(text).toContain("S3_SECRET_ACCESS_KEY=issued-secret");
        expect(text).toContain("S3_FORCE_PATH_STYLE=true");
        expect(text).toContain("aws s3 ls s3://shop-assets/ --endpoint-url https://s3.rebase.example");
    });

    it("reads the action past a flag's value", async () => {
        await storage("keys", "--name", "ci", "create");
        expect(sent[0]).toMatchObject({ method: "POST", path: "/keys", body: { name: "ci", permission: "read-write" } });
    });

    it("carries the secret and the env lines in --json", async () => {
        await storage("keys", "create", "--json");
        expect(jsonOut()).toMatchObject({ secretAccessKey: "issued-secret", env: expect.arrayContaining(["S3_ACCESS_KEY_ID=RKCI"]) });
    });

    it("rotates with --yes and prints the new secret", async () => {
        await storage("keys", "rotate", "ci", "--yes");
        expect(sent[0]).toMatchObject({ method: "POST", path: "/keys/ci/rotate" });
        expect(out()).toContain("S3_SECRET_ACCESS_KEY=rotated-secret");
    });

    it("confirms a revoke", async () => {
        await storage("keys", "revoke", "ci", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "confirmation_required" } });
        expect(sent).toEqual([]);
    });

    it("revokes with --yes", async () => {
        await storage("keys", "revoke", "ci", "--yes", "--json");
        expect(sent[0]).toMatchObject({ method: "DELETE", path: "/keys/ci" });
        expect(jsonOut()).toMatchObject({ success: true, revoked: "ci" });
    });

    it("refuses an unknown keys action", async () => {
        await storage("keys", "delete", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "unknown_command" } });
    });

    it("refuses a flag that belongs to another keys action", async () => {
        await storage("keys", "rotate", "ci", "--read-only", "--yes", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "usage" } });
        expect(sent).toEqual([]);
    });
});

describe("storage usage", () => {
    it("shows the estimate against the cap, the cost, and this month's egress", async () => {
        await storage("usage");
        const text = out();
        expect(text).toContain("20 GB of a 50 GB cap (40%)");
        expect(text).toContain("10 GB per month");
        // (20 − 10) GB × €0.02
        expect(text).toContain("€0.20/month at current usage");
        // Only this month's day counts, not the one from 2000.
        expect(text).toContain("2.0 GB this month");
        expect(text).toMatch(/not billed/);
    });

    it("reports the figures in --json", async () => {
        await storage("usage", "--json");
        expect(jsonOut()).toMatchObject({ percentOfCap: 40, monthlyCostEur: 0.2, egressBytesThisMonth: 2 * GB });
    });
});

describe("storage limit", () => {
    it("shows the cap with no argument", async () => {
        await storage("limit", "--json");
        expect(sent.map(s => s.method)).toEqual(["GET"]);
        expect(jsonOut()).toMatchObject({ capBytes: 50 * GB, monthlyCostAtCapEur: 0.8 });
    });

    it("sets the cap and shows the most a month can cost", async () => {
        await storage("limit", "100");
        expect(sent[1]).toMatchObject({ method: "PUT", path: "/limit", body: { capGb: 100 } });
        expect(out()).toContain("€1.80/month at most");
    });

    it("refuses a cap that is not a number, before calling anything", async () => {
        await storage("limit", "lots", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "usage" } });
        expect(sent).toEqual([]);
    });

    it("refuses a cap above the highest", async () => {
        await storage("limit", "5000", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "invalid_param" } });
        expect(sent.map(s => s.method)).toEqual(["GET"]);
    });
});

describe("storage cors", () => {
    it("builds one rule from the flags", async () => {
        await storage("cors", "shop-assets", "--allow-origin", "https://a.example", "--allow-origin", "https://b.example", "--allow-method", "put");
        expect(sent[0]).toMatchObject({
            method: "PUT",
            path: "/buckets/shop-assets/cors",
            body: { rules: [{ allowedOrigins: ["https://a.example", "https://b.example"], allowedMethods: ["PUT"] }] }
        });
    });

    it("defaults to GET and HEAD", async () => {
        await storage("cors", "shop-assets", "--allow-origin", "*");
        expect(sent[0].body).toEqual({ rules: [{ allowedOrigins: ["*"], allowedMethods: ["GET", "HEAD"] }] });
    });

    it("clears", async () => {
        await storage("cors", "shop-assets", "--clear");
        expect(sent[0].body).toEqual({ rules: [] });
    });

    it("reads a rules file", async () => {
        const file = path.join(home, "cors.json");
        fs.writeFileSync(file, JSON.stringify({ rules: [{ allowedOrigins: ["https://x"], allowedMethods: ["GET"], maxAgeSeconds: 60 }] }));
        await storage("cors", "shop-assets", "--file", file);
        expect(sent[0].body).toEqual({ rules: [{ allowedOrigins: ["https://x"], allowedMethods: ["GET"], maxAgeSeconds: 60 }] });
    });

    it("refuses two modes at once", async () => {
        await storage("cors", "shop-assets", "--clear", "--allow-origin", "*", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "usage" } });
        expect(sent).toEqual([]);
    });

    it("shows the current rules with no flag", async () => {
        await storage("cors", "shop-assets");
        expect(sent.map(s => s.method)).toEqual(["GET"]);
        expect(out()).toContain("has no CORS rules");
    });
});

describe("storage import", () => {
    const start = ["import", "--from", "s3://old/uploads", "--region", "eu-west-1", "--access-key-id", "AKIA1", "--to", "shop-assets"];

    it("starts a platform-run import, with the secret from the variable, and never echoes it", async () => {
        process.env.REBASE_IMPORT_SECRET_ACCESS_KEY = SECRET;
        await storage(...start, "--switch-app", "--json");
        expect(sent[0]).toMatchObject({
            method: "POST",
            path: "/imports",
            body: {
                source: { endpoint: "https://s3.eu-west-1.amazonaws.com", region: "eu-west-1", bucket: "old", prefix: "uploads", accessKeyId: "AKIA1", secretAccessKey: SECRET },
                bucket: "shop-assets",
                switchApp: true
            }
        });
        expect(out()).not.toContain(SECRET);
        expect(jsonOut()).toMatchObject({ importId: "imp_1", status: "queued", follow: "rebase cloud storage import --status imp_1 --wait" });
    });

    it("--from-app-storage and --from-import send no source and no secret: the platform holds the key", async () => {
        await storage("import", "--from-app-storage", "--to", "shop-assets", "--switch-app", "--json");
        expect(sent[0]).toMatchObject({ method: "POST", path: "/imports", body: { fromCurrentStorage: true, bucket: "shop-assets", switchApp: true } });
        await storage("import", "--from-import", "imp_0", "--to", "shop-assets", "--json");
        expect(sent[1]).toMatchObject({ method: "POST", path: "/imports", body: { fromImport: "imp_0", bucket: "shop-assets", switchApp: false } });
        expect(sent[1].body).not.toHaveProperty("source");
    });

    it("refuses --from-import with a source of its own, or with --from-app-storage", async () => {
        await storage("import", "--from-import", "imp_0", "--from", "s3://x", "--to", "b", "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "usage" } });
        await storage("import", "--from-import", "imp_0", "--from-app-storage", "--to", "b", "--json");
        expect(sent).toEqual([]);
    });

    it("refuses with no secret and no terminal, before sending anything", async () => {
        await storage(...start, "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "input_required" } });
        expect(sent).toEqual([]);
    });

    it("refuses a --from that is not an s3:// URL", async () => {
        await storage("import", "--from", "old", "--region", "r", "--access-key-id", "a", "--to", "b", "--secret-access-key", SECRET, "--json");
        expect(jsonOut()).toMatchObject({ error: { code: "usage" } });
        expect(out()).not.toContain(SECRET);
    });

    it("names every missing required flag", async () => {
        await storage("import", "--json");
        const err = jsonOut().error as { code: string; message: string };
        expect(err.code).toBe("usage");
        expect(err.message).toContain("--from, --region, --access-key-id, --to");
    });

    it("with --wait, follows the import to the end and shows progress", async () => {
        importPolls = ["copying", "verifying", "done"];
        await storage(...start, "--secret-access-key", SECRET, "--wait");
        const text = out();
        expect(text).toContain("copying · 4/10 objects");
        expect(text).toContain("Import imp_1 done: 10 objects");
        expect(text).not.toContain(SECRET);
    });

    it("exits 1 with import_failed when the import fails", async () => {
        routes.set("GET /imports/imp_1", () => json(200, { status: "failed", copiedObjects: 0, copiedBytes: 0, message: "AccessDenied on old" }));
        await storage("import", "--status", "imp_1", "--json");
        expect(exitCode).toBe(1);
        expect(jsonOut()).toMatchObject({ error: { code: "import_failed" } });
    });
});

describe("--help", () => {
    it("prints the three-word page for `storage keys create --help`", async () => {
        await storage("keys", "create", "--help");
        expect(out()).toContain("rebase cloud storage keys create");
        expect(out()).toContain("--read-only");
        expect(sent).toEqual([]);
    });

    it("falls back to the action's page when the third word is an argument", async () => {
        await storage("create", "my-bucket", "--help");
        expect(out()).toContain("rebase cloud storage create");
        expect(sent).toEqual([]);
    });
});

describe("helpers", () => {
    it("bills nothing within the allowance and the rate over it", () => {
        expect(monthlyCostEur(5 * GB, PRICING)).toBe(0);
        expect(monthlyCostEur(60 * GB, PRICING)).toBeCloseTo(1);
    });

    it("sums only this month's egress", () => {
        const days = [
            { day: "2026-11-02", requests: 1, egressBytes: 3, ingressBytes: 0, currentBytes: null },
            { day: "2026-10-31", requests: 1, egressBytes: 100, ingressBytes: 0, currentBytes: null }
        ];
        expect(egressThisMonth(days, new Date("2026-11-23T00:00:00Z"))).toBe(3);
    });

    it("parses s3:// URLs", () => {
        expect(parseS3Url("s3://b")).toEqual({ bucket: "b" });
        expect(parseS3Url("s3://b/")).toEqual({ bucket: "b" });
        expect(parseS3Url("s3://b/a/c")).toEqual({ bucket: "b", prefix: "a/c" });
        expect(parseS3Url("https://b")).toBeUndefined();
    });

    it("leaves S3_BUCKET out for a key that is not scoped", () => {
        const lines = s3EnvLines({ ...ISSUED, permission: "read", bucket: null });
        expect(lines.some(l => l.startsWith("S3_BUCKET="))).toBe(false);
        expect(lines).toContain("S3_FORCE_PATH_STYLE=true");
    });

    it("suffixes every line for a declared bucket, so they never configure the default", () => {
        const lines = s3EnvLines(ISSUED, "media");
        expect(lines).toContain("STORAGE_TYPE__MEDIA=s3");
        expect(lines.find(l => l.startsWith("S3_ACCESS_KEY_ID"))).toMatch(/^S3_ACCESS_KEY_ID__MEDIA=/);
        expect(lines.every(l => l.split("=")[0].endsWith("__MEDIA"))).toBe(true);
        expect(s3EnvLines(ISSUED).every(l => !l.includes("__"))).toBe(true);
    });

    it("accepts a bare array of rules", () => {
        expect(parseCorsFile('[{"allowedOrigins":["*"],"allowedMethods":["GET"]}]', "f.json")).toHaveLength(1);
    });
});
