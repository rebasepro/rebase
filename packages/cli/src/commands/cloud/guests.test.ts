/**
 * `rebase cloud guests`: what the command sends and prints. Pinned: the service
 * key goes to the project's own address and nowhere else, and is never printed;
 * `prune` deletes nothing without `--yes`; a bad line is refused before the key
 * is read; an older runtime is told so. Which rows can go is the app's decision,
 * tested in `server-postgres/test/guest-cleanup.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "p1")
    };
});
vi.mock("./debug", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./debug")>();
    return { ...actual, resolveOrigin: vi.fn(async () => ORIGIN) };
});

import * as context from "./context";
import { guestsCommand, parseAge } from "./guests";

const ORIGIN = "https://shop.rebase.test";
const SERVICE_KEY = "rsk_guests_test_key";
const GUEST = {
    uid: "3f0c9a7e-1f3b-4c55-9d1e-7a2f4d6b8c10",
    createdAt: "2026-09-01T10:00:00.000Z",
    lastSeenAt: "2026-09-02T10:00:00.000Z"
};

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", "guests", ...words];
}

const invoke = vi.fn(async () => ({ key: "REBASE_SERVICE_KEY", value: SERVICE_KEY }));

interface Call { method: string; url: URL; authorization: string | null }
let calls: Call[];
let answer: (call: Call) => Response;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
});

async function run(...words: string[]): Promise<{ out: string; exited: boolean }> {
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
        await guestsCommand(argv(...words, "--json"));
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

const deletes = () => calls.filter(call => call.method === "DELETE");

beforeEach(() => {
    setJsonModeForTest(true);
    calls = [];
    answer = () => json({ guests: [GUEST], total: 1, limit: 25, offset: 0 });
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: { functions: { invoke } },
        url: "https://cp.example"
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        const call = { method: request.method, url: new URL(request.url), authorization: request.headers.get("authorization") };
        calls.push(call);
        return answer(call);
    }));
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("parseAge", () => {
    it("reads an age with a unit", () => {
        expect(parseAge("30d")).toBe(30 * 86_400_000);
        expect(parseAge("12h")).toBe(12 * 3_600_000);
        expect(parseAge("2w")).toBe(14 * 86_400_000);
        expect(parseAge("45m")).toBe(45 * 60_000);
    });

    it("refuses a bare number and an age of nothing", () => {
        for (const value of ["30", "0d", "d", "-1d", "1.5d", "30 days"]) {
            expect(parseAge(value)).toBeUndefined();
        }
    });
});

describe("rebase cloud guests", () => {
    it("lists through the project's own address, holding its service key", async () => {
        const { out, exited } = await run();

        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual({ guests: [GUEST], total: 1, limit: 25, offset: 0 });
        expect(invoke).toHaveBeenCalledWith("env-vars", { projectId: "p1", key: "REBASE_SERVICE_KEY" }, { path: "reveal" });
        expect(calls).toHaveLength(1);
        expect(calls[0].url.origin).toBe(ORIGIN);
        expect(calls[0].url.pathname).toBe("/api/admin/guests");
        expect(calls[0].authorization).toBe(`Bearer ${SERVICE_KEY}`);
        expect(out).not.toContain(SERVICE_KEY);
    });

    it("narrows the list with --limit and --older-than", async () => {
        await run("--limit", "5", "--older-than", "30d");

        expect(calls[0].url.searchParams.get("limit")).toBe("5");
        const cutoff = new Date(calls[0].url.searchParams.get("lastSeenBefore") ?? "").getTime();
        expect(Math.abs(cutoff - (Date.now() - 30 * 86_400_000))).toBeLessThan(60_000);
    });

    it("has no --host: the key goes to the project's address or nowhere", async () => {
        const { out, exited } = await run("--host", "elsewhere.example");

        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("usage");
        expect(invoke).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });

    it.each([
        ["delete with no id", ["delete"]],
        ["prune with no age", ["prune"]],
        ["prune with a bare number", ["prune", "--older-than", "30"]],
        ["prune --limit, a bound it would not have", ["prune", "--older-than", "30d", "--limit", "5"]],
        ["delete by age", ["delete", GUEST.uid, "--older-than", "30d"]],
        ["an id on the list", ["some-id"]],
        ["an id on prune", ["prune", "some-id", "--older-than", "30d"]],
        ["an unreadable --limit", ["--limit", "many"]]
    ])("refuses %s before reading the key", async (_what, words) => {
        const { exited } = await run(...words);

        expect(exited).toBe(true);
        expect(invoke).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });

    it("refuses an unknown action", async () => {
        const { out, exited } = await run("purge");

        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("unknown_command");
    });
});

describe("rebase cloud guests delete", () => {
    it("asks first, and reads no key where it cannot ask", async () => {
        const { out, exited } = await run("delete", GUEST.uid);

        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("deletes one with --yes", async () => {
        answer = () => json({ success: true });

        const { out } = await run("delete", GUEST.uid, "--yes");

        expect(JSON.parse(out)).toEqual({ success: true });
        expect(deletes().map(call => call.url.pathname)).toEqual([`/api/admin/guests/${GUEST.uid}`]);
    });

    it("passes on the app's refusal of an account", async () => {
        answer = () => json({ error: { code: "NOT_ANONYMOUS", message: "This user is an account, not a guest." } }, 400);

        const { out, exited } = await run("delete", GUEST.uid, "--yes");

        expect(exited).toBe(true);
        expect(JSON.parse(out).error.message).toContain("not a guest");
    });
});

describe("rebase cloud guests prune", () => {
    it("is a dry run without --yes: it counts, and deletes nothing", async () => {
        answer = () => json({ guests: [GUEST], total: 12, limit: 1, offset: 0 });

        const { out, exited } = await run("prune", "--older-than", "30d");

        expect(exited).toBe(false);
        expect(JSON.parse(out)).toMatchObject({ dryRun: true, olderThan: "30d", wouldDelete: 12 });
        expect(deletes()).toEqual([]);
    });

    it("deletes batch by batch with --yes, stepping past the guests it skipped", async () => {
        const skipped = { uid: "held", code: "GUEST_REFERENCED", message: "A row requires this guest." };
        const batches = [
            { deleted: 199, skipped: [skipped], remaining: 150 },
            { deleted: 150, skipped: [], remaining: 0 }
        ];
        answer = () => json(batches.shift());

        const { out, exited } = await run("prune", "--older-than", "30d", "--yes");

        expect(exited).toBe(false);
        expect(JSON.parse(out)).toMatchObject({ dryRun: false, deleted: 349, skipped: [skipped] });
        expect(deletes().map(call => call.url.searchParams.get("offset"))).toEqual([null, "1"]);
        // The same cutoff for every batch, so the set cannot grow while it runs.
        const cutoffs = new Set(deletes().map(call => call.url.searchParams.get("lastSeenBefore")));
        expect(cutoffs.size).toBe(1);
    });
});

describe("an app that cannot answer", () => {
    it("says a project on an older runtime needs a newer one", async () => {
        answer = () => json({ error: { code: "NOT_FOUND", message: "No route for GET /api/admin/guests on this backend." } }, 404);

        const { out, exited } = await run();

        expect(exited).toBe(true);
        const { error } = JSON.parse(out);
        expect(error.code).toBe("runtime_too_old");
        expect(error.message).toContain("needs a newer runtime");
    });

    it("does not take a guest that was not found for an older runtime", async () => {
        answer = () => json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);

        const { out, exited } = await run("delete", GUEST.uid, "--yes");

        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).not.toBe("runtime_too_old");
    });

    it("says when the repository has no guests to manage", async () => {
        answer = () => json({ error: { code: "NOT_SUPPORTED", message: "This backend's auth repository cannot list or delete guests." } }, 501);

        const { out, exited } = await run();

        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("not_supported");
    });
});
