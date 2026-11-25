/**
 * Log lines as a model reads them (`src/log-lines.ts`): the record's own
 * time, its severity, the pod only when several wrote, the component, the
 * message, then `key=value` — never the kubelet's second timestamp or the
 * quoting of every key.
 */
import { describe, expect, it } from "vitest";
import { compactLogLines, compactOutputLines, compactRecord, formatFieldValue, logReadBody, podShortName } from "../src/log-lines";

const kubelet = "2026-11-24T14:30:32.999999999Z";

describe("compactRecord", () => {
    it("drops the keys it printed and writes the rest as key=value", () => {
        expect(compactRecord(JSON.stringify({
            severity: "ERROR", message: "Request failed", timestamp: "2026-11-24T14:30:32.126Z", component: "http",
            requestId: "r-1", errorMessage: "duplicate key value", error: { name: "PostgresError", code: "23505" }
        }))).toBe('2026-11-24T14:30:32.126Z ERROR [http] Request failed requestId=r-1 errorMessage="duplicate key value" error={"name":"PostgresError","code":"23505"}');
    });

    it("writes a request as method, path, status and latency, keeping a route that differs from the path", () => {
        expect(compactRecord(JSON.stringify({
            severity: "INFO", message: "request", timestamp: "t", method: "PATCH", path: "/api/data/rooms/1",
            route: "/api/data/:table/:id", status: 200, latencyMs: 4, uid: "u1"
        }))).toBe("t INFO PATCH /api/data/rooms/1 200 4ms route=/api/data/:table/:id uid=u1");
    });

    it("takes a numeric level and the kubelet's time when the record has none", () => {
        expect(compactRecord('{"level":40,"msg":"slow"}', { fallbackTime: kubelet })).toBe(`${kubelet} WARN slow`);
    });

    it("is null for anything that is not a JSON object", () => {
        expect(compactRecord("plain")).toBeNull();
        expect(compactRecord("[1]")).toBeNull();
        expect(compactRecord("{not json}")).toBeNull();
    });
});

describe("compactLogLines", () => {
    it("names pods by their short name only when several wrote", () => {
        const one = `${kubelet} [rebase-backend-7d9f-aaaaa] {"severity":"INFO","message":"a","timestamp":"t1"}`;
        const two = `${kubelet} [rebase-backend-7d9f-bbbbb] {"severity":"INFO","message":"b","timestamp":"t2"}`;
        expect(compactLogLines(one)).toBe("t1 INFO a");
        expect(compactLogLines(`${one}\n${two}\n`)).toBe("t1 INFO [aaaaa] a\nt2 INFO [bbbbb] b");
    });

    it("keeps a plain-text line, with its kubelet time", () => {
        expect(compactLogLines(`${kubelet} [rebase-backend-a] Server listening on 3000`)).toBe(`${kubelet} Server listening on 3000`);
    });
});

describe("compactOutputLines", () => {
    it("compacts the lines that are records and leaves the rest", () => {
        expect(compactOutputLines('VITE ready\n{"severity":"INFO","message":"up","timestamp":"t","port":3001}\n'))
            .toBe("VITE ready\nt INFO up port=3001\n");
    });
});

describe("logReadBody", () => {
    it("is a one-line header without the log, a blank line, then the lines", () => {
        expect(logReadBody({
            logs: `${kubelet} [p-1] {"severity":"INFO","message":"m","timestamp":"t"}`,
            pods: [{ pod: "p-1", state: "ok", lines: 1, message: null, hint: null, truncated: false, restarts: null, container: "app" }],
            state: "ok"
        }, { compact: true })).toBe('{"pods":[{"pod":"p-1","state":"ok","lines":1}],"state":"ok"}\n\nt INFO m');
        expect(logReadBody({ logs: "", state: "no_pods" }, { compact: true })).toBe('{"state":"no_pods"}\n\n(no lines)');
    });
});

describe("helpers", () => {
    it("quotes a value only when it has to, and shortens pod names", () => {
        expect(formatFieldValue("a-b")).toBe("a-b");
        expect(formatFieldValue("a b")).toBe('"a b"');
        expect(formatFieldValue(null)).toBe("null");
        expect(podShortName("rebase-backend-7d9f8c6b5-x2k4p")).toBe("x2k4p");
    });
});
