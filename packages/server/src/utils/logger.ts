/**
 * Structured Logger for Rebase Backend
 *
 * Outputs JSON lines when `NODE_ENV=production`, human-readable prefixed
 * lines otherwise.  Designed to work with Google Cloud Logging severity levels.
 *
 * Every line — message and data, at any depth — passes through the redaction
 * below, which strips Drizzle's `Failed query: … / params: …` wrapper and the
 * values of secret-looking keys. See the block above `serialiseError`.
 *
 * Usage:
 *   import { logger } from "./utils/logger";
 *   logger.info("Server started", { port: 3001 });
 *   logger.error("Request failed", { path: "/api/test", error: err });
 *
 * Every host global goes through `./host`, and that is load-bearing rather than
 * tidy: this module is reachable from `@rebasepro/server/functions`, the
 * authoring surface that has to import cleanly on a runtime with no `process`.
 * A bare `process.env.NODE_ENV` here would make the first log line of the first
 * request on workerd a `ReferenceError`.
 */
import { hostEnv, writeLine } from "./host";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Google Cloud Logging severity strings. */
const GCP_SEVERITY: Record<LogLevel, string> = {
    debug: "DEBUG",
    info: "INFO",
    warn: "WARNING",
    error: "ERROR"
};

const LOG_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

export interface LogEntry {
    severity: string;
    message: string;
    timestamp: string;
    [key: string]: unknown;
}

export interface Logger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
    child(defaultFields: Record<string, unknown>): Logger;
}

function isProduction(): boolean {
    return hostEnv().NODE_ENV === "production";
}

/**
 * An explicit level from `config.logging.level`, when a project set one.
 *
 * Outranks `LOG_LEVEL` because it is the more specific statement: an
 * environment variable is the deployment's default, and this is the
 * application saying what it wants regardless of where it runs.
 *
 * There used to be a second, separate mechanism for this — `utils/logging.ts`
 * reassigned `console.debug`/`console.log`/`console.warn` to no-ops — and the
 * two disagreed in a way nobody could have guessed from either: `LOG_LEVEL=warn`
 * silenced this logger's info lines *and* every `console.log` in the process,
 * including a dependency's, including a project's own debugging. It also could
 * not be undone, because the originals were gone.
 */
let configuredLevel: LogLevel | undefined;

/**
 * Set the level from configuration. `undefined` returns to `LOG_LEVEL`.
 *
 * Read per line rather than captured at construction, so a logger created
 * before configuration is read still honours it — which the singleton below
 * always is.
 */
export function setLogLevel(level?: LogLevel): void {
    configuredLevel = level;
}

function getMinLevel(): LogLevel {
    if (configuredLevel) return configuredLevel;
    const env = (hostEnv().LOG_LEVEL || "info").toLowerCase();
    if (env in LOG_PRIORITY) return env as LogLevel;
    return "info";
}

// ── Redaction ───────────────────────────────────────────────────────
//
// Drizzle builds every query failure as
// `Failed query: ${query}\nparams: ${params}` (drizzle-orm/errors.js), so the
// statement *and* every bound value ride along in `.message` and `.stack` of
// whatever a driver rethrows — an email and a bcrypt hash reach stdout the
// moment a registration hits a unique violation. The redaction lives here, in
// the one function every log line passes through, rather than at the ~124
// `{ error: … }` call sites: a per-site rule is what produced the leak (one
// file suppressed the stack, four others did not), and the next caller would
// reintroduce it. Nothing above this line needs to know about it.

const FAILED_QUERY_MARKER = "Failed query:";
/**
 * The marker says how to lift it.
 *
 * Every DDL, RLS and CDC failure ends at this string, and the statement is the
 * whole diagnosis — three of them landed in one boot of a two-database project,
 * each a dead end. The switch existed; nothing named it, in the log or in the
 * docs, so `grep -rn REBASE_LOG_RAW_QUERIES` over the documentation, the
 * templates and the agent skills came back empty.
 */
const REDACTED_QUERY =
    "Failed query: [redacted — set REBASE_LOG_RAW_QUERIES=true in development to see it]";
const REDACTED_VALUE = "[redacted]";

/**
 * Key fragments whose values are never safe to publish. Compared against the
 * key with separators and case removed, so `api_key`, `apiKey` and `API-KEY`
 * all match `apikey`.
 */
const SENSITIVE_KEY_FRAGMENTS = [
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "apikey",
    "authorization",
    "credential",
    "cookie",
    "privatekey",
    "sessionid"
];

