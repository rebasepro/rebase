/**
 * `rebase cloud init --claim`, against a stand-in control plane.
 *
 * What these hold:
 *  - one unauthenticated POST to the provision endpoint, and its refusals
 *    (rate limit, switched off, an old control plane) named as such;
 *  - `.env` gets `REBASE_BASE_URL` and nothing secret: the token and the claim
 *    link go to the private credentials file, never into the repository;
 *  - the directory is linked, the collections are pushed with a bundle deploy,
 *    and the result names the live URL, the admin panel and the claim link —
 *    the claim link even when the deploy failed;
 *  - afterwards `rebase cloud` commands in the directory authenticate with the
 *    stored token, and stop once it has expired.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudCommand } from "./index";
import { cloudInitCommand, upsertDotenv, adminPanelUrl, type InitDeps, type ProvisionedProject } from "./init";
import { ephemeralGrantFor, initOutputMode, readLink, requireClient } from "./context";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const CP = "https://cp.example";

const PROVISIONED: ProvisionedProject = {
    projectId: "proj_eph",
    slug: "todo-app-k3j9x2ab",
    name: "Todo app",
    projectUrl: "https://todo-app-k3j9x2ab.rebase.website",
    apiKey: "rk_live_project_token",
    claimUrl: `${CP}/claim/rcl_${"a".repeat(48)}`,
    expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString()
};

interface Sent { method: string; path: string; authorization: string | null; body: unknown }

let sent: Sent[];
let said: string[];
let home: string;
let project: string;
let cwd: string;
let respond: (request: Sent) => Response;
let savedEnv: Record<string, string | undefined>;

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function line(...words: string[]): string[] {
    return ["node", "rebase", "cloud", ...words, "--url", CP];
}

function printedJson(): Record<string, unknown> {
    return JSON.parse(said.find(chunk => chunk.trimStart().startsWith("{")) ?? "{}");
}

function refusal(): { code: string; message: string } {
    const value = printedJson() as { error?: { code: string; message: string } };
    if (!value.error) throw new Error(`no error was printed:\n${said.join("\n")}`);
    return value.error;
}

/** The scaffold's manifest: a managed backend and an admin SPA with the CMS at its root. */
function scaffold(dir: string): void {
    fs.writeFileSync(path.join(dir, "rebase.json"), JSON.stringify({
        rebase: "^1",
        apps: {
            backend: { type: "backend", runtime: "managed" },
            admin: { type: "static", root: "frontend", build: "npm run build", output: "frontend/dist", path: "/", cms: "/" }
        }
    }));
    fs.writeFileSync(path.join(dir, ".env"), "PORT=3001\nJWT_SECRET=local-secret\n");
}

function credentials(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(home, ".rebase", "credentials.json"), "utf-8"));
}

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-home-")));
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-project-")));
    scaffold(project);
    cwd = process.cwd();
    process.chdir(project);
    savedEnv = { HOME: process.env.HOME, REBASE_TOKEN: process.env.REBASE_TOKEN, REBASE_JSON: process.env.REBASE_JSON };
    process.env.HOME = home;
    delete process.env.REBASE_TOKEN;
    process.env.REBASE_JSON = "1";

    sent = [];
    said = [];
    respond = (request) => request.path === "/api/functions/ephemeral/provision"
        ? json(201, PROVISIONED)
        : json(404, { error: { code: "NOT_FOUND", message: "no route" } });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const request: Sent = {
            method: init?.method ?? "GET",
            path: url.pathname,
            authorization: new Headers(init?.headers).get("Authorization"),
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined
        };
        sent.push(request);
        return respond(request);
    }));
    const capture = (...args: unknown[]) => { said.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { said.push(String(chunk)); return true; }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { said.push(String(chunk)); return true; }) as never);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Exited(code ?? 0); }) as never);
});

afterEach(() => {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
});

/** Run `init` with the deploy stood in, the way the dispatcher would. */
async function init(words: string[], deploy: InitDeps["deploy"] = async () => ({ ok: true, result: { status: "success" } })) {
    const rawArgs = line("init", ...words);
    initOutputMode(rawArgs);
    const calls: { cwd: string; json: boolean }[] = [];
    await cloudInitCommand(rawArgs, {
        provision: (await import("./init")).requestEphemeralProject,
        deploy: async (dir, jsonMode) => {
            calls.push({ cwd: dir, json: jsonMode });
            return deploy(dir, jsonMode);
        }
    });
    return calls;
}

