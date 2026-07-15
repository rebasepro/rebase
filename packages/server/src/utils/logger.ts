/**
 * Structured Logger for Rebase Backend
 *
 * Outputs JSON lines when `NODE_ENV=production`, human-readable prefixed
 * lines otherwise.  Designed to work with Google Cloud Logging severity levels.
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

/**
 * Serialise an Error into a plain object (stack + message).
 * Handles non-Error values gracefully.
 */
function serialiseError(value: unknown): Record<string, unknown> {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack
        };
    }
    return { value: String(value) };
}

function formatData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
        if (val instanceof Error) {
            out[key] = serialiseError(val);
        } else {
            out[key] = val;
        }
    }
    return out;
}

function createLogger(defaultFields: Record<string, unknown> = {}): Logger {
    const minLevel = getMinLevel();

    function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        if (LOG_PRIORITY[level] < LOG_PRIORITY[minLevel]) return;

        const merged = { ...defaultFields,
...formatData(data) };

        if (isProduction()) {
            // Structured JSON for Cloud Logging
            const entry: LogEntry = {
                severity: GCP_SEVERITY[level],
                message,
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
            const out = `${prefix} [${level.toUpperCase()}] ${message}${extra}`;

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
