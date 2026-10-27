/**
 * `rebase storage orphans` and `rebase storage move`, against a fake backend.
 *
 * The server decides what is unused and does the copying; what the command
 * owes is to ask, to never delete without a yes, and to keep asking for the
 * next page of a move until there is none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The `.env` the commands see. A test that needs another one swaps it and puts it back. */
const project = vi.hoisted(() => ({
    env: { REBASE_SERVICE_KEY: "svc_test_key", REBASE_BASE_URL: "http://rebase.test" } as Record<string, string>
}));

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        requireProjectRoot: () => "/nonexistent/rebase-storage-test",
        readEnvFile: () => project.env
    };
});

import { describeOrphanReport, orphanScanPolling, storageCommand, type OrphanReport } from "./storage";

function argv(...line: string[]): string[] {
    return ["/usr/bin/node", "/usr/local/bin/rebase", ...line];
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

const report: OrphanReport = {
    storageId: "(default)",
    objects: 5,
    orphans: [{ key: "avatars/old.png", size: 2048, updated: "2026-09-01T00:00:00.000Z" }],
    recent: 1,
    scanned: ["users", "posts"],
    unscanned: []
};

const SCAN = "6f1d7a52-3c51-4a8e-9a43-0d3cbf6a7e11";
const progress = { phase: "rows", filesScanned: 5, rowsScanned: 40, historyEntriesScanned: 0, collectionsScanned: 1, collectionsTotal: 2, unscanned: [] };
const { storageId: _storageId, ...result } = report;
/** A scan's record at each point the command asks about it. */
const scan = {
    queued: { id: SCAN, storageId: "(default)", runner: "worker", status: "queued", progress },
    running: { id: SCAN, storageId: "(default)", runner: "worker", status: "running", progress },
    completed: { id: SCAN, storageId: "(default)", runner: "worker", status: "completed", progress, result },
    deleted: {
        id: SCAN, storageId: "(default)", runner: "worker", status: "completed", progress, result,
        deletion: {
            status: "completed",
            progress: { ...progress, phase: "done", candidates: 2, deleted: 1 },
            result: { deleted: ["avatars/old.png"], kept: [{ key: "avatars/other.png", reason: "a row or a history entry names it now" }], failed: [] }
        }
    }
};

let calls: { method: string; url: string; body?: unknown; auth?: string }[];
let printed: string[];
let answers: unknown[];

beforeEach(() => {
    calls = [];
    printed = [];
    answers = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
            method: init.method ?? "GET",
            url,
            body: init.body ? JSON.parse(String(init.body)) : undefined,
            auth: (init.headers as Record<string, string>).Authorization
        });
        return new Response(JSON.stringify({ data: answers.shift() }), { status: 200 });
    }));
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(" ")); });
});

beforeEach(() => {
    orphanScanPolling.intervalMs = 0;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.exitCode = undefined;
});

