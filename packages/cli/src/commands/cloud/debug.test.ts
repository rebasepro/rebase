/**
 * Tests for `rebase cloud debug`.
 *
 * The guarantees worth pinning here are the ones that make the command
 * trustworthy rather than merely present:
 *
 *   1. A status code is INTERPRETED, and the interpretation is the load-bearing
 *      part — a 404 on the functions route and a 200 on an unauthenticated read
 *      are the two findings this command exists to surface, and neither is
 *      classified as healthy.
 *   2. `health` fails the process when a probe fails, so it works in a script.
 *   3. Nothing here mutates, and `db` never reaches the password endpoint.
 *   4. The subcommand is read from the dispatcher's positional, not re-derived
 *      by indexing rawArgs (the mistake that silently orphaned `storage create`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    PROBES,
    runProbe,
    overallVerdict,
    parseSince,
    formatDuration,
    parseLogLine,
    isErrorLine,
    isBootLine,
    parseRequestLine,
    functionNames,
    resolveTail,
    assessCoverage,
    bootReach,
    formatSpan,
    printDebugHelp,
    SERVER_MAX_TAIL_LINES,
    LOG_VIEW_FLAGS,
    REQUESTS_FLAGS,
    HEALTH_FLAGS,
    type RuntimeLogsResponse,
    type ProbeResult,
    type Verdict
} from "./debug";
import { setJsonModeForTest } from "./context";

/* ── helpers ────────────────────────────────────────────────────── */

function probe(id: string) {
    const spec = PROBES.find((p) => p.id === id);
    if (!spec) throw new Error(`no probe ${id}`);
    return spec;
}

/** Verdict this probe assigns to a status code. */
function verdictFor(id: string, status: number | null): Verdict {
    return probe(id).interpret(status).verdict;
}

function captureStdout(): { output: () => string; restore: () => void } {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    return { output: () => chunks.join(""),
restore: () => { process.stdout.write = orig; } };
}

/* ═══════════════════════════════════════════════════════════════
   Probe interpretation — the heart of the command
   ═══════════════════════════════════════════════════════════════ */

describe("functions probe (the misrouted-mount detector)", () => {
    /**
     * The probe MUST target the router's listing endpoint, not a function path.
     *
     * A function is a Hono sub-app that usually defines only sub-routes, so
     * `/api/functions/<name>` 404s even on a completely healthy deployment —
     * verified against a live project, where `/api/functions/doc-content` gave
     * 404 while `/api/functions/doc-content/get` gave 401 and the listing
     * returned all six functions. An earlier draft probed the function path and
     * reported "the functions router did not mount" for a deployment that was
     * fine. This pins the endpoint so that cannot come back.
     */
    it("probes the listing endpoint, never a function's own path", () => {
        expect(probe("functions").path({ collection: "users",
fn: "doc-content" })).toBe("/api/functions");
    });

    it("treats 200 as mounted", () => {
        expect(verdictFor("functions", 200)).toBe("ok");
    });

    it("treats 401 as mounted too — a gated listing still proves the router is there", () => {
        expect(verdictFor("functions", 401)).toBe("ok");
        expect(probe("functions").interpret(401).meaning).toMatch(/mounted/i);
    });

    it("treats 404 on the listing as a genuinely absent router", () => {
        const reading = probe("functions").interpret(404);
        expect(reading.verdict).toBe("fail");
        expect(reading.meaning).toMatch(/did not mount/i);
    });

    describe("refine, against the listing body", () => {
        const t = (fn?: string) => ({ collection: "users",
fn });
        const listing = { functions: [{ name: "doc-content" }, { name: "hello" }] };

        it("counts the loaded functions when no name was asked for", () => {
            const reading = probe("functions").refine!(listing, t());
            expect(reading?.verdict).toBe("ok");
            expect(reading?.meaning).toMatch(/loaded 2 functions/);
        });

        it("confirms a named function that is present", () => {
            const reading = probe("functions").refine!(listing, t("doc-content"));
            expect(reading?.verdict).toBe("ok");
            expect(reading?.meaning).toMatch(/including doc-content/);
        });

        it("fails a named function that is absent, and says what DID load", () => {
            const reading = probe("functions").refine!(listing, t("nope"));
            expect(reading?.verdict).toBe("fail");
            expect(reading?.meaning).toMatch(/no function is named "nope"/);
            expect(reading?.meaning).toMatch(/doc-content, hello/);
        });

        /**
         * The status was a perfectly good 200 — the body is what failed. The
         * summary keys off `statusOk` so it does not tell the operator to
         * expect a 200 they already received.
         */
        it("records statusOk when only the body failed the probe", async () => {
            vi.stubGlobal("fetch", vi.fn(async () =>
                new Response(JSON.stringify(listing), { status: 200 })));
            const res = await runProbe("https://x.example", probe("functions"), t("nope"));
            expect(res.verdict).toBe("fail");
            expect(res.statusOk).toBe(true);
            vi.unstubAllGlobals();
        });

        it("records statusOk=false when the status itself was wrong", async () => {
            vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
            const res = await runProbe("https://x.example", probe("functions"), t());
            expect(res.verdict).toBe("fail");
            expect(res.statusOk).toBe(false);
            vi.unstubAllGlobals();
        });

        it("defers to the status reading when the body is not a listing", () => {
            expect(probe("functions").refine!({ nope: true }, t())).toBeNull();
            expect(probe("functions").refine!(null, t())).toBeNull();
        });
    });
});

