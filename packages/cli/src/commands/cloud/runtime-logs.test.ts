/**
 * `rebase cloud logs --runtime`, once and followed.
 *
 * The bug this file guards: `--runtime --follow` parsed `-f` and printed one
 * snapshot — the command people run while watching a crash simply stopped.
 * Following is a loop of polls against `runtime-logs`, and the hard part is
 * printing each line exactly once while pods restart, roll and drop off the
 * network.
 */
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
    FollowCursor,
    backoffMs,
    clockTime,
    formatFieldValue,
    parseStructured,
    podShortName,
    renderLine,
    filterThenTail,
    followRuntimeLogs,
    grepMatcher,
    lineLevel,
    parseRecords,
    parseSinceFlag,
    recordFilter,
    runtimeLogsPath,
    tailPerPod,
    type FollowEvent,
    type LogRecord,
    type RuntimeLogsPage,
    type RuntimeLogsQuery
} from "./runtime-logs";

const T = (s: number, nanos = "000000000"): string =>
    `2026-10-24T10:00:${String(s).padStart(2, "0")}.${nanos}Z`;
const line = (ts: string, pod: string, text: string): string => `${ts} [${pod}] ${text}`;

describe("parseSinceFlag", () => {
    it("reads durations as seconds", () => {
        expect(parseSinceFlag("30s")).toEqual({ sinceSeconds: 30 });
        expect(parseSinceFlag("5m")).toEqual({ sinceSeconds: 300 });
        expect(parseSinceFlag("1h")).toEqual({ sinceSeconds: 3600 });
        expect(parseSinceFlag("90")).toEqual({ sinceSeconds: 90 });
    });

    it("reads an RFC3339 instant as a cursor", () => {
        expect(parseSinceFlag("2026-10-24T09:30:00Z")).toEqual({ sinceTime: "2026-10-24T09:30:00.000Z" });
        expect(parseSinceFlag("2026-10-24T11:30:00+02:00")).toEqual({ sinceTime: "2026-10-24T09:30:00.000Z" });
    });

    it("refuses what is neither, rather than inventing a date", () => {
        expect(parseSinceFlag("yesterday")).toBeNull();
        expect(parseSinceFlag("May")).toBeNull();
        expect(parseSinceFlag("2026-10-24")).toBeNull();
        expect(parseSinceFlag("2026-13-45T99:99:00Z")).toBeNull();
    });
});

describe("runtimeLogsPath", () => {
    it("sends the cursor, never both windows, and always asks for timestamps", () => {
        const path = runtimeLogsPath("p1", { sinceTime: T(1), sinceSeconds: 30, tailLines: 2000, preview: "new-quiz" });
        const params = new URLSearchParams(path.split("?")[1]);
        expect(path.startsWith("p1?")).toBe(true);
        expect(params.get("sinceTime")).toBe(T(1));
        expect(params.has("sinceSeconds")).toBe(false);
        expect(params.get("tailLines")).toBe("2000");
        expect(params.get("preview")).toBe("new-quiz");
        expect(params.get("timestamps")).toBe("true");
    });
});

