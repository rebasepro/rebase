/**
 * `rebase cloud login` for the accounts a password cannot sign in: console
 * sign-ups through Google, GitHub or LinkedIn (an emailed code), and accounts
 * with two-factor authentication on (the second factor, on any path).
 *
 * Driven through the real SDK client against a stubbed `fetch`, so what is
 * asserted is the requests the control plane sees, in order.
 */
import fs from "fs";
import os from "os";
import path from "path";
import inquirer from "inquirer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loginCommand, LOGIN_FLAGS, EMAIL_ENV, PASSWORD_ENV } from "./auth";
import { ACTION_HELP } from "./action-help";
import { setJsonModeForTest } from "./context";
import { readMfaRequired, NO_PASSWORD_HINT, TOKEN_REMEDY } from "./login-flow";

const HOST = "https://cloud.example.test";

type Reply = { status: number; body: unknown };
type Route = (body: Record<string, unknown>, headers: Headers) => Reply;

let requests: Array<{ method: string; path: string; body: Record<string, unknown>; auth: string | null }>;
let routes: Record<string, Route | Reply[]>;
let stdout: string[];
let stderr: string[];
let answers: Array<Record<string, unknown>>;
let promptMessages: string[];
let originalIsTTY: boolean | undefined;

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words, "--url", HOST];
}

function session(email: string): Reply {
    return {
        status: 200,
        body: {
            user: { uid: "u1", email, roles: [] },
            tokens: { accessToken: "access", refreshToken: "refresh", accessTokenExpiresAt: Date.now() + 3_600_000 }
        }
    };
}

function refusal(status: number, code: string, details?: unknown): Reply {
    return { status, body: { error: { message: code, code, details } } };
}

const MFA = refusal(401, "MFA_REQUIRED", {
    mfaToken: "pending-mfa-token",
    factors: [{ id: "factor-1", factorType: "totp", friendlyName: "Phone" }]
});

function paths(): string[] {
    return requests.map(r => `${r.method} ${r.path}`);
}

function signInPaths(): string[] {
    return paths().filter(p => p.includes("/api/auth/"));
}

/**
 * The JSON error envelope the command printed first. Under the test's `exit`
 * stub a refusal inside the sign-in throws on into the command's own `catch`,
 * which prints a second one; a real exit never gets there.
 */
function firstJsonError(): { code?: string; message?: string; hint?: string } {
    const first = stdout.join("").split(/\n}\n/)[0] + "\n}";
    return (JSON.parse(first) as { error: { code?: string; message?: string; hint?: string } }).error;
}

function printedErrors(): string {
    return stderr.join("");
}

beforeEach(() => {
    requests = [];
    stdout = [];
    stderr = [];
    answers = [];
    promptMessages = [];
    routes = {
        "GET /api/auth/config": [{ status: 200, body: { emailOtp: true, emailPasswordLogin: true } }]
    };

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-login-flow-"));
    fs.mkdirSync(path.join(root, "home"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input instanceof Request ? input.url : input));
        const method = (init?.method ?? "GET").toUpperCase();
        const headers = new Headers(init?.headers);
        const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
        requests.push({ method, path: url.pathname, body, auth: headers.get("authorization") });
        const route = routes[`${method} ${url.pathname}`];
        const reply = Array.isArray(route)
            ? (route.length > 1 ? route.shift()! : route[0])
            : route
                ? route(body, headers)
                : url.pathname.startsWith("/api/data/")
                    ? { status: 200, body: { data: [] } }
                    : { status: 404, body: { error: { message: "Not found", code: "NOT_FOUND" } } };
        return new Response(JSON.stringify(reply?.body ?? {}), {
            status: reply?.status ?? 404,
            headers: { "Content-Type": "application/json" }
        });
    }));

    vi.spyOn(inquirer, "prompt").mockImplementation((async (questions: Array<{ name: string; message: string; validate?: (v: string) => unknown }>) => {
        const out: Record<string, unknown> = {};
        for (const q of questions) {
            promptMessages.push(q.message);
            const next = answers.shift();
            if (!next || !(q.name in next)) throw new Error(`unexpected prompt: ${q.message}`);
            out[q.name] = next[q.name];
        }
        return out;
    }) as never);

    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
    }) as typeof process.stderr.write);
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
        stderr.push(parts.map(String).join(" ") + "\n");
    });
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        stdout.push(parts.map(String).join(" ") + "\n");
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`__exit_${code ?? 0}`);
    }) as never);

    originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    setJsonModeForTest(false);
});

