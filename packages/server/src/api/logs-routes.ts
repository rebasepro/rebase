import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { HonoEnv } from "./types";
import { ApiError, errorHandler } from "./errors";
import { addLogSink } from "../utils/logger";

export interface LogEntry {
    id: string;
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    source: "api" | "auth" | "storage" | "realtime" | "system";
    message: string;
    metadata?: Record<string, unknown>;
}

/** What a caller can narrow the log by, in either direction (query or stream). */
export interface LogFilterOptions {
    level?: string;
    source?: string;
    search?: string;
    since?: string;
}

/**
 * A filter with the search term already lowercased.
 *
 * The distinction matters on the stream path: `query()` lowercases once and then
 * scans, but a subscriber tests one entry at a time and would otherwise redo the
 * same `toLowerCase()` on every request the server handles.
 */
type NormalizedFilter = LogFilterOptions;

function normalizeFilter(options: LogFilterOptions): NormalizedFilter {
    return { ...options,
        search: options.search?.toLowerCase() };
}

/**
 * Whether one entry belongs in a filtered view.
 *
 * Shared by the query and the stream on purpose: two copies of this would drift,
 * and the failure that produces is invisible — a tail that quietly shows a
 * different set of lines than the snapshot it started from.
 */
function matchesFilter(entry: LogEntry, filter: NormalizedFilter): boolean {
    if (filter.level && entry.level !== filter.level) return false;
    if (filter.source && entry.source !== filter.source) return false;
    if (filter.search && !entry.message.toLowerCase().includes(filter.search)) return false;
    if (filter.since && entry.timestamp < filter.since) return false;
    return true;
}

/** Notified for every entry pushed, in push order. */
export type LogListener = (entry: LogEntry) => void;

class LogRingBuffer {
    private buffer: LogEntry[] = [];
    private maxSize: number;
    private idCounter = 0;
    private listeners = new Set<LogListener>();

    constructor(maxSize = 10000) {
        this.maxSize = maxSize;
    }

    push(entry: Omit<LogEntry, "id">): void {
        const id = `log_${++this.idCounter}`;
        const stored: LogEntry = { ...entry,
            id };
        this.buffer.push(stored);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
        // This runs on the request hot path, so a listener must never be able to
        // take the request down with it: a tail that throws loses its own tail,
        // not the response the log line was describing.
        for (const listener of this.listeners) {
            try {
                listener(stored);
            } catch {
                /* a broken tail is not the request's problem */
            }
        }
    }

