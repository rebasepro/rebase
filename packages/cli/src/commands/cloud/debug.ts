/**
 * `rebase cloud debug <subcommand>` — one entry point for "why is my deployed
 * app not behaving".
 *
 * ## Why this exists
 *
 * The useful signals for a deployed project live in four different places — the
 * control plane, the workload's pods, the tenant database, and the public URL —
 * and each is normally reached with a different tool and a different set of
 * flags. Getting to a log should not be a research task. This started life as a
 * hand-rolled `prod-debug.sh` for a single project, with the namespace and the
 * URL hardcoded at the top; it earned its place twice in one week, so it is
 * generalised here to any project the CLI can already resolve.
 *
 * ## Read-only by default
 *
 * Every subcommand here only reads. The two things the original script could do
 * that mutate are deliberately NOT reproduced as-is:
 *
 *   - restarting the workload lives at `rebase cloud restart`, which already
 *     gates downtime behind `--yes`; duplicating it here would give the same
 *     destructive act a second, ungated spelling.
 *   - `debug db` prints the port-forward recipe and the connection's *shape*.
 *     It opens no session and prints no password — `rebase cloud db info
 *     --reveal` is the explicit, auditable way to get one.
 *
 * ## The probes are the point
 *
 * `debug health` is the highest-value piece and the reason the script existed.
 * A bare status code is not a diagnosis: a 404 from a functions route means
 * something completely different from a 404 at the root, and a 200 on an
 * unauthenticated read is a finding rather than a success. So every probe ships
 * with the interpretation of what it got, not just the number — see
 * {@link PROBES}.
 */
import arg from "arg";
import chalk from "chalk";
import { unknownCommandMessage } from "../../utils/unknown-command";
import {
    requireClient,
    requireProject,
    parseCloudArgs,
    displayProjectRef,
    fetchTenantBaseDomain,
    projectHost,
    colorStatus,
    keyValues,
    emit,
    printGroupHelp,
    fail,
    reportError,
    type CloudClient
} from "./context";

/* ═══════════════════════════════════════════════════════════════
   Health probes
   ═══════════════════════════════════════════════════════════════ */

/** How a probe's outcome should be read. */
export type Verdict =
    /** Behaving as a healthy deployment should. */
    | "ok"
    /** Reachable and legal, but worth a human look (e.g. a public read). */
    | "warn"
    /** Broken, or wired up wrong. */
    | "fail"
    /** We could not classify the response. */
    | "unknown";

export interface ProbeReading {
    verdict: Verdict;
    /** What this status code *means for this endpoint*, in one sentence. */
    meaning: string;
}

export interface ProbeSpec {
    id: string;
    /** Column label in human output. */
    label: string;
    method: "GET" | "POST";
    /** Path relative to the project origin. */
    path: (opts: ProbeTargets) => string;
    body?: unknown;
    /** One-line statement of what a healthy deployment answers here. */
    healthy: string;
    interpret: (status: number | null) => ProbeReading;
    /**
     * Read the response body as well. Set only where the body carries a fact the
     * status code cannot — today, the function listing.
     */
    needsBody?: boolean;
    /**
     * Sharpen the status-code reading using the parsed body. Returning null
     * keeps {@link interpret}'s verdict.
     */
    refine?: (body: unknown, targets: ProbeTargets) => ProbeReading | null;
}

export interface ProbeTargets {
    /** Collection used for the unauthenticated-read probe. */
    collection: string;
    /** Function to confirm exists, if the caller named one. */
    fn?: string;
}

/** A response never arrived: DNS, TLS, ingress, or the pod. */
const NO_RESPONSE: ProbeReading = {
    verdict: "fail",
    meaning:
        "nothing answered — the hostname does not resolve, the ingress has no route, or no pod is running"
};

function serverError(what: string): ProbeReading {
    return { verdict: "fail",
meaning: `the server is running but ${what}` };
}

/**
 * The probe set, in the order a failure cascades: if `health` is down, nothing
 * below it is meaningful, so it is checked first and reported first.
 */
