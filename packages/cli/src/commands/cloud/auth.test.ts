/**
 * `rebase cloud login --password` says what it just did.
 *
 * A password written as an argument is in the shell's history file and in the
 * process table for as long as the command runs, and neither is something this
 * CLI can redact afterwards. The flag stays — there is no machine token yet, so
 * a non-interactive login genuinely needs the password from somewhere — but it
 * warns, once, BEFORE the request: by the time a login succeeds the password is
 * already written down, and a warning after that is advice about something that
 * has already happened.
 *
 * `REBASE_CLOUD_EMAIL` / `REBASE_CLOUD_PASSWORD` are the route that does not
 * touch the command line. The same stance `rls-check` takes for its connection
 * string, which carries a password too.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loginCommand, passwordOnTheCommandLine, LOGIN_FLAGS, PASSWORD_ENV, EMAIL_ENV } from "./auth";
import { ACTION_HELP } from "./action-help";
import { setJsonModeForTest } from "./context";

describe("passwordOnTheCommandLine", () => {
    it("is true for a password written as a flag", () => {
        expect(passwordOnTheCommandLine({ "--password": "hunter2" })).toBe(true);
    });

    it("is false when the flag was not used", () => {
        expect(passwordOnTheCommandLine({})).toBe(false);
        expect(passwordOnTheCommandLine({ "--password": undefined })).toBe(false);
    });

    it("is false for an empty value, which put nothing in the history", () => {
        expect(passwordOnTheCommandLine({ "--password": "" })).toBe(false);
    });
});

describe("the login page", () => {
    it("carries the warning, so it is read before the flag is used", () => {
        const page = ACTION_HELP.login;
        const text = [...page.flags.map(([, d]) => d), ...(page.notes ?? [])].join(" ");
        expect(text).toContain("shell history");
        expect(text).toContain(PASSWORD_ENV);
        expect(text).toContain(EMAIL_ENV);
    });

    it("still documents the flag it discourages", () => {
        // Discouraged is not removed: CI has no other route today, and a flag
        // that exists and is undocumented is worse than one with a caveat.
        expect(Object.keys(LOGIN_FLAGS)).toContain("--password");
        expect(page(ACTION_HELP.login)).toContain("--password");
    });
});

function page(entry: { flags: Array<[string, string]> }): string {
    return entry.flags.map(([flag]) => flag).join(" ");
}

/**
 * A repository's `.rebase/cloud.json` names the control plane its cloud
 * commands talk to — and `login` sent the user's email and password there.
 * A cloned repository could ship a link to any host, and the natural reaction
 * to "Not logged in to https://…" is to run the login it suggests. A host the
 * user has never signed in to is now only used when they name it themselves.
 */
describe("login in a directory whose link names the control plane", () => {
    const LINKED = "https://attacker.example";
    let requests: string[];
    let stdout: string[];

    function argv(...words: string[]): string[] {
        return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
    }

    /** A checkout linked to `url`, with HOME holding `contexts` as the user's own. */
    function linkedTo(url: string, contexts: Record<string, unknown> = {}): void {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-login-link-"));
        fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
        fs.writeFileSync(path.join(root, ".rebase", "cloud.json"), JSON.stringify({ url, projectId: "x" }));
        fs.mkdirSync(path.join(root, "home", ".rebase"), { recursive: true });
        fs.writeFileSync(path.join(root, "home", ".rebase", "credentials.json"), JSON.stringify({ contexts }));
        vi.spyOn(process, "cwd").mockReturnValue(root);
        vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
    }

    beforeEach(() => {
        requests = [];
        stdout = [];
        process.env[EMAIL_ENV] = "victim@example.com";
        process.env[PASSWORD_ENV] = "hunter2-real-password";
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            requests.push(String(url));
            return new Response(JSON.stringify({ error: { message: "Invalid credentials" } }), { status: 401 });
        }));
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
        vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Error(`__exit_${code ?? 0}`);
        }) as never);
        setJsonModeForTest(true);
    });

    afterEach(() => {
        setJsonModeForTest(false);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete process.env[EMAIL_ENV];
        delete process.env[PASSWORD_ENV];
        delete process.env.REBASE_CLOUD_URL;
    });

    it("refuses a host the user has never signed in to, before anything is sent", async () => {
        linkedTo(LINKED);

        await expect(loginCommand(argv("login"))).rejects.toThrow("__exit_1");

        expect(requests).toEqual([]);
        const error = JSON.parse(stdout.join("")).error;
        expect(error.code).toBe("unknown_control_plane");
        expect(error.message).toContain(LINKED);
        expect(error.hint).toContain(`--url ${LINKED}`);
    });

    it("signs in there when the user names it with --url", async () => {
        linkedTo(LINKED);

        await expect(loginCommand(argv("login", "--url", LINKED))).rejects.toThrow("__exit_1");

        expect(requests).toEqual([`${LINKED}/api/auth/login`]);
    });

    it("signs in to a linked host the user has signed in to before", async () => {
        linkedTo(LINKED, { [LINKED]: {} });

        await expect(loginCommand(argv("login"))).rejects.toThrow("__exit_1");

        expect(requests).toEqual([`${LINKED}/api/auth/login`]);
    });

    it("signs in to the platform's own control plane when a link names it", async () => {
        linkedTo("https://app.rebase.pro");

        await expect(loginCommand(argv("login"))).rejects.toThrow("__exit_1");

        expect(requests).toEqual(["https://app.rebase.pro/api/auth/login"]);
    });
});