describe("functionNames", () => {
    it("extracts names from a listing", () => {
        expect(functionNames({ functions: [{ name: "a" }, { name: "b" }] })).toEqual(["a", "b"]);
    });
    it("returns null for anything that is not a listing", () => {
        expect(functionNames({})).toBeNull();
        expect(functionNames("nope")).toBeNull();
        expect(functionNames(undefined)).toBeNull();
    });
    it("returns null rather than a partial list when an entry has no name", () => {
        expect(functionNames({ functions: [{ name: "a" }, { endpoint: "/x" }] })).toBeNull();
    });
});

describe("unauthenticated read probe", () => {
    it("treats 401 as healthy (RLS enforced)", () => {
        expect(verdictFor("unauthRead", 401)).toBe("ok");
    });

    it("WARNS on 200 rather than calling a public collection healthy", () => {
        const reading = probe("unauthRead").interpret(200);
        expect(reading.verdict).toBe("warn");
        expect(reading.meaning).toMatch(/NO authentication/);
    });

    it("blames RLS on a 500, which is where that failure actually comes from", () => {
        const reading = probe("unauthRead").interpret(500);
        expect(reading.verdict).toBe("fail");
        expect(reading.meaning).toMatch(/RLS policy/i);
    });
});

describe("auth probe", () => {
    it("treats 400 as healthy — an empty login body must be rejected", () => {
        expect(verdictFor("auth", 400)).toBe("ok");
    });

    it("treats 200 as a FAILURE — an empty login must never succeed", () => {
        const reading = probe("auth").interpret(200);
        expect(reading.verdict).toBe("fail");
        expect(reading.meaning).toMatch(/never succeed/i);
    });

    it("treats 404 as auth not being mounted", () => {
        expect(verdictFor("auth", 404)).toBe("fail");
    });
});

describe("health probe", () => {
    it("distinguishes 'nothing answered' from a served 404", () => {
        expect(probe("health").interpret(null).meaning).toMatch(/nothing answered/i);
        expect(probe("health").interpret(404).meaning).toMatch(/not a Rebase backend/i);
        expect(verdictFor("health", 404)).toBe("fail");
    });
});

describe("spa probe", () => {
    it("only warns on 404 — a backend-only project legitimately has no root", () => {
        expect(verdictFor("spa", 404)).toBe("warn");
    });
});

describe("every probe", () => {
    it("classifies an unreachable host as a failure", () => {
        for (const p of PROBES) expect(p.interpret(null).verdict).toBe("fail");
    });

    it("states what a healthy deployment answers", () => {
        for (const p of PROBES) expect(p.healthy).toMatch(/\d{3}|—/);
    });
});

describe("overallVerdict", () => {
    const r = (verdict: Verdict): ProbeResult => ({
        id: "x",
label: "x",
method: "GET",
url: "u",
status: 200,
        ms: 1,
verdict,
meaning: "",
healthy: "",
statusOk: verdict === "ok"
    });

    it("is ok only when every probe is ok", () => {
        expect(overallVerdict([r("ok"), r("ok")])).toBe("ok");
    });
    it("lets a single fail dominate a warn", () => {
        expect(overallVerdict([r("ok"), r("warn"), r("fail")])).toBe("fail");
    });
    it("surfaces warn when nothing failed", () => {
        expect(overallVerdict([r("ok"), r("warn")])).toBe("warn");
    });
});

/* ═══════════════════════════════════════════════════════════════
   runProbe — transport failures are data, not exceptions
   ═══════════════════════════════════════════════════════════════ */

describe("runProbe", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reports a null status instead of throwing when the host is unreachable", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("ENOTFOUND");
        }));
        const res = await runProbe("https://nope.example", probe("health"), { collection: "users",
fn: "health" });
        expect(res.status).toBeNull();
        expect(res.verdict).toBe("fail");
    });

    it("builds the URL from the probe path and encodes the target names", async () => {
        const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
        vi.stubGlobal("fetch", fetchMock);
        const res = await runProbe("https://app.example", probe("unauthRead"), {
            collection: "my posts",
            fn: "health"
        });
        expect(res.url).toBe("https://app.example/api/data/my%20posts");
        expect(res.verdict).toBe("ok");
    });

    it("posts a JSON body for the auth probe", async () => {
        // Both parameters are declared because the assertion below reads the
        // second: a bare `vi.fn()` types `mock.calls` as `[][]`, and "posts a
        // JSON body" then compiles to a tuple index error rather than a check.
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
            new Response("", { status: 400 }));
        vi.stubGlobal("fetch", fetchMock);
        await runProbe("https://app.example", probe("auth"), { collection: "users",
fn: "health" });
        const init = fetchMock.mock.calls[0][1] ?? {};
        expect(init.method).toBe("POST");
        expect(init.body).toBe("{}");
    });
});

/* ═══════════════════════════════════════════════════════════════
   Log parsing
   ═══════════════════════════════════════════════════════════════ */

