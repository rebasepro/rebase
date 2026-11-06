/**
 * `rebase cloud connect`, run through the real dispatcher against a stand-in
 * control plane.
 *
 * What matters: one command adds a self-hosted instance and hands over the two
 * variables it needs; running it again changes nothing; an account in several
 * organizations is asked which one; the `.env` it writes has each key once and
 * every other line as it was; and `--json` never prompts or waits.
 */
import fs from "fs";
import os from "os";
import path from "path";
import inquirer from "inquirer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../telemetry", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../telemetry")>();
    return { ...actual, recordEvent: vi.fn(async () => undefined) };
});

import { cloudCommand } from "./index";
import { normalizeInstanceUrl, waitForInstance, describeCheckFailure } from "./connect";
import { createTokenClient } from "./context";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const CP = "https://cp.example";
const CP_TOKEN = "rk_live_token";
const KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEexample+key/with==";
const AUDIENCE = "rebase-connector:li_1";
const ORGS = [{ id: "org_a", name: "Acme" }, { id: "org_b", name: "Beta" }];

interface Sent { method: string; path: string; bearer: string | null; body: unknown }
interface Instance { id: string; name: string; url: string; organization: string; verifiedAt: string | null; createdAt: string }

let sent: Sent[];
let stdout: string[];
let stderr: string[];
let home: string;
let cwd: string;
let savedEnv: Record<string, string | undefined>;
let savedIsTTY: boolean | undefined;

