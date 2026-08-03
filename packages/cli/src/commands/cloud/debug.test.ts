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
    // @ts-expect-error test shim
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
        const fetchMock = vi.fn(async () => new Response("", { status: 400 }));
        vi.stubGlobal("fetch", fetchMock);
        await runProbe("https://app.example", probe("auth"), { collection: "users",
fn: "health" });
        const init = fetchMock.mock.calls[0][1] as RequestInit;
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
                portForward: { namespace: "rebase-tenant-proj_1",
service: "postgres-rw",
localPort: 5432,
remotePort: 5432 },
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
        expect(parsed.portForwardCommand).toContain("kubectl port-forward -n rebase-tenant-proj_1");
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