describe("rebase storage orphans", () => {
    it("starts a scan with the service key, asks about it until it is done, and deletes nothing", async () => {
        answers.push(scan.queued, scan.running, scan.completed);
        await storageCommand("orphans", argv("storage", "orphans", "--source", "media", "--older-than", "48"));

        expect(calls.map(({ method, url, auth }) => ({ method, url, auth }))).toEqual([
            { method: "POST", url: "http://rebase.test/api/admin/storage/orphans/scans?olderThanHours=48&storageId=media", auth: "Bearer svc_test_key" },
            { method: "GET", url: `http://rebase.test/api/admin/storage/orphans/scans/${SCAN}?storageId=media`, auth: "Bearer svc_test_key" },
            { method: "GET", url: `http://rebase.test/api/admin/storage/orphans/scans/${SCAN}?storageId=media`, auth: "Bearer svc_test_key" }
        ]);
        const text = printed.join("\n").replace(ANSI, "");
        expect(text).toContain("avatars/old.png");
        expect(text).toContain("Nothing was deleted");
    });

    it("prints the report as JSON with --json, the scan's id beside it", async () => {
        answers.push(scan.queued, scan.completed);
        await storageCommand("orphans", argv("storage", "orphans", "--json"));
        expect(JSON.parse(printed.join("\n"))).toEqual({ ...report, scanId: SCAN });
    });

    it("says so when the scan runs inside the server process, for want of a job queue", async () => {
        answers.push({ ...scan.queued, runner: "in-process" }, scan.completed);
        await storageCommand("orphans", argv("storage", "orphans"));
        expect(printed.join("\n").replace(ANSI, "")).toContain("runs no job queue, so the scan runs inside the server process");
    });

    it("stops with the reason when the scan failed", async () => {
        answers.push(scan.queued, { ...scan.running, status: "failed", error: "The scan stopped reporting progress 11 minutes ago" });
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as never);
        await expect(storageCommand("orphans", argv("storage", "orphans"))).rejects.toThrow("exit:1");
        expect(printed.join("\n").replace(ANSI, "")).toContain("The scan failed: The scan stopped reporting progress");
    });

    it("does not delete without a yes when there is no terminal to ask", async () => {
        answers.push(scan.queued, scan.completed);
        const isTTY = process.stdin.isTTY;
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        try {
            await expect(storageCommand("orphans", argv("storage", "orphans", "--delete"))).rejects.toThrow(/--yes/);
        } finally {
            Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
        }
        expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
    });

    it("deletes with --yes from the completed scan, and says which files the server kept", async () => {
        const deletionQueued = { ...scan.completed, deletion: { status: "queued", progress: { ...progress, candidates: 2, deleted: 0 } } };
        answers.push(scan.queued, scan.completed, deletionQueued, deletionQueued, scan.deleted);
        await storageCommand("orphans", argv("storage", "orphans", "--delete", "--yes"));
        expect(calls.map(call => `${call.method} ${call.url.replace("http://rebase.test/api/admin/storage", "")}`)).toEqual([
            "POST /orphans/scans?olderThanHours=24",
            `GET /orphans/scans/${SCAN}`,
            `DELETE /orphans?scan=${SCAN}`,
            `GET /orphans/scans/${SCAN}`,
            `GET /orphans/scans/${SCAN}`
        ]);
        const text = printed.join("\n").replace(ANSI, "");
        expect(text).toContain("Deleted 1 file(s)");
        expect(text).toContain("Kept avatars/other.png: a row or a history entry names it now");
        expect(process.exitCode).toBeUndefined();
    });

    it("does not fall back to the old way for a source the backend does not serve", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ method: init.method ?? "GET", url });
            return new Response(JSON.stringify({ error: { code: "UNKNOWN_STORAGE_SOURCE", message: "This server has no storage source \"media\"." } }), { status: 404 });
        }));
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as never);
        await expect(storageCommand("orphans", argv("storage", "orphans", "--source", "media"))).rejects.toThrow("exit:1");
        expect(calls.map(call => call.method)).toEqual(["POST"]);
    });

    it("asks a backend from before background scans the old way, in one request", async () => {
        const legacy: unknown[] = [report, { deleted: ["avatars/old.png"], failed: [] }];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ method: init.method ?? "GET", url });
            if (url.includes("/orphans/scans")) {
                return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not Found" } }), { status: 404 });
            }
            return new Response(JSON.stringify({ data: legacy.shift() }), { status: 200 });
        }));
        await storageCommand("orphans", argv("storage", "orphans", "--delete", "--yes"));
        expect(calls.map(call => `${call.method} ${call.url.replace("http://rebase.test/api/admin/storage", "")}`)).toEqual([
            "POST /orphans/scans?olderThanHours=24",
            "GET /orphans?olderThanHours=24",
            "DELETE /orphans?olderThanHours=24"
        ]);
        expect(printed.join("\n").replace(ANSI, "")).toContain("Deleted 1 file(s)");
    });

    it("says in a sentence how many unused files it left out for being recent", () => {
        // It read "1 more no row names are newer than 24h, or of unknown age".
        const one = describeOrphanReport(report, 24).join("\n");
        expect(one).toContain("1 more unused file is left out: it is newer than 24h, or its age is unknown,");
        expect(one).not.toContain("no row names are newer");

        const three = describeOrphanReport({ ...report, recent: 3 }, 48).join("\n");
        expect(three).toContain("3 more unused files are left out: they are newer than 48h, or their age is unknown,");

        // With none listed above it, they are not "more".
        const only = describeOrphanReport({ ...report, orphans: [], recent: 2 }, 24).join("\n");
        expect(only).toContain("No file older than 24h is unused.");
        expect(only).toContain("2 unused files are left out: they are newer than 24h");
    });

    it("says which collections were not read", () => {
        const lines = describeOrphanReport({ ...report, unscanned: [{ collection: "events", reason: "no data driver serves it here" }] }, 24);
        expect(lines.join("\n")).toContain("events could not be read");
    });
});