describe("parseLogLine", () => {
    it("splits the timestamp and pod prefix runtime-logs renders", () => {
        expect(parseLogLine("2026-07-20T10:00:00.123Z [rebase-backend-abc] hello world")).toEqual({
            ts: "2026-07-20T10:00:00.123Z",
            pod: "rebase-backend-abc",
            text: "hello world"
        });
    });

    it("keeps an unprefixed line intact", () => {
        expect(parseLogLine("plain text").text).toBe("plain text");
    });

    it("does not eat a JSON payload's braces", () => {
        const parsed = parseLogLine('2026-07-20T10:00:00Z [pod-1] {"message":"request"}');
        expect(parsed.text).toBe('{"message":"request"}');
    });
});

describe("isErrorLine", () => {
    it("matches structured severities", () => {
        expect(isErrorLine('{"severity":"ERROR","msg":"boom"}')).toBe(true);
        expect(isErrorLine('{"level":"warn","msg":"hm"}')).toBe(true);
    });
    it("matches permission failures, which often log below error level", () => {
        expect(isErrorLine("permission denied for table users")).toBe(true);
        expect(isErrorLine("connect ECONNREFUSED 10.0.0.1:5432")).toBe(true);
    });
    it("ignores ordinary info lines", () => {
        expect(isErrorLine('{"severity":"INFO","msg":"served /"}')).toBe(false);
    });
});

describe("parseRequestLine", () => {
    it("extracts status, method, path and latency", () => {
        expect(
            parseRequestLine('{"message":"request","status":200,"method":"GET","path":"/api/data/x","latencyMs":12}')
        ).toEqual({ status: 200,
method: "GET",
path: "/api/data/x",
latencyMs: 12 });
    });

    it("returns null for a line that is not a request record", () => {
        expect(parseRequestLine('{"message":"started"}')).toBeNull();
        expect(parseRequestLine("not json at all")).toBeNull();
    });

    it("reports an absent latency as null rather than zero", () => {
        const entry = parseRequestLine('{"message":"request","status":500,"method":"GET","path":"/x"}');
        expect(entry?.latencyMs).toBeNull();
    });
});

describe("isBootLine", () => {
    it("matches the startup decisions worth seeing", () => {
        expect(isBootLine("Loaded function doc-content")).toBe(true);
        expect(isBootLine("Server running on port 8080")).toBe(true);
        expect(isBootLine("Refusing to start: no DATABASE_URL")).toBe(true);
    });
    it("ignores ordinary request noise", () => {
        expect(isBootLine("GET /favicon.ico 200")).toBe(false);
    });
});

describe("formatDuration", () => {
    it("renders back the compact form a user would type", () => {
        expect(formatDuration(900)).toBe("15m");
        expect(formatDuration(7200)).toBe("2h");
        expect(formatDuration(604800)).toBe("7d");
        expect(formatDuration(90)).toBe("90s");
    });
    it("round-trips with parseSince", () => {
        for (const s of ["90s", "15m", "2h", "1d"]) {
            expect(formatDuration(parseSince(s)!)).toBe(s);
        }
    });
});

