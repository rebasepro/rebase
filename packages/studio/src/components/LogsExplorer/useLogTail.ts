import { useEffect, useRef, useState } from "react";
import { useApiBase, useApiConfig } from "@rebasepro/app";

export interface LogEntry {
    id: string;
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    source: "api" | "auth" | "storage" | "realtime" | "system";
    message: string;
    metadata?: Record<string, unknown>;
}

export interface LogTailFilters {
    /** `"all"` and `undefined` both mean unfiltered. */
    level?: string;
    source?: string;
    search?: string;
}

/**
 * How the view is currently being fed.
 *
 * Surfaced rather than kept private: "connecting" and "polling" look identical
 * from the outside until something is wrong, and the first question about a log
 * view that seems stuck is whether it is actually live.
 */
export type LogTransport = "connecting" | "live" | "polling";

/**
 * Entries kept in the browser.
 *
 * The server window is 200; a tail that never forgets would grow without bound
 * on a busy backend, since nothing else here ever drops an entry.
 */
const MAX_ENTRIES = 1000;

/** Fallback cadence, used only against a server with no stream route. */
const POLL_MS = 3000;

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;

/** Ids are `log_<n>` off a monotonic counter, so numeric order is push order. */
export const idNum = (entry: LogEntry): number => Number(entry.id.slice("log_".length));

/** The window is contiguous and ordered, so identical ends mean identical content. */
export const sameLogs = (a: LogEntry[], b: LogEntry[]): boolean =>
    a.length === b.length &&
    a[0]?.id === b[0]?.id &&
    a[a.length - 1]?.id === b[b.length - 1]?.id;

/** One identity for "nothing", so clearing an already-empty view is not a change. */
const EMPTY: LogEntry[] = [];

const capped = (entries: LogEntry[]): LogEntry[] =>
    entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;

export interface SSEFrame {
    event: string;
    data: string;
}

/**
 * Split an SSE byte stream into frames.
 *
 * `EventSource` would do this, and cannot be used: logs are admin-only, and
 * `EventSource` has no way to send an `Authorization` header. So the stream is
 * read off `fetch` and framed here.
 *
 * Exported for its own test — the parser is the part with edge cases (a frame
 * split across two chunks, multi-line data, comment keepalives).
 */
export async function* readSSEFrames(
    body: ReadableStream<Uint8Array>
): AsyncGenerator<SSEFrame> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // `stream: true` keeps a multi-byte character split across two chunks
        // from decoding as two replacement characters.
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const frame = parseFrame(raw);
            if (frame) yield frame;
            boundary = buffer.indexOf("\n\n");
        }
    }
}

function parseFrame(raw: string): SSEFrame | null {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
        // A line starting with ":" is a comment. The server sends them as
        // keepalives, and they carry nothing.
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
    }
    if (data.length === 0) return null;
    return { event,
        data: data.join("\n") };
}

const buildParams = (filters: LogTailFilters, limit: number): string => {
    const params = new URLSearchParams();
    if (filters.level && filters.level !== "all") params.set("level", filters.level);
    if (filters.source && filters.source !== "all") params.set("source", filters.source);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", String(limit));
    return params.toString();
};

/**
 * Why the log is not being served, in the server's words where it has any.
 *
 * The admin gate answers 501 with a message naming the setting to change (a
 * backend with no `jwtSecret` and no auth adapter cannot tell an admin from the
 * internet, so it refuses rather than opens). Rendering "HTTP 501" over the top
 * of that would throw away the only sentence that says what to do.
 */
async function failureMessage(resp: { status: number; json?: () => Promise<unknown> }): Promise<string> {
    try {
        const body = await resp.json?.() as { error?: { message?: string } } | undefined;
        const message = body?.error?.message;
        if (typeof message === "string" && message) return message;
    } catch {
        /* not every failure has a JSON body */
    }
    return resp.status === 401 || resp.status === 403
        ? "Not authorised to read logs — an admin role is required."
        : `Could not load logs (HTTP ${resp.status}).`;
}

export interface LogTail {
    logs: LogEntry[];
    error: string | null;
    transport: LogTransport;
    /**
     * Entries the server had to discard because this client was not draining the
     * stream fast enough, since the connection opened.
     *
     * Surfaced rather than swallowed. The server bounds what it will hold per
     * connection, so under a heavy enough burst there is a hole in the tail — and
     * a tail with a hole in it that says so beats one that silently lies.
     */
    dropped: number;
}

/**
 * Tail the server's log buffer.
 *
 * Server-sent events, with the 3s poll kept only as a fallback: the studio and
 * the server are versioned and deployed separately, so a frontend that knows
 * about `/logs/stream` will meet servers that do not. A 404 there is not an
 * error, it is an older backend, and it degrades to what that backend supports
 * instead of showing an empty view.
 *
 * The stream sends its own backlog as a `snapshot` frame before any `append`, so
 * a reconnect restores the window without a second request and without a gap
 * where entries logged mid-handshake would belong to neither call.
 */