describe("--grep and --level", () => {
    const rec = (text: string, pod = "backend-a"): LogRecord => {
        const raw = line(T(1), pod, text);
        return parseRecords(raw)[0];
    };

    it("--grep is a case-insensitive substring of the whole line, pod included", () => {
        expect(grepMatcher("timeout")("GET /x TIMEOUT after 30s")).toBe(true);
        expect(grepMatcher("timeout")("all good")).toBe(false);
        expect(recordFilter({ grep: "backend-b" })(rec("hello", "backend-b"))).toBe(true);
        // A substring, not a pattern: `?` and `.` mean themselves.
        expect(grepMatcher("/users?id=1")("GET /users?id=1 200")).toBe(true);
        expect(grepMatcher("a.c")("abc")).toBe(false);
    });

    it("--grep /re/ is a regular expression", () => {
        expect(grepMatcher("/5\\d\\d/")("GET / 503")).toBe(true);
        expect(grepMatcher("/5\\d\\d/")("GET / 200")).toBe(false);
        expect(grepMatcher("/error/i")("ERROR boom")).toBe(true);
        expect(grepMatcher("/error/")("ERROR boom")).toBe(false);
    });

    it("reads severity the way the console does, plus `cloud debug errors`' shapes", () => {
        expect(lineLevel('{"severity":"ERROR","message":"boom"}')).toBe("error");
        expect(lineLevel('{"level":40,"msg":"slow"}')).toBe("warn");
        expect(lineLevel('{"severity":"INFO","message":"Server running"}')).toBe("info");
        expect(lineLevel("WARN: pool nearly exhausted")).toBe("warn");
        expect(lineLevel("[debug] cache miss")).toBe("debug");
        expect(lineLevel("TypeError: Cannot read properties of undefined")).toBe("error");
        expect(lineLevel("Server listening on 3000")).toBe("unknown");
    });

    it("--level is a floor: warn keeps warnings and errors, not info or unlevelled lines", () => {
        const keep = recordFilter({ level: "warn" });
        expect(keep(rec('{"severity":"ERROR","message":"boom"}'))).toBe(true);
        expect(keep(rec('{"severity":"WARNING","message":"slow"}'))).toBe(true);
        expect(keep(rec('{"severity":"INFO","message":"ok"}'))).toBe(false);
        expect(keep(rec("Server listening on 3000"))).toBe(false);
        expect(recordFilter({ level: "error" })(rec('{"severity":"WARN","message":"slow"}'))).toBe(false);
    });

    it("both together must both match", () => {
        const keep = recordFilter({ level: "error", grep: "db" });
        expect(keep(rec('{"severity":"ERROR","message":"db down"}'))).toBe(true);
        expect(keep(rec('{"severity":"ERROR","message":"cache down"}'))).toBe(false);
    });
});

