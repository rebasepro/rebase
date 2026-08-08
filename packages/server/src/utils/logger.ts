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
 */

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
    return process.env.NODE_ENV === "production";
}

function getMinLevel(): LogLevel {
    const env = (process.env.LOG_LEVEL || "info").toLowerCase();
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
const REDACTED_QUERY = "Failed query: [redacted]";
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
    return process.env.NODE_ENV !== "production"
        && process.env.REBASE_LOG_RAW_QUERIES === "true";
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
 * Serialise an Error into a plain object (stack + message), with the query
 * text redacted out of both. `query`/`params` own-properties — which
 * `DrizzleQueryError` carries beside the message — are deliberately not
 * copied.
 * Handles non-Error values gracefully.
 */
function serialiseError(value: unknown): Record<string, unknown> {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactSensitiveText(value.message),
            stack: value.stack ? redactSensitiveText(value.stack) : undefined
        };
    }
    return { value: redactSensitiveText(String(value)) };
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

function createLogger(rawDefaultFields: Record<string, unknown> = {}): Logger {
    const minLevel = getMinLevel();
    // Child fields go through the same pass as per-call data — they are merged
    // into every line this logger emits, so leaving them raw would be a hole
    // the moment `child()` gets its first caller.
    const defaultFields = formatData(rawDefaultFields) ?? {};

    function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        if (LOG_PRIORITY[level] < LOG_PRIORITY[minLevel]) return;

        // The message is redacted too, not just the data: several call sites
        // interpolate `error.message` straight into the line they log.
        const safeMessage = redactSensitiveText(message);
        const merged = { ...defaultFields,
...formatData(data) };

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
                process.stderr.write(line + "\n");
            } else {
                process.stdout.write(line + "\n");
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