/** Longest structure the redactor will walk before giving up. */
const MAX_REDACT_DEPTH = 8;

function isSensitiveKey(key: string): boolean {
    const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return SENSITIVE_KEY_FRAGMENTS.some(fragment => normalised.includes(fragment));
}

/**
 * Local escape hatch for the `Failed query:` strip only — the statement is the
 * fastest way to diagnose a failing query on a developer machine. Ignored in
 * production, so a runtime that inherits the variable cannot leak because of
 * it, and it never re-enables the key deny-list.
 */
function rawQueriesAllowed(): boolean {
    return hostEnv().NODE_ENV !== "production"
        && hostEnv().REBASE_LOG_RAW_QUERIES === "true";
}

/**
 * Strip every `Failed query: … / params: …` span out of a message or stack,
 * keeping the surrounding text (including stack frames, which carry no user
 * data). When no `params:` line follows the marker the rest of the string is
 * dropped: a statement of unknown extent is treated as sensitive rather than
 * guessed at.
 *
 * Idempotent, and it has to be: an already-redacted span still starts with the
 * marker but has no `params:` line, so a second pass over it would fall into
 * the drop-the-rest branch and eat the stack frames behind it. Redaction runs
 * more than once on the same string in practice — the cron scheduler redacts
 * before persisting and then logs the result.
 */
export function redactSensitiveText(text: string): string {
    if (!text.includes(FAILED_QUERY_MARKER) || rawQueriesAllowed()) return text;

    let out = text;
    let idx = out.indexOf(FAILED_QUERY_MARKER);
    while (idx !== -1) {
        if (out.startsWith(REDACTED_QUERY, idx)) {
            idx = out.indexOf(FAILED_QUERY_MARKER, idx + REDACTED_QUERY.length);
            continue;
        }
        const paramsIdx = out.indexOf("\nparams:", idx);
        let end: number;
        if (paramsIdx === -1) {
            end = out.length;
        } else {
            const eol = out.indexOf("\n", paramsIdx + 1);
            end = eol === -1 ? out.length : eol;
        }
        out = out.slice(0, idx) + REDACTED_QUERY + out.slice(end);
        idx = out.indexOf(FAILED_QUERY_MARKER, idx + REDACTED_QUERY.length);
    }
    return out;
}

/**
 * Diagnostic own-properties worth carrying up out of an error.
 *
 * These are what a socket failure actually says: `ECONNREFUSED` with the
 * `address` and `port` it was refused on, `ENOTFOUND` with the hostname that
 * did not resolve. They live as own-properties on the Node error rather than in
 * its message, so a serialiser that copies only `message` and `stack` prints a
 * boot failure that names no host, no port and no reason.
 *
 * Deliberately a fixed list rather than "every own-property": `DrizzleQueryError`
 * carries `query` and `params` beside its message, and copying those would put
 * the statement and its bound values — an email, a bcrypt hash — straight back
 * on stdout, which is what the redaction above exists to prevent. Postgres's own
 * `detail` and `hint` are left out for the same reason: `23505` reports
 * `Key (email)=(a@b.c) already exists.`, which is a row's contents.
 */
const ERROR_DETAIL_KEYS = ["code", "errno", "syscall", "address", "port", "hostname"] as const;

/** How far the cause chain is followed before the serialiser gives up. */
const MAX_CAUSE_DEPTH = 4;

/** How many of an `AggregateError`'s children are serialised. */
const MAX_AGGREGATE_ERRORS = 4;

/**
 * Serialise an Error into a plain object, with the query text redacted out of
 * its message and stack. `query`/`params` own-properties — which
 * `DrizzleQueryError` carries beside the message — are deliberately not copied.
 *
 * The chain matters more than the top. Everything a driver rethrows is a
 * wrapper: Drizzle's is `Failed query: SELECT 1` with a stack through drizzle
 * internals, and the sentence that says what is wrong — `connect ECONNREFUSED
 * 127.0.0.1:5432`, `password authentication failed for user "app"` — sits in
 * `.cause`, or inside the `AggregateError.errors` that `net` raises when every
 * resolved address is refused. Serialising only the wrapper is why a boot
 * against a stopped database used to log a redacted query and nothing else.
 *
 * Handles non-Error values gracefully.
 */