export const PROBES: ProbeSpec[] = [
    {
        id: "health",
        label: "health",
        method: "GET",
        path: () => "/health",
        healthy: "200 — the backend is up",
        interpret: (status) => {
            if (status === null) return NO_RESPONSE;
            if (status === 200) return { verdict: "ok",
meaning: "the backend is up and serving" };
            if (status === 404) {
                return {
                    verdict: "fail",
                    meaning:
                        "something answered but it is not a Rebase backend — the ingress is routing this host elsewhere"
                };
            }
            if (status >= 500) return serverError("its health endpoint is failing");
            return { verdict: "unknown",
meaning: "unexpected for a health endpoint" };
        }
    },
    {
        id: "spa",
        label: "spa",
        method: "GET",
        path: () => "/",
        healthy: "200 — the frontend is being served",
        interpret: (status) => {
            if (status === null) return NO_RESPONSE;
            if (status === 200) return { verdict: "ok",
meaning: "the frontend bundle is being served" };
            if (status === 404) {
                return {
                    verdict: "warn",
                    meaning:
                        "no frontend at the root — expected for a backend-only project, otherwise the SPA assets were not bundled into the image"
                };
            }
            if (status >= 500) return serverError("the root route throws");
            return { verdict: "unknown",
meaning: "unexpected at the site root" };
        }
    },
    {
        id: "auth",
        label: "auth",
        method: "POST",
        path: () => "/api/auth/login",
        body: {},
        healthy: "400 — auth is mounted and rejects an empty body",
        interpret: (status) => {
            if (status === null) return NO_RESPONSE;
            // The probe deliberately posts an empty body: a healthy auth route
            // must reject it. Reachability is what is being tested, not a login.
            if (status === 400 || status === 422) {
                return { verdict: "ok",
meaning: "auth is mounted and rejected the empty body, as it should" };
            }
            if (status === 401 || status === 403) {
                return { verdict: "ok",
meaning: "auth is mounted and refused the credentials" };
            }
            if (status === 404) {
                return {
                    verdict: "fail",
                    meaning: "the auth routes are NOT mounted — this project cannot sign anyone in"
                };
            }
            if (status === 200) {
                return {
                    verdict: "fail",
                    meaning: "an EMPTY login body was accepted — a login with no credentials must never succeed"
                };
            }
            if (status >= 500) return serverError("the login route throws — often a missing or unmigrated auth table");
            return { verdict: "unknown",
meaning: "unexpected for a login route" };
        }
    },
    {
        id: "unauthRead",
        label: "unauth read",
        method: "GET",
        path: (t) => `/api/data/${encodeURIComponent(t.collection)}`,
        healthy: "401 — reads require authentication",
        interpret: (status) => {
            if (status === null) return NO_RESPONSE;
            if (status === 401 || status === 403) {
                return { verdict: "ok",
meaning: "unauthenticated reads are refused — row-level security is enforced" };
            }
            if (status === 200) {
                // Legal, and sometimes intended. Never silently called healthy.
                return {
                    verdict: "warn",
                    meaning:
                        "this collection is readable with NO authentication — correct only if it is deliberately public"
                };
            }
            if (status === 404) {
                return {
                    verdict: "warn",
                    meaning: "no such collection on this deployment — check the name, or pass --collection"
                };
            }
            if (status >= 500) {
                return serverError(
                    "the read reached the database and failed — most often an RLS policy naming a column or table that is not there"
                );
            }
            return { verdict: "unknown",
meaning: "unexpected for a data read" };
        }
    },
    {
        id: "functions",
        label: "functions",
        method: "GET",
        /**
         * The router's own listing endpoint, NOT a function's path.
         *
         * This matters, and it is the one place the original script got a wrong
         * answer. A function is a Hono sub-app mounted at `/<name>`, and it
         * usually defines only sub-routes (`/get`, `/list`) — so
         * `/api/functions/<name>` 404s **even when everything is mounted and
         * healthy**. Probing there cannot separate "the router is missing" from
         * "that function defines no root route", and reporting the first is how
         * you send someone to debug a deployment that was fine.
         *
         * `GET /api/functions` is unambiguous: the router registers a listing
         * route at its own root (see `createFunctionRoutes`), so a 200 proves
         * the mount *and* names every function that loaded.
         */
        path: () => "/api/functions",
        healthy: "200 — the functions router is mounted and lists its functions",
        interpret: (status) => {
            if (status === null) return NO_RESPONSE;
            if (status === 200) return { verdict: "ok",
meaning: "the functions router is mounted" };
            if (status === 401 || status === 403) {
                // The listing is behind auth on this deployment. That still
                // proves the router is there, which is what is being tested.
                return { verdict: "ok",
meaning: "the functions router is mounted (its listing requires auth)" };
            }
            if (status === 404) {
                return {
                    verdict: "fail",
                    meaning:
                        "the functions router did not mount — no functions directory was found at build time, or it held no functions, so every function on this project is unreachable"
                };
            }
            if (status >= 500) return serverError("the functions router throws");
            return { verdict: "unknown",
meaning: "unexpected for the functions listing" };
        },
        needsBody: true,
        refine: (body, t) => {
            const names = functionNames(body);
            if (!names) return null;
            if (t.fn && !names.includes(t.fn)) {
                // Definitive, because the listing is authoritative — no guessing
                // from a 404 that could equally mean the router is absent.
                return {
                    verdict: "fail",
                    meaning:
                        `the router is mounted but no function is named "${t.fn}" — it loaded ${names.length}: ` +
                        `${names.join(", ")}`
                };
            }
            const found = t.fn ? `, including ${t.fn}` : "";
            return {
                verdict: "ok",
                meaning: `the functions router is mounted and loaded ${names.length} function${names.length === 1 ? "" : "s"}${found}`
            };
        }
    }
];

/** The function names out of a listing body, or null when it is not one. */
export function functionNames(body: unknown): string[] | null {
    const list = (body as { functions?: unknown } | null | undefined)?.functions;
    if (!Array.isArray(list)) return null;
    const names = list
        .map((f) => (f as { name?: unknown })?.name)
        .filter((n): n is string => typeof n === "string");
    return names.length === list.length ? names : null;
}

export interface ProbeResult {
    id: string;
    label: string;
    method: string;
    url: string;
    status: number | null;
    ms: number;
    verdict: Verdict;
    meaning: string;
    healthy: string;
    /**
     * Whether the STATUS CODE alone looked healthy. False means the code itself
     * was wrong; true with a failing `verdict` means the code was fine and the
     * body carried the bad news (a named function that did not load). The
     * summary uses this so it never tells you to expect a 200 you already got.
     */
    statusOk: boolean;
}

/** Milliseconds before a probe is treated as unanswered. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Ceiling on a probe body we will parse. The only body read is the function
 * listing; anything larger is a page we have no use for, and a debug command
 * must not be the thing that runs a machine out of memory.
 */
const MAX_PROBE_BODY_BYTES = 256 * 1024;

/**
 * Run one probe. A transport failure is a `null` status, never a thrown error:
 * "nothing answered" is a diagnosis in its own right and the other probes still
 * need to run.
 */
export async function runProbe(origin: string, spec: ProbeSpec, targets: ProbeTargets): Promise<ProbeResult> {
    const url = `${origin}${spec.path(targets)}`;
    const started = Date.now();
    let status: number | null = null;
    let body: unknown;
    try {
        const res = await fetch(url, {
            method: spec.method,
            headers: spec.body ? { "Content-Type": "application/json" } : undefined,
            body: spec.body ? JSON.stringify(spec.body) : undefined,
            redirect: "manual",
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
        });
        status = res.status;
        if (spec.needsBody && res.ok) {
            const text = await res.text();
            if (text.length <= MAX_PROBE_BODY_BYTES) {
                try {
                    body = JSON.parse(text);
                } catch {
                    // Not JSON — `refine` returns null and the status reading stands.
                }
            }
        }
    } catch {
        status = null;
    }
    const statusReading = spec.interpret(status);
    // The body can only sharpen a reading, never invent one where the request
    // failed outright.
    const reading = (status !== null && spec.refine?.(body, targets)) || statusReading;
    return {
        statusOk: statusReading.verdict === "ok",
        id: spec.id,
        label: spec.label,
        method: spec.method,
        url,
        status,
        ms: Date.now() - started,
        verdict: reading.verdict,
        meaning: reading.meaning,
        healthy: spec.healthy
    };
}

/** The worst verdict across probes — what the command's exit code keys off. */
export function overallVerdict(results: ProbeResult[]): Verdict {
    if (results.some((r) => r.verdict === "fail")) return "fail";
    if (results.some((r) => r.verdict === "unknown")) return "unknown";
    if (results.some((r) => r.verdict === "warn")) return "warn";
    return "ok";
}

