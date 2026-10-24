/**
 * `rebase cloud init --claim`, against a stand-in control plane.
 *
 * What these hold:
 *  - one unauthenticated POST to the provision endpoint, and its refusals
 *    (rate limit, switched off, an old control plane) named as such;
 *  - `.env` gets `REBASE_BASE_URL`, and after a deploy `REBASE_API_TOKEN`: a key
 *    minted on the app, asked for with the project's token. The control-plane
 *    token and the claim link go to the private credentials file, never into
 *    the repository, and no key is printed;
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
import {
    cloudInitCommand,
    requestAppKey,
    upsertDotenv,
    adminPanelUrl,
    dotenvSets,
    mintMissingAppKey,
    INIT_CHILD_DEPLOY_ENV,
    type AppKey,
    type InitDeps,
    type ProvisionedProject
} from "./init";
import { ephemeralGrantFor, forgetEphemeralGrant, initOutputMode, readLink, requireClient } from "./context";

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

const APP_KEY: AppKey = {
    apiKey: "rk_live_app_key",
    keyId: "key_app",
    scopes: ["data:read", "data:write"],
    expiresAt: PROVISIONED.expiresAt
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
    savedEnv = {
        HOME: process.env.HOME,
        REBASE_TOKEN: process.env.REBASE_TOKEN,
        REBASE_JSON: process.env.REBASE_JSON,
        [INIT_CHILD_DEPLOY_ENV]: process.env[INIT_CHILD_DEPLOY_ENV]
    };
    process.env.HOME = home;
    delete process.env.REBASE_TOKEN;
    delete process.env[INIT_CHILD_DEPLOY_ENV];
    process.env.REBASE_JSON = "1";

    sent = [];
    said = [];
    respond = (request) => {
        if (request.path === "/api/functions/ephemeral/provision") return json(201, PROVISIONED);
        if (request.path === "/api/functions/ephemeral/app-key") return json(201, { projectId: PROVISIONED.projectId, ...APP_KEY });
        return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
    };
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
        },
        appKey: (url, token, projectId) => requestAppKey(url, token, projectId, { attempts: 3, sleep: async () => {} })
    });
    return calls;
}

describe("rebase cloud init --claim", () => {
    it("provisions with one unauthenticated POST, naming the app", async () => {
        await init(["--claim", "--name", "Todo app"]);
        const provisions = sent.filter(r => r.path === "/api/functions/ephemeral/provision");
        expect(provisions).toEqual([{ method: "POST", path: "/api/functions/ephemeral/provision", authorization: null, body: { name: "Todo app" } }]);
    });

    it("writes REBASE_BASE_URL and the app's own key into .env, keeps the rest, and no control-plane secret", async () => {
        await init(["--claim"]);
        const env = fs.readFileSync(path.join(project, ".env"), "utf-8");
        expect(env).toBe(
            `PORT=3001\nJWT_SECRET=local-secret\nREBASE_BASE_URL=${PROVISIONED.projectUrl}\nREBASE_API_TOKEN=${APP_KEY.apiKey}\n`
        );
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
            appKey: { ok: true, env: "REBASE_API_TOKEN", scopes: ["data:read", "data:write"], expiresAt: PROVISIONED.expiresAt },
            deploy: { ok: true, result: { status: "success" } }
        });
        expect(printedJson()).not.toHaveProperty("apiKey");
        expect(said.join("\n")).not.toContain(APP_KEY.apiKey);
    });

    it("asks for the app's key once, after the deploy, with the project's own token", async () => {
        await init(["--claim"]);
        const asks = sent.filter(r => r.path === "/api/functions/ephemeral/app-key");
        expect(asks).toEqual([{
            method: "POST",
            path: "/api/functions/ephemeral/app-key",
            authorization: `Bearer ${PROVISIONED.apiKey}`,
            body: { projectId: PROVISIONED.projectId }
        }]);
    });

    it("asks for no key when nothing was deployed", async () => {
        await init(["--claim", "--no-deploy"]);
        fs.rmSync(path.join(project, ".rebase"), { recursive: true });
        await init(["--claim"], async () => ({ ok: false }));
        expect(sent.filter(r => r.path === "/api/functions/ephemeral/provision")).toHaveLength(2);
        expect(sent.filter(r => r.path === "/api/functions/ephemeral/app-key")).toEqual([]);
        expect(fs.readFileSync(path.join(project, ".env"), "utf-8")).not.toContain("REBASE_API_TOKEN");
    });

    it("keeps the project when the key is refused: says why, writes no token, and exits 0", async () => {
        const base = respond;
        respond = (request) => request.path === "/api/functions/ephemeral/app-key"
            ? json(502, { error: { code: "upstream_error", message: "The project's app refused the platform's credential." } })
            : base(request);
        await init(["--claim"]);
        expect(printedJson()).toMatchObject({
            claimUrl: PROVISIONED.claimUrl,
            appKey: { ok: false, error: { code: "upstream_error", message: "The project's app refused the platform's credential." } }
        });
        expect(fs.readFileSync(path.join(project, ".env"), "utf-8")).not.toContain("REBASE_API_TOKEN");
        expect(process.exitCode).toBeUndefined();
    });

    it("asks again while the app is still coming up, and stops once it answers", async () => {
        const base = respond;
        let asked = 0;
        respond = (request) => {
            if (request.path !== "/api/functions/ephemeral/app-key") return base(request);
            asked++;
            return asked < 3
                ? json(503, { error: { code: "upstream_error", message: "The project's app is not answering yet." } })
                : base(request);
        };
        await init(["--claim"]);
        expect(asked).toBe(3);
        expect(fs.readFileSync(path.join(project, ".env"), "utf-8")).toContain(`REBASE_API_TOKEN=${APP_KEY.apiKey}`);
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
        // The only stored copy of the claim link goes with it: it is printed first.
        expect(said.join("\n")).toContain(PROVISIONED.claimUrl);
    });

    /** A control plane where the token is good and `/auth/me` takes only a person's session. */
    function sessionOnlyMe(): void {
        respond = (request) => {
            if (request.path === "/api/auth/me") return json(401, { error: { code: "UNAUTHORIZED", message: "Invalid token" } });
            if (request.path === "/api/auth/scopes") return json(200, { held: [`project:deploy:${PROVISIONED.projectId}`, `project:logs:${PROVISIONED.projectId}`] });
            return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
        };
    }

    it("shows the project, the claim URL and the expiry on `whoami`, and keeps the token", async () => {
        await init(["--claim", "--no-deploy"]);
        sessionOnlyMe();
        said = [];
        await cloudCommand("whoami", line("whoami"));
        expect(printedJson()).toMatchObject({
            credential: "ephemeral",
            projectId: PROVISIONED.projectId,
            claimUrl: PROVISIONED.claimUrl,
            expiresAt: PROVISIONED.expiresAt
        });
        expect(sent.some(r => r.path === "/api/auth/me")).toBe(false);
        expect(ephemeralGrantFor(CP, PROVISIONED.projectId)?.claimUrl).toBe(PROVISIONED.claimUrl);
    });

    it("is kept when a session-only route refuses it, and the refusal says a session is needed", async () => {
        // `rebase cloud projects create` reads `/auth/me` with whatever client it was handed.
        await init(["--claim", "--no-deploy"]);
        sessionOnlyMe();
        said = [];
        const { client } = await requireClient(line("projects", "create"));
        await expect(client.auth.getUser()).rejects.toBeInstanceOf(Exited);
        expect(refusal().code).toBe("session_required");
        expect(ephemeralGrantFor(CP, PROVISIONED.projectId)?.claimUrl).toBe(PROVISIONED.claimUrl);
    });

    it("is kept when the control plane cannot say whether it still holds", async () => {
        await init(["--claim", "--no-deploy"]);
        respond = (request) => request.path === "/api/auth/scopes"
            ? json(502, { error: { code: "upstream_error", message: "Bad gateway" } })
            : json(401, { error: { code: "UNAUTHORIZED", message: "Invalid token" } });
        said = [];
        await expect(cloudCommand("logs", line("logs"))).rejects.toThrow(Exited);
        expect(refusal().code).toBe("token_rejected");
        expect(ephemeralGrantFor(CP, PROVISIONED.projectId)?.claimUrl).toBe(PROVISIONED.claimUrl);
    });
});

