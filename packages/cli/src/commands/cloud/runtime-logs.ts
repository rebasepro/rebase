/**
 * `rebase cloud logs --runtime`: what the running app prints, once or followed.
 *
 * The control plane's `runtime-logs` route reads every pod behind the project
 * (or behind one backend preview, with `?preview=`) and answers a poll, not a
 * stream: its SDK transport buffers the whole body, so there is nothing to hold
 * open. A follow is therefore a loop of polls, each asking only for what came
 * after the newest line already printed. Everything below is about making that
 * loop print each line exactly once, survive what happens to pods while it
 * runs, and stop cleanly.
 *
 * - **Cursor.** The next poll starts from the newest line's own timestamp —
 *   the kubelet's clock, never ours, so a skewed laptop cannot open a gap. It
 *   asks from one millisecond earlier, because the control plane compares at
 *   millisecond precision while Kubernetes writes nanoseconds: two lines in the
 *   same millisecond would otherwise lose the second. The lines that overlap
 *   are dropped here by identity ({@link FollowCursor}).
 * - **Restarts.** A container that crashes and comes back between two polls
 *   starts a fresh log; its last lines, usually the reason, are only in the
 *   previous instance. The route reports each pod's restart count; when it
 *   rises, the follower reads that instance once and prints its tail.
 * - **Pods coming and going** (a rolling deploy, a scale-down) are announced,
 *   and "no pods" is a state to wait through, not an error.
 * - **Network blips** back off and retry from the same cursor, so nothing in
 *   between is lost while the pod keeps its log. A refusal (401, 403, 404)
 *   ends the follow — it will say the same next time.
 * - **Ctrl-C** ends the follow and exits 0: stopping a tail is how it is used.
 */
import chalk from "chalk";
import { fail, type CloudClient } from "./context";
import { isErrorLine, parseLogLine, parseSince, SERVER_MAX_TAIL_LINES, type RuntimeLogsPod } from "./debug";

/** The control-plane function this module reads. */
export const RUNTIME_LOGS_FUNCTION = "runtime-logs";

/** How often a follow polls. The console polls at the same rate. */
export const FOLLOW_INTERVAL_MS = 2_000;
/** The longest a follow waits between retries of a failed poll. */
export const MAX_BACKOFF_MS = 30_000;
/** A poll with no answer by then is treated as a dropped connection. */
export const POLL_TIMEOUT_MS = 30_000;

/** What one request asks the route for. `sinceTime` and `sinceSeconds` are exclusive. */
export interface RuntimeLogsQuery {
    sinceSeconds?: number;
    /** RFC3339. */
    sinceTime?: string;
    tailLines?: number;
    previous?: boolean;
    /** One backend preview's pod instead of production's. */
    preview?: string;
}

export interface RuntimeLogsPodState extends RuntimeLogsPod {
    /** The container's restart count. Absent from control planes before it was reported; null when unknown. */
    restarts?: number | null;
}

/** The route's answer, read defensively: every field may be missing on an older control plane. */
export interface RuntimeLogsPage {
    logs?: string;
    pods?: RuntimeLogsPodState[];
    ordering?: string;
    truncated?: boolean;
    previous?: boolean;
    /** Echoed by control planes that understand `?preview=`. */
    preview?: string | null;
    nextSinceTime?: string | null;
    state?: "ok" | "no_pods" | "error" | string;
    message?: string | null;
}

/** The request path for a query: `<projectId>?…`. Timestamps are always asked for — the cursor is built from them. */
export function runtimeLogsPath(projectId: string, q: RuntimeLogsQuery): string {
    const params = new URLSearchParams();
    if (q.sinceTime !== undefined) params.set("sinceTime", q.sinceTime);
    else if (q.sinceSeconds !== undefined) params.set("sinceSeconds", String(q.sinceSeconds));
    if (q.tailLines !== undefined) params.set("tailLines", String(q.tailLines));
    if (q.previous) params.set("previous", "true");
    if (q.preview !== undefined) params.set("preview", q.preview);
    params.set("timestamps", "true");
    return `${projectId}?${params.toString()}`;
}