function verdictMark(v: Verdict): string {
    switch (v) {
        case "ok":
            return chalk.green("✓");
        case "warn":
            return chalk.yellow("!");
        case "fail":
            return chalk.red("✗");
        default:
            return chalk.gray("?");
    }
}

/* ═══════════════════════════════════════════════════════════════
   Log parsing
   ═══════════════════════════════════════════════════════════════

   `runtime-logs` renders each line as `<rfc3339> [<pod>] <text>`, where <text>
   is normally the application's structured JSON. These helpers unwrap that so
   the derived views (errors / requests / boot) work on the payload rather than
   on the transport's formatting.
*/

export interface ParsedLogLine {
    ts: string | null;
    pod: string | null;
    text: string;
}

const LOG_PREFIX_RE = /^(?:(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+)?(?:\[([^\]]+)\]\s+)?([\s\S]*)$/;

export function parseLogLine(line: string): ParsedLogLine {
    const m = LOG_PREFIX_RE.exec(line);
    if (!m) return { ts: null,
pod: null,
text: line };
    return { ts: m[1] ?? null,
pod: m[2] ?? null,
text: m[3] ?? "" };
}

/**
 * Lines an operator scanning for a fault wants to see.
 *
 * Matches the structured `severity` field first, then the shapes that show up
 * in unstructured output. `refus`/`denied` are in the list because a permission
 * failure often logs at info level and is exactly what one is hunting for.
 */
export function isErrorLine(text: string): boolean {
    return /"(?:severity|level)":\s*"(?:ERROR|WARN(?:ING)?|error|warn)"|\bError:|\bERR!|refus|denied|EACCES|ECONNREFUSED/i.test(
        text
    );
}

export interface RequestLogEntry {
    status: number | null;
    method: string;
    path: string;
    latencyMs: number | null;
}

/**
 * Pull an HTTP request record out of a log line, or null when it is not one.
 *
 * Only structured request lines are recognised. Guessing at prose would produce
 * a table with invented columns, which is worse than a short one.
 */
export function parseRequestLine(text: string): RequestLogEntry | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(text.slice(start)) as Record<string, unknown>;
    } catch {
        return null;
    }
    if (parsed.message !== "request" && parsed.msg !== "request") return null;

    const num = (v: unknown): number | null => {
        const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
        return Number.isFinite(n) ? n : null;
    };
    return {
        status: num(parsed.status),
        method: typeof parsed.method === "string" ? parsed.method : "",
        path: typeof parsed.path === "string" ? parsed.path : "",
        latencyMs: num(parsed.latencyMs ?? parsed.durationMs)
    };
}

/**
 * Startup lines: what the server *decided* it was going to do. Which storage
 * backend it bound, which functions it loaded, whether auth tables were found.
 * This is the fastest way to tell a misconfiguration from a runtime fault.
 */
export function isBootLine(text: string): boolean {
    return /storage|Loaded function|Mounted|Auth tables|Server running|listening|Refusing|migrat/i.test(text);
}