describe("rebase storage move", () => {
    it("asks for page after page until the folder is done", async () => {
        answers.push(
            { moved: [{ key: "avatars/1.png", outcome: "copied" }, { key: "avatars/2.png", outcome: "exists" }], cursor: "c1" },
            { moved: [{ key: "avatars/3.png", outcome: "failed", error: "too big" }] },
            { checked: 3, notMoved: [{ key: "avatars/3.png", reason: "the target has no copy" }] }
        );
        await storageCommand("move", argv("storage", "move", "--from", "(default)", "--to", "media", "--prefix", "avatars"));

        expect(calls.map(call => call.body)).toEqual([
            { from: "(default)", to: "media", prefix: "avatars", deleteSource: false },
            { from: "(default)", to: "media", prefix: "avatars", cursor: "c1", deleteSource: false },
            { from: "(default)", to: "media", prefix: "avatars", deleteSource: false, limit: 500 }
        ]);
        const text = printed.join("\n").replace(ANSI, "");
        expect(text).toContain("1 copied, 1 already there");
        expect(text).toContain("avatars/3.png: too big");
        expect(process.exitCode).toBe(1);
    });

    it("lists the source again afterwards, and names every file the move left behind", async () => {
        // A walk that skipped files reported success over the half it moved.
        answers.push(
            { moved: [{ key: "a/1.png", outcome: "copied", deleted: true }] },
            { checked: 1, notMoved: [{ key: "a/2.png", reason: "still in the source, and the target has no copy of the same size" }], cursor: "v1" },
            { checked: 1, notMoved: [] }
        );
        await storageCommand("move", argv("storage", "move", "--to", "media", "--delete-source"));

        expect(calls.map(call => call.url.replace("http://rebase.test/api/admin/storage", ""))).toEqual(["/move", "/move/verify", "/move/verify"]);
        expect(calls[2].body).toMatchObject({ to: "media", cursor: "v1", deleteSource: true });
        const text = printed.join("\n").replace(ANSI, "");
        expect(text).toContain("1 copied");
        expect(text).toMatch(/1 file\(s\) were not moved/);
        expect(text).toContain("a/2.png: still in the source");
        expect(process.exitCode).toBe(1);
    });

    it("says so when the move left nothing behind, and in --json", async () => {
        answers.push(
            { moved: [{ key: "a/1.png", outcome: "copied" }] },
            { checked: 1, notMoved: [] }
        );
        await storageCommand("move", argv("storage", "move", "--to", "media", "--json"));
        const json = JSON.parse(printed.join("\n")) as { copied: number; notMoved: unknown[]; verified: boolean };
        expect(json).toMatchObject({ copied: 1, notMoved: [], verified: true });
        expect(process.exitCode).toBeUndefined();
    });

    it("moves anyway against a backend that cannot list the source again, and says it did not check", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined });
            if (url.endsWith("/move/verify")) {
                return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not Found" } }), { status: 404 });
            }
            return new Response(JSON.stringify({ data: { moved: [{ key: "a/1.png", outcome: "copied" }] } }), { status: 200 });
        }));
        await storageCommand("move", argv("storage", "move", "--to", "media"));
        const text = printed.join("\n").replace(ANSI, "");
        expect(text).toContain("1 copied");
        expect(text).toContain("did not check");
        expect(process.exitCode).toBeUndefined();
    });

    it("names the flag a typo was one swap away from, and sends nothing", async () => {
        await expect(storageCommand("move", argv("storage", "move", "--form", "(default)", "--to", "media")))
            .rejects.toThrow("`rebase storage move` has no option --form — did you mean --from? Nothing was run.");
        await expect(storageCommand("orphans", argv("storage", "orphans", "--older-then", "48")))
            .rejects.toThrow(/did you mean --older-than\?/);
        expect(calls).toEqual([]);
    });

    it("needs at least one source named", async () => {
        await expect(storageCommand("move", argv("storage", "move"))).rejects.toThrow(/--from/);
        expect(calls).toEqual([]);
    });
});

describe("with no server to reach", () => {
    it("sends the service key nowhere — not to .env's PORT", async () => {
        // Every scaffold writes PORT=3001, and with `rebase dev` stopped that
        // was where the key went: to whatever else listened there.
        const saved = project.env;
        project.env = { REBASE_SERVICE_KEY: "svc_this_project", PORT: "3001" };
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as never);
        try {
            await expect(storageCommand("orphans", argv("storage", "orphans"))).rejects.toThrow("exit:1");
        } finally {
            project.env = saved;
        }

        expect(calls).toEqual([]);
        expect(printed.join("\n").replace(ANSI, "")).toContain("not running");
    });
});
