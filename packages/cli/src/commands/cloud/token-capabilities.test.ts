/**
 * Each token capability covers what its commands actually call.
 *
 * The map in `token-capabilities.ts` is a claim about the control plane's
 * traffic: that `--can deploy` is enough for `rebase cloud deploy`, and so on.
 * Written from reading the commands, it is wrong the day a command grows a
 * request — a new collection read, a second function — and the first to find
 * out is a CI job, refused halfway through a deploy.
 *
 * So the commands are run here, for real: the dispatcher, the SDK client built
 * from `REBASE_TOKEN`, the raw uploads, the build follow. Only `fetch` is
 * stood in, by a control plane that records every request, works out the
 * scope each one needs (`GET /api/data/<slug>` is `data:read:<slug>`,
 * `/api/functions/<name>/…` is `functions:invoke:<name>`), and — on the
 * enforced run — refuses with `SCOPE_MISSING` whatever the token does not
 * hold, exactly as the control plane does. Two runs per command: one that lets
 * everything through, to see every request it can make; one that enforces, to
 * prove it still finishes.
 *
 * The project-level scopes (`project:deploy:<id>`) are the control plane's to
 * check inside its functions; what is asserted here is that each capability
 * carries them narrowed to the token's project.
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
import * as context from "./context";
import {
    ALWAYS_SCOPES,
    capabilitiesInScopes,
    scopesForCapabilities,
    TOKEN_CAPABILITIES,
    TOKEN_CAPABILITY_NAMES,
    type TokenCapability
} from "./token-capabilities";
import { parseCapabilities, resolveTokenExpiry } from "./tokens";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const PROJECT_ID = "proj_1";

/**
 * The project's own app. `rebase cloud cron` reads it directly, with a token
 * the control plane mints — so those requests are not control-plane traffic,
 * need no scope of the CLI's token, and must not carry it.
 */
const APP = "https://shop.rebase.website";
const RUNTIME_TOKEN = "rpt_minted.for.cron";

/**
 * Requests a command makes that a token is not given, each with why the
 * command does not need it. Anything else uncovered is a gap in the map.
 */
const BEST_EFFORT: Record<string, string> = {
    // `readBillingState`: refused, it resolves to "could not tell" and the
    // deploy goes on — the control plane's own 402 at the trigger still
    // applies. Granting it would hand a deploy token the whole billing
    // function, checkout and portal included.
    "functions:invoke:stripe-billing": "the deploy's billing pre-check, which proceeds when refused",
    // The same pre-check, only reached when the card check answered.
    "data:read:billing-accounts": "the deploy's billing pre-check, which proceeds when refused"
};

/* ─── the stand-in control plane ───────────────────────────────── */

interface Sent { method: string; url: URL; scope: string }

let cp: string;
let runs = 0;
let sent: Sent[];
let held: string[];
let enforce: boolean;
let latestStatus: string;
let said: string[];

/** The scope the control plane checks a request against. */
function requiredScope(method: string, url: URL): string {
    const [api, plane, name] = url.pathname.split("/").filter(Boolean);
    if (url.origin === APP) return `app:${method} ${url.pathname}`;
    if (url.origin !== cp) return `elsewhere:${method} ${url.href}`;
    if (api === "api" && plane === "data") {
        const verb = method === "GET" ? "read" : method === "DELETE" ? "delete" : "write";
        return `data:${verb}:${name}`;
    }
    if (api === "api" && plane === "functions") return `functions:invoke:${name}`;
    return `unmapped:${method} ${url.pathname}`;
}

/** `scopeGrants`, for exact narrowed scopes and the unqualified one. */
function grants(scopes: readonly string[], scope: string): boolean {
    const [resource, action] = scope.split(":");
    return scopes.includes(scope) || scopes.includes(`${resource}:${action}`);
}

const project = () => ({
    id: PROJECT_ID,
    name: "Shop",
    subdomain: "shop",
    organization: "org_1",
    runtimeMode: "custom",
    host: "shop.rebase.website",
    status: "active"
});