/**
 * Read one page, refusing to pass off production's log as a preview's.
 *
 * A control plane from before `?preview=` ignores the parameter and answers with
 * production's pods. It does not echo `preview`, and that silence is the tell.
 */
export async function fetchRuntimeLogsPage(client: CloudClient, projectId: string, q: RuntimeLogsQuery): Promise<RuntimeLogsPage> {
    const page = await client.functions.invoke<RuntimeLogsPage>(RUNTIME_LOGS_FUNCTION, undefined, {
        method: "GET",
        path: runtimeLogsPath(projectId, q)
    });
    if (q.preview !== undefined && page?.preview !== q.preview) {
        fail(
            "This control plane cannot read a preview's runtime log yet; it would have answered with production's.",
            `\`rebase cloud logs --preview ${q.preview}\` (without --runtime) shows the preview's build log.`,
            "preview_runtime_unavailable"
        );
    }
    return page ?? {};
}

/* ═══════════════════════════════════════════════════════════════
   Flags
   ═══════════════════════════════════════════════════════════════ */

/**
 * `--since`: a duration (`30s`, `5m`, `1h`, `2d`) or an RFC3339 instant.
 * Returns null for anything else.
 */
export function parseSinceFlag(input: string): { sinceSeconds: number } | { sinceTime: string } | null {
    const seconds = parseSince(input);
    if (seconds !== null) return { sinceSeconds: seconds };
    // An instant needs at least a date and a time; `Date.parse` alone would
    // take "5" or "May" and invent one.
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(input.trim())) {
        const ms = Date.parse(input.trim());
        if (!Number.isNaN(ms)) return { sinceTime: new Date(ms).toISOString() };
    }
    return null;
}

/** Severity, as the console's log explorer reads it. */
export type LogLevel = "error" | "warn" | "info" | "debug" | "unknown";

/** `--level` names a floor: `warn` keeps warnings and errors. */
export const LEVEL_FLOOR: Record<Exclude<LogLevel, "unknown">, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const LEVEL_ALIASES: Record<string, LogLevel> = {
    emerg: "error", alert: "error", crit: "error", critical: "error",
    fatal: "error", error: "error", err: "error", severe: "error",
    warn: "warn", warning: "warn", notice: "warn",
    info: "info", information: "info", log: "info", default: "info",
    debug: "debug", trace: "debug", verbose: "debug", fine: "debug"
};
const LEVEL_KEYS = ["severity", "level", "levelname", "loglevel", "lvl"];
/** A level token at the head of an unstructured line: `ERROR`, `[warn]`, `info:`. */
const BARE_LEVEL = /^[\s[(]*([A-Za-z]{4,7})\b[\s\])]*[:-]?\s/;

function normalizeLevel(value: unknown): LogLevel {
    if (typeof value === "number") {
        // pino/bunyan: 50+ error, 40 warn, 30 info, below that debug.
        if (value >= 50) return "error";
        if (value >= 40) return "warn";
        if (value >= 30) return "info";
        return "debug";
    }
    if (typeof value !== "string") return "unknown";
    return LEVEL_ALIASES[value.trim().toLowerCase()] ?? "unknown";
}

/**
 * A line's severity: the structured field when the payload is a JSON object
 * (a Rebase backend logs `{"severity":"ERROR",…}`), else a level token at the
 * head of the line — the console explorer's rules. A line with neither that
 * `cloud debug errors` would flag (`Error:`, `EACCES`, a refusal) counts as an
 * error, because an unstructured stack trace is exactly what `--level error`
 * is run to find.
 */