describe("rebase cloud init --claim", () => {
    it("provisions with one unauthenticated POST, naming the app", async () => {
        await init(["--claim", "--name", "Todo app"]);
        const provisions = sent.filter(r => r.path === "/api/functions/ephemeral/provision");
        expect(provisions).toEqual([{ method: "POST", path: "/api/functions/ephemeral/provision", authorization: null, body: { name: "Todo app" } }]);
    });

    it("writes REBASE_BASE_URL into .env, keeps the rest, and puts no secret there", async () => {
        await init(["--claim"]);
        const env = fs.readFileSync(path.join(project, ".env"), "utf-8");
        expect(env).toBe(`PORT=3001\nJWT_SECRET=local-secret\nREBASE_BASE_URL=${PROVISIONED.projectUrl}\n`);
        expect(env).not.toContain(PROVISIONED.apiKey);
        expect(env).not.toContain("rcl_");
    });

    it("links the directory, and keeps the token and claim link only in the private credentials file", async () => {
        await init(["--claim"]);
        const link = readLink(project);
        expect(link).toMatchObject({ url: CP, projectId: PROVISIONED.projectId, slug: PROVISIONED.slug, apiUrl: PROVISIONED.projectUrl });
        const linkFile = fs.readFileSync(path.join(project, ".rebase", "cloud.json"), "utf-8");
        expect(linkFile).not.toContain(PROVISIONED.apiKey);
        expect(linkFile).not.toContain("rcl_");

        expect(ephemeralGrantFor(CP, PROVISIONED.projectId)).toEqual({
            token: PROVISIONED.apiKey,
            claimUrl: PROVISIONED.claimUrl,
            expiresAt: PROVISIONED.expiresAt
        });
        const mode = fs.statSync(path.join(home, ".rebase", "credentials.json")).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    it("pushes the collections with a bundle deploy from the project, then reports the URLs", async () => {
        const calls = await init(["--claim"]);
        expect(calls).toEqual([{ cwd: project, json: true }]);
        expect(printedJson()).toMatchObject({
            projectId: PROVISIONED.projectId,
            projectUrl: PROVISIONED.projectUrl,
            adminUrl: `${PROVISIONED.projectUrl}/`,
            claimUrl: PROVISIONED.claimUrl,
            expiresAt: PROVISIONED.expiresAt,
            env: { REBASE_BASE_URL: PROVISIONED.projectUrl },
            deploy: { ok: true, result: { status: "success" } }
        });
        expect(printedJson()).not.toHaveProperty("apiKey");
    });

    it("still prints the claim link when the deploy fails, and exits 1", async () => {
        await init(["--claim"], async () => ({ ok: false, result: { error: { code: "build_failed", message: "tsc" } } }));
        expect(printedJson()).toMatchObject({ claimUrl: PROVISIONED.claimUrl, adminUrl: null, deploy: { ok: false } });
        expect(process.exitCode).toBe(1);
        expect(ephemeralGrantFor(CP, PROVISIONED.projectId)?.claimUrl).toBe(PROVISIONED.claimUrl);
    });

    it("skips the deploy with --no-deploy", async () => {
        const calls = await init(["--claim", "--no-deploy"]);
        expect(calls).toEqual([]);
        expect(printedJson()).toMatchObject({ deploy: null, adminUrl: null });
    });

    it("dispatches from `rebase cloud init`", async () => {
        await cloudCommand(undefined, line("init", "--claim", "--no-deploy"));
        expect(printedJson()).toMatchObject({ claimUrl: PROVISIONED.claimUrl });
    });

    it("refuses without --claim, and provisions nothing", async () => {
        await expect(init([])).rejects.toBeInstanceOf(Exited);
        expect(refusal().code).toBe("usage");
        expect(sent).toEqual([]);
    });

    it("refuses in a directory already linked to a project", async () => {
        fs.mkdirSync(path.join(project, ".rebase"), { recursive: true });
        fs.writeFileSync(path.join(project, ".rebase", "cloud.json"), JSON.stringify({ url: CP, projectId: "other", slug: "shop" }));
        await expect(init(["--claim"])).rejects.toBeInstanceOf(Exited);
        expect(refusal().code).toBe("already_linked");
        expect(sent).toEqual([]);
    });

    it.each([
        [429, { error: { code: "conflict", message: "This address already holds as many unclaimed projects as it may." } }, "rate_limited"],
        [503, { error: { code: "not_configured", message: "Provisioning without an account is not enabled on this control plane." } }, "not_configured"],
        [404, { error: { code: "NOT_FOUND", message: "no route" } }, "not_supported"]
    ])("names a %i refusal, and writes nothing", async (status, body, code) => {
        respond = () => json(status, body);
        await expect(init(["--claim"])).rejects.toBeInstanceOf(Exited);
        expect(refusal().code).toBe(code);
        expect(fs.existsSync(path.join(project, ".rebase", "cloud.json"))).toBe(false);
        expect(fs.readFileSync(path.join(project, ".env"), "utf-8")).not.toContain("REBASE_BASE_URL");
    });
});

describe("the stored token afterwards", () => {
    it("authenticates `rebase cloud` commands in the linked directory", async () => {
        await init(["--claim", "--no-deploy"]);
        const { client, url } = await requireClient(line("status"));
        expect(url).toBe(CP);
        respond = () => json(200, { data: [] });
        await client.data.collection("projects").find({ limit: 1 });
        expect(sent.at(-1)?.authorization).toBe(`Bearer ${PROVISIONED.apiKey}`);
    });

    it("is not used once it has expired", async () => {
        await init(["--claim", "--no-deploy"]);
        const file = path.join(home, ".rebase", "credentials.json");
        const creds = credentials() as { contexts: Record<string, { ephemeral: Record<string, { expiresAt: string }> }> };
        creds.contexts[CP].ephemeral[PROVISIONED.projectId].expiresAt = new Date(Date.now() - 1000).toISOString();
        fs.writeFileSync(file, JSON.stringify(creds));
        said = [];

        await expect(requireClient(line("status"))).rejects.toBeInstanceOf(Exited);
        expect(refusal().code).toBe("not_logged_in");
    });

    it("is forgotten when the control plane refuses it, with the way forward", async () => {
        await init(["--claim", "--no-deploy"]);
        said = [];
        respond = () => json(401, { error: { code: "UNAUTHORIZED", message: "API key has been revoked" } });
        await expect(cloudCommand("logs", line("logs"))).rejects.toThrow(Exited);
        expect(refusal()).toMatchObject({ code: "token_rejected" });
        expect(refusal().message).toContain("rebase cloud init --claim");
        expect(ephemeralGrantFor(CP, PROVISIONED.projectId)).toBeUndefined();
    });
});

describe("the helpers", () => {
    it("replaces a variable already in .env, including an exported one", () => {
        const file = path.join(project, "x.env");
        fs.writeFileSync(file, "A=1\nexport REBASE_BASE_URL=http://localhost:3001\nB=2");
        upsertDotenv(file, "REBASE_BASE_URL", "https://x.rebase.website");
        expect(fs.readFileSync(file, "utf-8")).toBe("A=1\nREBASE_BASE_URL=https://x.rebase.website\nB=2\n");
        upsertDotenv(path.join(project, "new.env"), "K", "v");
        expect(fs.readFileSync(path.join(project, "new.env"), "utf-8")).toBe("K=v\n");
    });

    it("finds the admin panel where rebase.json mounts the CMS, and nowhere when it mounts none", () => {
        expect(adminPanelUrl(project, "https://a.rebase.website")).toBe("https://a.rebase.website/");
        fs.writeFileSync(path.join(project, "rebase.json"), JSON.stringify({
            rebase: "^1",
            apps: { backend: { type: "backend", runtime: "managed" } }
        }));
        expect(adminPanelUrl(project, "https://a.rebase.website")).toBeUndefined();
        expect(adminPanelUrl(null, "https://a.rebase.website")).toBeUndefined();
    });
});