const deployment = (id: string, status: string) => ({
    id,
    project: PROJECT_ID,
    status,
    logs: "built\n",
    bundleId: `bundle_${id}`,
    createdAt: "2026-09-30T10:00:00.000Z"
});

const ENV_LIST = {
    vars: [{ id: "v1", key: "FOO", secret: false, valueSet: true, createdAt: null, updatedAt: null }],
    pendingRedeploy: false,
    pendingSince: null,
    limits: { maxVars: 100, maxValueBytes: 4096, maxTotalBytes: 65536, keyPattern: "^[A-Z_][A-Z0-9_]*$", reservedKeys: [] }
};

const DB_INFO = {
    type: "managed",
    host: "db.internal",
    port: "5432",
    database: "app",
    username: "app",
    passwordAvailable: true,
    directAccess: { via: "tunnel" },
    unavailableReason: null
};

/** What the control plane answers, or undefined for a 404. */
function answer(method: string, url: URL): unknown {
    const p = url.pathname;
    const routes: Array<[boolean, () => unknown]> = [
        [p === "/api/data/projects", () => ({ data: [project()], meta: { hasMore: false } })],
        [p === `/api/data/projects/${PROJECT_ID}`, project],
        [p === "/api/data/organizations/org_1", () => ({ id: "org_1", billingAccountId: "ba_1" })],
        [p === "/api/data/billing-accounts/ba_1", () => ({ id: "ba_1", plan: "standard" })],
        [p === "/api/data/deployments", () => ({ data: [deployment("d1", latestStatus), deployment("d0", "success")] })],
        [p.startsWith("/api/data/deployments/"), () => deployment(p.split("/").pop() ?? "", "success")],
        [p === "/api/data/databases", () => ({ data: [{ id: "db_1", project: PROJECT_ID, type: "managed", connectionStatus: "connected" }] })],
        [p === "/api/functions/platform-config", () => ({ tenantBaseDomain: "rebase.website", deployTargets: [] })],
        [p.startsWith("/api/functions/stripe-billing/payment-method/"), () => ({ hasPaymentMethod: true })],
        [p === "/api/functions/deploy/bundle/upload", () => ({ bundleId: "b1" })],
        [p === "/api/functions/deploy/source/upload", () => ({ sourceId: "0123456789abcdef0123456789abcdef" })],
        [p === "/api/functions/deploy/upload", () => ({ source: "gs://contexts/build-contexts/proj_1/c.tar.gz" })],
        [p === "/api/functions/deploy/rollback", () => ({ success: true, deployment: { id: "d2" }, rolledBackTo: "d0", imageUrl: null, bundleId: "bundle_d0" })],
        [p === "/api/functions/deploy/cancel", () => ({ success: true, deploymentId: "d1", buildJobDeleted: true })],
        [p === "/api/functions/deploy", () => ({ success: true, deployment: { id: "d1" }, managed: true })],
        [p === `/api/functions/runtime-logs/${PROJECT_ID}`, () => ({ logs: "listening on :3000\n" })],
        [p === `/api/functions/metrics/${PROJECT_ID}`, () => ({ status: "running", cpu: "12m", memory: "120Mi", memoryPercent: "23%" })],
        [p === `/api/functions/runtime-token/${PROJECT_ID}`, () => ({ token: RUNTIME_TOKEN, scopes: ["cron:read"] })],
        [p === `/api/functions/env-vars/${PROJECT_ID}` && method === "GET", () => ENV_LIST],
        [p === `/api/functions/env-vars/${PROJECT_ID}`, () => ({ success: true, var: ENV_LIST.vars[0], pendingRedeploy: true })],
        [p === `/api/functions/env-vars/${PROJECT_ID}/FOO`, () => ({ success: true, pendingRedeploy: true })],
        [p === "/api/functions/env-vars/reveal", () => ({ key: "FOO", value: "bar" })],
        [p === `/api/functions/db-info/${PROJECT_ID}`, () => DB_INFO],
        [p === "/api/functions/db-info/reveal", () => ({ password: "pw", connectionString: "postgresql://app:pw@db.internal:5432/app" })],
        [p === `/api/functions/backup/list/${PROJECT_ID}`, () => ({ backups: [] })],
        [p === "/api/functions/backup/create", () => ({ success: true, backup: { name: "base-1" } })],
        [p === `/api/functions/backup/backup-status/${PROJECT_ID}`, () => ({ enabled: true, reason: "", databaseType: "managed" })],
        [p.startsWith(`/api/functions/backup/download/${PROJECT_ID}/`), () => ({ url: "https://storage.example/base-1", name: "base-1", size: 1024 })],
        [p === `/api/functions/backup/pitr-status/${PROJECT_ID}`, () => ({ enabled: true })]
    ];
    return routes.find(([matches]) => matches)?.[1]();
}

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The app's cron surface, which answers only the token minted for it. */
function app(method: string, url: URL, init?: RequestInit): Response {
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${RUNTIME_TOKEN}`);
    if (url.pathname === "/api/admin/cron") return json(200, { jobs: [] });
    if (url.pathname === "/api/admin/cron/nightly/logs") return json(200, { logs: [] });
    return json(404, { error: { code: "NOT_FOUND", message: `no route ${method} ${url.pathname}` } });
}

function controlPlane(input: RequestInfo | URL, init?: RequestInit): Response {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const scope = requiredScope(method, url);
    sent.push({ method, url, scope });
    if (url.origin === APP) return app(method, url, init);
    // A token, so the bearer is the one the line was given — never a session.
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer rk_live_token");
    if (enforce && !grants(held, scope)) {
        return json(403, {
            error: {
                code: "SCOPE_MISSING",
                message: `This API key does not hold the "${scope}" scope. Create a key that includes it.`,
                details: { requiredScope: scope }
            }
        });
    }
    const body = answer(method, url);
    return body === undefined ? json(404, { error: { code: "NOT_FOUND", message: `no route ${method} ${url.pathname}` } }) : json(200, body);
}

/* ─── a project to run the commands in ─────────────────────────── */

let project_: string;
let bundleDir: string;
let home: string;
let cwd: string;
let savedEnv: Record<string, string | undefined>;

function write(root: string, relative: string, content: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

beforeEach(() => {
    project_ = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-token-cap-")));
    bundleDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-token-cap-bundle-")));
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-token-cap-home-")));
    write(project_, "rebase.json", JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed" } } }));
    write(project_, "backend/src/index.ts", "export {};\n");
    write(bundleDir, "manifest.json", JSON.stringify({
        bundleFormat: 2,
        runtime: { range: "^1", builtAgainst: "0.23.0", contract: 1 },
        schemaVersion: "v1:abc",
        app: "backend",
        kind: "backend",
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "0.23.0", node: "22", createdAt: "2026-09-30T00:00:00Z" }
    }));
    write(bundleDir, "config/index.js", "export default {};\n");

    cwd = process.cwd();
    process.chdir(project_);
    savedEnv = { HOME: process.env.HOME, REBASE_TOKEN: process.env.REBASE_TOKEN, REBASE_JSON: process.env.REBASE_JSON };
    process.env.HOME = home;
    process.env.REBASE_TOKEN = "rk_live_token";
    // A person's terminal, so the human paths run — the deploy follow reads the
    // project's URL only when it is printing.
    process.env.REBASE_JSON = "0";

    sent = [];
    held = [];
    enforce = false;
    latestStatus = "success";
    said = [];
    const capture = (...args: unknown[]) => { said.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { said.push(String(chunk)); return true; }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { said.push(String(chunk)); return true; }) as never);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Exited(code ?? 0); }) as never);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => controlPlane(input, init)));
});

afterEach(() => {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const dir of [project_, bundleDir, home]) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Run one `rebase cloud …` line against a fresh control-plane URL — fresh,
 * because `platform-config` is cached per host for the process.
 */
async function run(line: string[], capability: TokenCapability, enforced: boolean): Promise<Sent[]> {
    cp = `https://cp-${++runs}.example`;
    sent = [];
    held = scopesForCapabilities(PROJECT_ID, [capability]);
    enforce = enforced;
    try {
        await cloudCommand(line[0], ["node", "rebase", "cloud", ...line, "--project", "shop", "--url", cp]);
    } catch (e) {
        // What the command said is the reason it stopped.
        throw new Error(`rebase cloud ${line.join(" ")}: ${String(e)}\n${said.join("\n")}`);
    }
    return sent;
}