describe("asking for the app's key", () => {
    it("gives up after its attempts while the app never answers, waiting between them", async () => {
        respond = () => json(503, { error: { code: "upstream_error", message: "The project's app is not answering yet." } });
        const waits: number[] = [];
        const outcome = await requestAppKey(CP, "rk_live_x", "p1", { attempts: 3, sleep: async (ms) => { waits.push(ms); } });
        expect(outcome).toEqual({ ok: false, code: "upstream_error", message: "The project's app is not answering yet." });
        expect(sent).toHaveLength(3);
        expect(waits).toHaveLength(2);
    });

    it("does not ask again on any other refusal", async () => {
        respond = () => json(404, { error: { code: "not_found", message: "This project is not waiting to be claimed." } });
        const outcome = await requestAppKey(CP, "rk_live_x", "p1", { attempts: 3, sleep: async () => {} });
        expect(outcome).toMatchObject({ ok: false, code: "not_found" });
        expect(sent).toHaveLength(1);
    });

    it("names a control plane that has no such route", async () => {
        respond = () => new Response("Not Found", { status: 404 });
        const outcome = await requestAppKey(CP, "rk_live_x", "p1", { attempts: 3, sleep: async () => {} });
        expect(outcome).toMatchObject({ ok: false, code: "not_supported" });
    });

    it("refuses an answer that carries no key", async () => {
        respond = () => json(201, { keyId: "k" });
        const outcome = await requestAppKey(CP, "rk_live_x", "p1", { attempts: 1, sleep: async () => {} });
        expect(outcome).toMatchObject({ ok: false, code: "bad_response" });
    });
});