describe("parseSince", () => {
    it("parses each supported unit", () => {
        expect(parseSince("90s")).toBe(90);
        expect(parseSince("15m")).toBe(900);
        expect(parseSince("2h")).toBe(7200);
        expect(parseSince("1d")).toBe(86400);
    });
    it("treats a bare number as seconds", () => {
        expect(parseSince("45")).toBe(45);
    });
    it("returns null for junk, so the caller can reject it explicitly", () => {
        expect(parseSince("yesterday")).toBeNull();
        expect(parseSince("15 minutes")).toBeNull();
        expect(parseSince(undefined)).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   Coverage: the window asked for against the window returned
   ═══════════════════════════════════════════════════════════════ */

/**
 * `count` lines from one pod, as runtime-logs renders them, one every `stepMs`
 * ending at `lastMs`.
 */
function podLog(pod: string, count: number, lastMs: number, stepMs = 1000, text = "tick"): string[] {
    return Array.from({ length: count }, (_, i) => {
        const ts = new Date(lastMs - (count - 1 - i) * stepMs).toISOString();
        return `${ts} [${pod}] ${text} ${i}`;
    });
}

function answer(lines: string[], pods: RuntimeLogsResponse["pods"], truncated = false): RuntimeLogsResponse {
    return { logs: lines.join("\n"),
pods,
ordering: "timestamp",
truncated,
state: "ok",
message: null };
}

function okPod(pod: string, lines: number, truncated = false) {
    return { pod,
state: "ok",
lines,
message: null,
hint: null,
truncated };
}

const NOW = Date.parse("2026-10-05T10:37:00.000Z");
const DAY = 86400;

describe("resolveTail", () => {
    it("lowers an ask above the control plane's ceiling, and says so", () => {
        const tail = resolveTail(200000, true);
        expect(tail.applied).toBe(SERVER_MAX_TAIL_LINES);
        expect(tail.note).toMatch(/--tail 200000 was lowered to 2000/);
    });

    it("sends an ask within the ceiling unchanged, with nothing to say", () => {
        expect(resolveTail(500, false)).toEqual({ requested: 500,
applied: 500,
explicit: false,
note: null });
    });
});

describe("assessCoverage", () => {
    /**
     * The prospector report, 2026-10-05: `--since 30d --tail 200000` came back
     * with 35 minutes of lines from one pod, and the server's answer said
     * `truncated: false` for the pod and for the whole. The pod returned the
     * full 2000 lines the control plane allows, which is the tell.
     */
    it("marks a pod that filled the line limit short of the window as truncated, and says by how much", () => {
        const lines = podLog("rebase-backend-a", 2000, NOW - 20_000, 1050);
        const tail = resolveTail(200000, true);
        const cov = assessCoverage({
            res: answer(lines, [okPod("rebase-backend-a", 2000)]),
            lines: lines.map(parseLogLine),
            sinceSeconds: 30 * DAY,
            tail,
            now: NOW
        });

        expect(cov.truncated).toBe(true);
        expect(cov.requestedFrom).toBe("2026-09-05T10:37:00.000Z");
        expect(cov.firstTimestamp).toBe(parseLogLine(lines[0]).ts);
        expect(cov.lastTimestamp).toBe(parseLogLine(lines[1999]).ts);
        const pod = cov.pods[0];
        expect(pod.truncated).toBe(true);
        expect(pod.truncatedBy).toBe("tail");
        expect(pod.complete).toBe(false);
        expect(pod.firstTimestamp).toBe(cov.firstTimestamp);
        expect(pod.truncatedReason).toContain("returned 2000 lines, the control plane's ceiling of 2000 lines per pod");
        expect(pod.truncatedReason).toContain(`earliest is ${cov.firstTimestamp}`);
        expect(pod.truncatedReason).toMatch(/29d 23h after the 30d window begins/);
        expect(cov.truncatedReasons).toEqual([pod.truncatedReason]);
    });

    it("does not call a young pod truncated: fewer lines than the limit is its whole log", () => {
        // Started an hour ago, asked for 30 days. Nothing older exists, and
        // nothing was cut.
        const lines = podLog("rebase-backend-a", 120, NOW - 1000, 30_000);
        const cov = assessCoverage({
            res: answer(lines, [okPod("rebase-backend-a", 120)]),
            lines: lines.map(parseLogLine),
            sinceSeconds: 30 * DAY,
            tail: resolveTail(500, false),
            now: NOW
        });
        expect(cov.truncated).toBe(false);
        expect(cov.truncatedReasons).toEqual([]);
        expect(cov.pods[0]).toMatchObject({ truncated: false,
truncatedBy: null,
complete: true });
        expect(cov.firstTimestamp).toBe(parseLogLine(lines[0]).ts);
    });

    it("tells a reader under the default limit that --tail reads further back", () => {
        const lines = podLog("p", 500, NOW - 1000);
        const cov = assessCoverage({
            res: answer(lines, [okPod("p", 500)]),
            lines: lines.map(parseLogLine),
            sinceSeconds: 3600,
            tail: resolveTail(500, false),
            now: NOW
        });
        expect(cov.pods[0].truncatedReason).toContain("the default of 500 lines per pod");
        expect(cov.pods[0].truncatedReason).toMatch(/Raise --tail \(at most 2000\)/);
    });

    it("tells a reader at the ceiling that older lines cannot be read from here", () => {
        const lines = podLog("p", 2000, NOW - 1000);
        const cov = assessCoverage({
            res: answer(lines, [okPod("p", 2000)]),
            lines: lines.map(parseLogLine),
            sinceSeconds: DAY,
            tail: resolveTail(2000, true),
            now: NOW
        });
        expect(cov.pods[0].truncatedReason).toContain("the --tail 2000 limit");
        expect(cov.pods[0].truncatedReason).toMatch(/older lines cannot be read from here/);
    });

    it("reports each pod's own range, and the overall range across them", () => {
        const a = podLog("a", 10, NOW - 60_000);
        const b = podLog("b", 10, NOW - 1000);
        const lines = [...a, ...b];
        const cov = assessCoverage({
            res: answer(lines, [okPod("a", 10), okPod("b", 10)]),
            lines: lines.map(parseLogLine),
            sinceSeconds: 3600,
            tail: resolveTail(500, false),
            now: NOW
        });
        expect(cov.pods[0].lastTimestamp).toBe(parseLogLine(a[9]).ts);
        expect(cov.pods[1].firstTimestamp).toBe(parseLogLine(b[0]).ts);
        expect(cov.firstTimestamp).toBe(parseLogLine(a[0]).ts);
        expect(cov.lastTimestamp).toBe(parseLogLine(b[9]).ts);
    });

    it("names the server's byte budget when that is what cut a pod", () => {
        const lines = podLog("p", 40, NOW - 1000);
        const cov = assessCoverage({
            res: answer(lines, [okPod("p", 40, true)], true),
            lines: lines.map(parseLogLine),
            sinceSeconds: 3600,
            tail: resolveTail(500, false),
            now: NOW
        });
        expect(cov.pods[0]).toMatchObject({ truncated: true,
truncatedBy: "bytes",
complete: false });
        expect(cov.pods[0].truncatedReason).toMatch(/per-pod byte budget/);
        // One reason for one cut: the server's overall flag is this pod's.
        expect(cov.truncatedReasons).toHaveLength(1);
    });

    it("explains a server-side cut that no single pod owns", () => {
        const lines = podLog("p", 40, NOW - 1000);
        const cov = assessCoverage({
            res: answer(lines, [okPod("p", 40)], true),
            lines: lines.map(parseLogLine),
            sinceSeconds: 3600,
            tail: resolveTail(500, false),
            now: NOW
        });
        expect(cov.truncated).toBe(true);
        expect(cov.pods[0].truncated).toBe(false);
        expect(cov.truncatedReasons[0]).toMatch(/trimmed the combined result/);
    });

    it("with no window, a pod that filled the limit was not read back to its start", () => {
        const lines = podLog("p", 2000, NOW - 1000);
        const cov = assessCoverage({
            res: answer(lines, [okPod("p", 2000)]),
            lines: lines.map(parseLogLine),
            sinceSeconds: null,
            tail: resolveTail(2000, false),
            now: NOW
        });
        expect(cov.requestedFrom).toBeNull();
        expect(cov.pods[0].truncatedReason).toContain(`its log before ${cov.firstTimestamp} was not read`);
    });

    it("leaves a pod that could not be read out of the cut, and not complete", () => {
        const cov = assessCoverage({
            res: answer([], [{ pod: "p",
state: "not_ready",
lines: 0,
message: "waiting",
hint: "retry" }]),
            lines: [],
            sinceSeconds: 3600,
            tail: resolveTail(500, false),
            now: NOW
        });
        expect(cov.truncated).toBe(false);
        expect(cov.pods[0]).toMatchObject({ truncated: false,
complete: false,
firstTimestamp: null });
    });
});

describe("bootReach", () => {
    function pods(...entries: Array<[string, number]>) {
        const lines = entries.flatMap(([pod, n]) => podLog(pod, n, NOW - 1000));
        return assessCoverage({
            res: answer(lines, entries.map(([pod, n]) => okPod(pod, n))),
            lines: lines.map(parseLogLine),
            sinceSeconds: null,
            tail: resolveTail(2000, false),
            now: NOW
        }).pods;
    }

    it("reaches a pod's start when its whole log came back", () => {
        expect(bootReach(pods(["a", 300]), null)).toEqual({ reachedStart: true,
unreached: [] });
    });

    it("names the pod whose log was cut before its start", () => {
        expect(bootReach(pods(["a", 300], ["b", 2000]), null)).toEqual({ reachedStart: false,
unreached: ["b"] });
    });

    it("never claims the start under --since, which only reads a recent window", () => {
        expect(bootReach(pods(["a", 300]), 3600).reachedStart).toBe(false);
    });
});

describe("formatSpan", () => {
    it("renders the two largest units", () => {
        expect(formatSpan(40_000)).toBe("40s");
        expect(formatSpan(35 * 60_000)).toBe("35m");
        expect(formatSpan(125 * 60_000)).toBe("2h 5m");
        expect(formatSpan((30 * 86400 - 3600) * 1000)).toBe("29d 23h");
        expect(formatSpan(86400_000)).toBe("1d");
    });
});

/* ═══════════════════════════════════════════════════════════════
   Command behaviour
   ═══════════════════════════════════════════════════════════════ */

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        requireProjectRef: vi.fn(() => "proj-one"),
        displayProjectRef: vi.fn(() => "proj-one"),
        fetchTenantBaseDomain: vi.fn(async () => "apps.example")
    };
});

import * as context from "./context";
import { debugCommand } from "./debug";
import { cloudCommand, positionals } from "./index";

function fakeClient(spec: {
    invoke?: (name: string, body: unknown, opts?: { method?: string; path?: string }) => Promise<unknown>;
    findById?: (collection: string, id: string) => Promise<unknown>;
}) {
    return {
        functions: { invoke: vi.fn(spec.invoke ?? (async () => ({}))) },
        data: {
            collection: (name: string) => ({
                find: async () => ({ data: [] }),
                findById: async (id: string) =>
                    spec.findById ? spec.findById(name, id) : { subdomain: "proj-one",
host: "proj-one.apps.example" },
                update: async () => ({}),
                create: async () => ({}),
                delete: async () => ({})
            })
        },
        auth: { getSession: () => ({ accessToken: "t",
expiresAt: Date.now() + 1e9 }) }
    };
}

function useClient(client: unknown): void {
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client,
        url: "https://cp.example"
    });
}