/** `db connect` waits for Ctrl-C; this sends it as soon as the tunnel is listening. */
function interruptWhenListening(): void {
    const once = process.once.bind(process);
    vi.spyOn(process, "once").mockImplementation(((event: string, listener: () => void) => {
        if (event === "SIGINT") {
            setImmediate(listener);
            return process;
        }
        return once(event, listener);
    }) as never);
}

const COMMANDS: Record<TokenCapability, string[][]> = {
    deploy: [
        ["deploy", "--bundle", "--bundle-dir", "<bundle>"],
        // A container build of a project the platform runs as managed is an
        // eject, which it refuses without saying so; the requests are the same.
        ["deploy", "--source", ".", "--eject"],
        ["deployments", "list"],
        ["rollback", "d0", "--yes"],
        ["cancel", "--yes"]
    ],
    logs: [
        ["logs"],
        ["logs", "--runtime"],
        ["logs", "--follow"],
        ["metrics"],
        ["cron", "list"],
        ["cron", "logs", "nightly"]
    ],
    env: [
        ["env", "list"],
        ["env", "set", "FOO=bar"],
        ["env", "reveal", "FOO"],
        ["env", "unset", "FOO", "--yes"],
        ["env", "pull", "--output", "<out>"]
    ],
    database: [
        ["db", "list"],
        ["db", "info", "--reveal"],
        ["db", "connect", "--port", "0", "--reveal"]
    ],
    backups: [
        ["db", "backup"],
        ["db", "backup", "create"],
        ["db", "backup", "status"],
        ["db", "backup", "download", "base-1"],
        ["db", "pitr", "status"]
    ]
};

