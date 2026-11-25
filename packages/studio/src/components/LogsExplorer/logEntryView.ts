import type { LogEntry } from "./useLogTail";

/**
 * How one log entry reads on screen: the request sentence, the pills beside a
 * collapsed row, and the text a copy hands back.
 *
 * Pure, so the rules are tested without rendering. The row grammar is the one
 * the Cloud console's runtime-logs view uses, so the same request reads the
 * same in both places.
 */

/**
 * A request entry read as one line: `GET /api/data/posts 404 · 16 ms`.
 *
 * The server records every request with `method`, `path` and `status` in its
 * metadata, and the time it took as `duration` (the ring) or `latencyMs` (the
 * stdout record). An entry without all three is not a request and keeps its
 * message.
 */
export interface RequestSummary {
    method: string;
    path: string;
    status: number;
    latencyMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    /** The metadata the sentence does not already say, for the pills. */
    rest: Record<string, unknown>;
}

/** Keys the request sentence says, so a pill repeating one is noise. */
const REQUEST_KEYS = new Set(["method", "path", "status", "duration", "latencyMs", "errorCode", "errorMessage"]);

export function requestSummary(entry: Pick<LogEntry, "metadata">): RequestSummary | null {
    const m = entry.metadata;
    if (!m) return null;
    const { method, path, status } = m;
    if (typeof method !== "string" || typeof path !== "string" || typeof status !== "number") return null;
    const latency = typeof m.latencyMs === "number" ? m.latencyMs : typeof m.duration === "number" ? m.duration : null;
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m)) if (!REQUEST_KEYS.has(k)) rest[k] = v;
    return {
        method,
        path,
        status,
        latencyMs: latency,
        errorCode: typeof m.errorCode === "string" ? m.errorCode : null,
        errorMessage: typeof m.errorMessage === "string" ? m.errorMessage : null,
        rest
    };
}

/** The colour family a status reads as: 5xx red, 4xx amber, the rest green. */
export function statusTone(status: number): "error" | "warn" | "ok" {
    if (status >= 500) return "error";
    if (status >= 400) return "warn";
    return "ok";
}

/**
 * The fields worth reading without opening a row, in the order they are worth
 * it: the id that joins a line to everything else about the same request, the
 * machine-readable reason, then who and what.
 */
const PILL_PRIORITY = ["requestId", "errorCode", "status", "uid", "collection", "jobId", "component", "route"];

/** How many pills a collapsed row shows before "+N". */
export const MAX_PILLS = 4;

/**
 * The fields a collapsed row shows as pills, most useful first, and how many
 * more the row holds.
 *
 * Values that would read as nothing (`null`, `""`, an empty object) are left
 * to the expanded view.
 */
export function pillFields(fields: Record<string, unknown> | undefined): { pills: Array<[string, unknown]>; more: number } {
    if (!fields) return { pills: [], more: 0 };
    const shown = Object.entries(fields).filter(([, v]) => formatFieldValue(v) !== "");
    const rank = (key: string) => {
        const at = PILL_PRIORITY.indexOf(key);
        return at === -1 ? PILL_PRIORITY.length : at;
    };
    // A stable sort, so fields outside the priority list keep the order the
    // server wrote them in.
    const ordered = [...shown].sort(([a], [b]) => rank(a) - rank(b));
    return { pills: ordered.slice(0, MAX_PILLS), more: Math.max(0, ordered.length - MAX_PILLS) };
}

/** A field value compactly enough to sit inline on one row. */
export function formatFieldValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        const text = JSON.stringify(value) ?? "";
        return text === "{}" || text === "[]" ? "" : text;
    } catch {
        return String(value);
    }
}

/** Whether a row holds anything beyond its one line, and so is worth expanding. */
export function hasMetadata(entry: Pick<LogEntry, "metadata">): boolean {
    return entry.metadata !== undefined && Object.keys(entry.metadata).length > 0;
}

/** One entry as the JSON a bug report or an agent reads. */
export function entryToJson(entry: LogEntry): string {
    return JSON.stringify({
        timestamp: entry.timestamp,
        level: entry.level,
        source: entry.source,
        message: entry.message,
        ...(hasMetadata(entry) ? { metadata: entry.metadata } : {})
    });
}

/** The entries on screen as JSON lines, oldest first: what "copy visible" hands back. */
export function entriesToJsonLines(entries: LogEntry[]): string {
    return entries.map(entryToJson).join("\n");
}