beforeEach(() => setJsonModeForTest(true));
afterEach(() => {
    setJsonModeForTest(false);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("debug health --json", () => {
    /** Answer each probe path with a caller-chosen status. */
    function stubFetch(byPath: (path: string) => number) {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => new Response("", { status: byPath(new URL(url).pathname) }))
        );
    }

    it("prints one JSON value carrying every probe and its explanation", async () => {
        stubFetch((p) => {
            if (p === "/health") return 200;
            if (p === "/") return 200;
            if (p === "/api/auth/login") return 400;
            if (p.startsWith("/api/data/")) return 401;
            return 401; // functions mounted
        });
        useClient(fakeClient({}));

        const cap = captureStdout();
        await debugCommand("health", ["node", "rebase", "cloud", "debug", "health", "--json"]);
        cap.restore();

        // The WHOLE of stdout must parse: one JSON value, nothing human.
        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.overall).toBe("ok");
        expect(parsed.origin).toBe("https://proj-one.apps.example");
        expect(parsed.probes).toHaveLength(PROBES.length);
        for (const p of parsed.probes) expect(p.meaning).toBeTruthy();
    });

    it("exits non-zero and explains the mount when the functions listing 404s", async () => {
        stubFetch((p) => (p === "/api/functions" ? 404 : p.startsWith("/api/data/") ? 401 : 200));
        useClient(fakeClient({}));

        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        await expect(
            debugCommand("health", ["node", "rebase", "cloud", "debug", "health", "--json"])
        ).rejects.toThrow("__exit__");
        cap.restore();
        exit.mockRestore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.overall).toBe("fail");
        const fn = parsed.probes.find((p: { id: string }) => p.id === "functions");
        expect(fn.status).toBe(404);
        expect(fn.meaning).toMatch(/did not mount/i);
    });

    /**
     * The live-verified false positive, as an end-to-end regression: a healthy
     * deployment whose functions define only sub-routes. Every function path
     * 404s; only the listing answers. This must come out clean.
     */
    it("does NOT report a mount failure when only function sub-paths 404", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            const p = new URL(url).pathname;
            if (p === "/api/functions") {
                return new Response(
                    JSON.stringify({ functions: [{ name: "doc-content" }, { name: "hello" }] }),
                    { status: 200,
headers: { "Content-Type": "application/json" } }
                );
            }
            // A function's bare mount point — 404 even though all is well.
            if (p.startsWith("/api/functions/")) return new Response("", { status: 404 });
            if (p.startsWith("/api/data/")) return new Response("", { status: 401 });
            if (p === "/api/auth/login") return new Response("", { status: 400 });
            return new Response("", { status: 200 });
        }));
        useClient(fakeClient({}));

        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        await debugCommand("health", [
            "node", "rebase", "cloud", "debug", "health", "--function", "doc-content", "--json"
        ]);
        cap.restore();

        expect(exit).not.toHaveBeenCalled();
        exit.mockRestore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.overall).toBe("ok");
        const fn = parsed.probes.find((p: { id: string }) => p.id === "functions");
        expect(fn.verdict).toBe("ok");
        expect(fn.meaning).toMatch(/including doc-content/);
    });

    it("does NOT exit non-zero for a warn-only result (a public collection)", async () => {
        stubFetch((p) => {
            if (p.startsWith("/api/data/")) return 200; // public read → warn
            if (p === "/api/auth/login") return 400;
            return p.startsWith("/api/functions/") ? 401 : 200;
        });
        useClient(fakeClient({}));

        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        await debugCommand("health", ["node", "rebase", "cloud", "debug", "health", "--json"]);
        cap.restore();
        exit.mockRestore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.overall).toBe("warn");
    });

    it("honours --host over the project's own hostname", async () => {
        const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        useClient(fakeClient({}));

        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        await debugCommand("health", ["node", "rebase", "cloud", "debug", "health", "--host", "staging.example", "--json"]);
        cap.restore();
        exit.mockRestore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.origin).toBe("https://staging.example");
    });

    it("probes the collection named on the flag", async () => {
        const seen: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            seen.push(new URL(url).pathname);
            return new Response("", { status: 401 });
        }));
        useClient(fakeClient({}));

        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        await debugCommand("health", [
            "node", "rebase", "cloud", "debug", "health", "--collection", "documents", "--json"
        ]);
        cap.restore();
        exit.mockRestore();

        expect(seen).toContain("/api/data/documents");
        // The function check rides on the listing, so no per-function request.
        expect(seen).toContain("/api/functions");
        expect(seen.some((p) => p.startsWith("/api/functions/"))).toBe(false);
    });
});