const cases = TOKEN_CAPABILITY_NAMES.flatMap(capability =>
    COMMANDS[capability].map(line => [capability, line.join(" "), line] as const));

function prepare(line: readonly string[]): string[] {
    if (line[0] === "logs" && line.includes("--follow")) latestStatus = "deploying";
    if (line[0] === "db" && line[1] === "connect") interruptWhenListening();
    return line.map(word =>
        word === "<bundle>" ? bundleDir
            : word === "<out>" ? path.join(project_, `pulled-${runs}.env`)
            : word);
}

describe("each capability covers its commands", () => {
    it.each(cases)("%s covers `rebase cloud %s`", async (capability, _label, line) => {
        const requests = await run(prepare(line), capability, false);

        expect(requests.length, "the command made no request, so this proves nothing").toBeGreaterThan(0);
        for (const request of requests) {
            expect(request.scope, `${request.method} ${request.url.href}`).toMatch(/^(data|functions|app):/);
        }
        const gaps = requests
            .filter(request => !request.scope.startsWith("app:"))
            .filter(request => !grants(held, request.scope) && !BEST_EFFORT[request.scope])
            .map(request => `${request.method} ${request.url.pathname} needs ${request.scope}`);
        expect(gaps, `--can ${capability} does not cover what the command calls`).toEqual([]);
    });

    it.each(cases)("%s alone completes `rebase cloud %s`", async (capability, _label, line) => {
        // The enforced run: what the token does not hold is refused, and the
        // command still finishes — `process.exit` would have thrown here.
        const requests = await run(prepare(line), capability, true);
        const refused = requests
            .filter(request => !request.scope.startsWith("app:") && !grants(held, request.scope))
            .map(request => request.scope);
        expect(refused.every(scope => BEST_EFFORT[scope])).toBe(true);
        expect(said.join("\n")).not.toMatch(/SCOPE_MISSING|does not hold/);
    });

    it("finds the best-effort requests it excuses, so the list cannot go stale", async () => {
        const requests = await run(prepare(COMMANDS.deploy[0]), "deploy", false);
        for (const scope of Object.keys(BEST_EFFORT)) {
            expect(requests.map(request => request.scope)).toContain(scope);
        }
    });

    it("never touches the login a person keeps on this machine", async () => {
        await run(prepare(COMMANDS.deploy[0]), "deploy", true);
        expect(fs.existsSync(path.join(home, ".rebase"))).toBe(false);
    });
});

