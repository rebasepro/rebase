/**
 * `rebase logs`: one entry of a server's log buffer as a person reads it —
 * the way `rebase cloud logs --runtime` prints a record, with the metadata of
 * every level on the line, not only of warnings and errors.
 */
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { renderBufferEntry } from "./logs";

const at = (h: number, m: number, s: number, ms: number): string => new Date(2026, 10, 24, h, m, s, ms).toISOString();
const now = new Date(2026, 10, 24, 18, 0, 0);
const plain = (entry: Record<string, unknown>): string => stripVTControlCharacters(renderBufferEntry(entry, now));

describe("renderBufferEntry", () => {
    it("prints time, level, source and message, with an info entry's metadata on the same line", () => {
        expect(plain({
            id: "log_1", timestamp: at(9, 5, 7, 42), level: "info", source: "system",
            message: "Cron job ran", metadata: { job: "nightly", tookMs: 120, note: "two words" }
        })).toBe('09:05:07.042 INFO   [system] Cron job ran  job=nightly tookMs=120 note="two words"');
    });

    it("does not repeat what a request's message already says", () => {
        expect(plain({
            id: "log_2", timestamp: at(9, 5, 7, 42), level: "warn", source: "api",
            message: "GET /api/data/rooms/x 404 16ms — NOT_FOUND: Room x was not found",
            metadata: {
                method: "GET", path: "/api/data/rooms/x", status: 404, duration: 16, requestId: "req-9",
                collection: "rooms", errorCode: "NOT_FOUND", errorMessage: "Room x was not found"
            }
        })).toBe("09:05:07.042 WARN   [api] GET /api/data/rooms/x 404 16ms — NOT_FOUND: Room x was not found  requestId=req-9 collection=rooms");
    });

    it("prints an entry with no metadata as one plain line", () => {
        expect(plain({ id: "log_3", timestamp: at(0, 0, 0, 0), level: "error", source: "auth", message: "Token refresh failed" }))
            .toBe("00:00:00.000 ERROR  [auth] Token refresh failed");
    });
});
