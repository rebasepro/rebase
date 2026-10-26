/**
 * `rebase cloud app-key [rotate]`: the key `init --claim` wrote into `.env`,
 * handed to the claimer at the claim, and replaced by its owner.
 *
 * Pinned: the listing reads `GET credentials/<id>/app-key`; `rotate` asks
 * first (and refuses without `--yes` where it cannot ask), calls the rotate
 * route once, writes the new key into a `.env` that already set
 * `REBASE_API_TOKEN` and then keeps it out of `--json`, prints it once where
 * there is no such `.env`, and refuses an unknown action before any call.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireSessionClient: vi.fn(),
        requireProject: vi.fn(async () => "p1")
    };
});

let projectRoot: string;
vi.mock("../../utils/project", () => ({ findProjectRoot: () => projectRoot }));

import * as context from "./context";
import { appKeyCommand } from "./app-key";

const NEW_KEY = `rk_live_${"c".repeat(32)}`;
const ROTATED = { apiKey: NEW_KEY, keyId: "key_new", scopes: ["data:read", "data:write"], expiresAt: null, revoked: ["key_agent"] };
const LISTING = { keys: [{ id: "key_agent", prefix: "rk_live_ab12", createdAt: "2026-10-20T12:00:00.000Z", expiresAt: null }] };

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

const invoke = vi.fn(async (_name: string, _body: unknown, opts?: { method?: string; path?: string }) => {
    if (opts?.path === "p1/app-key/rotate") return ROTATED;
    if (opts?.path === "p1/app-key") return LISTING;
    throw new Error(`unexpected call ${opts?.path}`);
});

async function stdoutOf(run: () => Promise<unknown>): Promise<{ out: string; exited: boolean }> {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("__exit__");
    }) as never);
    let exited = false;
    try {
        await run();
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "app-key-"));
    setJsonModeForTest(true);
    (context.requireSessionClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: { functions: { invoke } },
        url: "https://cp.example"
    });
});
afterEach(() => {
    setJsonModeForTest(false);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    vi.clearAllMocks();
});

describe("rebase cloud app-key", () => {
    it("lists the app's agent keys, never their value", async () => {
        const { out, exited } = await stdoutOf(() => appKeyCommand(argv("app-key", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(LISTING);
        expect(invoke).toHaveBeenCalledWith("credentials", undefined, { method: "GET", path: "p1/app-key" });
    });

    it("is a session's act: it asks for a signed-in client, naming what it does", async () => {
        await stdoutOf(() => appKeyCommand(argv("app-key", "--json")));
        expect(context.requireSessionClient).toHaveBeenCalledWith(expect.any(Array), "replace a project's app key");
    });

    it("refuses to rotate without --yes where it cannot ask, and calls nothing", async () => {
        const { out, exited } = await stdoutOf(() => appKeyCommand(argv("app-key", "rotate", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("rotates once, and answers the new key in --json where no .env holds the old one", async () => {
        const { out, exited } = await stdoutOf(() => appKeyCommand(argv("app-key", "rotate", "--yes", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual({ ...ROTATED, dotenv: null });
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("credentials", {}, { path: "p1/app-key/rotate" });
        expect(fs.existsSync(path.join(projectRoot, ".env"))).toBe(false);
    });

    it("writes the new key into a .env that set REBASE_API_TOKEN, keeps other lines, and keeps the key out of --json", async () => {
        const dotenv = path.join(projectRoot, ".env");
        fs.writeFileSync(dotenv, "REBASE_BASE_URL=https://acme.rebase.website\nREBASE_API_TOKEN=rk_live_old\n");
        const { out } = await stdoutOf(() => appKeyCommand(argv("app-key", "rotate", "--yes", "--json")));
        const written = fs.readFileSync(dotenv, "utf-8");
        expect(written).toContain(`REBASE_API_TOKEN=${NEW_KEY}`);
        expect(written).toContain("REBASE_BASE_URL=https://acme.rebase.website");
        expect(written).not.toContain("rk_live_old");
        expect(out).not.toContain(NEW_KEY);
        expect(JSON.parse(out)).toEqual({ keyId: "key_new", scopes: ROTATED.scopes, expiresAt: null, revoked: ["key_agent"], dotenv });
    });

    it("refuses an unknown action before any call", async () => {
        const { out, exited } = await stdoutOf(() => appKeyCommand(argv("app-key", "revoke", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("unknown_command");
        expect(context.requireSessionClient).not.toHaveBeenCalled();
    });
});
