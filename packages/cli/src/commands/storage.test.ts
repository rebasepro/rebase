/**
 * `rebase storage orphans` and `rebase storage move`, against a fake backend.
 *
 * The server decides what is unused and does the copying; what the command
 * owes is to ask, to never delete without a yes, and to keep asking for the
 * next page of a move until there is none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        requireProjectRoot: () => "/nonexistent/rebase-storage-test",
        readEnvFile: () => ({
            REBASE_SERVICE_KEY: "svc_test_key",
            REBASE_BASE_URL: "http://rebase.test"
        })
    };
});

import { describeOrphanReport, storageCommand, type OrphanReport } from "./storage";

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

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.exitCode = undefined;
});

describe("rebase storage orphans", () => {
    it("lists, with the service key, and deletes nothing", async () => {
        answers.push(report);
        await storageCommand("orphans", argv("storage", "orphans", "--source", "media", "--older-than", "48"));

        expect(calls).toEqual([{
            method: "GET",
            url: "http://rebase.test/api/admin/storage/orphans?olderThanHours=48&storageId=media",
            body: undefined,
            auth: "Bearer svc_test_key"
        }]);
        const text = printed.join("\n").replace(ANSI, "");
        expect(text).toContain("avatars/old.png");
        expect(text).toContain("Nothing was deleted");
    });

    it("does not delete without a yes when there is no terminal to ask", async () => {
        answers.push(report);
        const isTTY = process.stdin.isTTY;
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        try {
            await expect(storageCommand("orphans", argv("storage", "orphans", "--delete"))).rejects.toThrow(/--yes/);
        } finally {
            Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
        }
        expect(calls.map(call => call.method)).toEqual(["GET"]);
    });

    it("deletes with --yes, asking the server to find them again", async () => {
        answers.push(report, { deleted: ["avatars/old.png"], failed: [] });
        await storageCommand("orphans", argv("storage", "orphans", "--delete", "--yes"));
        expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
            "GET http://rebase.test/api/admin/storage/orphans?olderThanHours=24",
            "DELETE http://rebase.test/api/admin/storage/orphans?olderThanHours=24"
        ]);
        expect(printed.join("\n").replace(ANSI, "")).toContain("Deleted 1 file(s)");
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
            { moved: [{ key: "avatars/3.png", outcome: "failed", error: "too big" }] }
        );
        await storageCommand("move", argv("storage", "move", "--from", "(default)", "--to", "media", "--prefix", "avatars"));

        expect(calls.map(call => call.body)).toEqual([
            { from: "(default)", to: "media", prefix: "avatars", deleteSource: false },
            { from: "(default)", to: "media", prefix: "avatars", cursor: "c1", deleteSource: false }
        ]);
        const text = printed.join("\n").replace(ANSI, "");
        expect(text).toContain("1 copied, 1 already there");
        expect(text).toContain("avatars/3.png: too big");
        expect(process.exitCode).toBe(1);
    });

    it("needs at least one source named", async () => {
        await expect(storageCommand("move", argv("storage", "move"))).rejects.toThrow(/--from/);
        expect(calls).toEqual([]);
    });
});