describe("renderLine: a structured record as a person reads it", () => {
    // Local time is printed; the fixtures are built from local time so the
    // suite passes in any zone.
    const at = (h: number, m: number, sec: number, ms: number): string => new Date(2026, 10, 24, h, m, sec, ms).toISOString();
    const now = new Date(2026, 10, 24, 18, 0, 0);
    const kubelet = "2026-11-24T14:30:32.999999999Z";
    const rec = (text: string, pod = "rebase-backend-7d9f8c6b5-x2k4p"): LogRecord => parseRecords(line(kubelet, pod, text))[0];
    const plain = (r: LogRecord, opts: Parameters<typeof renderLine>[1] = {}): string =>
        stripVTControlCharacters(renderLine(r, { now, ...opts }));

    it("prints the record's own time, its level, component, message and fields", () => {
        const text = JSON.stringify({ severity: "WARNING", message: "pool nearly exhausted", timestamp: at(14, 30, 32, 126), component: "db", used: 9, max: 10, note: "two words" });
        expect(plain(rec(text))).toBe('14:30:32.126 WARN   [db] pool nearly exhausted  used=9 max=10 note="two words"');
    });

    it("prints a request line as method, path, status and latency, then what else it carries", () => {
        const text = JSON.stringify({
            severity: "WARNING", message: "request", timestamp: at(9, 1, 2, 3), component: "http",
            method: "GET", path: "/api/data/rooms/abc", route: "/api/data/:table/:id", status: 404, latencyMs: 16,
            requestId: "req-1", uid: null, errorCode: "NOT_FOUND", errorMessage: "Room abc was not found"
        });
        expect(plain(rec(text))).toBe(
            '09:01:02.003 WARN   [http] GET /api/data/rooms/abc 404 16ms  route=/api/data/:table/:id requestId=req-1 uid=null errorCode=NOT_FOUND errorMessage="Room abc was not found"'
        );
        // A route that is the path says nothing more.
        const same = JSON.stringify({ severity: "INFO", message: "request", timestamp: at(9, 1, 2, 3), method: "GET", path: "/health", route: "/health", status: 200, latencyMs: 1 });
        expect(plain(rec(same))).toBe("09:01:02.003 INFO   GET /health 200 1ms");
    });

    it("names the pod by its short name only when the read spans several", () => {
        const text = JSON.stringify({ severity: "INFO", message: "ready", timestamp: at(1, 2, 3, 4) });
        expect(plain(rec(text), { showPod: true })).toBe("01:02:03.004 x2k4p INFO   ready");
        expect(plain(rec(text))).toBe("01:02:03.004 INFO   ready");
        expect(podShortName("rebase-backend-7d9f8c6b5-x2k4p")).toBe("x2k4p");
        expect(podShortName("rebase-app-p1")).toBe("p1");
        expect(podShortName("single")).toBe("single");
    });

    it("falls back to the kubelet's time, and dates a line from another day", () => {
        const noTime = JSON.stringify({ severity: "ERROR", message: "boom" });
        const kubeletLocal = new Date(Date.parse(kubelet));
        expect(plain(rec(noTime), { now: kubeletLocal })).toMatch(/^\d\d:\d\d:\d\d\.999 ERROR {2}boom$/);
        expect(clockTime(at(23, 59, 59, 1), new Date(2026, 10, 25, 1, 0, 0))).toBe("2026-11-24 23:59:59.001");
        expect(clockTime("not a time")).toBeNull();
    });

    it("puts a stack trace on the lines below, not inside the line", () => {
        const text = JSON.stringify({
            severity: "ERROR", message: "Request failed", timestamp: at(1, 0, 0, 0), component: "http",
            error: { name: "TypeError", message: "x is undefined", stack: "TypeError: x is undefined\n    at f (a.ts:1:2)" }
        });
        expect(plain(rec(text)).split("\n")).toEqual([
            '01:00:00.000 ERROR  [http] Request failed  error={"name":"TypeError","message":"x is undefined"}',
            "    TypeError: x is undefined",
            "    at f (a.ts:1:2)"
        ]);
    });

    it("colours by level and leaves a plain-text line exactly as it came", () => {
        const plainText = rec("Server listening on 3000");
        expect(stripVTControlCharacters(renderLine(plainText))).toBe(plainText.raw);
        const notAnObject = rec("[1,2,3]");
        expect(stripVTControlCharacters(renderLine(notAnObject))).toBe(notAnObject.raw);
    });

    it("quotes a value only when it has to", () => {
        expect(formatFieldValue("abc-1")).toBe("abc-1");
        expect(formatFieldValue("a b")).toBe('"a b"');
        expect(formatFieldValue("")).toBe('""');
        expect(formatFieldValue('say "hi"')).toBe('"say \\"hi\\""');
        expect(formatFieldValue("k=v")).toBe('"k=v"');
        expect(formatFieldValue(3)).toBe("3");
        expect(formatFieldValue(false)).toBe("false");
        expect(formatFieldValue({ a: [1] })).toBe('{"a":[1]}');
    });

    it("parses the severity spellings the level rules know, keeping the word as written", () => {
        expect(parseStructured('{"severity":"WARNING","message":"m"}')).toMatchObject({ level: "warn", severity: "WARNING" });
        expect(parseStructured('{"level":50,"msg":"m"}')).toMatchObject({ level: "error", severity: "50", message: "m" });
        expect(parseStructured('{"message":"m"}')).toMatchObject({ level: "unknown", severity: null });
        expect(parseStructured("plain")).toBeNull();
    });
});

describe("FollowCursor", () => {
    it("prints a line that two overlapping polls both return only once", () => {
        const c = new FollowCursor();
        const a = line(T(1), "p", "one");
        const b = line(T(2), "p", "two");
        expect(c.admit(parseRecords([a, b].join("\n"))).map((r) => r.text)).toEqual(["one", "two"]);
        // The next poll starts a millisecond early, so it returns `two` again.
        expect(c.sinceTime()).toBe("2026-10-24T10:00:01.999Z");
        const d = line(T(3), "p", "three");
        expect(c.admit(parseRecords([b, d].join("\n"))).map((r) => r.text)).toEqual(["three"]);
    });

    it("keeps a second line written in the same millisecond as the cursor", () => {
        // The control plane compares at millisecond precision; Kubernetes writes
        // nanoseconds. Asking from the cursor itself would drop this line.
        const c = new FollowCursor();
        const first = line(T(5, "123000001"), "p", "first");
        c.admit(parseRecords(first));
        const second = line(T(5, "123999999"), "p", "second");
        expect(c.admit(parseRecords([first, second].join("\n"))).map((r) => r.text)).toEqual(["second"]);
    });

    it("drops what is older than the cursor, from any pod", () => {
        const c = new FollowCursor();
        c.admit(parseRecords(line(T(9), "a", "late")));
        expect(c.admit(parseRecords(line(T(8), "b", "old")))).toEqual([]);
    });

    it("prints a line it cannot place, rather than lose it", () => {
        const c = new FollowCursor();
        c.admit(parseRecords(line(T(9), "a", "x")));
        expect(c.admit(parseRecords("no timestamp here")).map((r) => r.raw)).toEqual(["no timestamp here"]);
    });
});