/**
 * `init --no-deploy`, or an `init` whose deploy failed, writes no key, and
 * `init` does not run again in a linked directory. The next deploy that
 * succeeds asks for it instead.
 */
describe("the app's key after a later deploy", () => {
    const mint = () => mintMissingAppKey({
        url: CP,
        projectId: PROVISIONED.projectId,
        appKey: (url, token, projectId) => requestAppKey(url, token, projectId, { attempts: 1, sleep: async () => {} })
    });
    const asks = () => sent.filter(r => r.path === "/api/functions/ephemeral/app-key");
    const dotenv = () => fs.readFileSync(path.join(project, ".env"), "utf-8");

    beforeEach(async () => {
        await init(["--claim", "--no-deploy"]);
        sent = [];
        said = [];
    });

    it("asks once, with the project's own token, and writes the key into .env", async () => {
        const outcome = await mint();
        expect(outcome).toEqual({ ok: true, key: { projectId: PROVISIONED.projectId, ...APP_KEY } });
        expect(asks()).toEqual([{
            method: "POST",
            path: "/api/functions/ephemeral/app-key",
            authorization: `Bearer ${PROVISIONED.apiKey}`,
            body: { projectId: PROVISIONED.projectId }
        }]);
        expect(dotenv()).toBe(
            `PORT=3001\nJWT_SECRET=local-secret\nREBASE_BASE_URL=${PROVISIONED.projectUrl}\nREBASE_API_TOKEN=${APP_KEY.apiKey}\n`
        );
        expect(said.join("\n")).not.toContain(APP_KEY.apiKey);
    });

    it("asks nothing once .env sets a key, and again for an empty one", async () => {
        await mint();
        expect(await mint()).toBeUndefined();
        expect(asks()).toHaveLength(1);

        upsertDotenv(path.join(project, ".env"), "REBASE_API_TOKEN", "");
        expect((await mint())?.ok).toBe(true);
        expect(asks()).toHaveLength(2);
    });

    it("asks nothing for a project other than the linked one", async () => {
        const outcome = await mintMissingAppKey({ url: CP, projectId: "proj_other" });
        expect(outcome).toBeUndefined();
        expect(sent).toEqual([]);
    });

    it("asks nothing once the project is claimed or its grant has expired", async () => {
        forgetEphemeralGrant(CP, PROVISIONED.projectId);
        expect(await mint()).toBeUndefined();
        expect(sent).toEqual([]);
    });

    it("asks nothing in the deploy `init` runs, which asks for the key itself", async () => {
        process.env[INIT_CHILD_DEPLOY_ENV] = "1";
        expect(await mint()).toBeUndefined();
        expect(sent).toEqual([]);
    });

    it("answers a refusal, writes nothing, and never throws", async () => {
        respond = () => json(404, { error: { code: "not_found", message: "This project is not waiting to be claimed." } });
        expect(await mint()).toEqual({ ok: false, code: "not_found", message: "This project is not waiting to be claimed." });
        expect(dotenv()).not.toContain("REBASE_API_TOKEN");

        const thrown = await mintMissingAppKey({
            url: CP,
            projectId: PROVISIONED.projectId,
            appKey: async () => { throw new Error("socket hang up"); }
        });
        expect(thrown).toEqual({ ok: false, code: "app_key_failed", message: "socket hang up" });
    });
});

describe("the helpers", () => {
    it("reads whether .env sets a variable to something", () => {
        const file = path.join(project, "x.env");
        expect(dotenvSets(file, "REBASE_API_TOKEN")).toBe(false);
        for (const [content, set] of [
            ["REBASE_API_TOKEN=rk_live_x\n", true],
            ["export REBASE_API_TOKEN = \"rk_live_x\"\n", true],
            ["REBASE_API_TOKEN=\n", false],
            ["REBASE_API_TOKEN=\"\"\n", false],
            ["# REBASE_API_TOKEN=rk_live_x\nREBASE_API_TOKEN_OLD=x\n", false]
        ] as const) {
            fs.writeFileSync(file, content);
            expect(dotenvSets(file, "REBASE_API_TOKEN"), content).toBe(set);
        }
    });

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