export function lineLevel(text: string): LogLevel {
    const body = text.trim();
    if (body.startsWith("{") && body.endsWith("}")) {
        try {
            const parsed: unknown = JSON.parse(body);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const obj = parsed as Record<string, unknown>;
                const key = LEVEL_KEYS.find((k) => Object.prototype.hasOwnProperty.call(obj, k));
                if (key) {
                    const level = normalizeLevel(obj[key]);
                    if (level !== "unknown") return level;
                }
            }
        } catch {
            // Not JSON after all: read it as text.
        }
    }
    const bare = BARE_LEVEL.exec(body);
    const level = bare ? normalizeLevel(bare[1]) : "unknown";
    if (level !== "unknown") return level;
    // `TypeError: …`, `UnhandledPromiseRejection…Exception: …` — the head of an
    // unstructured stack trace, which `isErrorLine`'s `\bError:` misses when
    // the word is part of a class name.
    return isErrorLine(body) || /^\w*(?:Error|Exception):\s/.test(body) ? "error" : "unknown";
}

/**
 * `--grep`: a case-insensitive substring of the whole line (timestamp and pod
 * included, as in the console), or a regular expression written `/re/flags`.
 */
export function grepMatcher(pattern: string): (line: string) => boolean {
    const re = /^\/(.+)\/([a-z]*)$/.exec(pattern);
    if (re) {
        let compiled: RegExp;
        try {
            compiled = new RegExp(re[1], re[2].replace(/[gy]/g, ""));
        } catch (e) {
            fail(`--grep ${pattern} is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`, undefined, "usage");
        }
        return (line) => compiled.test(line);
    }
    const needle = pattern.toLowerCase();
    return (line) => line.toLowerCase().includes(needle);
}

/** Read `--level`, refusing anything that is not a level. */
export function parseLevelFlag(value: string): Exclude<LogLevel, "unknown"> {
    const level = value.trim().toLowerCase();
    if (level === "error" || level === "warn" || level === "info" || level === "debug") return level;
    if (level === "warning") return "warn";
    fail(`--level must be error, warn, info or debug; received "${value}".`, undefined, "usage");
}

/** One printed line, parsed. */
export interface LogRecord {
    /** The kubelet's RFC3339(Nano) timestamp, or null when the line carried none. */
    ts: string | null;
    pod: string | null;
    text: string;
    /** The line exactly as the control plane rendered it. */
    raw: string;
}

export function parseRecords(logs: string | undefined): LogRecord[] {
    if (!logs) return [];
    const out: LogRecord[] = [];
    for (const raw of logs.split("\n")) {
        if (raw === "") continue;
        const { ts, pod, text } = parseLogLine(raw);
        out.push({ ts, pod, text, raw });
    }
    return out;
}

/** The lines `--grep` and `--level` keep. Both unset keeps everything. */
export function recordFilter(opts: { grep?: string; level?: Exclude<LogLevel, "unknown"> }): (rec: LogRecord) => boolean {
    const grep = opts.grep !== undefined && opts.grep !== "" ? grepMatcher(opts.grep) : null;
    const floor = opts.level !== undefined ? LEVEL_FLOOR[opts.level] : null;
    return (rec) => {
        if (grep && !grep(rec.raw)) return false;
        if (floor !== null) {
            const level = lineLevel(rec.text);
            if (level === "unknown" || LEVEL_FLOOR[level] > floor) return false;
        }
        return true;
    };
}

/* ═══════════════════════════════════════════════════════════════
   Cursor
   ═══════════════════════════════════════════════════════════════ */

function msOf(ts: string | null): number | null {
    if (ts === null) return null;
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms;
}

/**
 * The newest line printed so far, and which lines share its millisecond.
 *
 * Polls overlap by design (see the module docs), so a line can arrive twice.
 * A line older than the cursor was printed by an earlier poll — every pod is
 * read at the same instant, so nothing older can still be on its way. A line
 * in the cursor's own millisecond was printed if it is one of the lines
 * remembered there. A line with no timestamp cannot be placed and is printed:
 * a duplicate is a kinder failure than a lost line.
 */
export class FollowCursor {
    private ms: number | null = null;
    private boundary = new Set<string>();