describe("backoffMs", () => {
    it("doubles from the poll interval and stops at 30s", () => {
        expect([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n))).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    });
});

/** A follow driven by a script of answers; aborts once the script runs out. */
/**
 * `since: "6h", tail: 40, grep: "TRDQ"` found nothing while `tail: 2000`
 * found the line from two hours back: the tail was taken first, and the
 * filter saw only the newest 40 lines. The filter now runs over everything
 * the control plane returned, and `tail` counts matches.
 */
describe("filterThenTail", () => {
    const pageOf = (logs: string[], pods: Array<{ pod: string; lines?: number; truncated?: boolean; state?: string }>, extra: Partial<RuntimeLogsPage> = {}): RuntimeLogsPage => ({
        logs: logs.join("\n"),
        state: "ok",
        pods: pods.map((p) => ({
            pod: p.pod,
            state: p.state ?? "ok",
            lines: p.lines ?? logs.filter((l) => l.includes(`[${p.pod}]`)).length,
            message: null,
            hint: null,
            truncated: p.truncated ?? false
        })),
        ...extra
    });
    /** 963 lines over the window, one of them the match, far from the end. */
    const window = Array.from({ length: 963 }, (_, i) =>
        line(new Date(Date.UTC(2026, 10, 10, 6, 0, i)).toISOString(), "a", i === 100 ? "POST /api/rooms TRDQ joined" : `GET /health ${i}`));

    it("finds a match older than the newest `tail` lines", () => {
        const read = filterThenTail(pageOf(window, [{ pod: "a" }]), recordFilter({ grep: "TRDQ" }), 40);
        expect(read.records.map((r) => r.text)).toEqual(["POST /api/rooms TRDQ joined"]);
        expect(read).toMatchObject({ scannedLines: 963, matchedLines: 1, returnedLines: 1, scanCapped: false, note: null });
    });

    it("takes /regex/flags the same way", () => {
        const read = filterThenTail(pageOf(window, [{ pod: "a" }]), recordFilter({ grep: "/POST|TRDQ/" }), 40);
        expect(read.records.map((r) => r.text)).toEqual(["POST /api/rooms TRDQ joined"]);
    });

    it("keeps the newest `tail` matches per pod, and counts per pod what this answer holds", () => {
        const logs = [
            line(T(1), "a", "hit 1"), line(T(2), "b", "hit 2"), line(T(3), "a", "miss"),
            line(T(4), "a", "hit 3"), line(T(5), "a", "hit 4"), line(T(6), "b", "hit 5")
        ];
        const read = filterThenTail(pageOf(logs, [{ pod: "a" }, { pod: "b" }]), recordFilter({ grep: "hit" }), 2);
        expect(read.records.map((r) => r.text)).toEqual(["hit 2", "hit 3", "hit 4", "hit 5"]);
        expect(read.pods.map((p) => [p.pod, p.lines, p.matchedLines, p.scannedLines])).toEqual([["a", 2, 3, 4], ["b", 2, 2, 2]]);
        expect(read).toMatchObject({ scannedLines: 6, matchedLines: 5, returnedLines: 4 });
    });

    it("says when a pod filled the line ceiling, so older lines went unsearched", () => {
        const logs = [line(T(1), "a", "x"), line(T(2), "a", "y"), line(T(3), "b", "x")];
        const read = filterThenTail(pageOf(logs, [{ pod: "a" }, { pod: "b" }]), recordFilter({ grep: "nomatch" }), 40, 2);
        expect(read.records).toEqual([]);
        expect(read.scanCapped).toBe(true);
        expect(read.pods.map((p) => [p.pod, p.scanCapped])).toEqual([["a", true], ["b", false]]);
        expect(read.note).toContain(`a from ${T(1)}`);
        expect(read.note).toContain("not searched");
    });

    it("says when a byte budget cut a pod or the page", () => {
        const logs = [line(T(1), "a", "x")];
        expect(filterThenTail(pageOf(logs, [{ pod: "a", truncated: true }]), () => true, 40).scanCapped).toBe(true);
        const page = filterThenTail(pageOf(logs, [{ pod: "a" }], { truncated: true }), () => true, 40);
        expect(page.scanCapped).toBe(true);
        expect(page.note).toContain("byte budget");
    });

    it("does not call a pod that is not running capped", () => {
        const read = filterThenTail(pageOf([], [{ pod: "a", state: "not_ready", lines: 0 }]), () => true, 40, 0);
        expect(read.scanCapped).toBe(false);
    });
});