/* ── read-only guarantees ───────────────────────────────────────── */

describe("debug is read-only", () => {
    it("db shows the connection shape and never calls the reveal endpoint", async () => {
        const invoke = vi.fn(async (name: string, _b: unknown, opts?: { path?: string }) => {
            if (opts?.path === "reveal") throw new Error("reveal must not be called");
            expect(name).toBe("db-info");
            return {
                type: "managed",
                host: "postgres-rw.rebase-tenant-proj_1.svc.cluster.local",
                port: "5432",
                database: "rebase",
                username: "app",
                passwordAvailable: true,
                directAccess: { via: "tunnel" },
                unavailableReason: null
            };
        });
        useClient(fakeClient({ invoke }));

        const cap = captureStdout();
        await debugCommand("db", ["node", "rebase", "cloud", "debug", "db", "--json"]);
        cap.restore();

        const text = cap.output().trim();
        const parsed = JSON.parse(text.trim());
        expect(parsed).not.toHaveProperty("password");
        expect(parsed.passwordAvailable).toBe(true);
        // The remedy has to be runnable: a customer holds no kubeconfig for
        // the platform's cluster, so `kubectl` is offered only when the cluster
        // is their own — which this project's is not.
        expect(parsed.connectCommand).toBe("rebase cloud db connect");
        expect(parsed.kubectlCommand).toBe(null);
        expect(parsed.psqlCommand).toContain("psql -h 127.0.0.1 -p 5432 -U app -d rebase");
        expect(invoke.mock.calls.filter((c) => c[2]?.path === "reveal")).toHaveLength(0);
    });

    it("pod reads placement without writing anything", async () => {
        const update = vi.fn();
        const client = fakeClient({
            invoke: async () => ({
                status: "running",
                cpu: "3.1%",
                memory: "80 MiB / 512 MiB",
                placement: {
                    cluster: "prod",
provider: "gcp",
region: "eu",
namespace: "rebase-tenant-proj_1",
                    host: "proj-one.apps.example",
image: "img:1",
replicas: { available: 1,
desired: 1 }
                }
            })
        });
        client.data.collection = (() => ({
            find: async () => ({ data: [] }),
            findById: async () => ({}),
            update,
            create: update,
            delete: update
        })) as never;
        useClient(client);

        const cap = captureStdout();
        await debugCommand("pod", ["node", "rebase", "cloud", "debug", "pod", "--json"]);
        cap.restore();

        expect(update).not.toHaveBeenCalled();
        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.placement.replicas.available).toBe(1);
    });
});