    /**
     * Follow the buffer. Returns the unsubscribe — call it, always: a listener
     * left behind holds its whole closure, and on this class that closure is a
     * pending-entry array.
     *
     * A listener must not log. It is called from inside `push`, so anything that
     * reaches `addLog` from here recurses until the stack gives out.
     */
    subscribe(listener: LogListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    query(options: LogFilterOptions & {
        limit?: number;
        offset?: number;
    }): { entries: LogEntry[]; total: number } {
        const filter = normalizeFilter(options);
        const filtered = this.buffer.filter(e => matchesFilter(e, filter));

        // Newest first
        const sorted = [...filtered].reverse();
        const total = sorted.length;
        const limit = options.limit || 100;
        const offset = options.offset || 0;

        return {
            entries: sorted.slice(offset, offset + limit),
            total
        };
    }

    getLatest(count = 50): LogEntry[] {
        return this.buffer.slice(-count).reverse();
    }
}

// Global singleton
export const logBuffer = new LogRingBuffer();

/** Add a log entry */
export function addLog(
    level: LogEntry["level"],
    source: LogEntry["source"],
    message: string,
    metadata?: Record<string, unknown>
): void {
    logBuffer.push({
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        metadata
    });
}

export interface LogMiddlewareOptions {
    /**
     * Paths this sink ignores, matched exactly against `c.req.path`.
     *
     * For requests whose only reason to exist is to read the log. Recording
     * those makes the reader the loudest thing in its own output, and on a quiet
     * server it is also the thing evicting real entries out of the ring.
     */
    ignorePaths?: string[];
}

/** Hono middleware to log API requests */
export function logMiddleware(options: LogMiddlewareOptions = {}): MiddlewareHandler<HonoEnv> {
    const ignored = new Set(options.ignorePaths ?? []);
    return async (c, next) => {
        const start = Date.now();
        await next();
        if (ignored.has(c.req.path)) return;
        const duration = Date.now() - start;
        const reqId = c.get("requestId");
        // Every request used to be recorded at `info`, whatever it answered, so
        // the Logs Explorer's level filter could not find a single failure: a
        // 500 sat at the same level as the 200 above it, in a wall of them.
        const status = c.res.status;
        const level: LogEntry["level"] = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
        // What the error handler answered, so the failure is on the entry
        // rather than in a stdout line the panel cannot see. See
        // `HonoEnv.Variables.errorSummary`.
        const failure = c.get("errorSummary");
        addLog(
            level,
            "api",
            `${c.req.method} ${c.req.path} ${status} ${duration}ms`
                + (failure ? ` — ${failure.code}: ${failure.message}` : ""),
            {
                method: c.req.method,
                path: c.req.path,
                status,
                duration,
                ...(reqId && { requestId: reqId }),
                ...(c.get("collection") && { collection: c.get("collection") }),
                ...(failure && { errorCode: failure.code, errorMessage: failure.message })
            }
        );
    };
}

/**
 * Prefixes the server writes at the head of a log message, and the `source`
 * each one belongs to.
 *
 * The ring's `source` is a closed set the Studio filters on, and the messages
 * carry their origin as a bracketed prefix — `[API]`, `[Auth]`, `[functions]`,
 * `[schema]`. Matching them is what makes a teed line filterable beside the
 * request entries rather than a heap under "system".
 */
const SOURCE_BY_PREFIX: Array<[RegExp, LogEntry["source"]]> = [
    [/^\[?(api|rest)\b/i, "api"],
    [/^\[?auth\b/i, "auth"],
    [/^\[?(storage|s3|gcs)\b/i, "storage"],
    [/^\[?(realtime|ws|websocket|cdc)\b/i, "realtime"]
];

/**
 * The `source` for a teed line, from whatever prefix it carries.
 *
 * Exported for its test: the mapping is a string match on wording somebody else
 * writes, which is the shape of check that stops working without failing.
 */
export function sourceForMessage(message: string): LogEntry["source"] {
    // The level emoji comes first on several call sites (`⚠️ [API] …`), so the
    // prefix is whatever is inside the first bracket, wherever that is.
    const bracketed = message.match(/\[([^\]]{1,32})\]/);
    const candidate = bracketed?.[1] ?? message;
    for (const [pattern, source] of SOURCE_BY_PREFIX) {
        if (pattern.test(candidate)) return source;
    }
    return "system";
}

/**
 * Feed the Logs Explorer everything the server says at warn and above.
 *
 * The ring used to be filled by `logMiddleware` alone, so the panel showed a
 * wall of `GET /api/data/posts 200 4ms` and not one of the errors, warnings or
 * boot diagnoses being written to stdout at the same moment. A function that
 * threw was the sharpest case: the request entry said `500` and the reason
 * existed only in a terminal the person looking at the panel does not have.
 *
 * Warn and above, deliberately. `info` is where the steady-state chatter lives,
 * and a 10,000-entry ring filled with it evicts the lines somebody opened the
 * panel to find.
 *
 * Idempotent: called from `createLogsRoutes`, which a split deployment may
 * reach more than once.
 */
let detachLoggerTee: (() => void) | undefined;
export function teeLoggerIntoLogBuffer(): () => void {
    if (detachLoggerTee) return detachLoggerTee;
    const detach = addLogSink((level, message, data) => {
        if (level !== "warn" && level !== "error") return;
        // `requestLogger` writes this one to stdout for every request, and
        // `logMiddleware` has already recorded the same request here with the
        // fields this panel renders. Teeing it too would double every failure.
        if (message === "request") return;
        addLog(level, sourceForMessage(message), message, Object.keys(data).length > 0 ? data : undefined);
    });
    detachLoggerTee = () => {
        detach();
        detachLoggerTee = undefined;
    };
    return detachLoggerTee;
}

/**
 * How long entries accumulate before a batch goes out.
 *
 * Not zero, and that is the point. A busy server logs faster than a browser can
 * render, and one SSE frame per line would hand the client a re-render per
 * request served — worse than the 3s poll this replaces, precisely when the logs
 * are worth watching. Coalescing keeps the frame rate bounded by the window
 * rather than by traffic, and 250ms still reads as "live" to a person.
 */
const STREAM_FLUSH_MS = 250;

/**
 * Idle gap after which the stream sends a comment line.
 *
 * A silent SSE connection is indistinguishable from a dead one to everything in
 * between — proxies, load balancers and laptop NICs all reap idle sockets, and a
 * server with nothing to say is the normal state here.
 */
const STREAM_HEARTBEAT_MS = 25_000;

/**
 * Entries a single connection will hold between flushes.
 *
 * This is a *rate* ceiling, not just a memory bound, and that is easy to get
 * wrong: nothing drains `pending` between flushes, so the most a connection can
 * carry losslessly is `maxPending` per `flushMs` — here 2000 per 250ms, or 8000
 * entries a second. Above that the oldest pending entries go and the client is
 * told how many, whatever speed it is reading at.
 *
 * It was 500, which put that ceiling at 2000/s. A healthy reader on a loopback
 * socket lost 85% of a 20k burst to it — the cap fired on the server's own
 * coalescing window rather than on any slowness at the client, which is a drop
 * notice that says nothing true about why. 8000/s is past what one Node process
 * serves, so reaching it now means genuinely more log than a person can be shown.
 *
 * The memory this bounds is the copy a *stalled* reader causes: roughly 2000
 * entries, a few MB, per stuck connection.
 */
const STREAM_MAX_PENDING = 2000;

/**
 * The largest window any of these routes will hand back.
 *
 * The ring buffer holds 10,000 entries, so asking for more than all of it is a
 * mistake worth naming rather than silently clamping — and a clamped answer is
 * indistinguishable from "that is all there is".
 */
const LOG_WINDOW_MAX = 10_000;

/**
 * The stream's timings, injectable only so they can be tested.
 *
 * The defaults above are the contract and nothing in production passes this. A
 * heartbeat is a 25-second wait to observe, and a suite that cannot observe it is
 * a suite where the keepalive can rot — which surfaces as "the tail dies after a
 * few minutes behind the load balancer", months later, on someone else's cluster.
 */
export interface LogStreamTiming {
    flushMs?: number;
    heartbeatMs?: number;
    maxPending?: number;
}

export function createLogsRoutes(timing: LogStreamTiming = {}): Hono<HonoEnv> {
    // Here rather than at module load: the ring exists whether or not anything
    // reads it, but there is no reason to fill it on a process that serves no
    // logs surface. Idempotent, so the repeated calls a split deployment makes
    // do not stack up sinks.
    teeLoggerIntoLogBuffer();

    const flushMs = timing.flushMs ?? STREAM_FLUSH_MS;
    const heartbeatMs = timing.heartbeatMs ?? STREAM_HEARTBEAT_MS;
    const maxPending = timing.maxPending ?? STREAM_MAX_PENDING;

    const app = new Hono<HonoEnv>();
    // Its own, like every other router here: nothing registers one on the host
    // app — not `boot.ts`, not the scaffolded backend, not the eject template —
    // so a router that throws without this answers Hono's default 500 in plain
    // text, outside the `{ error: { code, message } }` envelope the rest of the
    // API keeps to.
    app.onError(errorHandler);

    /**
     * A window into the ring buffer, or a 400 saying why not.
     *
     * `parseInt` was the whole of it before, and every malformed value failed
     * differently and silently: `?limit=abc` fell through to the default,
     * `?limit=-5` sliced an empty window and answered 200 with no entries, and
     * `?count=abc` made `slice(-NaN)` return the *entire* buffer. Three ways to
     * be wrong, none of them visible to the caller. The data plane refuses the
     * same input with a 400 — see `resolveListLimitParam`.
     */
    const window = (raw: string | undefined, what: string, max: number): number | undefined => {
        if (raw === undefined || raw.trim() === "") return undefined;
        const parsed = Number(raw.trim());
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
            throw new ApiError(
                400,
                "INVALID_PARAM",
                `Invalid \`${what}\`: ${raw}. Expected a whole number between 1 and ${max}.`,
                undefined,
                true
            );
        }
        return parsed;
    };

    // GET /api/logs — Query logs
    app.get("/", (c) => {
        const query = c.req.query();
        const result = logBuffer.query({
            level: query.level,
            source: query.source,
            search: query.search,
            limit: window(query.limit, "limit", LOG_WINDOW_MAX),
            offset: window(query.offset, "offset", Number.MAX_SAFE_INTEGER),
            since: query.since
        });
        return c.json(result);
    });

    // GET /api/logs/latest — Get latest logs (for real-time)
    app.get("/latest", (c) => {
        const count = window(c.req.query("count"), "count", LOG_WINDOW_MAX) ?? 50;
        return c.json({ entries: logBuffer.getLatest(count) });
    });

    // GET /api/logs/stream — tail the buffer over SSE.
    //
    // The Logs Explorer used to poll this router every 3 seconds, which cost a
    // request per client per 3s to say "nothing happened" and still showed each
    // line up to 3s late. Here the buffer pushes instead, so an idle server is an
    // idle socket.
    //
    // Events:
    //   snapshot  {entries, total}   the filtered window, oldest-first, at open
    //   append    {entries, dropped} entries since the last frame, oldest-first
    //   `: ping`                     comment, keepalive only
    //
    // Snapshot and appends come down the same connection deliberately. A client
    // that fetched its backlog separately would race the subscription — entries
    // logged between the two calls belong to neither — and closing that race from
    // the outside needs an id cursor and dedupe on every frame.
    app.get("/stream", (c) => {
        const query = c.req.query();
        const filter = normalizeFilter({
            level: query.level,
            source: query.source,
            search: query.search
        });
        const limit = window(query.limit, "limit", LOG_WINDOW_MAX) ?? 200;

        // Reverse proxies buffer text responses by default, which turns a live
        // tail into nothing at all until the buffer fills. nginx (and the ingress
        // in front of the managed runtime) reads this header; everything else
        // ignores it. The rest of the SSE headers are set by `streamSSE`.
        c.header("X-Accel-Buffering", "no");

        return streamSSE(c, async (stream) => {
            let pending: LogEntry[] = [];
            let dropped = 0;

            // Subscribe *before* reading the backlog, with nothing awaited
            // between the two. Both are synchronous, so the two halves meet
            // exactly: an entry logged after the query but before the
            // subscription would otherwise be in neither, and that gap is the one
            // thing this route exists to close.
            const unsubscribe = logBuffer.subscribe(entry => {
                if (!matchesFilter(entry, filter)) return;
                if (pending.length >= maxPending) {
                    pending.shift();
                    dropped++;
                }
                pending.push(entry);
            });
            const snapshot = logBuffer.query({ ...filter,
                limit });

            // A client that goes away has to end this handler, or the
            // subscription outlives the socket. `streamSSE` only wires the
            // request signal through on old Bun, so do it here and let
            // `stream.aborted` be the one condition the loop tests.
            //
            // The `aborted` check is not belt-and-braces. A listener added to an
            // already-aborted signal is never called, so a client that leaves
            // during the snapshot write — a fast navigation, or a reconnect storm
            // against a restarting server — would leave this handler with no way
            // to learn it had gone: a subscriber and a flush loop, per attempt,
            // for the life of the process.
            const abortOnDisconnect = () => {
                if (!stream.closed) stream.abort();
            };
            c.req.raw.signal.addEventListener("abort", abortOnDisconnect, { once: true });
            if (c.req.raw.signal.aborted) abortOnDisconnect();

            try {
                await stream.writeSSE({
                    event: "snapshot",
                    // The view tails like a terminal; both frames are oldest-first
                    // so the client only ever appends.
                    data: JSON.stringify({
                        entries: snapshot.entries.slice().reverse(),
                        total: snapshot.total
                    })
                });

                let idleMs = 0;
                while (!stream.aborted && !stream.closed) {
                    await stream.sleep(flushMs);
                    if (stream.aborted || stream.closed) break;

                    if (pending.length === 0) {
                        idleMs += flushMs;
                        if (idleMs >= heartbeatMs) {
                            await stream.write(": ping\n\n");
                            idleMs = 0;
                        }
                        continue;
                    }

                    const entries = pending;
                    const lost = dropped;
                    pending = [];
                    dropped = 0;
                    idleMs = 0;
                    await stream.writeSSE({
                        event: "append",
                        data: JSON.stringify(lost > 0 ? { entries,
                            dropped: lost } : { entries })
                    });
                }
            } finally {
                unsubscribe();
                c.req.raw.signal.removeEventListener("abort", abortOnDisconnect);
            }
        });
    });

    return app;
}

export default createLogsRoutes();