describe("tailPerPod", () => {
    it("keeps each pod's newest lines, in their order", () => {
        const recs = parseRecords([line(T(1), "a", "1"), line(T(2), "b", "2"), line(T(3), "a", "3"), "bare 4", "bare 5"].join("\n"));
        expect(tailPerPod(recs, 1).map((r) => r.text)).toEqual(["2", "3", "bare 5"]);
    });
});

function harness(script: Array<RuntimeLogsPage | Error | ((q: RuntimeLogsQuery) => RuntimeLogsPage)>, opts: {
    initial?: RuntimeLogsQuery;
    filter?: (r: LogRecord) => boolean;
    initialTail?: number;
    transient?: (e: unknown) => boolean;
    /** Called on each sleep, with the controller — a Ctrl-C mid-wait. */
    onSleep?: (controller: AbortController) => void;
} = {}) {
    const controller = new AbortController();
    const queries: RuntimeLogsQuery[] = [];
    const printed: string[] = [];
    const events: FollowEvent[] = [];
    const sleeps: number[] = [];
    let clock = 0;
    let i = 0;
    const run = followRuntimeLogs(
        {
            fetch: async (q) => {
                queries.push(q);
                const step = script[i++];
                // Past the script: stop. This answer is the one an abort discards.
                if (step === undefined) {
                    controller.abort();
                    return { state: "ok", logs: "", pods: [] };
                }
                if (step instanceof Error) throw step;
                return typeof step === "function" ? step(q) : step;
            },
            sleep: async (ms) => {
                sleeps.push(ms);
                clock += ms;
                opts.onSleep?.(controller);
            },
            signal: controller.signal,
            sink: { line: (r) => printed.push(r.raw), event: (e) => events.push(e) },
            now: () => clock,
            isTransient: opts.transient ?? (() => true)
        },
        {
            initial: opts.initial ?? {},
            filter: opts.filter ?? (() => true),
            ...(opts.initialTail !== undefined ? { initialTail: opts.initialTail } : {})
        }
    );
    return { run, queries, printed, events, sleeps, controller };
}

const ok = (logs: string[], pods: Array<{ pod: string; restarts?: number | null; state?: string; lines?: number }> = [{ pod: "p" }]): RuntimeLogsPage => ({
    logs: logs.join("\n"),
    state: "ok",
    pods: pods.map((p) => ({ pod: p.pod, state: p.state ?? "ok", lines: p.lines ?? logs.length, message: null, hint: null, restarts: p.restarts ?? 0 }))
});

