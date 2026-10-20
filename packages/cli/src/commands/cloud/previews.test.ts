/**
 * `rebase cloud previews`, run through the real dispatcher with `fetch` stood in
 * for the control plane.
 *
 * What these hold: the list and the delete reach the `previews` function for
 * this project and nothing else; a delete is confirmed before it is sent; and a
 * control plane that has no previews says so, rather than reading as "this
 * project has none".
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

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const CP = "https://cp.example";
const PROJECT_ID = "proj_1";

interface Sent { method: string; path: string }

let sent: Sent[];
let stdout: string[];
let previewsServed: boolean;
let home: string;
let cwd: string;
let savedEnv: Record<string, string | undefined>;

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const PREVIEWS = [
    {
        name: "new-quiz",
        url: "https://songbuzz--new-quiz.rebase.website",
        app: "backend",
        backend: "preview",
        status: "success",
        expiresAt: "2026-10-27T10:00:00.000Z"
    },
    { name: "k3x9", url: "songbuzz--k3x9.rebase.website", app: "game", backend: "production", status: "success" }
];

function respond(method: string, p: string): Response {
    if (p === "/api/data/projects") return json(200, { data: [{ id: PROJECT_ID, subdomain: "songbuzz" }], meta: { hasMore: false } });
    if (p.startsWith("/api/functions/previews")) {
        if (!previewsServed) {
            return json(404, { error: { code: "FUNCTION_NOT_FOUND", message: "No function named 'previews'." } });
        }
        if (method === "GET" && p === `/api/functions/previews/${PROJECT_ID}`) return json(200, { previews: PREVIEWS });
        if (method === "DELETE" && p === `/api/functions/previews/${PROJECT_ID}/new-quiz`) return json(200, { success: true });
        if (method === "DELETE") return json(404, { error: { code: "NOT_FOUND", message: "No such preview." } });
    }
    return json(404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${p} on this backend.` } });
}

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-previews-home-")));
    cwd = process.cwd();
    process.chdir(home);
    savedEnv = { HOME: process.env.HOME, REBASE_TOKEN: process.env.REBASE_TOKEN, REBASE_JSON: process.env.REBASE_JSON };
    process.env.HOME = home;
    process.env.REBASE_TOKEN = "rk_live_token";
    delete process.env.REBASE_JSON;

    sent = [];
    stdout = [];
    previewsServed = true;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Exited(code ?? 0); }) as never);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        sent.push({ method, path: url.pathname });
        return respond(method, url.pathname);
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

/** Run `rebase cloud previews …` and return the one JSON value it printed. */
async function run(...words: string[]): Promise<Record<string, unknown>> {
    await cloudCommand("previews", ["node", "rebase", "cloud", "previews", ...words, "--project", "songbuzz", "--url", CP, "--json"]);
    return JSON.parse(stdout.join(""));
}

async function refused(...words: string[]): Promise<{ code: string; message: string; hint?: string }> {
    await expect(run(...words)).rejects.toThrow(Exited);
    return (JSON.parse(stdout.join("")) as { error: { code: string; message: string; hint?: string } }).error;
}

const toPreviews = () => sent.filter(request => request.path.startsWith("/api/functions/previews"));

describe("rebase cloud previews list", () => {
    it("reads the project's previews from the previews function", async () => {
        const out = await run("list");

        expect(toPreviews()).toEqual([{ method: "GET", path: `/api/functions/previews/${PROJECT_ID}` }]);
        expect(out.previews).toEqual([
            expect.objectContaining({ name: "new-quiz", backend: "preview", expiresAt: "2026-10-27T10:00:00.000Z" }),
            // A bare host is given its scheme, so the address is one a browser opens.
            expect.objectContaining({ name: "k3x9", url: "https://songbuzz--k3x9.rebase.website", backend: "production" })
        ]);
    });

    it("is the default action, and answers to the singular", async () => {
        expect((await run()).previews).toHaveLength(2);
        stdout = [];
        await cloudCommand("preview", ["node", "rebase", "cloud", "preview", "--project", "songbuzz", "--url", CP, "--json"]);
        expect((JSON.parse(stdout.join("")) as { previews: unknown[] }).previews).toHaveLength(2);
    });

    it("says the control plane has no previews, rather than that the project has none", async () => {
        previewsServed = false;

        const error = await refused("list");

        expect(error.code).toBe("previews_unavailable");
    });
});

describe("rebase cloud previews delete", () => {
    it("deletes the named preview with --yes", async () => {
        const out = await run("delete", "New-Quiz", "--yes");

        expect(toPreviews()).toEqual([{ method: "DELETE", path: `/api/functions/previews/${PROJECT_ID}/new-quiz` }]);
        expect(out).toEqual({ success: true, deleted: "new-quiz" });
    });

    it("refuses to delete unconfirmed when nobody can answer a prompt, and sends nothing", async () => {
        const error = await refused("delete", "new-quiz");

        expect(error.code).toBe("confirmation_required");
        expect(toPreviews()).toEqual([]);
    });

    it("says which preview does not exist", async () => {
        const error = await refused("rm", "gone", "--yes");

        expect(error.code).toBe("not_found");
        expect(error.message).toContain("gone");
    });

    it("needs a name", async () => {
        expect((await refused("delete", "--yes")).code).toBe("usage");
    });

    it("refuses an unknown action", async () => {
        expect((await refused("promote", "new-quiz")).code).toBe("unknown_command");
    });
});