function serialiseError(value: unknown, depth = 0): Record<string, unknown> {
    const isError = value instanceof Error;
    // A cause is not always an Error: drivers throw plain `{ code, address,
    // port }` bags, and stringifying one yields `[object Object]`, which is
    // worse than nothing. Only the named fields are copied out of it — the same
    // fixed list, for the same reason.
    const isDetailBag = !isError && depth > 0 && Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (!isError && !isDetailBag) {
        return { value: redactSensitiveText(String(value)) };
    }

    const own = value as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = isError
        ? {
            name: (value as Error).name,
            message: redactSensitiveText((value as Error).message),
            stack: (value as Error).stack ? redactSensitiveText((value as Error).stack as string) : undefined
        }
        : {
            ...(typeof own.name === "string" ? { name: own.name } : {}),
            ...(typeof own.message === "string" ? { message: redactSensitiveText(own.message) } : {})
        };

    for (const key of ERROR_DETAIL_KEYS) {
        const detail = own[key];
        if (detail === undefined || detail === null) continue;
        if (typeof detail === "object") continue;
        out[key] = typeof detail === "string" ? redactSensitiveText(detail) : detail;
    }

    if (depth >= MAX_CAUSE_DEPTH) return out;

    if (own.cause !== undefined && own.cause !== null) {
        out.cause = serialiseError(own.cause, depth + 1);
    }
    const aggregated = own.errors;
    if (Array.isArray(aggregated) && aggregated.length > 0) {
        out.errors = aggregated
            .slice(0, MAX_AGGREGATE_ERRORS)
            .map(item => serialiseError(item, depth + 1));
    }
    return out;
}

/**
 * Redact one logged value: errors are serialised, strings are stripped of
 * query text, objects and arrays are walked. Cycles and over-deep structures
 * collapse to a marker rather than throwing — a logger that can fail is worse
 * than one that logs less. (An object referenced twice in one payload is
 * reported as `[circular]` the second time; bounding the walk matters more
 * than rendering a shared reference twice.)
 */
function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    // `serialiseError` returns only already-redacted strings, so it is the
    // terminal step — walking its output again would redact twice.
    if (value instanceof Error) return serialiseError(value);
    if (typeof value === "string") return redactSensitiveText(value);
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_REDACT_DEPTH) return "[truncated]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map(item => redactValue(item, depth + 1, seen));
    }
    if (value instanceof Date) return value;

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        out[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactValue(val, depth + 1, seen);
    }
    return out;
}

function formatData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined;
    const seen = new WeakSet<object>();
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
        out[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactValue(val, 0, seen);
    }
    return out;
}

/**
 * Something that wants a copy of every line this logger writes.
 *
 * Receives the message and fields *after* redaction, never before: a sink is
 * another destination for the same line, and the one thing that must not vary
 * by destination is whether the query and its bound values are in it.
 */
export type LogSink = (
    level: LogLevel,
    message: string,
    data: Record<string, unknown>
) => void;

const sinks = new Set<LogSink>();

/**
 * Tee this logger somewhere else. Returns the unsubscribe.
 *
 * The Studio's Logs Explorer is the caller: its ring buffer used to be fed only
 * by a request middleware, so the panel showed a wall of `GET … 200` and not one
 * of the errors, warnings or diagnoses the server was writing to stdout at the
 * same moment. A log viewer that cannot show you an error is a log viewer
 * nobody opens twice.
 *
 * A sink MUST NOT log. It is called from inside `emit`, so anything that comes
 * back through `logger` recurses; the guard below stops the stack blowing, but
 * the line is dropped rather than delivered, which is its own bug.
 */
export function addLogSink(sink: LogSink): () => void {
    sinks.add(sink);
    return () => { sinks.delete(sink); };
}

/** Re-entrancy guard: see `addLogSink`. */
let inSink = false;

function fanOut(level: LogLevel, message: string, data: Record<string, unknown>): void {
    if (sinks.size === 0 || inSink) return;
    inSink = true;
    try {
        for (const sink of sinks) {
            // One broken sink must not take down the line, nor the request that
            // was writing it.
            try { sink(level, message, data); } catch { /* a broken tee is not the caller's problem */ }
        }
    } finally {
        inSink = false;
    }
}

