/**
 * `REBASE_TOKEN` and `rebase cloud tokens`, against a stand-in control plane.
 *
 * What these hold:
 *  - with `REBASE_TOKEN` set, the token is the only credential sent, and the
 *    login on this machine is neither read nor written;
 *  - a 401 under a token says the token was refused and how to get another —
 *    or, when the token is fine and the endpoint takes only a session, says
 *    that instead — and never "log in again";
 *  - `tokens create` mints from the session, with the scopes the capability
 *    map gives, prints the secret once as an `export` line, and refuses to run
 *    on a token alone.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudCommand } from "./index";
import { createTokenClient, freshAccessToken } from "./context";
import { scopesForCapabilities } from "./token-capabilities";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const CP = "https://cp.example";

interface Sent { method: string; path: string; authorization: string | null; body: unknown }

let sent: Sent[];
let said: string[];
let home: string;
let respond: (request: Sent) => Response;
let savedEnv: Record<string, string | undefined>;

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A `cloud login` session for the control plane, as the CLI stores it. */
function signIn(): void {
    const session = {
        accessToken: "session_jwt",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60 * 60_000,
        user: { uid: "user_1", email: "me@example.com", roles: [] }
    };
    fs.mkdirSync(path.join(home, ".rebase"), { recursive: true });
    fs.writeFileSync(
        path.join(home, ".rebase", "credentials.json"),
        JSON.stringify({ current: CP, contexts: { [CP]: { auth: JSON.stringify(session) } } })
    );
}

function line(...words: string[]): string[] {
    return ["node", "rebase", "cloud", ...words, "--url", CP];
}

/** The one JSON value the command printed on stdout. Narration on stderr is not it. */
function printedJson(): unknown {
    return JSON.parse(said.find(chunk => chunk.trimStart().startsWith("{")) ?? "{}");
}

/** The one JSON value a refused command printed. */
function refusal(): { code: string; message: string; hint?: string } {
    const value = printedJson() as { error?: { code: string; message: string; hint?: string } };
    if (!value.error) throw new Error(`no error was printed:\n${said.join("\n")}`);
    return value.error;
}

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tokens-home-")));
    savedEnv = { HOME: process.env.HOME, REBASE_TOKEN: process.env.REBASE_TOKEN, REBASE_JSON: process.env.REBASE_JSON };
    process.env.HOME = home;
    delete process.env.REBASE_TOKEN;
    process.env.REBASE_JSON = "1";

    sent = [];
    said = [];
    respond = () => json(404, { error: { code: "NOT_FOUND", message: "no route" } });
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
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(home, { recursive: true, force: true });
});

describe("REBASE_TOKEN", () => {
    it("is the bearer of every request, in place of the stored login", async () => {
        signIn();
        process.env.REBASE_TOKEN = "rk_live_token";
        const before = fs.readFileSync(path.join(home, ".rebase", "credentials.json"), "utf8");
        respond = request => request.path === "/api/data/projects"
            ? json(200, { data: [{ id: "proj_1", subdomain: "shop" }] })
            : json(200, { data: [] });

        await cloudCommand("logs", line("logs", "--project", "shop"));

        expect(sent.length).toBeGreaterThan(0);
        expect(sent.every(request => request.authorization === "Bearer rk_live_token")).toBe(true);
        expect(fs.readFileSync(path.join(home, ".rebase", "credentials.json"), "utf8")).toBe(before);
    });

    it("is what a raw upload or the tunnel is handed", async () => {
        const client = createTokenClient(CP, "rk_live_token");
        expect(await freshAccessToken(client)).toBe("rk_live_token");
    });

    it("answers a refused token with a new token, not a login", async () => {
        process.env.REBASE_TOKEN = "rk_live_revoked";
        respond = () => json(401, { error: { code: "UNAUTHORIZED", message: "Invalid API key" } });

        await expect(cloudCommand("logs", line("logs", "--project", "shop"))).rejects.toThrow(Exited);

        const error = refusal();
        expect(error.code).toBe("token_rejected");
        expect(error.message).toContain("REBASE_TOKEN was rejected");
        expect(error.hint).toContain("rebase cloud tokens create");
        expect(`${error.message} ${error.hint}`).not.toContain("cloud login");
        // The refused request, then the one probe that tells the two causes apart.
        expect(sent.map(request => request.path)).toEqual(["/api/data/projects", "/api/auth/scopes"]);
    });

    it("tells a good token on a session-only endpoint from a refused one", async () => {
        process.env.REBASE_TOKEN = "rk_live_token";
        respond = request => request.path === "/api/auth/scopes"
            ? json(200, { scopes: [], held: ["data:read:projects"] })
            : json(401, { error: { code: "UNAUTHORIZED", message: "Session required" } });

        await expect(cloudCommand("logs", line("logs", "--project", "shop"))).rejects.toThrow(Exited);

        expect(refusal().code).toBe("session_required");
    });

    it("makes whoami report what the token may do, not a session", async () => {
        process.env.REBASE_TOKEN = "rk_live_token";
        const held = scopesForCapabilities("proj_1", ["deploy"]);
        respond = request => request.path === "/api/auth/scopes"
            ? json(200, { scopes: [], held })
            : json(500, { error: { code: "INTERNAL", message: "unexpected" } });

        await cloudCommand("whoami", line("whoami"));

        expect(sent.map(request => request.path)).toEqual(["/api/auth/scopes"]);
        const value = printedJson() as { credential: string; grants: unknown };
        expect(value.credential).toBe("token");
        expect(value.grants).toEqual([{ projectId: "proj_1", capabilities: ["deploy"] }]);
    });
});