export function useLogTail(filters: LogTailFilters, limit = 200): LogTail {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [transport, setTransport] = useState<LogTransport>("connecting");
    const [dropped, setDropped] = useState(0);
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();

    // Held in a ref, and deliberately not a dependency of the connection effect.
    // `apiConfig` is an object: a provider that forgets to memoize it hands us a
    // new identity per render, and as a dependency that is a reconnect per
    // render — a tail that hammers the server and never stays up. `apiBase` is a
    // string and compares by value, so it can be a dependency and covers the one
    // thing that actually has to reopen the connection.
    const getAuthToken = apiConfig?.getAuthToken;
    const getAuthTokenRef = useRef(getAuthToken);
    useEffect(() => {
        getAuthTokenRef.current = getAuthToken;
    });

    const { level, source, search } = filters;

    // A hidden tab is not watching. The connection is dropped rather than left
    // to accumulate, and the reconnect's snapshot rebuilds the window — so this
    // costs nothing but the entries nobody saw.
    const [visible, setVisible] = useState(
        typeof document === "undefined" || document.visibilityState === "visible"
    );
    useEffect(() => {
        const onChange = () => setVisible(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
    }, []);

    // A filter change replaces the window wholesale. Clearing here rather than in
    // the connection effect means a reconnect (or a tab coming back) keeps what
    // is on screen until the new snapshot lands.
    //
    // Joined on NUL, written as the escape: the search box takes free text, so any
    // printable separator is a character a user can type, and two filters that
    // differ only either side of it would collide into one key and skip the clear.
    // As a raw byte it would make the whole file binary to grep, which reads as an
    // empty search result rather than as an error.
    const filterKey = `${level}\u0000${source}\u0000${search}`;
    // `EMPTY` rather than a fresh `[]` so the run on mount, when there is nothing
    // to clear, is not a state change and does not cost a render.
    useEffect(() => {
        setLogs(EMPTY);
    }, [filterKey]);

    useEffect(() => {
        if (!apiBase) {
            setError("No API URL configured — cannot load logs.");
            return;
        }
        if (!visible) return;

        let cancelled = false;
        let controller: AbortController | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;

        const query = buildParams({ level,
            source,
            search }, limit);

        const authHeaders = async (): Promise<Record<string, string>> => {
            const headers: Record<string, string> = {};
            const token = await getAuthTokenRef.current?.() ?? null;
            if (token) headers["Authorization"] = `Bearer ${token}`;
            return headers;
        };

        const retryLater = () => {
            if (cancelled) return;
            const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
            attempt++;
            timer = setTimeout(connect, delay);
        };

        /** The fallback. Only ever reached against a server with no stream route. */
        const poll = async () => {
            if (cancelled) return;
            try {
                const resp = await fetch(`${apiBase}/logs?${query}`, { headers: await authHeaders() });
                if (cancelled) return;
                if (!resp.ok) {
                    setError(await failureMessage(resp));
                } else {
                    const data: { entries?: LogEntry[] } = await resp.json();
                    // The query returns newest-first; the view tails like a
                    // terminal, so flip to chronological order.
                    const entries = (data.entries || []).slice().reverse();
                    setLogs(prev => sameLogs(prev, entries) ? prev : entries);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Could not load logs.");
            }
            if (!cancelled) timer = setTimeout(poll, POLL_MS);
        };

        const startPolling = () => {
            if (cancelled) return;
            setTransport("polling");
            poll();
        };

        const connect = async () => {
            if (cancelled) return;
            controller = new AbortController();
            try {
                const resp = await fetch(`${apiBase}/logs/stream?${query}`, {
                    headers: { ...await authHeaders(),
                        Accept: "text/event-stream" },
                    signal: controller.signal
                });
                if (cancelled) return;

                // 404 is an older server, not a failure — it has the query route
                // but not the stream. Same for a body-less response, which is a
                // client with no streaming support at all.
                if (resp.status === 404 || !resp.body) {
                    startPolling();
                    return;
                }
                if (!resp.ok) {
                    setError(await failureMessage(resp));
                    retryLater();
                    return;
                }

                attempt = 0;
                setError(null);
                setTransport("live");
                // Per-connection: the server's counter resets with the socket, so
                // a stale total would outlive the gap it described.
                setDropped(0);

                for await (const frame of readSSEFrames(resp.body)) {
                    if (cancelled) return;
                    if (frame.event === "snapshot") {
                        const { entries } = JSON.parse(frame.data) as { entries: LogEntry[] };
                        setLogs(prev => sameLogs(prev, entries) ? prev : capped(entries));
                    } else if (frame.event === "append") {
                        const parsed = JSON.parse(frame.data) as { entries: LogEntry[]; dropped?: number };
                        if (parsed.entries.length > 0) {
                            setLogs(prev => capped([...prev, ...parsed.entries]));
                        }
                        if (parsed.dropped) setDropped(n => n + parsed.dropped!);
                    } else if (frame.event === "error") {
                        setError(frame.data);
                    }
                }

                // The stream ended on its own — a restarted or redeployed
                // server. Reconnecting is the whole point of the backoff.
                if (!cancelled) {
                    setTransport("connecting");
                    retryLater();
                }
            } catch (e) {
                if (cancelled || (e instanceof Error && e.name === "AbortError")) return;
                setTransport("connecting");
                setError(e instanceof Error ? e.message : "Could not load logs.");
                retryLater();
            }
        };

        connect();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            controller?.abort();
        };
    }, [level, source, search, limit, apiBase, visible]);

    return { logs,
        error,
        transport,
        dropped };
}