    /** Keep the lines of one page that have not been printed, and move the cursor past them. */
    admit(records: LogRecord[]): LogRecord[] {
        const prevMs = this.ms;
        const prevBoundary = this.boundary;
        const fresh = records.filter((r) => {
            const ms = msOf(r.ts);
            if (ms === null || prevMs === null) return true;
            if (ms < prevMs) return false;
            return !(ms === prevMs && prevBoundary.has(r.raw));
        });
        let newest = prevMs;
        for (const r of fresh) {
            const ms = msOf(r.ts);
            if (ms !== null && (newest === null || ms > newest)) newest = ms;
        }
        if (newest !== null && newest !== prevMs) {
            this.boundary = new Set(fresh.filter((r) => msOf(r.ts) === newest).map((r) => r.raw));
        } else if (newest !== null) {
            for (const r of fresh) if (msOf(r.ts) === newest) this.boundary.add(r.raw);
        }
        this.ms = newest;
        return fresh;
    }

    /** Where the next poll starts: one millisecond before the newest line, or null before any. */
    sinceTime(): string | null {
        return this.ms === null ? null : new Date(this.ms - 1).toISOString();
    }
}

/** Order lines by timestamp, keeping each pod's order among equals (`sort` is stable). */
function byTime(records: LogRecord[]): LogRecord[] {
    if (!records.every((r) => msOf(r.ts) !== null)) return records;
    return [...records].sort((a, b) => (msOf(a.ts) as number) - (msOf(b.ts) as number));
}

/* ═══════════════════════════════════════════════════════════════
   Follow
   ═══════════════════════════════════════════════════════════════ */

/** Something a follower says besides a log line. */
export type FollowEvent =
    | { event: "no_pods"; message: string }
    | { event: "pod_added"; pod: string }
    | { event: "pod_removed"; pod: string }
    | { event: "pod_state"; pod: string; state: string; message: string | null }
    | { event: "pod_restarted"; pod: string; restarts: number; missed: number }
    | { event: "truncated"; message: string }
    | { event: "server_error"; message: string }
    | { event: "reconnecting"; message: string; retryInMs: number }
    | { event: "reconnected" };

export interface FollowSink {
    line(rec: LogRecord): void;
    event(e: FollowEvent): void;
}

export interface FollowDeps {
    fetch(q: RuntimeLogsQuery): Promise<RuntimeLogsPage>;
    /** Resolves after `ms`, or as soon as `signal` aborts. */
    sleep(ms: number, signal: AbortSignal): Promise<void>;
    signal: AbortSignal;
    sink: FollowSink;
    /** A monotonic clock, in milliseconds. */
    now(): number;
    /** Whether a failed poll is worth retrying. */
    isTransient(e: unknown): boolean;
    intervalMs?: number;
    pollTimeoutMs?: number;
}

export interface FollowOptions {
    /** The first poll, as the flags asked for it. */
    initial: RuntimeLogsQuery;
    filter: (rec: LogRecord) => boolean;
}

class PollTimeout extends Error {
    constructor(ms: number) {
        super(`no answer within ${Math.round(ms / 1000)}s`);
    }
}

/** Resolve with `p`, or reject when `ms` passes or `signal` aborts (resolving undefined then). */
function bounded<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
        const timer = setTimeout(() => reject(new PollTimeout(ms)), ms);
        const onAbort = (): void => {
            clearTimeout(timer);
            resolve(undefined);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        p.then(
            (v) => {
                clearTimeout(timer);
                signal.removeEventListener("abort", onAbort);
                resolve(v);
            },
            (e: unknown) => {
                clearTimeout(timer);
                signal.removeEventListener("abort", onAbort);
                reject(e);
            }
        );
    });
}

/** The delay before retry `attempt` (1-based): 2s, 4s, 8s, 16s, then 30s. */
export function backoffMs(attempt: number, base = FOLLOW_INTERVAL_MS): number {
    return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.max(0, attempt - 1));
}

