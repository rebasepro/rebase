/**
 * What `rebase cloud` does on this machine with what it is handed: a URL to
 * open, a token to send, a `.env` to write.
 *
 *  - A URL opens through a program's argv, never a shell: `cmd.exe` reads `&`
 *    as "run the rest as a second command", and a URL with a query has one.
 *  - `REBASE_TOKEN` goes only to a control plane the user chose. A cloned
 *    repository's `.rebase/cloud.json` names a host; the token is not its to
 *    receive, exactly as the password is not at `login`.
 *  - `env pull` leaves its `.env` owner-only even when it replaces one that
 *    was world-readable.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>();
    return { ...actual, spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })) };
});

import { spawn } from "child_process";
import { browserOpener, openUrl, requireClient, setJsonModeForTest } from "./context";
import { envCommand } from "./env";

const PROJECT_ID = "0b6f2a4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("browserOpener", () => {
    const url = "https://app.rebase.pro/claim/abc?next=1&calc=1";

    it("opens a URL on Windows without cmd.exe, the URL one argument as it is", () => {
        const opener = browserOpener(url, "win32");

        expect(opener).toEqual({ command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] });
    });

    it("keeps a space or a quote from splitting the URL on Windows", () => {
        const opener = browserOpener("https://x.test/a b?q=\"&x", "win32");

        expect(opener?.args).toEqual(["url.dll,FileProtocolHandler", "https://x.test/a%20b?q=%22&x"]);
    });

    it("hands the URL to open and xdg-open as one argv entry", () => {
        expect(browserOpener(url, "darwin")).toEqual({ command: "open", args: [url] });
        expect(browserOpener(url, "linux")).toEqual({ command: "xdg-open", args: [url] });
    });

    it("opens nothing that is not an http(s) URL", () => {
        for (const target of ["file:///etc/passwd", "calc.exe", "-a Terminal", "javascript:alert(1)", ""]) {
            expect(browserOpener(target, "win32"), target).toBeNull();
            expect(browserOpener(target, "linux"), target).toBeNull();
        }
    });
});

describe("openUrl", () => {
    beforeEach(() => {
        vi.mocked(spawn).mockClear();
        vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("spawns the opener with no shell", () => {
        openUrl("https://app.rebase.pro/projects/p?a=1&b=2");

        expect(spawn).toHaveBeenCalledTimes(1);
        const options = vi.mocked(spawn).mock.calls[0][2];
        expect(options).toMatchObject({ shell: false });
    });

    it("spawns nothing for a target that is not a web URL", () => {
        openUrl("file:///etc/passwd");

        expect(spawn).not.toHaveBeenCalled();
    });
});

/** A checkout linked to `url`, with HOME holding `contexts` as the user's own. Returns its root. */
function linkedTo(url: string, contexts: Record<string, unknown> = {}): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-w3-cloud-"));
    fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
    fs.writeFileSync(path.join(root, ".rebase", "cloud.json"), JSON.stringify({ url, projectId: PROJECT_ID }));
    fs.mkdirSync(path.join(root, "home", ".rebase"), { recursive: true });
    fs.writeFileSync(path.join(root, "home", ".rebase", "credentials.json"), JSON.stringify({ contexts }));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
    return root;
}

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

describe("REBASE_TOKEN and a linked control plane", () => {
    const LINKED = "https://attacker.example";
    let requests: Array<{ url: string; authorization: string | null }>;
    let stdout: string[];

    beforeEach(() => {
        requests = [];
        stdout = [];
        process.env.REBASE_TOKEN = "rk_live_ci_token";
        delete process.env.REBASE_CLOUD_URL;
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
            requests.push({ url: String(input instanceof Request ? input.url : input), authorization: headers.get("Authorization") });
            return new Response(JSON.stringify({ held: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }));
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
        vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`__exit_${Number(code ?? 0)}`);
        });
        setJsonModeForTest(true);
    });

    afterEach(() => {
        setJsonModeForTest(false);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete process.env.REBASE_TOKEN;
        delete process.env.REBASE_CLOUD_URL;
    });

    it("is refused for a host only the repository named, before anything is sent", async () => {
        linkedTo(LINKED);

        await expect(requireClient(argv("status"))).rejects.toThrow("__exit_1");

        expect(requests).toEqual([]);
        const error = JSON.parse(stdout.join("")).error;
        expect(error.code).toBe("unknown_control_plane");
        expect(error.message).toContain(LINKED);
        expect(error.hint).toContain(`--url ${LINKED}`);
    });

    it("is used there when the user names the host with --url", async () => {
        linkedTo(LINKED);

        const { url } = await requireClient(argv("status", "--url", LINKED));

        expect(url).toBe(LINKED);
    });

    it("is used there when the user names the host in REBASE_CLOUD_URL", async () => {
        linkedTo(LINKED);
        process.env.REBASE_CLOUD_URL = LINKED;

        const { url } = await requireClient(argv("status"));

        expect(url).toBe(LINKED);
    });

    it("is used for a linked host the user has signed in to before", async () => {
        linkedTo(LINKED, { [LINKED]: {} });

        const { url } = await requireClient(argv("status"));

        expect(url).toBe(LINKED);
    });

    it("is used for the platform's own control plane", async () => {
        linkedTo("https://app.rebase.pro");

        const { url } = await requireClient(argv("status"));

        expect(url).toBe("https://app.rebase.pro");
    });
});

describe("rebase cloud env pull", () => {
    beforeEach(() => {
        process.env.REBASE_TOKEN = "rk_live_ci_token";
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
            const url = String(input instanceof Request ? input.url : input);
            const body = url.includes("/reveal")
                ? { key: "API_URL", value: "https://api.example.com" }
                : { vars: [{ key: "API_URL", secret: false, valueSet: true }], pendingRedeploy: null, pendingSince: null };
            return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        }));
        vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);
        vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`__exit_${Number(code ?? 0)}`);
        });
        setJsonModeForTest(true);
    });

    afterEach(() => {
        setJsonModeForTest(false);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete process.env.REBASE_TOKEN;
    });

    it.skipIf(process.platform === "win32")("leaves a replaced world-readable .env owner-only", async () => {
        const root = linkedTo("https://app.rebase.pro");
        const out = path.join(root, ".env");
        fs.writeFileSync(out, "OLD=1\n", { mode: 0o644 });
        fs.chmodSync(out, 0o644);

        await envCommand("pull", argv("env", "pull", "--yes"));

        expect(fs.readFileSync(out, "utf-8")).toBe("API_URL=https://api.example.com\n");
        expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    });
});