/* ── log views: what was asked, what came back ──────────────────── */

describe("debug logs / boot --json report the window they covered", () => {
    /** Answer runtime-logs with `body`, recording the query each call sent. */
    function useLogsClient(body: (query: URLSearchParams) => RuntimeLogsResponse) {
        const queries: URLSearchParams[] = [];
        const invoke = vi.fn(async (name: string, _b: unknown, opts?: { path?: string }) => {
            expect(name).toBe("runtime-logs");
            const query = new URLSearchParams((opts?.path ?? "").split("?")[1] ?? "");
            queries.push(query);
            return body(query);
        });
        useClient(fakeClient({ invoke }));
        return queries;
    }

    async function run(action: string, ...flags: string[]) {
        const cap = captureStdout();
        await debugCommand(action, ["node", "rebase", "cloud", "debug", action, ...flags, "--json"]);
        cap.restore();
        return JSON.parse(cap.output().trim());
    }

    it("clamps --tail to the server's ceiling out loud, and marks a cut window truncated", async () => {
        const now = Date.now();
        const lines = podLog("rebase-backend-a", 2000, now - 60_000, 1050);
        const queries = useLogsClient((q) => {
            const n = Number(q.get("tailLines"));
            return answer(lines.slice(-n), [okPod("rebase-backend-a", Math.min(n, 2000))]);
        });

        const out = await run("logs", "--since", "30d", "--tail", "200000");

        // The request carries the clamped number: the server no longer
        // lowers anything out of sight.
        expect(queries[0].get("tailLines")).toBe("2000");
        expect(queries[0].get("sinceSeconds")).toBe(String(30 * DAY));
        expect(out.tail).toMatchObject({ requested: 200000,
applied: 2000,
serverMax: 2000 });
        expect(out.tail.note).toMatch(/lowered to 2000/);
        expect(out.truncated).toBe(true);
        expect(out.truncatedReasons[0]).toMatch(/rebase-backend-a: returned 2000 lines/);
        expect(out.window.firstTimestamp).toBe(parseLogLine(lines[0]).ts);
        expect(out.window.lastTimestamp).toBe(parseLogLine(lines[1999]).ts);
        expect(Date.parse(out.window.requestedFrom)).toBeLessThan(Date.parse(out.window.firstTimestamp));
        expect(out.pods[0]).toMatchObject({ truncated: true,
truncatedBy: "tail" });
    });

    it("refuses a --tail that is not a positive whole number", async () => {
        useLogsClient(() => answer([], []));
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        const cap = captureStdout();
        await expect(
            debugCommand("logs", ["node", "rebase", "cloud", "debug", "logs", "--tail", "0", "--json"])
        ).rejects.toThrow("__exit__");
        cap.restore();
        exit.mockRestore();
        expect(JSON.parse(cap.output().trim()).error.message).toMatch(/--tail must be a positive whole number/);
    });

    it("boot reads each pod from its start, with the most lines the server returns", async () => {
        const now = Date.now();
        const lines = [
            ...podLog("rebase-backend-a", 1, now - 600_000, 1000, "Server running on port 8080"),
            ...podLog("rebase-backend-a", 99, now - 1000)
        ];
        const queries = useLogsClient(() => answer(lines, [okPod("rebase-backend-a", 100)]));

        const out = await run("boot");

        // No window: a 7-day one cut the startup off any older pod.
        expect(queries[0].has("sinceSeconds")).toBe(false);
        expect(queries[0].get("tailLines")).toBe(String(SERVER_MAX_TAIL_LINES));
        expect(out.sinceSeconds).toBeNull();
        expect(out.window.requestedFrom).toBeNull();
        expect(out.reachedStart).toBe(true);
        expect(out.lines.map((l: { text: string }) => l.text)).toEqual(["Server running on port 8080 0"]);
    });

    it("boot says so when a pod's start was out of reach, instead of reporting nothing found", async () => {
        const now = Date.now();
        const lines = podLog("rebase-backend-a", 2000, now - 1000);
        useLogsClient(() => answer(lines, [okPod("rebase-backend-a", 2000)]));

        const out = await run("boot");

        expect(out.state).toBe("ok"); // the fetch worked…
        expect(out.reachedStart).toBe(false); // …and did not get to the startup
        expect(out.unreachedPods).toEqual(["rebase-backend-a"]);
        expect(out.truncated).toBe(true);
        expect(out.matched).toBe(0);
    });
});