/** Render a number of seconds back as the compact duration a user would type. */
export function formatDuration(seconds: number): string {
    if (seconds % 86400 === 0 && seconds >= 86400) return `${seconds / 86400}d`;
    if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600}h`;
    if (seconds % 60 === 0 && seconds >= 60) return `${seconds / 60}m`;
    return `${seconds}s`;
}

/**
 * Parse a duration like `15m`, `2h`, `90s`, `1d` (or a bare number of seconds)
 * into seconds. Returns null when it is not a duration.
 */
export function parseSince(input: string | undefined): number | null {
    if (!input) return null;
    const m = /^(\d+(?:\.\d+)?)\s*([smhd])?$/i.exec(input.trim());
    if (!m) return null;
    const value = parseFloat(m[1]);
    const unit = (m[2] || "s").toLowerCase();
    const mult = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
    return Math.round(value * mult);
}

/* ═══════════════════════════════════════════════════════════════
   Shared fetches
   ═══════════════════════════════════════════════════════════════ */

/** One pod's entry in a `runtime-logs` answer. */
export interface RuntimeLogsPod {
    pod: string;
    state: string;
    /** Lines this pod returned. */
    lines: number;
    message: string | null;
    hint: string | null;
    /** The server's per-pod BYTE budget cut this pod's output. Says nothing about the line limit. */
    truncated?: boolean;
}

export interface RuntimeLogsResponse {
    logs?: string;
    pods?: RuntimeLogsPod[];
    ordering?: string;
    /** A byte budget or the pod-count ceiling cut the result. Says nothing about the line limit. */
    truncated?: boolean;
    state?: string;
    message?: string | null;
}

/**
 * The most lines `runtime-logs` returns per pod.
 *
 * The control plane enforces this (`MAX_TAIL_LINES` in
 * `saas/backend/functions/runtime-logs.ts`) by clamping a larger `tailLines`
 * without saying so: its answer names neither the limit nor the value it used.
 * `--tail 200000` therefore came back as 2000 lines reported as untruncated.
 * The CLI clamps first, with the same number, so the lowering is something it
 * can print rather than something that happened out of sight.
 */
export const SERVER_MAX_TAIL_LINES = 2000;

/** How many lines per pod a read asks for, and why that may be less than requested. */
export interface TailLimit {
    /** What `--tail` asked for, or the view's default. */
    requested: number;
    /** What is sent: `requested`, lowered to {@link SERVER_MAX_TAIL_LINES}. */
    applied: number;
    /** Whether `--tail` was given, so a message can name the flag or the default. */
    explicit: boolean;
    /** Set when `applied < requested`: the sentence that says so. */
    note: string | null;
}

export function resolveTail(requested: number, explicit: boolean): TailLimit {
    const applied = Math.min(requested, SERVER_MAX_TAIL_LINES);
    return {
        requested,
        applied,
        explicit,
        note:
            applied < requested
                ? `--tail ${requested} was lowered to ${applied}: the control plane returns at most ` +
                  `${SERVER_MAX_TAIL_LINES} lines per pod.`
                : null
    };
}

/** Read `--tail`, refusing anything that is not a positive whole number. */
function tailFromFlag(value: number | undefined, fallback: number): TailLimit {
    if (value === undefined) return resolveTail(fallback, false);
    if (!Number.isInteger(value) || value <= 0) {
        fail(`--tail must be a positive whole number of lines; received "${value}".`, undefined, "usage");
    }
    return resolveTail(value, true);
}

/** What one pod's lines actually cover. */
export interface PodCoverage extends RuntimeLogsPod {
    /** Earliest and latest timestamps among the lines this pod returned. */
    firstTimestamp: string | null;
    lastTimestamp: string | null;
    /** A limit cut what this pod would otherwise have returned for the window. */
    truncated: boolean;
    /** Which limit: the per-pod line limit, or the server's byte budget. */
    truncatedBy: "tail" | "bytes" | null;
    /** The plain explanation, when truncated. */
    truncatedReason: string | null;
    /**
     * Every line this pod holds in the window came back. With no window (read
     * from the start), its first line is the start of its log.
     */
    complete: boolean;
}

/** The window asked for against the window delivered. */
export interface LogCoverage {
    /** Start of the window asked for, ISO. Null when reading each pod from its start. */
    requestedFrom: string | null;
    /** Earliest and latest timestamps across every line returned. */
    firstTimestamp: string | null;
    lastTimestamp: string | null;
    pods: PodCoverage[];
    truncated: boolean;
    truncatedReasons: string[];
}

/** A span of milliseconds as `29d 23h`, `2h 5m`, `35m`, `40s`. */
export function formatSpan(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
}

function timestampRange(lines: ParsedLogLine[]): { first: string | null; last: string | null } {
    let first: { text: string; ms: number } | null = null;
    let last: { text: string; ms: number } | null = null;
    for (const l of lines) {
        if (!l.ts) continue;
        const ms = Date.parse(l.ts);
        if (Number.isNaN(ms)) continue;
        if (!first || ms < first.ms) first = { text: l.ts,
ms };
        if (!last || ms > last.ms) last = { text: l.ts,
ms };
    }
    return { first: first?.text ?? null,
last: last?.text ?? null };
}

/**
 * Compare what a read covered with what it asked for.
 *
 * The server's `truncated` describes only its byte budgets and pod ceiling, so
 * a pod that filled the line limit came back marked complete however much of
 * the window it left unread. The line limit is the cut that matters most, and
 * it is detected here: a pod that returned as many lines as the limit, whose
 * earliest line is later than the start of the window, was cut by it.
 *
 * Filling the limit is the half that separates a cut from a young pod. A pod
 * that started an hour ago also has no line older than an hour; it returned
 * fewer lines than the limit, so what came back is its whole log, and nothing
 * was cut.
 */
export function assessCoverage(opts: {
    res: RuntimeLogsResponse;
    lines: ParsedLogLine[];
    /** The window asked for. Null reads each pod from its start. */
    sinceSeconds: number | null;
    tail: TailLimit;
    now: number;
}): LogCoverage {
    const { res, lines, sinceSeconds, tail, now } = opts;
    const windowStartMs = sinceSeconds === null ? null : now - sinceSeconds * 1000;
    const requestedFrom = windowStartMs === null ? null : new Date(windowStartMs).toISOString();
    const limitName = tail.note
        ? `the control plane's ceiling of ${tail.applied} lines per pod`
        : tail.explicit
          ? `the --tail ${tail.applied} limit`
          : `the default of ${tail.applied} lines per pod`;
    // Only worth saying when raising it would read further back.
    const raise = tail.applied < SERVER_MAX_TAIL_LINES
        ? ` Raise --tail (at most ${SERVER_MAX_TAIL_LINES}) to read further back.`
        : ` The control plane returns only each pod's newest ${SERVER_MAX_TAIL_LINES}, so older lines cannot be read from here.`;

    const pods: PodCoverage[] = (res.pods ?? []).map((p) => {
        const range = timestampRange(lines.filter((l) => l.pod === p.pod));
        const base = { ...p,
firstTimestamp: range.first,
lastTimestamp: range.last };
        if (p.state !== "ok") {
            return { ...base,
truncated: false,
truncatedBy: null,
truncatedReason: null,
complete: false };
        }
        if (p.truncated) {
            return {
                ...base,
                truncated: true,
                truncatedBy: "bytes" as const,
                truncatedReason:
                    `${p.pod}: the control plane's per-pod byte budget cut this pod's output short` +
                    (range.first ? ` — what fit runs ${range.first} to ${range.last}.` : "."),
                complete: false
            };
        }
        const firstMs = range.first ? Date.parse(range.first) : null;
        const startsLate = windowStartMs === null || firstMs === null || firstMs > windowStartMs;
        if (p.lines >= tail.applied && startsLate) {
            let reason: string;
            if (firstMs === null) {
                reason = `${p.pod}: returned ${p.lines} lines, ${limitName}; they carry no timestamps, so how far back they reach is unknown.`;
            } else if (sinceSeconds !== null && windowStartMs !== null) {
                reason =
                    `${p.pod}: returned ${p.lines} lines, ${limitName}, and the earliest is ${range.first} — ` +
                    `${formatSpan(firstMs - windowStartMs)} after the ${formatDuration(sinceSeconds)} ` +
                    `window begins (${requestedFrom}). Lines in between were not read.${raise}`;
            } else {
                reason =
                    `${p.pod}: returned ${p.lines} lines, ${limitName}, so its log before ${range.first} ` +
                    `was not read.${raise}`;
            }
            return { ...base,
truncated: true,
truncatedBy: "tail" as const,
truncatedReason: reason,
complete: false };
        }
        return { ...base,
truncated: false,
truncatedBy: null,
truncatedReason: null,
complete: true };
    });

    const truncatedReasons = pods.flatMap((p) => (p.truncatedReason ? [p.truncatedReason] : []));
    // The server's flag also covers cuts no single pod owns: its total byte
    // budget across pods, and the cap on how many pods it reads.
    if (res.truncated && !pods.some((p) => p.truncatedBy === "bytes")) {
        truncatedReasons.push(
            "The control plane trimmed the combined result (its total byte budget, or the most pods it reads at once); the oldest lines were dropped."
        );
    }
    const overall = timestampRange(lines);
    return {
        requestedFrom,
        firstTimestamp: overall.first,
        lastTimestamp: overall.last,
        pods,
        truncated: Boolean(res.truncated) || pods.some((p) => p.truncated),
        truncatedReasons
    };
}

async function fetchRuntimeLogs(
    client: CloudClient,
    projectId: string,
    opts: { sinceSeconds?: number; tailLines?: number; previous?: boolean }
): Promise<RuntimeLogsResponse> {
    const params = new URLSearchParams();
    if (opts.sinceSeconds !== undefined) params.set("sinceSeconds", String(opts.sinceSeconds));
    if (opts.tailLines !== undefined) params.set("tailLines", String(opts.tailLines));
    if (opts.previous) params.set("previous", "true");
    params.set("timestamps", "true");
    const qs = params.toString();
    return client.functions.invoke<RuntimeLogsResponse>("runtime-logs", undefined, {
        method: "GET",
        path: `${projectId}${qs ? `?${qs}` : ""}`
    });
}

