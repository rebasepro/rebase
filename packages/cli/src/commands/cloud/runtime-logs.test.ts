/**
 * `rebase cloud logs --runtime`, once and followed.
 *
 * The bug this file guards: `--runtime --follow` parsed `-f` and printed one
 * snapshot — the command people run while watching a crash simply stopped.
 * Following is a loop of polls against `runtime-logs`, and the hard part is
 * printing each line exactly once while pods restart, roll and drop off the
 * network.
 */
import { describe, expect, it, vi } from "vitest";
import {
    FollowCursor,
    backoffMs,
    followRuntimeLogs,
    grepMatcher,
    lineLevel,
    parseRecords,
    parseSinceFlag,
    recordFilter,
    runtimeLogsPath,
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
function harness(script: Array<RuntimeLogsPage | Error | ((q: RuntimeLogsQuery) => RuntimeLogsPage)>, opts: {
    initial?: RuntimeLogsQuery;
    filter?: (r: LogRecord) => boolean;
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
        { initial: opts.initial ?? {}, filter: opts.filter ?? (() => true) }
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