describe("debug help and the flags each action parses agree", () => {
    /**
     * `--tail`, `--since` and `--previous` were one group-wide list saying
     * "Default: 500": wrong for `requests` (1000) and `boot`, and `requests`
     * rejects `--previous`. Each action now lists its own, from the specs.
     */
    function helpFlags(): Record<string, string[]> {
        const cap = captureStdout();
        printDebugHelp();
        cap.restore();
        const page = JSON.parse(cap.output().trim()) as {
            actions: Array<{ action: string; flags: Array<{ flag: string }> }>;
        };
        return Object.fromEntries(page.actions.map((a) => [a.action, a.flags.map((f) => f.flag.split(" ")[0]).sort()]));
    }

    it.each([
        ["health", HEALTH_FLAGS],
        ["logs", LOG_VIEW_FLAGS],
        ["errors", LOG_VIEW_FLAGS],
        ["boot", LOG_VIEW_FLAGS],
        ["requests", REQUESTS_FLAGS],
        ["pod", {}],
        ["db", {}]
    ])("%s documents exactly the flags it parses", (action, spec) => {
        expect(helpFlags()[action]).toEqual(Object.keys(spec).sort());
    });

    it("states each action's real --tail default", () => {
        const cap = captureStdout();
        printDebugHelp();
        cap.restore();
        const page = JSON.parse(cap.output().trim()) as {
            actions: Array<{ action: string; flags: Array<{ flag: string; description: string }> }>;
        };
        const tailOf = (action: string) =>
            page.actions.find((a) => a.action === action)?.flags.find((f) => f.flag.startsWith("--tail"))?.description;
        expect(tailOf("logs")).toMatch(/Default: 500$/);
        expect(tailOf("requests")).toMatch(/Default: 1000$/);
        expect(tailOf("boot")).toMatch(/Default: 2000$/);
    });
});

/* ── input validation ───────────────────────────────────────────── */

describe("--since validation", () => {
    it("rejects an unparseable duration instead of silently using a default", async () => {
        useClient(fakeClient({ invoke: async () => ({ logs: "",
pods: [] }) }));
        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        await expect(
            debugCommand("logs", ["node", "rebase", "cloud", "debug", "logs", "--since", "yesterday", "--json"])
        ).rejects.toThrow("__exit__");
        cap.restore();
        exit.mockRestore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.error.message).toMatch(/--since must be a duration/);
    });
});

/* ── dispatch ───────────────────────────────────────────────────── */

describe("debug subcommand dispatch", () => {
    /**
     * `rawArgs` is the whole of `process.argv`, so the resource group sits at
     * index 3 and index 2 is always the literal "cloud". `debug` therefore takes
     * its action from the dispatcher's positional — re-deriving it by indexing
     * rawArgs is what left `storage create` unreachable.
     */
    it("reads the action from positional 1, with the group at argv[3]", () => {
        // This used to declare a local `positionals` and assert against that, so
        // the dispatcher's own parser was never called — the exact shape of
        // mistake the docblock above is about.
        expect(positionals(["/usr/bin/node", "/path/rebase.js", "cloud", "debug", "health"]))
            .toEqual(["debug", "health"]);
        expect(positionals(["node", "cli", "cloud", "debug", "logs", "--since", "1h"])[1]).toBe("logs");
        // Bare `rebase cloud debug` has no action — that is the health path.
        expect(positionals(["node", "cli", "cloud", "debug"])[1]).toBeUndefined();
    });

    it("dispatches `cloud debug health` through the real cloud router", async () => {
        // `debugCommand` receives the action the router resolved, so route the
        // whole argv through the router rather than hand-feeding the string.
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
        useClient(fakeClient({}));
        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

        await cloudCommand("debug", ["node", "rebase", "cloud", "debug", "health", "--json"]);

        cap.restore();
        exit.mockRestore();
        const parsed = JSON.parse(cap.output().trim());
        // The health path is the one that reports the probe list.
        expect(parsed.probes).toHaveLength(PROBES.length);
    });

    it("runs the probes when no subcommand is given", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
        useClient(fakeClient({}));
        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        await debugCommand(undefined, ["node", "rebase", "cloud", "debug", "--json"]);
        cap.restore();
        exit.mockRestore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.probes).toHaveLength(PROBES.length);
    });

    it("fails with a code on an unknown subcommand in JSON mode", async () => {
        const cap = captureStdout();
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        await expect(
            debugCommand("frobnicate", ["node", "rebase", "cloud", "debug", "frobnicate", "--json"])
        ).rejects.toThrow("__exit__");
        cap.restore();
        exit.mockRestore();

        const parsed = JSON.parse(cap.output().trim());
        expect(parsed.error.code).toBe("unknown_command");
    });
});