afterEach(() => {
    process.stdin.isTTY = originalIsTTY as boolean;
    setJsonModeForTest(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env[EMAIL_ENV];
    delete process.env[PASSWORD_ENV];
});

describe("rebase cloud login --code", () => {
    it("mails a code, then trades what is typed for a session", async () => {
        routes["POST /api/auth/otp"] = [{ status: 200, body: { success: true, expiresInSeconds: 600 } }];
        routes["POST /api/auth/otp/verify"] = [session("ada@example.com")];
        answers = [{ code: "123 456" }];

        await loginCommand(argv("login", "--code", "--email", "ada@example.com"));

        expect(signInPaths()).toEqual(["POST /api/auth/otp", "POST /api/auth/otp/verify"]);
        expect(requests[0].body).toEqual({ email: "ada@example.com" });
        expect(requests[1].body).toEqual({ email: "ada@example.com", code: "123456" });
        expect(stderr.join("")).toContain("Logged in as");
        const stored = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".rebase", "credentials.json"), "utf8"));
        expect(JSON.stringify(stored)).toContain(HOST);
    });

    it("asks for the email when it was not given, and never for a password", async () => {
        routes["POST /api/auth/otp"] = [{ status: 200, body: { success: true } }];
        routes["POST /api/auth/otp/verify"] = [session("ada@example.com")];
        answers = [{ email: "ada@example.com" }, { code: "123456" }];

        await loginCommand(argv("login", "--code"));

        expect(promptMessages).toEqual(["Email:", "Code from the email:"]);
        expect(signInPaths()).toEqual(["POST /api/auth/otp", "POST /api/auth/otp/verify"]);
    });

    it("takes another code after a wrong one", async () => {
        routes["POST /api/auth/otp"] = [{ status: 200, body: { success: true } }];
        routes["POST /api/auth/otp/verify"] = [refusal(400, "INVALID_CODE"), session("ada@example.com")];
        answers = [{ code: "000000" }, { code: "123456" }];

        await loginCommand(argv("login", "--code", "-e", "ada@example.com"));

        expect(signInPaths()).toEqual(["POST /api/auth/otp", "POST /api/auth/otp/verify", "POST /api/auth/otp/verify"]);
        expect(printedErrors()).toContain("That code is not right");
    });

    it("gives up after three wrong codes and says how to get a new one", async () => {
        routes["POST /api/auth/otp"] = [{ status: 200, body: { success: true } }];
        routes["POST /api/auth/otp/verify"] = [refusal(400, "INVALID_CODE")];
        answers = [{ code: "000000" }, { code: "000001" }, { code: "000002" }];

        await expect(loginCommand(argv("login", "--code", "-e", "ada@example.com"))).rejects.toThrow("__exit_1");

        expect(signInPaths().filter(p => p.endsWith("/otp/verify"))).toHaveLength(3);
        expect(printedErrors()).toContain("rebase cloud login --code");
    });

    it("says so when the control plane sends no codes", async () => {
        routes["POST /api/auth/otp"] = [refusal(503, "EMAIL_NOT_CONFIGURED")];

        await expect(loginCommand(argv("login", "--code", "-e", "ada@example.com"))).rejects.toThrow("__exit_1");

        expect(printedErrors()).toContain("does not send sign-in codes");
        expect(printedErrors()).toContain("REBASE_TOKEN");
        expect(signInPaths()).toEqual(["POST /api/auth/otp"]);
    });

    it("refuses with no terminal, before anything is mailed, and names the token route", async () => {
        setJsonModeForTest(true);

        await expect(loginCommand(argv("login", "--code", "-e", "ada@example.com"))).rejects.toThrow("__exit_1");

        expect(requests).toEqual([]);
        const error = firstJsonError();
        expect(error.code).toBe("input_required");
        expect(error.hint).toContain("REBASE_TOKEN");
        expect(error.hint).toContain("Access tokens");
    });

    it("refuses --code with --password", async () => {
        await expect(loginCommand(argv("login", "--code", "--password", "x", "-e", "a@b.c"))).rejects.toThrow("__exit_1");
        expect(requests).toEqual([]);
        expect(printedErrors()).toContain("Pass one of them");
    });
});