/**
 * Poll until `deps.signal` aborts. Returns normally then; throws only a
 * failure that is not worth retrying (the caller reports it).
 */
export async function followRuntimeLogs(deps: FollowDeps, opts: FollowOptions): Promise<void> {
    const interval = deps.intervalMs ?? FOLLOW_INTERVAL_MS;
    const timeoutMs = deps.pollTimeoutMs ?? POLL_TIMEOUT_MS;
    const { signal, sink } = deps;
    const cursor = new FollowCursor();

    /** Pod name → last state and restart count seen. Null until the first answer with pods. */
    let known: Map<string, { state: string; restarts: number | null }> | null = null;
    let waitingForPods = false;
    let failures = 0;
    let lastServerError: string | null = null;
    let first = true;
    /** When the last poll was sent, for the cursor-less window. */
    let lastSentAt: number | null = null;

    const nextQuery = (): RuntimeLogsQuery => {
        if (first) return opts.initial;
        const base: RuntimeLogsQuery = {
            // As wide as the route allows: a chatty app writes more than the
            // default 500 lines in two seconds, and the window is only as old
            // as the last line printed anyway.
            tailLines: SERVER_MAX_TAIL_LINES,
            preview: opts.initial.preview
        };
        const since = cursor.sinceTime();
        if (since !== null) return { ...base, sinceTime: since };
        // Nothing timestamped printed yet. Everything up to the last poll was
        // read and was empty, so ask for the time since then — a duration,
        // measured on our clock and applied on the kubelet's, so their skew
        // does not matter. One second more, for the rounding.
        if (lastSentAt !== null) {
            return { ...base, sinceSeconds: Math.max(1, Math.ceil((deps.now() - lastSentAt) / 1000) + 1) };
        }
        return opts.initial;
    };

    while (!signal.aborted) {
        const q = nextQuery();
        const sentAt = deps.now();
        let page: RuntimeLogsPage | undefined;
        try {
            page = await bounded(deps.fetch(q), timeoutMs, signal);
        } catch (e) {
            if (!(e instanceof PollTimeout) && !deps.isTransient(e)) throw e;
            failures += 1;
            const retryInMs = backoffMs(failures, interval);
            sink.event({ event: "reconnecting", message: e instanceof Error ? e.message : String(e), retryInMs });
            await deps.sleep(retryInMs, signal);
            continue;
        }
        if (signal.aborted || page === undefined) break;
        if (failures > 0) sink.event({ event: "reconnected" });
        failures = 0;
        first = false;
        lastSentAt = sentAt;

        if (page.state === "no_pods") {
            if (!waitingForPods) sink.event({ event: "no_pods", message: page.message ?? "No pods are running for this project." });
            waitingForPods = true;
            if (known) for (const pod of known.keys()) sink.event({ event: "pod_removed", pod });
            known = new Map();
            await deps.sleep(interval, signal);
            continue;
        }
        if (page.state === "error") {
            const message = page.message ?? "The control plane could not read the logs.";
            if (message !== lastServerError) sink.event({ event: "server_error", message });
            lastServerError = message;
            failures += 1;
            await deps.sleep(backoffMs(failures, interval), signal);
            continue;
        }
        lastServerError = null;
        waitingForPods = false;

        const pods = page.pods ?? [];
        const restarted: Array<{ pod: string; restarts: number; missed: number }> = [];
        const next = new Map<string, { state: string; restarts: number | null }>();
        for (const p of pods) {
            const restarts = typeof p.restarts === "number" ? p.restarts : null;
            const before = known?.get(p.pod);
            next.set(p.pod, { state: p.state, restarts });
            if (known && !before) sink.event({ event: "pod_added", pod: p.pod });
            // A state worth saying out loud: the first time a pod is seen in
            // it, and each time it changes. Never on every poll.
            if ((before?.state ?? "ok") !== p.state && p.state !== "ok") {
                sink.event({ event: "pod_state", pod: p.pod, state: p.state, message: p.message ?? null });
            } else if (before && before.state !== "ok" && p.state === "ok") {
                sink.event({ event: "pod_state", pod: p.pod, state: "ok", message: null });
            }
            if (before && before.restarts !== null && restarts !== null && restarts > before.restarts) {
                restarted.push({ pod: p.pod, restarts, missed: restarts - before.restarts - 1 });
            }
        }
        if (known) for (const pod of known.keys()) if (!next.has(pod)) sink.event({ event: "pod_removed", pod });
        known = next;

        let records = parseRecords(page.logs);

        // The instance that died between the two polls: its tail is the
        // reason, and it is only in `previous`. Read over the same window.
        if (restarted.length > 0) {
            for (const r of restarted) sink.event({ event: "pod_restarted", ...r });
            try {
                const prev = await bounded(deps.fetch({ ...q, previous: true }), timeoutMs, signal);
                const names = new Set(restarted.map((r) => r.pod));
                const tail = parseRecords(prev?.logs).filter((r) => r.pod !== null && names.has(r.pod));
                records = byTime([...tail, ...records]);
            } catch (e) {
                if (!(e instanceof PollTimeout) && !deps.isTransient(e)) throw e;
                // The live log is still worth printing; the dead instance's
                // tail stays readable with --previous.
            }
        }

        for (const rec of cursor.admit(records)) {
            if (opts.filter(rec)) sink.line(rec);
        }

        // A follow poll cut short skipped lines: by a byte budget, or — after
        // the first poll, whose tail is what the flags asked for — by the line
        // limit, which only a burst of more than that many lines reaches.
        const tailCut = q !== opts.initial && q.tailLines !== undefined
            && pods.some((p) => p.state === "ok" && p.lines >= (q.tailLines as number));
        if (page.truncated || pods.some((p) => p.truncated) || tailCut) {
            sink.event({
                event: "truncated",
                message: "More was written than one poll returns; some lines in this window were skipped."
            });
        }

        await deps.sleep(interval, signal);
    }
}

