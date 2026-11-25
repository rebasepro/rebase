import { describe, expect, it } from "@jest/globals";
import { entriesToJsonLines, formatFieldValue, hasMetadata, pillFields, requestSummary, statusTone } from "../src/components/LogsExplorer/logEntryView";
import type { LogEntry } from "../src/components/LogsExplorer/useLogTail";

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
    id: "log_1",
    timestamp: "2026-08-17T09:41:02.000Z",
    level: "info",
    source: "api",
    message: "a line",
    ...over
});

describe("requestSummary", () => {
    it("reads method, path and status, and the time under either name", () => {
        expect(requestSummary(entry({ metadata: { method: "GET", path: "/a", status: 200, duration: 4 } })))
            .toMatchObject({ method: "GET", path: "/a", status: 200, latencyMs: 4, errorCode: null, rest: {} });
        expect(requestSummary(entry({ metadata: { method: "GET", path: "/a", status: 200, latencyMs: 9, route: "/:id" } })))
            .toMatchObject({ latencyMs: 9, rest: { route: "/:id" } });
    });

    it("is not a request without all three of method, path and status", () => {
        expect(requestSummary(entry())).toBeNull();
        expect(requestSummary(entry({ metadata: { method: "GET", path: "/a" } }))).toBeNull();
        expect(requestSummary(entry({ metadata: { method: "GET", path: "/a", status: "200" } }))).toBeNull();
    });
});

describe("statusTone", () => {
    it("is red for 5xx, amber for 4xx, green for the rest", () => {
        expect(statusTone(503)).toBe("error");
        expect(statusTone(404)).toBe("warn");
        expect(statusTone(304)).toBe("ok");
        expect(statusTone(200)).toBe("ok");
    });
});

describe("pillFields", () => {
    it("puts the most useful fields first and counts the rest", () => {
        const { pills, more } = pillFields({ table: "posts", errorCode: "E1", requestId: "r1", count: 3, uid: "u1", note: "x" });
        expect(pills.map(([k]) => k)).toEqual(["requestId", "errorCode", "uid", "table"]);
        expect(more).toBe(2);
    });

    it("leaves out values that read as nothing", () => {
        const { pills, more } = pillFields({ a: null, b: "", c: {}, d: [], e: 0, f: false });
        expect(pills.map(([k]) => k)).toEqual(["e", "f"]);
        expect(more).toBe(0);
    });
});

describe("formatFieldValue", () => {
    it("shows scalars as they are and structures as JSON", () => {
        expect(formatFieldValue("x")).toBe("x");
        expect(formatFieldValue(3)).toBe("3");
        expect(formatFieldValue({ a: 1 })).toBe("{\"a\":1}");
    });
});

describe("entriesToJsonLines", () => {
    it("writes one JSON object per line, metadata only where there is some", () => {
        const text = entriesToJsonLines([entry({ metadata: { requestId: "r1" } }), entry({ id: "log_2", message: "b", metadata: {} })]);
        const [first, second] = text.split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
        expect(first).toEqual({ timestamp: "2026-08-17T09:41:02.000Z", level: "info", source: "api", message: "a line", metadata: { requestId: "r1" } });
        expect(second).not.toHaveProperty("metadata");
        expect(hasMetadata(entry({ metadata: {} }))).toBe(false);
    });
});
