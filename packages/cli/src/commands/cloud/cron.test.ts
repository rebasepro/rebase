/**
 * `rebase cloud cron`, run through the real dispatcher.
 *
 * The command crosses two services with two different credentials, and the
 * property that matters most is that they never cross over: the control-plane
 * credential goes only to the control plane, the minted `rpt_` token only to the
 * app. So `fetch` is stood in by both at once — a control plane that mints, and
 * an app that serves cron — and every request is recorded with the bearer it
 * carried.
 *
 * The other half is that each refusal says what to do about it. The first
 * runtime this meets in the field predates platform tokens and answers a bare
 * "Invalid or expired token"; reporting that as an expired login would send the
 * owner to `rebase cloud login`, which fixes nothing.
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
import { isMissingRoute, shortDuration, shortTime } from "./cron";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const CP = "https://cp.example";
const APP = "https://shop.rebase.website";
const PROJECT_ID = "proj_1";
const CP_TOKEN = "rk_live_token";
const RUNTIME_TOKEN = "rpt_header.claims.signature";

interface Sent { method: string; url: URL; bearer: string | null; body: unknown }

let sent: Sent[];
let stdout: string[];
let stderr: string[];
/** Overrides for one test: a path → the response to give instead. */
let override: Record<string, () => Response>;
let home: string;
let cwd: string;
let savedEnv: Record<string, string | undefined>;

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const JOBS = [
    {
        id: "agent-worker",
        name: "Agent worker",
        schedule: "* * * * *",
        enabled: true,
        state: "success",
        lastRunAt: "2026-10-05T10:31:00.000Z",
        nextRunAt: "2026-10-05T10:32:00.000Z",
        lastDurationMs: 1240,
        totalRuns: 1440,
        totalFailures: 3
    },
    {
        id: "prospect-sweep",
        name: "Prospect sweep",
        schedule: "0 * * * *",
        enabled: true,
        state: "error",
        lastRunAt: "2026-10-05T10:00:00.000Z",
        nextRunAt: "2026-10-05T11:00:00.000Z",
        lastError: "model unavailable (quota_exhausted)",
        totalRuns: 24,
        totalFailures: 1
    }
];

const LOGS = [
    {
        jobId: "prospect-sweep",
        startedAt: "2026-10-05T10:00:00.000Z",
        finishedAt: "2026-10-05T10:00:02.000Z",
        durationMs: 2000,
        success: false,
        error: "model unavailable (quota_exhausted)",
        logs: ["swept audience a1", "falling back to keyword scoring"]
    }
];