/** The stand-in control plane's state. */
let instances: Map<string, Instance>;
let checks: Array<{ ok: boolean; reason?: string; message?: string }>;
let requireOrg: boolean;

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function respond(method: string, url: URL, body: unknown): Response {
    const p = url.pathname;
    if (url.origin !== CP) return json(404, { error: { code: "NOT_FOUND", message: "Not Found" } });
    if (p === "/api/functions/linked-instances" && method === "POST") {
        const request = body as { url: string; name?: string; organizationId?: string };
        if (!/^https?:\/\//.test(request.url)) return json(400, { error: { code: "invalid_url", message: "Not a URL" } });
        if (requireOrg && !request.organizationId) {
            return json(400, {
                error: { code: "organization_required", message: "Pick an organization", details: { organizations: ORGS } }
            });
        }
        const organization = request.organizationId ?? "org_a";
        const existing = [...instances.values()].find(i => i.url === request.url && i.organization === organization);
        const instance = existing ?? {
            id: `li_${instances.size + 1}`,
            name: request.name ?? new URL(request.url).hostname,
            url: request.url,
            organization,
            verifiedAt: null,
            createdAt: "2026-11-06T10:00:00.000Z"
        };
        instances.set(instance.id, instance);
        return json(200, {
            instance,
            env: { REBASE_PLATFORM_TOKEN_KEY: KEY, REBASE_PLATFORM_TOKEN_AUDIENCE: AUDIENCE },
            created: !existing
        });
    }
    if (p === "/api/functions/linked-instances" && method === "GET") {
        return json(200, { instances: [...instances.values()] });
    }
    const check = /^\/api\/functions\/linked-instances\/([^/]+)\/check$/.exec(p);
    if (check && method === "POST") {
        const instance = instances.get(check[1]);
        if (!instance) return json(404, { error: { code: "not_found", message: "No such instance" } });
        const next = checks.shift() ?? { ok: false, reason: "not_configured", message: "No platform key set" };
        if (next.ok) {
            instance.verifiedAt = instance.verifiedAt ?? "2026-11-06T10:01:00.000Z";
            return json(200, { ok: true, instance });
        }
        return json(200, next);
    }
    const one = /^\/api\/functions\/linked-instances\/([^/]+)$/.exec(p);
    if (one && method === "DELETE") {
        instances.delete(one[1]);
        return json(200, { deleted: true });
    }
    return json(404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${p} on this backend.` } });
}

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-connect-home-")));
    cwd = process.cwd();
    process.chdir(home);
    savedEnv = { HOME: process.env.HOME, REBASE_TOKEN: process.env.REBASE_TOKEN, REBASE_JSON: process.env.REBASE_JSON };
    process.env.HOME = home;
    process.env.REBASE_TOKEN = CP_TOKEN;
    delete process.env.REBASE_JSON;
    savedIsTTY = process.stdin.isTTY;

    sent = [];
    stdout = [];
    stderr = [];
    instances = new Map();
    checks = [];
    requireOrg = false;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { stderr.push(String(chunk)); return true; }) as never);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Exited(code ?? 0); }) as never);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const auth = new Headers(init?.headers).get("Authorization");
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        sent.push({ method, path: url.pathname, bearer: auth?.replace(/^Bearer /, "") ?? null, body });
        return respond(method, url, body);
    }));
});

afterEach(() => {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    process.stdin.isTTY = savedIsTTY as boolean;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(home, { recursive: true, force: true });
});

/** Run `rebase cloud connect …` with `--json` and return its one JSON value. */
async function runJson(...words: string[]): Promise<Record<string, unknown>> {
    await cloudCommand("connect", ["node", "rebase", "cloud", "connect", ...words, "--url", CP, "--json"]);
    return JSON.parse(stdout.join(""));
}

/** Run it as a person at a terminal would, and return what it printed on both streams. */
async function runHuman(...words: string[]): Promise<{ out: string; err: string }> {
    process.env.REBASE_JSON = "0";
    await cloudCommand("connect", ["node", "rebase", "cloud", "connect", ...words, "--url", CP]);
    return { out: stdout.join("\n"), err: stderr.join("\n") };
}

const creates = () => sent.filter(r => r.method === "POST" && r.path === "/api/functions/linked-instances");
const checksSent = () => sent.filter(r => r.path.endsWith("/check"));

describe("rebase cloud connect <url>", () => {
    it("adds the instance's origin, named after its host, and prints the variables and the check", async () => {
        const out = await runJson("your-app.com/admin?x=1");

        expect(creates()).toHaveLength(1);
        expect(creates()[0].body).toEqual({ url: "https://your-app.com", name: "your-app.com" });
        expect(creates()[0].bearer).toBe(CP_TOKEN);
        expect(out.created).toBe(true);
        expect(out.env).toEqual({ REBASE_PLATFORM_TOKEN_KEY: KEY, REBASE_PLATFORM_TOKEN_AUDIENCE: AUDIENCE });
        expect((out.instance as Instance).url).toBe("https://your-app.com");
        expect(out.check).toEqual({ ok: false, reason: "not_configured", message: "No platform key set" });
    });

    it("is idempotent: a rerun returns the same instance with created: false", async () => {
        const first = await runJson("https://your-app.com");
        stdout = [];
        const second = await runJson("your-app.com");

        expect((second.instance as Instance).id).toBe((first.instance as Instance).id);
        expect(second.created).toBe(false);
        expect(instances.size).toBe(1);
    });

    it("sends --name and --org when given", async () => {
        await runJson("your-app.com", "--name", "Shop (EU)", "--org", "org_b");
        expect(creates()[0].body).toEqual({ url: "https://your-app.com", name: "Shop (EU)", organizationId: "org_b" });
    });

    it("in --json mode never prompts and never waits: one check, then done", async () => {
        process.stdin.isTTY = true;
        fs.writeFileSync(path.join(home, ".env"), "A=1\n");
        const prompt = vi.spyOn(inquirer, "prompt");

        await runJson("your-app.com");

        expect(prompt).not.toHaveBeenCalled();
        expect(checksSent()).toHaveLength(1);
        expect(fs.readFileSync(path.join(home, ".env"), "utf8")).toBe("A=1\n");
    });

    it("lists the organizations and names --org when the account has several and none was given", async () => {
        requireOrg = true;
        await expect(runJson("your-app.com")).rejects.toThrow(Exited);

        const error = (JSON.parse(stdout.join("")) as {
            error: { code: string; hint: string; organizations: Array<{ id: string; name: string }> };
        }).error;
        expect(error.code).toBe("organization_required");
        expect(error.organizations).toEqual(ORGS);
        expect(error.hint).toContain("--org org_a");
        expect(instances.size).toBe(0);
    });

    it("asks which organization at a terminal, and adds it there", async () => {
        requireOrg = true;
        process.stdin.isTTY = true;
        vi.spyOn(inquirer, "prompt").mockImplementation((async () => ({ picked: "org_b" })) as never);

        await runHuman("your-app.com", "--no-wait");

        expect(creates().map(r => r.body)).toEqual([
            { url: "https://your-app.com", name: "your-app.com" },
            { url: "https://your-app.com", name: "your-app.com", organizationId: "org_b" }
        ]);
        expect([...instances.values()][0].organization).toBe("org_b");
    });

    it("refuses an address that is not http(s) before calling anyone", async () => {
        await expect(runJson("ftp://your-app.com")).rejects.toThrow(Exited);
        expect((JSON.parse(stdout.join("")) as { error: { code: string } }).error.code).toBe("invalid_url");
        expect(sent).toEqual([]);
    });

    it("says when the control plane cannot link instances yet", async () => {
        vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
            json(404, { error: { code: "NOT_FOUND", message: `No route for ${init?.method} ${new URL(String(input)).pathname} on this backend.` } }));

        await expect(runJson("your-app.com")).rejects.toThrow(Exited);
        expect((JSON.parse(stdout.join("")) as { error: { code: string } }).error.code).toBe("linked_instances_unavailable");
    });
});

describe("what a person sees", () => {
    it("prints the added line, the two variables as a copyable block, and 'restart it'", async () => {
        const { out, err } = await runHuman("your-app.com", "--no-wait");

        expect(out).toContain("✓ Added https://your-app.com to your Rebase account as \"your-app.com\".");
        // Flush left, unquoted: pasteable into a .env, a compose file or a shell.
        expect(out.split("\n")).toContain(`REBASE_PLATFORM_TOKEN_KEY=${KEY}`);
        expect(out.split("\n")).toContain(`REBASE_PLATFORM_TOKEN_AUDIENCE=${AUDIENCE}`);
        expect(out).toContain("Then restart it.");
        // --no-wait: the one check up front, and no polling after it.
        expect(checksSent()).toHaveLength(1);
        expect(err).toContain("rebase cloud connect your-app.com");
        expect(err).not.toContain("Waiting for");
    });

    it("waits for the instance and says it is connected once the check passes", async () => {
        vi.useFakeTimers();
        try {
            checks = [
                { ok: false, reason: "not_configured" },
                { ok: false, reason: "unreachable" },
                { ok: true }
            ];
            const done = runHuman("your-app.com");
            await vi.advanceTimersByTimeAsync(10_000);
            const { out, err } = await done;

            expect(checksSent()).toHaveLength(3);
            expect(err).toContain(
                "Waiting for https://your-app.com to accept the connector — restart it with these variables. " +
                "Ctrl+C to stop; rerun this command any time."
            );
            expect(out).toContain(
                "Connected. Ask Claude about your-app.com through the Rebase connector (https://app.rebase.pro/mcp)."
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("gives up after ten minutes, and says how to finish", async () => {
        vi.useFakeTimers();
        try {
            const done = runHuman("your-app.com").catch((e: unknown) => e);
            await vi.advanceTimersByTimeAsync(11 * 60_000);
            expect(await done).toBeInstanceOf(Exited);
            expect(stderr.join("\n")).toContain("did not accept the connector within 10 minutes");
            // 1 up front, then one every 5s for ten minutes.
            expect(checksSent().length).toBeGreaterThan(100);
            expect(checksSent().length).toBeLessThanOrEqual(122);
        } finally {
            vi.useRealTimers();
        }
    });

    it("says so at once when the instance is already connected, and prints no variables", async () => {
        checks = [{ ok: true }];
        await runJson("your-app.com");
        stdout = [];
        stderr = [];
        checks = [{ ok: true }];

        const { out, err } = await runHuman("your-app.com");

        expect(err).toContain("https://your-app.com is already connected to your Rebase account.");
        expect(out).toContain("Connected. Ask Claude about your-app.com");
        expect(out).not.toContain("REBASE_PLATFORM_TOKEN_KEY=");
    });
});

describe("writing ./.env", () => {
    it("asks, then sets both keys: replaced where set, appended where not, every other byte kept", async () => {
        process.stdin.isTTY = true;
        const before = "# my app\nDATABASE_URL=postgres://u:p@h/db\nREBASE_PLATFORM_TOKEN_KEY=old\n\nOTHER='x y'\n";
        fs.writeFileSync(path.join(home, ".env"), before);
        const prompt = vi.spyOn(inquirer, "prompt").mockImplementation((async () => ({ write: true })) as never);

        await runHuman("your-app.com", "--no-wait");
        // Twice: the same keys must not be added again.
        await runHuman("your-app.com", "--no-wait");

        expect(prompt).toHaveBeenCalledTimes(2);
        expect(fs.readFileSync(path.join(home, ".env"), "utf8")).toBe(
            `# my app\nDATABASE_URL=postgres://u:p@h/db\nREBASE_PLATFORM_TOKEN_KEY=${KEY}\n\nOTHER='x y'\n` +
            `REBASE_PLATFORM_TOKEN_AUDIENCE=${AUDIENCE}\n`
        );
    });

    it("leaves ./.env alone when the answer is no", async () => {
        process.stdin.isTTY = true;
        fs.writeFileSync(path.join(home, ".env"), "A=1\n");
        vi.spyOn(inquirer, "prompt").mockImplementation((async () => ({ write: false })) as never);

        await runHuman("your-app.com", "--no-wait");

        expect(fs.readFileSync(path.join(home, ".env"), "utf8")).toBe("A=1\n");
    });

    it("does not ask without a terminal, or without a ./.env", async () => {
        const prompt = vi.spyOn(inquirer, "prompt");
        process.stdin.isTTY = false;
        fs.writeFileSync(path.join(home, ".env"), "A=1\n");
        await runHuman("your-app.com", "--no-wait");

        process.stdin.isTTY = true;
        fs.rmSync(path.join(home, ".env"));
        await runHuman("your-app.com", "--no-wait");

        expect(prompt).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(home, ".env"))).toBe(false);
    });
});