describe("rebase cloud tokens create", () => {
    it("mints from the session, with the capability map's scopes", async () => {
        signIn();
        respond = request => {
            if (request.path === "/api/data/projects") return json(200, { data: [{ id: "proj_1", subdomain: "shop" }] });
            if (request.path === "/api/auth/keys") {
                const body = request.body as { name: string; scopes: string[]; expires_at: string | null };
                return json(201, {
                    key: {
                        id: "key_1", name: body.name, kind: "personal", key_prefix: "rk_live_abcd", scopes: body.scopes,
                        roles: [], owner_uid: "user_1", rate_limit: null, created_by: "user_1",
                        created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
                        last_used_at: null, expires_at: body.expires_at, revoked_at: null, key: "rk_live_secret"
                    }
                });
            }
            return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
        };

        await cloudCommand("tokens", line("tokens", "create", "--project", "shop", "--can", "deploy,logs", "--expires-in", "30"));

        const minted = sent.find(request => request.path === "/api/auth/keys");
        expect(minted?.method).toBe("POST");
        expect(minted?.authorization).toBe("Bearer session_jwt");
        expect(minted?.body).toMatchObject({
            name: "shop deploy+logs",
            scopes: scopesForCapabilities("proj_1", ["deploy", "logs"])
        });
        const value = printedJson() as { token: string; env: string; capabilities: string[] };
        expect(value).toMatchObject({ token: "rk_live_secret", env: "REBASE_TOKEN", capabilities: ["deploy", "logs"] });
    });

    it("prints the secret once, as the line to export", async () => {
        process.env.REBASE_JSON = "0";
        signIn();
        respond = request => request.path === "/api/auth/keys"
            ? json(201, { key: { id: "key_1", name: "n", kind: "personal", key_prefix: "rk_live_abcd", scopes: [], roles: [], owner_uid: "user_1", rate_limit: null, created_by: "user_1", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", last_used_at: null, expires_at: null, revoked_at: null, key: "rk_live_secret" } })
            : json(200, { data: [{ id: "proj_1", subdomain: "shop" }] });

        await cloudCommand("tokens", line("tokens", "create", "--project", "shop", "--can", "deploy"));

        // eslint-disable-next-line no-control-regex
        const text = said.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        expect(text).toContain("export REBASE_TOKEN=rk_live_secret");
        expect(text.split("rk_live_secret").length - 1).toBe(1);
    });

    it("refuses to run on a token alone, before any request", async () => {
        process.env.REBASE_TOKEN = "rk_live_token";

        await expect(cloudCommand("tokens", line("tokens", "create", "--project", "shop", "--can", "deploy")))
            .rejects.toThrow(Exited);

        expect(refusal().code).toBe("session_required");
        expect(sent).toEqual([]);
    });

    it("uses the session even when REBASE_TOKEN is set", async () => {
        signIn();
        process.env.REBASE_TOKEN = "rk_live_token";
        respond = () => json(200, { keys: [] });

        await cloudCommand("tokens", line("tokens", "list"));

        expect(sent.map(request => [request.path, request.authorization])).toEqual([["/api/auth/keys", "Bearer session_jwt"]]);
    });

    it("refuses an action it does not have", async () => {
        await expect(cloudCommand("tokens", line("tokens", "mint"))).rejects.toThrow(Exited);
        expect(refusal().code).toBe("unknown_command");
    });
});