function respond(method: string, url: URL): Response {
    const key = `${url.origin}${url.pathname}`;
    if (override[key]) return override[key]();
    const p = url.pathname;
    if (url.origin === CP) {
        if (p === "/api/data/projects") return json(200, { data: [{ id: PROJECT_ID, subdomain: "shop", name: "Shop" }], meta: { hasMore: false } });
        if (p === `/api/data/projects/${PROJECT_ID}`) return json(200, { id: PROJECT_ID, subdomain: "shop", host: "shop.rebase.website" });
        if (p === "/api/functions/platform-config") return json(200, { tenantBaseDomain: "rebase.website", deployTargets: [] });
        if (p === `/api/functions/runtime-token/${PROJECT_ID}` && method === "POST") {
            return json(200, { token: RUNTIME_TOKEN, expiresAt: "2026-10-05T10:40:00.000Z", scopes: ["cron:read"] });
        }
    }
    if (url.origin === APP && method === "GET") {
        if (p === "/api/admin/cron") return json(200, { jobs: JOBS });
        if (p === "/api/admin/cron/prospect-sweep/logs") return json(200, { logs: LOGS });
        if (p.startsWith("/api/admin/cron/")) return json(404, { error: { code: "NOT_FOUND", message: "Cron job not found" } });
    }
    return json(404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${p} on this backend.` } });
}

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cron-home-")));
    cwd = process.cwd();
    process.chdir(home);
    savedEnv = { HOME: process.env.HOME, REBASE_TOKEN: process.env.REBASE_TOKEN, REBASE_JSON: process.env.REBASE_JSON };
    process.env.HOME = home;
    process.env.REBASE_TOKEN = CP_TOKEN;
    delete process.env.REBASE_JSON;

    sent = [];
    stdout = [];
    stderr = [];
    override = {};
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { stderr.push(String(chunk)); return true; }) as never);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Exited(code ?? 0); }) as never);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const auth = new Headers(init?.headers).get("Authorization");
        sent.push({
            method,
            url,
            bearer: auth?.replace(/^Bearer /, "") ?? null,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined
        });
        return respond(method, url);
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

/** Run `rebase cloud cron …` and return what it printed as its one JSON value. */
async function run(...words: string[]): Promise<Record<string, unknown>> {
    await cloudCommand("cron", ["node", "rebase", "cloud", "cron", ...words, "--project", "shop", "--url", CP, "--json"]);
    return JSON.parse(stdout.join(""));
}

/** Run a line expected to fail, and return its error envelope. */
async function refused(...words: string[]): Promise<{ code: string; message: string; hint?: string }> {
    await expect(run(...words)).rejects.toThrow(Exited);
    return (JSON.parse(stdout.join("")) as { error: { code: string; message: string; hint?: string } }).error;
}

const toApp = () => sent.filter(request => request.url.origin === APP);
const toCp = () => sent.filter(request => request.url.origin === CP);

describe("rebase cloud cron list", () => {
    it("mints a cron:read token for the project and reads the app's job list with it", async () => {
        const out = await run("list");

        const mint = toCp().find(request => request.url.pathname === `/api/functions/runtime-token/${PROJECT_ID}`);
        expect(mint?.method).toBe("POST");
        expect(mint?.body).toEqual({ scopes: ["cron:read"] });

        expect(toApp().map(request => `${request.method} ${request.url.pathname}`)).toEqual(["GET /api/admin/cron"]);
        expect(out.origin).toBe(APP);
        expect((out.jobs as Array<{ id: string }>).map(job => job.id)).toEqual(["agent-worker", "prospect-sweep"]);
    });

    it("never hands either service the other's credential", async () => {
        await run("list");

        for (const request of toApp()) expect(request.bearer).toBe(RUNTIME_TOKEN);
        for (const request of toCp()) expect(request.bearer).toBe(CP_TOKEN);
    });

    it("is the default action", async () => {
        const out = await run();
        expect(out.jobs).toHaveLength(2);
    });

    it.each([
        [["--host", "staging.example.com"]],
        [["--host", "staging.example.com", "list"]]
    ])("takes `cron %j` as the list, not the host as an action", async (words) => {
        override[`https://staging.example.com/api/admin/cron`] = () => json(200, { jobs: [] });

        const out = await run(...words);

        expect(out.origin).toBe("https://staging.example.com");
    });

    it("reads the address --host names instead of the project's own", async () => {
        override[`https://staging.example.com/api/admin/cron`] = () => json(200, { jobs: [] });

        const out = await run("list", "--host", "staging.example.com");

        expect(out.origin).toBe("https://staging.example.com");
        expect(sent.some(request => request.url.origin === "https://staging.example.com")).toBe(true);
    });

    it("prints a table a person can read, with the failing job's error under it", async () => {
        process.env.REBASE_JSON = "0";
        await cloudCommand("cron", ["node", "rebase", "cloud", "cron", "--project", "shop", "--url", CP]);

        const printed = stdout.join("\n");
        expect(printed).toContain("agent-worker");
        expect(printed).toContain("* * * * *");
        expect(printed).toContain("model unavailable (quota_exhausted)");
        expect(printed).toContain("rebase cloud cron logs <job>");
    });
});