/* ═══════════════════════════════════════════════════════════════
   Output
   ═══════════════════════════════════════════════════════════════ */

/** Colour a line by its severity on a terminal; the text itself is never changed. */
export function paintLine(rec: LogRecord): string {
    const level = lineLevel(rec.text);
    if (level === "error") return chalk.red(rec.raw);
    if (level === "warn") return chalk.yellow(rec.raw);
    return rec.raw;
}

/** The human sentence for an event, or null for one that needs none. */
export function describeEvent(e: FollowEvent, opts: { preview?: string } = {}): string | null {
    const previous = opts.preview !== undefined
        ? `rebase cloud logs --runtime --previous --preview ${opts.preview}`
        : "rebase cloud logs --runtime --previous";
    switch (e.event) {
        case "no_pods":
            return `${e.message} Waiting for one to start…`;
        case "pod_added":
            return `Pod ${e.pod} started.`;
        case "pod_removed":
            return `Pod ${e.pod} is gone.`;
        case "pod_state":
            if (e.state === "ok") return `Pod ${e.pod} is running again.`;
            if (e.state === "not_ready") {
                return `Pod ${e.pod} is not running${e.message ? ` (${e.message})` : ""}. Its crashed instance: \`${previous}\`.`;
            }
            return `Pod ${e.pod}: ${e.state}${e.message ? ` — ${e.message}` : ""}`;
        case "pod_restarted":
            return e.missed > 0
                ? `Pod ${e.pod} restarted ${e.missed + 1} times since the last poll (restart ${e.restarts}); the last instance's final lines follow.`
                : `Pod ${e.pod} restarted (restart ${e.restarts}); the previous instance's final lines follow.`;
        case "truncated":
            return e.message;
        case "server_error":
            return `The control plane could not read the logs: ${e.message} Retrying…`;
        case "reconnecting":
            return `Lost the connection (${e.message}). Retrying in ${Math.round(e.retryInMs / 1000)}s…`;
        case "reconnected":
            return "Reconnected.";
    }
}