function createLogger(rawDefaultFields: Record<string, unknown> = {}): Logger {
    // Child fields go through the same pass as per-call data — they are merged
    // into every line this logger emits, so leaving them raw would be a hole
    // the moment `child()` gets its first caller.
    const defaultFields = formatData(rawDefaultFields) ?? {};

    function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        // Per line, not captured at construction: the singleton is created when
        // this module is first imported, which is long before a project's
        // `config.logging.level` has been read.
        if (LOG_PRIORITY[level] < LOG_PRIORITY[getMinLevel()]) return;

        // The message is redacted too, not just the data: several call sites
        // interpolate `error.message` straight into the line they log.
        const safeMessage = redactSensitiveText(message);
        const merged = { ...defaultFields,
...formatData(data) };

        // Before the write, so a sink still sees the line if stdout is the
        // thing that is broken.
        fanOut(level, safeMessage, merged);

        if (isProduction()) {
            // Structured JSON for Cloud Logging
            const entry: LogEntry = {
                severity: GCP_SEVERITY[level],
                message: safeMessage,
                timestamp: new Date().toISOString(),
                ...merged
            };
            const line = JSON.stringify(entry);

            if (level === "error") {
                writeLine("err", line);
            } else {
                writeLine("out", line);
            }
        } else {
            // Human-readable for development
            const prefix = level === "error" ? "❌"
                : level === "warn" ? "⚠️"
                : level === "info" ? "ℹ️"
                : "🐛";
            const extra = Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : "";
            const out = `${prefix} [${level.toUpperCase()}] ${safeMessage}${extra}`;

            if (level === "error") {
                console.error(out);
            } else if (level === "warn") {
                console.warn(out);
            } else {
                console.log(out);
            }
        }
    }

    return {
        debug: (msg, data) => emit("debug", msg, data),
        info: (msg, data) => emit("info", msg, data),
        warn: (msg, data) => emit("warn", msg, data),
        error: (msg, data) => emit("error", msg, data),
        child(fields: Record<string, unknown>): Logger {
            return createLogger({ ...defaultFields,
...fields });
        }
    };
}

/**
 * Singleton logger instance.
 * In production: emits JSON lines with `severity`, `message`, `timestamp`.
 * In development: emits human-readable prefixed lines.
 */
export const logger: Logger = createLogger();

/**
 * The cause chain, one readable line per link.
 *
 * `serialiseError` puts the chain in the structured payload, which is the right
 * place for a log aggregator and the wrong place for a person staring at a
 * container that will not start: the sentence they need is inside a JSON blob
 * behind an escaped stack trace. This renders the same chain as lines to print
 * beside the headline, so the first thing on screen after "Failed to start" is
 * `caused by: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)`.
 *
 * Redacted like everything else, and bounded by the same depth: a chain is
 * usually two links and never usefully more than four.
 */
export function describeCauseChain(error: unknown): string[] {
    const lines: string[] = [];
    const seen = new Set<unknown>();

    const walk = (value: unknown, depth: number): void => {
        if (depth > MAX_CAUSE_DEPTH || value === undefined || value === null) return;
        if (typeof value === "object") {
            if (seen.has(value)) return;
            seen.add(value);
        }
        if (depth > 0) {
            const described = describeOneCause(value);
            if (described) lines.push(`caused by: ${described}`);
        }
        if (typeof value !== "object") return;
        const own = value as Record<string, unknown>;
        walk(own.cause, depth + 1);
        const aggregated = own.errors;
        if (Array.isArray(aggregated)) {
            for (const item of aggregated.slice(0, MAX_AGGREGATE_ERRORS)) walk(item, depth + 1);
        }
    };

    walk(error, 0);
    return lines;
}

/** One cause rendered as `message (CODE) address:port`, or nothing to say. */
function describeOneCause(value: unknown): string | undefined {
    if (value === null || typeof value !== "object") {
        const text = redactSensitiveText(String(value));
        return text || undefined;
    }
    const own = value as Record<string, unknown>;
    const message = typeof own.message === "string" && own.message
        ? redactSensitiveText(own.message)
        : undefined;
    const code = typeof own.code === "string" ? own.code : undefined;
    // Only when the message does not already carry it. Node writes
    // `connect ECONNREFUSED 127.0.0.1:5432` and also sets `address`/`port`, and
    // repeating the endpoint reads like two different facts.
    const endpoint = own.address !== undefined && own.port !== undefined
        ? `${String(own.address)}:${String(own.port)}`
        : undefined;
    const where = endpoint && !(message ?? "").includes(endpoint) ? endpoint : undefined;
    const parts = [message ?? code, code && message ? `(${code})` : undefined, where]
        .filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
}