describe("rebase cloud cron logs", () => {
    it("reads one job's runs, with the limit asked for", async () => {
        const out = await run("logs", "prospect-sweep", "--limit", "5");

        const read = toApp()[0];
        expect(read.url.pathname).toBe("/api/admin/cron/prospect-sweep/logs");
        expect(read.url.searchParams.get("limit")).toBe("5");
        expect(out.job).toBe("prospect-sweep");
        expect(out.logs).toEqual(LOGS);
    });

    it("prints each run's lines under it", async () => {
        process.env.REBASE_JSON = "0";
        await cloudCommand("cron", ["node", "rebase", "cloud", "cron", "logs", "prospect-sweep", "--project", "shop", "--url", CP]);

        const printed = stdout.join("\n");
        expect(printed).toContain("falling back to keyword scoring");
        expect(printed).toContain("model unavailable (quota_exhausted)");
    });

    it("says a job does not exist, and where the names are", async () => {
        const error = await refused("logs", "nonesuch");
        expect(error.code).toBe("not_found");
        expect(error.hint).toContain("rebase cloud cron list");
    });

    it.each([
        [["logs"], "usage"],
        [["logs", "a", "--limit", "0"], "usage"],
        [["logs", "a", "--limit", "2.5"], "usage"],
        [["trigger", "a"], "unknown_command"]
    ])("refuses `cron %j` before asking anyone for a token", async (words, code) => {
        expect((await refused(...words)).code).toBe(code);
        expect(sent.some(request => request.url.pathname.includes("runtime-token"))).toBe(false);
    });
});

describe("what each refusal tells the owner", () => {
    it("says when the control plane does not mint runtime tokens yet", async () => {
        override[`${CP}/api/functions/runtime-token/${PROJECT_ID}`] = () =>
            json(404, { error: { code: "NOT_FOUND", message: `No route for POST /api/functions/runtime-token/${PROJECT_ID} on this backend.` } });

        const error = await refused("list");

        expect(error.code).toBe("runtime_token_unavailable");
        expect(toApp()).toEqual([]);
    });

    it("passes on the control plane's own refusal — a project this login may not read", async () => {
        override[`${CP}/api/functions/runtime-token/${PROJECT_ID}`] = () =>
            json(403, { error: { code: "forbidden", message: "You do not have project:logs on this project" } });

        const error = await refused("list");

        expect(error.message).toContain("project:logs");
        expect(toApp()).toEqual([]);
    });

    it("tells an app on an older runtime from an expired login", async () => {
        // What a runtime before platform tokens answers: it parses `rpt_…` as a
        // user session and refuses it like any bad one.
        override[`${APP}/api/admin/cron`] = () =>
            json(401, { error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });

        const error = await refused("list");

        expect(error.code).toBe("runtime_token_refused");
        expect(error.message).toContain("does not accept platform tokens");
        expect(error.hint).toContain("Redeploy");
    });

    it("says to redeploy when the app was never given the platform's key", async () => {
        override[`${APP}/api/admin/cron`] = () =>
            json(401, { error: { code: "PLATFORM_TOKENS_OFF", message: "This server does not accept platform tokens" } });

        const error = await refused("list");

        expect(error.code).toBe("runtime_token_refused");
        expect(error.hint).toContain("redeploying");
    });

    it("says when the app serves no cron surface at all", async () => {
        override[`${APP}/api/admin/cron`] = () => json(404, { error: { code: "NOT_FOUND", message: "No route" } });

        expect((await refused("list")).code).toBe("cron_not_served");
    });

    it("says when the app cannot be reached", async () => {
        vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.origin === APP) throw new TypeError("fetch failed");
            return respond(init?.method ?? "GET", url);
        });

        const error = await refused("list");

        expect(error.code).toBe("runtime_unreachable");
        expect(error.hint).toContain("rebase cloud debug health");
    });
});

describe("isMissingRoute", () => {
    it("tells a missing route from a missing project", () => {
        expect(isMissingRoute("No route for POST /api/functions/runtime-token/p on this backend.")).toBe(true);
        expect(isMissingRoute("Not Found")).toBe(true);
        expect(isMissingRoute("404 Not Found")).toBe(true);
        expect(isMissingRoute("Project not found")).toBe(false);
        expect(isMissingRoute(undefined)).toBe(false);
    });
});

describe("formatting", () => {
    it("shortens timestamps and durations", () => {
        expect(shortTime("2026-10-05T10:31:00.000Z")).toBe("2026-10-05 10:31:00Z");
        expect(shortTime(undefined)).toBe("—");
        expect(shortDuration(850)).toBe("850ms");
        expect(shortDuration(2400)).toBe("2.4s");
        expect(shortDuration(190_000)).toBe("3m 10s");
        expect(shortDuration(undefined)).toBe("");
    });
});