describe("rebase cloud login at a terminal with no password given", () => {
    it("offers a code when the control plane mails them", async () => {
        routes["POST /api/auth/otp"] = [{ status: 200, body: { success: true } }];
        routes["POST /api/auth/otp/verify"] = [session("ada@example.com")];
        answers = [{ email: "ada@example.com" }, { method: "code" }, { code: "123456" }];

        await loginCommand(argv("login"));

        expect(promptMessages).toEqual(["Email:", "Sign in with:", "Code from the email:"]);
        expect(signInPaths()).toEqual(["GET /api/auth/config", "POST /api/auth/otp", "POST /api/auth/otp/verify"]);
    });

    it("still signs in with a password when that is the choice", async () => {
        routes["POST /api/auth/login"] = [session("ada@example.com")];
        answers = [{ email: "ada@example.com" }, { method: "password" }, { password: "pw" }];

        await loginCommand(argv("login"));

        expect(signInPaths()).toEqual(["GET /api/auth/config", "POST /api/auth/login"]);
        expect(requests[1].body).toEqual({ email: "ada@example.com", password: "pw" });
    });

    it("asks only for the password when the control plane mails no codes", async () => {
        routes["GET /api/auth/config"] = [{ status: 200, body: { emailOtp: false } }];
        routes["POST /api/auth/login"] = [session("ada@example.com")];
        answers = [{ email: "ada@example.com" }, { password: "pw" }];

        await loginCommand(argv("login"));

        expect(promptMessages).toEqual(["Email:", "Password:"]);
    });
});

describe("two-factor authentication", () => {
    it("asks for the second factor after a password and finishes the sign-in with it", async () => {
        process.env[EMAIL_ENV] = "ada@example.com";
        process.env[PASSWORD_ENV] = "pw";
        routes["POST /api/auth/login"] = [MFA];
        routes["POST /api/auth/mfa/challenge"] = [{ status: 200, body: { challengeId: "ch-1", factorId: "factor-1", expiresAt: "x" } }];
        routes["POST /api/auth/mfa/challenge/verify"] = [session("ada@example.com")];
        answers = [{ code: "654321" }];

        await loginCommand(argv("login"));

        expect(signInPaths()).toEqual(["POST /api/auth/login", "POST /api/auth/mfa/challenge", "POST /api/auth/mfa/challenge/verify"]);
        // The pending token is the credential for the two challenge requests, and only for them.
        expect(requests.filter(r => r.path.includes("/mfa/")).map(r => r.auth)).toEqual(["Bearer pending-mfa-token", "Bearer pending-mfa-token"]);
        expect(requests.find(r => r.path.endsWith("/mfa/challenge"))?.body).toEqual({ factorId: "factor-1" });
        expect(requests.find(r => r.path.endsWith("/challenge/verify"))?.body).toEqual({ challengeId: "ch-1", code: "654321" });
        expect(printedErrors()).toContain("Logged in as");
        expect(printedErrors()).not.toContain("Invalid email or password");
    });

    it("asks for it after an emailed code too", async () => {
        routes["POST /api/auth/otp"] = [{ status: 200, body: { success: true } }];
        routes["POST /api/auth/otp/verify"] = [MFA];
        routes["POST /api/auth/mfa/challenge"] = [{ status: 200, body: { challengeId: "ch-1" } }];
        routes["POST /api/auth/mfa/challenge/verify"] = [session("ada@example.com")];
        answers = [{ code: "123456" }, { code: "654321" }];

        await loginCommand(argv("login", "--code", "-e", "ada@example.com"));

        expect(signInPaths()).toEqual([
            "POST /api/auth/otp",
            "POST /api/auth/otp/verify",
            "POST /api/auth/mfa/challenge",
            "POST /api/auth/mfa/challenge/verify"
        ]);
    });

    it("takes another code on the same challenge after a wrong one", async () => {
        process.env[EMAIL_ENV] = "ada@example.com";
        process.env[PASSWORD_ENV] = "pw";
        routes["POST /api/auth/login"] = [MFA];
        routes["POST /api/auth/mfa/challenge"] = [{ status: 200, body: { challengeId: "ch-1" } }];
        routes["POST /api/auth/mfa/challenge/verify"] = [refusal(401, "INVALID_CODE"), session("ada@example.com")];
        answers = [{ code: "000000" }, { code: "654321" }];

        await loginCommand(argv("login"));

        expect(signInPaths().filter(p => p.endsWith("/mfa/challenge"))).toHaveLength(1);
        expect(signInPaths().filter(p => p.endsWith("/challenge/verify"))).toHaveLength(2);
    });

    it("lets the person pick the factor when there are several", async () => {
        process.env[EMAIL_ENV] = "ada@example.com";
        process.env[PASSWORD_ENV] = "pw";
        routes["POST /api/auth/login"] = [refusal(401, "MFA_REQUIRED", {
            mfaToken: "t",
            factors: [{ id: "f-phone", factorType: "totp", friendlyName: "Phone" }, { id: "f-key", factorType: "totp", friendlyName: "Laptop" }]
        })];
        routes["POST /api/auth/mfa/challenge"] = [{ status: 200, body: { challengeId: "ch-1" } }];
        routes["POST /api/auth/mfa/challenge/verify"] = [session("ada@example.com")];
        answers = [{ factorId: "f-key" }, { code: "654321" }];

        await loginCommand(argv("login"));

        expect(requests.find(r => r.path.endsWith("/mfa/challenge"))?.body).toEqual({ factorId: "f-key" });
    });

    it("refuses with no terminal and names the token route, not 'invalid password'", async () => {
        setJsonModeForTest(true);
        process.env[EMAIL_ENV] = "ada@example.com";
        process.env[PASSWORD_ENV] = "pw";
        routes["POST /api/auth/login"] = [MFA];

        await expect(loginCommand(argv("login"))).rejects.toThrow("__exit_1");

        const error = firstJsonError();
        expect(error.code).toBe("mfa_required");
        expect(error.hint).toBe(TOKEN_REMEDY);
        expect(signInPaths()).toEqual(["POST /api/auth/login"]);
    });
});