describe("followRuntimeLogs", () => {
    it("polls more than once — the original bug printed one snapshot and stopped", async () => {
        const h = harness([ok([line(T(1), "p", "a")]), ok([line(T(2), "p", "b")]), ok([])]);
        await h.run;
        expect(h.queries.length).toBeGreaterThanOrEqual(2);
    });

    it("prints every line once across overlapping polls, and passes the cursor back", async () => {
        const a = line(T(1), "p", "a");
        const b = line(T(2), "p", "b");
        const c = line(T(3), "p", "c");
        const h = harness([ok([a, b]), ok([b, c]), ok([c])], { initial: { tailLines: 100 } });
        await h.run;
        expect(h.printed).toEqual([a, b, c]);
        expect(h.queries[0]).toEqual({ tailLines: 100 });
        expect(h.queries[1]).toMatchObject({ sinceTime: "2026-10-24T10:00:01.999Z", tailLines: 2000 });
        expect(h.queries[2]).toMatchObject({ sinceTime: "2026-10-24T10:00:02.999Z" });
        // Never both windows at once — the route refuses that.
        for (const q of h.queries.slice(1)) expect(q.sinceSeconds).toBeUndefined();
        expect(h.sleeps.every((ms) => ms === 2000)).toBe(true);
    });

    it("stops as soon as it is aborted, between polls", async () => {
        const h = harness([ok([]), ok([]), ok([]), ok([])], { onSleep: (c) => c.abort() });
        await h.run;
        expect(h.queries).toHaveLength(1);
    });

    it("asks for the time since the last poll while nothing has been printed yet", async () => {
        const h = harness([ok([]), ok([]), ok([line(T(1), "p", "first")])], { initial: { sinceSeconds: 300 } });
        await h.run;
        expect(h.queries[0]).toEqual({ sinceSeconds: 300 });
        // 2s on the fake clock, rounded up, plus a second for rounding.
        expect(h.queries[1]).toMatchObject({ sinceSeconds: 3 });
        expect(h.printed).toEqual([line(T(1), "p", "first")]);
    });

    it("applies --grep/--level to what it prints, never to the cursor", async () => {
        const noisy = line(T(1), "p", "noise");
        const wanted = line(T(2), "p", "wanted");
        const h = harness([ok([noisy]), ok([noisy, wanted]), ok([wanted])], {
            filter: (r) => r.text.includes("wanted")
        });
        await h.run;
        expect(h.printed).toEqual([wanted]);
        expect(h.queries[1].sinceTime).toBe("2026-10-24T10:00:00.999Z");
    });

    it("waits through no pods, says so once, and announces the pod that starts", async () => {
        const noPods: RuntimeLogsPage = { state: "no_pods", message: "No pods are running.", logs: "" };
        const h = harness([noPods, noPods, ok([line(T(4), "backend-new", "Server running")], [{ pod: "backend-new" }]), ok([])]);
        await h.run;
        expect(h.events.filter((e) => e.event === "no_pods")).toHaveLength(1);
        expect(h.events).toContainEqual({ event: "pod_added", pod: "backend-new" });
        expect(h.printed).toEqual([line(T(4), "backend-new", "Server running")]);
    });

    it("announces a rolling deploy: the new pod starts, the old one goes", async () => {
        const h = harness([
            ok([line(T(1), "old", "a")], [{ pod: "old" }]),
            ok([line(T(2), "old", "b"), line(T(3), "new", "c")], [{ pod: "old" }, { pod: "new" }]),
            ok([line(T(4), "new", "d")], [{ pod: "new" }])
        ]);
        await h.run;
        expect(h.events).toEqual([{ event: "pod_added", pod: "new" }, { event: "pod_removed", pod: "old" }]);
        expect(h.printed.map((l) => l.slice(-1))).toEqual(["a", "b", "c", "d"]);
    });

    it("reads a restarted container's previous instance once, so the crash reason is printed", async () => {
        const before = line(T(1), "p", "handling request");
        const crash = line(T(2), "p", '{"severity":"ERROR","message":"out of memory"}');
        const reboot = line(T(5), "p", "Server running");
        const h = harness([
            ok([before], [{ pod: "p", restarts: 0 }]),
            (q) => (q.previous
                ? ok([before, crash], [{ pod: "p", restarts: 1 }])
                : ok([reboot], [{ pod: "p", restarts: 1 }])),
            (q) => (q.previous
                ? ok([before, crash], [{ pod: "p", restarts: 1 }])
                : ok([reboot], [{ pod: "p", restarts: 1 }])),
            ok([], [{ pod: "p", restarts: 1 }])
        ]);
        await h.run;
        expect(h.printed).toEqual([before, crash, reboot]);
        expect(h.events).toContainEqual({ event: "pod_restarted", pod: "p", restarts: 1, missed: 0 });
        expect(h.queries.filter((q) => q.previous)).toHaveLength(1);
        // Over the same window as the poll that saw the restart.
        expect(h.queries[2]).toMatchObject({ previous: true, sinceTime: h.queries[1].sinceTime });
    });

    it("says a pod stopped running once, not on every poll", async () => {
        const looping = { pod: "p", state: "not_ready", lines: 0 };
        const h = harness([ok([line(T(1), "p", "a")]), ok([], [looping]), ok([], [looping]), ok([line(T(9), "p", "b")])]);
        await h.run;
        const states = h.events.filter((e) => e.event === "pod_state");
        expect(states).toEqual([
            { event: "pod_state", pod: "p", state: "not_ready", message: null },
            { event: "pod_state", pod: "p", state: "ok", message: null }
        ]);
    });

    it("backs off through a network blip and resumes from the same cursor, losing nothing", async () => {
        const a = line(T(1), "p", "a");
        const b = line(T(2), "p", "b");
        const blip = Object.assign(new Error("fetch failed"), {});
        const h = harness([ok([a]), blip, blip, ok([a, b]), ok([])]);
        await h.run;
        expect(h.printed).toEqual([a, b]);
        expect(h.sleeps.slice(1, 3)).toEqual([2000, 4000]);
        expect(h.events.filter((e) => e.event === "reconnecting")).toHaveLength(2);
        expect(h.events).toContainEqual({ event: "reconnected" });
        expect(h.queries[3].sinceTime).toBe(h.queries[1].sinceTime);
    });

    it("ends on a refusal instead of retrying it forever", async () => {
        const denied = Object.assign(new Error("Forbidden"), { status: 403 });
        const h = harness([ok([]), denied, ok([])], { transient: (e) => (e as { status?: number }).status !== 403 });
        await expect(h.run).rejects.toThrow("Forbidden");
    });

    it("says when a burst outran one poll", async () => {
        const h = harness([ok([line(T(1), "p", "a")]), ok([line(T(2), "p", "b")], [{ pod: "p", lines: 2000 }]), ok([])]);
        await h.run;
        expect(h.events.some((e) => e.event === "truncated")).toBe(true);
    });

    it("gives a hung request up and retries it", async () => {
        vi.useFakeTimers();
        try {
            const controller = new AbortController();
            let calls = 0;
            const events: FollowEvent[] = [];
            const run = followRuntimeLogs(
                {
                    fetch: () => {
                        calls += 1;
                        if (calls >= 2) controller.abort();
                        return calls === 1 ? new Promise<RuntimeLogsPage>(() => {}) : Promise.resolve(ok([]));
                    },
                    sleep: async () => {},
                    signal: controller.signal,
                    sink: { line: () => {}, event: (e) => events.push(e) },
                    now: () => 0,
                    isTransient: () => false,
                    pollTimeoutMs: 1000
                },
                { initial: {}, filter: () => true }
            );
            await vi.advanceTimersByTimeAsync(1500);
            await run;
            expect(calls).toBe(2);
            expect(events[0]).toMatchObject({ event: "reconnecting" });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("followRuntimeLogs, filtered", () => {
    it("prints the newest `initialTail` matches of the first poll, then every new match", async () => {
        const first = [line(T(1), "p", "hit 1"), line(T(2), "p", "miss"), line(T(3), "p", "hit 2"), line(T(4), "p", "hit 3")];
        const h = harness([ok(first), ok([line(T(5), "p", "hit 4"), line(T(6), "p", "hit 5")])], {
            filter: recordFilter({ grep: "hit" }),
            initialTail: 2
        });
        await h.run;
        expect(h.printed).toEqual([line(T(3), "p", "hit 2"), line(T(4), "p", "hit 3"), line(T(5), "p", "hit 4"), line(T(6), "p", "hit 5")]);
    });
});