describe("rebase cloud connect --list / --remove", () => {
    it("lists the linked instances", async () => {
        await runJson("your-app.com");
        stdout = [];
        const out = await runJson("--list");
        expect((out.instances as Instance[]).map(i => i.url)).toEqual(["https://your-app.com"]);
    });

    it("removes one by its address, with --yes", async () => {
        await runJson("your-app.com");
        stdout = [];
        const out = await runJson("--remove", "your-app.com", "--yes");

        expect(out.deleted).toBe(true);
        expect(sent.some(r => r.method === "DELETE" && r.path === "/api/functions/linked-instances/li_1")).toBe(true);
        expect(instances.size).toBe(0);
    });

    it("refuses to remove without confirmation off a terminal", async () => {
        await runJson("your-app.com");
        stdout = [];
        await expect(runJson("--remove", "li_1")).rejects.toThrow(Exited);
        expect((JSON.parse(stdout.join("")) as { error: { code: string } }).error.code).toBe("confirmation_required");
        expect(instances.size).toBe(1);
    });

    it("refuses an address and --list together", async () => {
        await expect(runJson("your-app.com", "--list")).rejects.toThrow(Exited);
        expect((JSON.parse(stdout.join("")) as { error: { code: string } }).error.code).toBe("usage");
    });
});

describe("helpers", () => {
    it.each([
        ["your-app.com", "https://your-app.com"],
        ["https://your-app.com/admin?x=1#y", "https://your-app.com"],
        ["http://localhost:3000/", "http://localhost:3000"],
        ["  API.Example.com  ", "https://api.example.com"],
        ["ftp://x.com", null],
        ["", null]
    ])("normalizes %j to %j", (input, expected) => {
        expect(normalizeInstanceUrl(input)).toBe(expected);
    });

    it("waits through refusals and transient failures until the check passes", async () => {
        instances.set("li_9", { id: "li_9", name: "x", url: "https://x.com", organization: "org_a", verifiedAt: null, createdAt: "" });
        checks = [{ ok: false, reason: "rejected", message: "audience mismatch" }, { ok: true }];
        const heard: string[] = [];
        const result = await waitForInstance(createTokenClient(CP, CP_TOKEN), "li_9", {
            sleep: async () => undefined,
            onWaiting: failure => heard.push(describeCheckFailure(failure))
        });

        expect(result.ok).toBe(true);
        expect(heard).toEqual(["it refused the connector's token (audience mismatch)"]);
    });
});