/* ─── the map itself ───────────────────────────────────────────── */

describe("scopesForCapabilities", () => {
    it("starts from the scopes every token holds, and lists each scope once", () => {
        const scopes = scopesForCapabilities("p1", ["deploy", "logs", "database", "backups"]);
        expect(scopes.slice(0, ALWAYS_SCOPES.length)).toEqual(ALWAYS_SCOPES);
        expect(scopes).toEqual([...new Set(scopes)]);
        expect(scopes.filter(scope => scope === "project:read:p1")).toHaveLength(1);
    });

    it.each(TOKEN_CAPABILITY_NAMES)("narrows every project scope of %s to the token's project", (capability) => {
        const project = TOKEN_CAPABILITIES[capability].scopes("p1").filter(scope => scope.startsWith("project:"));
        expect(project.length).toBeGreaterThan(0);
        for (const scope of project) expect(scope).toMatch(/^project:[a-z]+:p1$/);
    });

    it("gives no capability key management or a restore", () => {
        const every = scopesForCapabilities("p1", [...TOKEN_CAPABILITY_NAMES]);
        expect(every.some(scope => scope.startsWith("keys:"))).toBe(false);
        expect(every.some(scope => scope.startsWith("project:restore"))).toBe(false);
    });

    it("refuses a project id a scope cannot carry, and a capability it does not know", () => {
        expect(() => scopesForCapabilities("", ["deploy"])).toThrow(/project id/);
        expect(() => scopesForCapabilities("a b", ["deploy"])).toThrow(/project id/);
        expect(() => scopesForCapabilities("p1", ["deploy", "admin" as TokenCapability])).toThrow(/not a token capability/);
    });

    it("reads a token's scopes back as its capabilities", () => {
        expect(capabilitiesInScopes(scopesForCapabilities("p1", ["deploy", "env"])))
            .toEqual([{ projectId: "p1", capabilities: ["deploy", "env"] }]);
        expect(capabilitiesInScopes(["data:read:projects"])).toEqual([]);
    });
});

describe("tokens create's line", () => {
    beforeEach(() => context.setJsonModeForTest(false));

    it("takes capabilities comma-separated or repeated, each once", () => {
        expect(parseCapabilities(["deploy,logs", "logs", "env"])).toEqual(["deploy", "logs", "env"]);
    });

    it("refuses an empty --can and a word that is not a capability", () => {
        expect(() => parseCapabilities(undefined)).toThrow(Exited);
        expect(said.join("\n")).toContain("--can deploy,logs");
        said.length = 0;
        expect(() => parseCapabilities(["deploy,admin"])).toThrow(Exited);
        expect(said.join("\n")).toContain("\"admin\" is not one");
    });

    it("expires a token in whole days, or never", () => {
        const now = new Date("2026-10-01T00:00:00.000Z");
        expect(resolveTokenExpiry("30", now)).toBe("2026-10-31T00:00:00.000Z");
        expect(resolveTokenExpiry(undefined, now)).toBeNull();
        expect(() => resolveTokenExpiry("90d", now)).toThrow(Exited);
    });
});