describe("a refused password", () => {
    it("names --code and access tokens, for accounts that never had a password", async () => {
        setJsonModeForTest(true);
        process.env[EMAIL_ENV] = "ada@example.com";
        process.env[PASSWORD_ENV] = "wrong";
        routes["POST /api/auth/login"] = [refusal(401, "INVALID_CREDENTIALS")];

        await expect(loginCommand(argv("login"))).rejects.toThrow("__exit_1");

        const error = firstJsonError();
        expect(error.code).toBe("invalid_credentials");
        expect(error.message).toBe("Invalid email or password.");
        expect(error.hint).toBe(NO_PASSWORD_HINT);
        expect(error.hint).toContain("rebase cloud login --code");
        expect(error.hint).toContain("Settings → Access tokens");
        expect(error.hint).toContain("REBASE_TOKEN");
    });
});

describe("readMfaRequired", () => {
    it("reads the pending sign-in out of an MFA_REQUIRED refusal", () => {
        const error = Object.assign(new Error("x"), { code: "MFA_REQUIRED", details: { mfaToken: "t", factors: [{ id: "f", factorType: "totp" }] } });
        expect(readMfaRequired(error)).toEqual({ mfaToken: "t", factors: [{ id: "f", factorType: "totp", friendlyName: undefined }] });
    });

    it("is null for any other error, and for one no code step could finish", () => {
        expect(readMfaRequired(Object.assign(new Error("x"), { code: "INVALID_CREDENTIALS" }))).toBeNull();
        expect(readMfaRequired(Object.assign(new Error("x"), { code: "MFA_REQUIRED", details: { mfaToken: "t", factors: [] } }))).toBeNull();
        expect(readMfaRequired(Object.assign(new Error("x"), { code: "MFA_REQUIRED", details: { factors: [{ id: "f", factorType: "totp" }] } }))).toBeNull();
        expect(readMfaRequired("MFA_REQUIRED")).toBeNull();
    });
});

describe("the login help page", () => {
    it("documents --code, which the parser accepts", () => {
        expect(Object.keys(LOGIN_FLAGS)).toContain("--code");
        expect(ACTION_HELP.login.flags.map(([flag]) => flag).join(" ")).toContain("--code");
        expect(ACTION_HELP.login.usage).toContain("--code");
    });
});