/** Print the per-pod states runtime-logs reports, including its hints. */
function printPodStates(res: RuntimeLogsResponse): void {
    if (res.state === "no_pods") {
        console.log(chalk.yellow(`  ${res.message ?? "No pods are running for this project."}`));
        console.log("");
        return;
    }
    for (const p of res.pods ?? []) {
        if (p.state === "ok") continue;
        console.log(`  ${chalk.yellow(p.pod)} ${chalk.gray(`(${p.state})`)}`);
        if (p.message) console.log(chalk.gray(`    ${p.message}`));
        // The hint is the actionable half — a crash-looping container's reason
        // is in its PREVIOUS instance, and that is only discoverable if we say so.
        if (p.hint) console.log(chalk.cyan(`    → ${p.hint}`));
    }
}

/**
 * The window asked for, the window delivered, and every cut between them.
 * Printed after the lines, where a reader's eye is when the output ends.
 */
function printCoverage(coverage: LogCoverage, tail: TailLimit): void {
    const asked = coverage.requestedFrom ? `from ${coverage.requestedFrom}` : "from each pod's start";
    const got = coverage.firstTimestamp && coverage.lastTimestamp
        ? `${coverage.firstTimestamp} → ${coverage.lastTimestamp} ` +
          `(${formatSpan(Date.parse(coverage.lastTimestamp) - Date.parse(coverage.firstTimestamp))})`
        : "no timestamped lines";
    console.log(chalk.gray(`  Asked for:  ${asked}`));
    console.log(chalk.gray(`  Returned:   ${got}`));
    if (tail.note) console.log(chalk.yellow(`  ! ${tail.note}`));
    if (coverage.truncated) {
        console.log(chalk.yellow("  ! Truncated — the lines above do not cover the window asked for:"));
        for (const reason of coverage.truncatedReasons) console.log(chalk.yellow(`    ${reason}`));
    }
    console.log("");
}

/**
 * Resolve the public origin a project is served at — or `--host`, when given.
 *
 * Shared with `rebase cloud cron`, which reads the runtime at the same address
 * `debug health` probes.
 */
export async function resolveOrigin(
    rawArgs: string[],
    client: CloudClient,
    url: string,
    projectId: string
): Promise<string> {
    const parsed = arg({ "--host": String }, { argv: rawArgs.slice(3),
permissive: true });
    if (parsed["--host"]) {
        const h = parsed["--host"].trim().replace(/\/+$/, "");
        return /^https?:\/\//.test(h) ? h : `https://${h}`;
    }

    const [project, baseDomain] = await Promise.all([
        client.data.collection("projects").findById(projectId) as Promise<
            { subdomain?: string; host?: string; customDomain?: string } | undefined
        >,
        fetchTenantBaseDomain(client, url)
    ]);
    if (!project) fail(`Project ${displayProjectRef(rawArgs)} not found.`);

    const host = projectHost(project, baseDomain);
    if (!host) {
        fail(
            "Could not determine the public URL for this project.",
            "It may never have been deployed. Pass --host <hostname> to probe an address directly."
        );
    }
    return `https://${host}`;
}

/* ═══════════════════════════════════════════════════════════════
   Subcommand: health
   ═══════════════════════════════════════════════════════════════ */

async function healthCommand(rawArgs: string[]): Promise<void> {
    // Strict: `--collecton users` used to be dropped and the probe then ran
    // against the default collection while reporting on the one asked for.
    const { flags: parsed } = parseCloudArgs({
        spec: HEALTH_FLAGS,
        rawArgs,
        commandWords: 3, // cloud debug health
        command: "cloud debug",
        maxPositionals: 0
    });
    const targets: ProbeTargets = {
        collection: parsed["--collection"] || "users",
        // Optional: the listing endpoint proves the mount on its own. A name
        // here additionally asserts that this particular function loaded.
        fn: parsed["--function"]
    };

    const { client, url } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const origin = await resolveOrigin(rawArgs, client, url, projectId);

    // Sequential, not Promise.all: five simultaneous requests to a struggling
    // pod is a small load test, and the latency column would then measure our
    // own contention rather than the endpoint's.
    const results: ProbeResult[] = [];
    for (const spec of PROBES) results.push(await runProbe(origin, spec, targets));

    const overall = overallVerdict(results);

    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🩺 Health — ${displayProjectRef(rawArgs)}`) + chalk.gray(`  ${origin}`));
            console.log("");
            const width = Math.max(...results.map((r) => r.label.length));
            for (const r of results) {
                const code = r.status === null ? chalk.red("---") : String(r.status);
                console.log(
                    `  ${verdictMark(r.verdict)} ${chalk.bold(r.label.padEnd(width))}  ${code.padStart(3)}  ${chalk.gray(`${r.ms}ms`)}`
                );
                console.log(`      ${chalk.gray(r.meaning)}`);
            }
            console.log("");
            if (overall === "ok") {
                console.log(chalk.green("  Everything reachable and wired as expected."));
            } else {
                const bad = results.filter((r) => r.verdict === "fail" || r.verdict === "warn");
                console.log(chalk.gray(`  ${bad.length} of ${results.length} check${bad.length === 1 ? "" : "s"} need attention.`));
                // Only where the status code itself was wrong — restating
                // "expected 200" under a probe that returned 200 reads as a bug.
                const wrongStatus = bad.filter((r) => !r.statusOk);
                if (wrongStatus.length > 0) {
                    console.log(chalk.gray("  A healthy deployment answers:"));
                    for (const r of wrongStatus) {
                        console.log(chalk.gray(`    ${r.label.padEnd(width)}  ${r.healthy}`));
                    }
                }
            }
            console.log("");
        },
        { origin,
overall,
probes: results }
    );

    // A failing probe is a failing command — this is meant to be usable in a
    // deploy script's `if`, not only read by a human.
    if (overall === "fail") process.exit(1);
}

/* ═══════════════════════════════════════════════════════════════
   Subcommand: logs / errors / requests / boot
   ═══════════════════════════════════════════════════════════════ */

/** What `debug logs`, `errors` and `boot` parse. Their help pairs against this. */
export const LOG_VIEW_FLAGS = {
    "--since": String,
    "--tail": Number,
    "--previous": Boolean
} as const;

/** What `debug requests` parses. */
export const REQUESTS_FLAGS = {
    "--since": String,
    "--tail": Number
} as const;

/** What `debug health` parses. */
export const HEALTH_FLAGS = {
    "--collection": String,
    "--function": String,
    // `--host` is read again inside `resolveOrigin`, which needs it before
    // the client exists; declared here because THIS is the parse that
    // decides whether the line is accepted at all.
    "--host": String
} as const;

interface LogViewOptions {
    /** Keep only lines matching this. Omit to keep everything. */
    filter?: (text: string) => boolean;
    /** Default lookback when --since is not given. Null reads each pod from its start. */
    defaultSinceSeconds: number | null;
    /** Lines read per pod when --tail is not given. */
    defaultTail: number;
    /** Max lines rendered. */
    limit: number;
    title: string;
    /**
     * The lines wanted are the first a pod wrote, so a read that did not reach
     * a pod's start has not looked where they are — see {@link bootReach}.
     */
    needsStart?: boolean;
}

const LOG_VIEWS = {
    logs: { defaultSinceSeconds: 900,
defaultTail: 500,
limit: 200,
title: "📄 Logs" },
    errors: { filter: isErrorLine,
defaultSinceSeconds: 3600,
defaultTail: 500,
limit: 40,
title: "🔥 Errors" },
    boot: {
        filter: isBootLine,
        // No window, and the most lines the control plane returns. Startup
        // happened when the pod started, which may have been days ago: a
        // 7-day window and the newest 500 lines missed it on any pod that had
        // served traffic since.
        defaultSinceSeconds: null,
        defaultTail: SERVER_MAX_TAIL_LINES,
        limit: 25,
        title: "🚀 Boot",
        needsStart: true
    }
} satisfies Record<string, LogViewOptions>;

const REQUESTS_DEFAULTS = { sinceSeconds: 900,
tail: 1000 };

/** Read `--since`, refusing anything that is not a duration. Undefined when it was not given. */
function sinceFromFlag(sinceArg: string | undefined): number | undefined {
    if (sinceArg === undefined) return undefined;
    const seconds = parseSince(sinceArg);
    if (seconds === null) fail(`--since must be a duration like 15m, 2h or 90s; received "${sinceArg}".`);
    return seconds;
}

function windowLabel(sinceSeconds: number | null): string {
    return sinceSeconds === null ? "since each pod started" : `last ${formatDuration(sinceSeconds)}`;
}

/**
 * Whether a boot read reached each pod's start, which is where its startup
 * lines are. A pod whose read was cut has not been looked at there, so finding
 * no startup lines in it means nothing — and a line from later in its life
 * that happens to mention `storage` is not its startup.
 *
 * Under `--since` a pod is never counted as reached: a complete read of the
 * window starts at the pod's first line only if the pod started inside it, and
 * nothing in the answer says whether it did.
 */
export function bootReach(pods: PodCoverage[], sinceSeconds: number | null): {
    reachedStart: boolean;
    unreached: string[];
} {
    const unreached = pods
        .filter((p) => p.state === "ok" && (!p.complete || sinceSeconds !== null))
        .map((p) => p.pod);
    return { reachedStart: unreached.length === 0,
unreached };
}

async function logView(rawArgs: string[], view: LogViewOptions): Promise<void> {
    const { flags: parsed } = parseCloudArgs({
        spec: LOG_VIEW_FLAGS,
        rawArgs,
        commandWords: 3, // cloud debug logs|errors|boot
        command: "cloud debug",
        maxPositionals: 0
    });

    const sinceSeconds = sinceFromFlag(parsed["--since"]) ?? view.defaultSinceSeconds;
    const tail = tailFromFlag(parsed["--tail"], view.defaultTail);

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    let res: RuntimeLogsResponse;
    try {
        res = await fetchRuntimeLogs(client, projectId, {
            sinceSeconds: sinceSeconds ?? undefined,
            tailLines: tail.applied,
            previous: Boolean(parsed["--previous"])
        });
    } catch (e) {
        reportError(e, "Failed to fetch runtime logs");
    }

    const all = (res.logs ?? "").split("\n").filter((l) => l !== "");
    const parsedLines = all.map(parseLogLine);
    const kept = view.filter ? parsedLines.filter((l) => view.filter!(l.text)) : parsedLines;
    const shown = kept.slice(-view.limit);
    const coverage = assessCoverage({ res,
lines: parsedLines,
sinceSeconds,
tail,
now: Date.now() });
    const reach = view.needsStart ? bootReach(coverage.pods, sinceSeconds) : null;

    emit(
        () => {
            console.log("");
            console.log(
                chalk.bold(`  ${view.title} — ${displayProjectRef(rawArgs)}`) + chalk.gray(`  ${windowLabel(sinceSeconds)}`)
            );
            console.log("");
            printPodStates(res);
            if (shown.length === 0) {
                console.log(chalk.gray("  (nothing matched in what was read)"));
                console.log("");
            } else {
                for (const l of shown) console.log(`  ${l.pod ? chalk.gray(`[${l.pod}] `) : ""}${l.text}`);
                console.log("");
                if (kept.length > shown.length) {
                    console.log(chalk.gray(`  (showing the last ${shown.length} of ${kept.length} matching lines)`));
                    console.log("");
                }
            }
            printCoverage(coverage, tail);
            if (reach && !reach.reachedStart) {
                const which = reach.unreached.join(", ");
                console.log(
                    chalk.yellow(
                        sinceSeconds === null
                            ? `  ! The start of ${which} was not read, so its startup lines are not among the lines above.`
                            : `  ! The start of ${which} may not have been read: --since limits the read to a recent window. ` +
                              "Drop it to read each pod from its start."
                    )
                );
                console.log("");
            }
        },
        {
            sinceSeconds,
            tail: { requested: tail.requested,
applied: tail.applied,
serverMax: SERVER_MAX_TAIL_LINES,
note: tail.note },
            window: {
                requestedFrom: coverage.requestedFrom,
                firstTimestamp: coverage.firstTimestamp,
                lastTimestamp: coverage.lastTimestamp
            },
            state: res.state ?? null,
            pods: coverage.pods,
            truncated: coverage.truncated,
            truncatedReasons: coverage.truncatedReasons,
            ...(reach ? { reachedStart: reach.reachedStart,
unreachedPods: reach.unreached } : {}),
            matched: kept.length,
            lines: shown
        }
    );
}

async function requestsCommand(rawArgs: string[]): Promise<void> {
    const { flags: parsed } = parseCloudArgs({
        spec: REQUESTS_FLAGS,
        rawArgs,
        commandWords: 3, // cloud debug requests
        command: "cloud debug",
        maxPositionals: 0
    });
    const sinceSeconds = sinceFromFlag(parsed["--since"]) ?? REQUESTS_DEFAULTS.sinceSeconds;
    const tail = tailFromFlag(parsed["--tail"], REQUESTS_DEFAULTS.tail);

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    let res: RuntimeLogsResponse;
    try {
        res = await fetchRuntimeLogs(client, projectId, { sinceSeconds,
tailLines: tail.applied });
    } catch (e) {
        reportError(e, "Failed to fetch runtime logs");
    }

    const parsedLines = (res.logs ?? "")
        .split("\n")
        .filter((l) => l !== "")
        .map(parseLogLine);
    const entries = parsedLines
        .map((l) => parseRequestLine(l.text))
        .filter((e): e is RequestLogEntry => e !== null);
    const shown = entries.slice(-40);
    const coverage = assessCoverage({ res,
lines: parsedLines,
sinceSeconds,
tail,
now: Date.now() });

    emit(
        () => {
            console.log("");
            console.log(
                chalk.bold(`  🌐 Requests — ${displayProjectRef(rawArgs)}`) +
                    chalk.gray(`  ${windowLabel(sinceSeconds)}`)
            );
            console.log("");
            printPodStates(res);
            if (shown.length === 0) {
                console.log(chalk.gray("  No structured request lines in what was read."));
                console.log(chalk.gray("  (this view needs the server's request logging; try `debug logs`)"));
                console.log("");
                printCoverage(coverage, tail);
                return;
            }
            for (const e of shown) {
                const status = e.status ?? 0;
                const color = status >= 500 ? chalk.red : status >= 400 ? chalk.yellow : chalk.green;
                console.log(
                    `  ${color(String(e.status ?? "---").padStart(3))}  ${e.method.padEnd(6)} ${e.path.slice(0, 70).padEnd(70)} ${chalk.gray(
                        e.latencyMs === null ? "" : `${e.latencyMs}ms`
                    )}`
                );
            }
            console.log("");
            printCoverage(coverage, tail);
        },
        {
            sinceSeconds,
            tail: { requested: tail.requested,
applied: tail.applied,
serverMax: SERVER_MAX_TAIL_LINES,
note: tail.note },
            window: {
                requestedFrom: coverage.requestedFrom,
                firstTimestamp: coverage.firstTimestamp,
                lastTimestamp: coverage.lastTimestamp
            },
            pods: coverage.pods,
            truncated: coverage.truncated,
            truncatedReasons: coverage.truncatedReasons,
            requests: shown
        }
    );
}

/* ═══════════════════════════════════════════════════════════════
   Subcommand: pod
   ═══════════════════════════════════════════════════════════════ */

async function podCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud debug",
maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    interface MetricsResponse {
        status?: string;
        cpu?: string | null;
        memory?: string | null;
        placement?: {
            cluster?: string | null;
            provider?: string | null;
            region?: string | null;
            namespace?: string | null;
            host?: string | null;
            image?: string | null;
            replicas?: { available?: number; desired?: number };
        };
    }

    let m: MetricsResponse;
    try {
        m = await client.functions.invoke<MetricsResponse>("metrics", undefined, {
            method: "GET",
            path: projectId
        });
    } catch (e) {
        reportError(e, "Failed to read workload placement");
    }

    const p = m.placement ?? {};
    const replicas = p.replicas ?? {};

    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  ☸  Workload — ${displayProjectRef(rawArgs)}`));
            console.log("");
            keyValues([
                ["Status", m.status ? colorStatus(m.status === "running" ? "active" : m.status) : undefined],
                [
                    "Replicas",
                    replicas.desired === undefined
                        ? undefined
                        : `${replicas.available ?? 0} / ${replicas.desired} available`
                ],
                ["Namespace", p.namespace],
                ["Cluster", p.cluster],
                ["Region", [p.provider, p.region].filter(Boolean).join(" · ") || undefined],
                ["Host", p.host],
                ["Image", p.image],
                // Reported as-is: the metrics function returns null for "not
                // measurable", which must not render as a number.
                ["CPU", m.cpu ?? undefined],
                ["Memory", m.memory ?? undefined]
            ]);
            console.log("");
            if ((replicas.available ?? 0) === 0 && (replicas.desired ?? 0) > 0) {
                console.log(chalk.yellow("  No replica is available — the pod is not passing its readiness check."));
                console.log(chalk.gray("  See why with:  ") + chalk.bold("rebase cloud debug logs --previous"));
                console.log("");
            }
        },
        { status: m.status ?? null,
placement: p }
    );
}

/* ═══════════════════════════════════════════════════════════════
   Subcommand: db
   ═══════════════════════════════════════════════════════════════ */

async function dbDebugCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud debug",
maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    interface DbInfo {
        type?: string;
        host?: string | null;
        port?: string | null;
        database?: string | null;
        username?: string | null;
        passwordAvailable?: boolean;
        unavailableReason?: string | null;
        directAccess?: {
            via: "tunnel";
            kubectl?: { namespace: string; service: string; localPort: number; remotePort: number };
        } | null;
    }

    let info: DbInfo;
    try {
        info = await client.functions.invoke<DbInfo>("db-info", undefined, { method: "GET",
path: projectId });
    } catch (e) {
        reportError(e, "Failed to read database connection info");
    }

    // The host above is a Service inside the platform's cluster, so `debug db`
    // has to say what to do about that. It used to print `kubectl port-forward
    // -n rebase-tenant-…`, which needs a kubeconfig for OUR cluster: a customer
    // has none, and nothing in the platform issues one. The tunnel is the
    // remedy a reader can actually run.
    const access = info.directAccess;
    const connectCmd = access ? "rebase cloud db connect" : null;
    const LOCAL_PORT = 5432;
    const psqlCmd =
        access && info.username && info.database
            ? `psql -h 127.0.0.1 -p ${LOCAL_PORT} -U ${info.username} -d ${info.database}`
            : null;
    // Only for a cluster the customer owns, where the credentials are theirs.
    const kubectlCmd = access?.kubectl
        ? `kubectl port-forward -n ${access.kubectl.namespace} svc/${access.kubectl.service} `
          + `${access.kubectl.localPort}:${access.kubectl.remotePort}`
        : null;

    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🐘 Database — ${displayProjectRef(rawArgs)}`));
            console.log("");
            if (info.unavailableReason) {
                console.log(chalk.yellow(`  ${info.unavailableReason}`));
                console.log("");
                return;
            }
            keyValues([
                ["Type", info.type],
                ["Host", info.host],
                ["Port", info.port],
                ["Database", info.database],
                ["Username", info.username],
                ["Password", info.passwordAvailable ? chalk.gray("stored — not shown here") : chalk.yellow("none stored")]
            ]);
            console.log("");
            if (connectCmd) {
                // Printed rather than run. Opening a tunnel and a database shell
                // is not something a command called `debug` should do implicitly.
                console.log(chalk.gray("  That host is inside the platform's cluster and does not resolve here."));
                console.log(chalk.gray("  To reach the database from this machine:"));
                console.log("");
                console.log(`    ${connectCmd}`);
                if (psqlCmd) console.log(`    ${psqlCmd}`);
                console.log("");
                if (kubectlCmd) {
                    console.log(chalk.gray("  Or, on your own cluster:"));
                    console.log(`    ${kubectlCmd}`);
                    console.log("");
                }
                if (info.passwordAvailable) {
                    console.log(
                        chalk.gray("  Get the password with:  ") + chalk.bold("rebase cloud db info --reveal")
                    );
                    console.log("");
                }
            }
        },
        {
            type: info.type ?? null,
            host: info.host ?? null,
            port: info.port ?? null,
            database: info.database ?? null,
            username: info.username ?? null,
            passwordAvailable: Boolean(info.passwordAvailable),
            connectCommand: connectCmd,
            kubectlCommand: kubectlCmd,
            psqlCommand: psqlCmd
        }
    );
}

/* ═══════════════════════════════════════════════════════════════
   Dispatch
   ═══════════════════════════════════════════════════════════════ */

/**
 * Everything the switch below dispatches, for the did-you-mean. `workload` is
 * the older spelling of `pod` and stays out of it: suggesting the name we no
 * longer print in the help would teach the wrong one.
 */
const DEBUG_SUBCOMMANDS = ["health", "logs", "errors", "boot", "requests", "pod", "db"] as const;

export async function debugCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case undefined:
        case "health":
            // Bare `rebase cloud debug` runs the probes: it is the answer to
            // "something is wrong" more often than any other view here.
            await healthCommand(rawArgs);
            break;
        case "logs":
        case "errors":
        case "boot":
            await logView(rawArgs, LOG_VIEWS[action]);
            break;
        case "requests":
            await requestsCommand(rawArgs);
            break;
        case "pod":
        case "workload":
            await podCommand(rawArgs);
            break;
        case "db":
            await dbDebugCommand(rawArgs);
            break;
        case "help":
        case "--help":
            printDebugHelp();
            break;
        default:
            // One refusal path in both modes. The terminal branch used to print
            // the whole help page to STDOUT — the results stream — after a
            // command that produced no result, which is the same shape the
            // index dispatcher was fixed out of. `fail` writes the machine
            // envelope under `--json` and one red line to stderr otherwise, and
            // the words come from the shared builder so the human line and the
            // machine one cannot drift apart: it carries the near-miss when
            // there is one, and names the page for the rest.
            fail(unknownCommandMessage(action, DEBUG_SUBCOMMANDS, "cloud debug"), undefined, "unknown_command");
    }
}

/**
 * The log flags as one action's help lists them, with THAT action's defaults.
 * They were one group-wide list saying "Default: 500", which was true of two of
 * the four actions, and offered `--previous` to `requests`, which rejects it.
 */
function logFlagHelp(defaults: { sinceSeconds: number | null; tail: number }, previous: boolean): Array<[string, string]> {
    const flags: Array<[string, string]> = [
        [
            "--since <dur>",
            defaults.sinceSeconds === null
                ? "Only lines this recent: 90s, 15m, 2h, 1d. Default: from each pod's start"
                : `Lookback window: 90s, 15m, 2h, 1d. Default: ${formatDuration(defaults.sinceSeconds)}`
        ],
        ["--tail <n>", `Newest lines to read per pod, at most ${SERVER_MAX_TAIL_LINES}. Default: ${defaults.tail}`]
    ];
    if (previous) flags.push(["--previous", "Read the CRASHED container instance, where the reason lives"]);
    return flags;
}

function logViewFlagHelp(view: LogViewOptions): Array<[string, string]> {
    return logFlagHelp({ sinceSeconds: view.defaultSinceSeconds,
tail: view.defaultTail }, true);
}

export function printDebugHelp(): void {
    printGroupHelp({
        command: "cloud debug",
        title: "Find out why a deployed project is misbehaving",
        actions: [
            {
                action: "health",
                section: "End-to-end",
                description: "Probe the live URL and explain every status code (the default)",
                flags: [
                    ["--host <hostname>", "Probe this address instead of the project's own"],
                    ["--collection <name>", "Collection for the unauth-read probe. Default: users"],
                    ["--function <name>", "Also assert this function loaded, against the listing"]
                ]
            },
            { action: "logs",
section: "Runtime",
description: "Recent application logs",
flags: logViewFlagHelp(LOG_VIEWS.logs) },
            { action: "errors",
section: "Runtime",
description: "Error and warning lines only",
flags: logViewFlagHelp(LOG_VIEWS.errors) },
            { action: "requests",
section: "Runtime",
description: "HTTP requests the server logged: status, path, latency",
flags: logFlagHelp(REQUESTS_DEFAULTS, false) },
            { action: "boot",
section: "Runtime",
description: "What the server decided at startup: storage, functions, auth",
flags: logViewFlagHelp(LOG_VIEWS.boot) },
            { action: "pod",
section: "Runtime",
description: "Replicas, image, namespace, cluster placement" },
            { action: "db",
section: "Data",
description: "Connection shape and the port-forward recipe. Never the password" }
        ],
        notes: [
            "Everything here is read-only. `health` exits non-zero when a check fails, so it works in a",
            "deploy script. To restart a workload, use `rebase cloud restart`.",
            "The log views end with the window asked for, the window returned, and anything that cut",
            `between them. The control plane returns at most ${SERVER_MAX_TAIL_LINES} lines per pod.`
        ]
    });
}
