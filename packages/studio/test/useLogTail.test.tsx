/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "util";
import { ReadableStream } from "stream/web";

// jsdom ships none of the streaming primitives every browser has had for years.
// Without these the hook cannot read a response body at all — which is most of
// what it does.
Object.assign(globalThis, { TextDecoder,
    TextEncoder,
    ReadableStream });

/**
 * The Logs Explorer's transport.
 *
 * It polled `/api/logs` every 3 seconds, which cost a request per client per 3s
 * to say nothing happened, showed each line up to 3s late, and — since the poll
 * went through the same middleware that fills the buffer — filled the view with
 * its own requests. It streams now.
 *
 * Two things here are worth a test rather than a read-through. The frame parser,
 * because `EventSource` cannot send an `Authorization` header and logs are
 * admin-only, so the framing is ours and its edge cases (a frame split across
 * two network chunks, a comment keepalive) are invisible until they are not.
 * And the fallback, because the studio and the server ship as separate packages:
 * a frontend that knows about `/logs/stream` will meet servers that do not, and
 * the failure there is a permanently empty log view with no error on it.
 */

/**
 * Swappable so a test can rotate the token. Mocked-module exports are not
 * configurable, so this indirection is the only way in.
 */
let tokenProvider: () => Promise<string | null> = async () => "token";

// The barrel pulls in react-router, which is ESM-only and dies under ts-jest.
// Only these two are consumed here.
//
// `useApiConfig` deliberately returns a fresh object every call, the way an
// un-memoized provider would: depending on that identity is a reconnect per
// render, and a stable mock would hide it.
jest.mock("@rebasepro/app", () => ({
    useApiConfig: () => ({
        apiUrl: "http://api.test",
        apiPath: "/api",
        getAuthToken: () => tokenProvider()
    }),
    useApiBase: () => "http://api.test/api"
}));


const { readSSEFrames, useLogTail } = require("../src/components/LogsExplorer/useLogTail");
// Type-only, so it is erased and does not re-import the module through the barrel.
import type { LogTailFilters } from "../src/components/LogsExplorer/useLogTail";

/**
 * A ReadableStream that emits exactly these strings, in order.
 *
 * `close: false` models the real thing: a log stream stays open, and the hook
 * treats an end-of-stream as a dropped connection to reconnect from.
 */
function streamOf(chunks: string[], { close = true }: { close?: boolean } = {}): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            if (close) controller.close();
        }
    });
}

const sseResponse = (chunks: string[], options?: { close?: boolean }) => ({
    ok: true,
    status: 200,
    body: streamOf(chunks, options)
});

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const entry = (id: number, message: string) => ({
    id: `log_${id}`,
    timestamp: "2026-08-17T00:00:00.000Z",
    level: "info",
    source: "api",
    message
});

const allLevels = { level: "all",
    source: "all",
    search: "" };

interface TailResult {
    logs: { id: string; message: string }[];
    error: string | null;
    transport: string;
    dropped: number;
}

/**
 * A stream whose chunks are pushed by the test, one at a time.
 *
 * For everything about *when* frames arrive — a burst after a pause, a server
 * that goes away mid-tail — which a pre-filled stream cannot express.
 */
function controllableStream() {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c;
        }
    });
    return {
        body,
        push: (text: string) => controller.enqueue(encoder.encode(text)),
        /** For splitting a frame at an arbitrary byte, mid-character included. */
        pushBytes: (bytes: Uint8Array) => controller.enqueue(bytes),
        end: () => controller.close()
    };
}

/**
 * Flip `document.visibilityState`.
 *
 * jsdom defines it as a prototype getter that always says "visible", so the test
 * has to shadow it and fire the event itself.
 */
function setVisibility(state: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state
    });
    document.dispatchEvent(new Event("visibilitychange"));
}

describe("readSSEFrames", () => {
    it("reassembles a frame split across chunks", async () => {
        const frames = [];
        for await (const f of readSSEFrames(streamOf(["event: snapshot\nda", "ta: {\"a\":1}\n\n"]))) {
            frames.push(f);
        }
        expect(frames).toEqual([{ event: "snapshot",
            data: "{\"a\":1}" }]);
    });

    it("reads several frames out of one chunk", async () => {
        const frames = [];
        for await (const f of readSSEFrames(streamOf([frame("snapshot", { a: 1 }) + frame("append", { b: 2 })]))) {
            frames.push(f.event);
        }
        expect(frames).toEqual(["snapshot", "append"]);
    });

    it("skips comment keepalives, which carry nothing", async () => {
        const frames = [];
        for await (const f of readSSEFrames(streamOf([": ping\n\n", frame("append", { b: 2 })]))) {
            frames.push(f.event);
        }
        expect(frames).toEqual(["append"]);
    });

    it("joins a multi-line data payload", async () => {
        const frames = [];
        for await (const f of readSSEFrames(streamOf(["event: error\ndata: one\ndata: two\n\n"]))) {
            frames.push(f);
        }
        expect(frames[0].data).toBe("one\ntwo");
    });
});

describe("useLogTail", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("renders the snapshot, then the appends, in arrival order", async () => {
        const fetchMock = jest.fn(async () => sseResponse([
            frame("snapshot", { entries: [entry(1, "backlog"), entry(2, "backlog two")],
total: 2 }),
            frame("append", { entries: [entry(3, "live")] })
        ], { close: false }));
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);

        await waitFor(() => expect(result.current.logs).toHaveLength(3));
        expect(result.current.logs.map(l => l.message)).toEqual(["backlog", "backlog two", "live"]);
        expect(result.current.transport).toBe("live");

        // One connection carries both. A client that fetched its backlog
        // separately would race its own subscription.
        //
        // Also one connection *total*, across every render the frames above
        // caused. The mock config above is a fresh object per render, as an
        // un-memoized provider would give — depending on that identity is a
        // reconnect per render, which is a tail that hammers the server and
        // never stays up.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/logs/stream");
    });

    it("sends the filter to the server rather than filtering what arrived", async () => {
        const fetchMock = jest.fn(async () => sseResponse([frame("snapshot", { entries: [],
total: 0 })]));
        global.fetch = fetchMock as unknown as typeof fetch;

        renderHook(() => useLogTail({ level: "error",
            source: "auth",
            search: "boom" }) as TailResult);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
        expect(url).toContain("level=error");
        expect(url).toContain("source=auth");
        expect(url).toContain("search=boom");
    });

    it("falls back to polling against a server with no stream route", async () => {
        const fetchMock = jest.fn(async (input: unknown) => {
            if (String(input).includes("/logs/stream")) {
                return { ok: false,
                    status: 404,
                    body: null };
            }
            return {
                ok: true,
                status: 200,
                // The query returns newest-first; the view tails oldest-first.
                json: async () => ({ entries: [entry(2, "second"), entry(1, "first")] })
            };
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);

        await waitFor(() => expect(result.current.transport).toBe("polling"));
        await waitFor(() => expect(result.current.logs.map(l => l.message)).toEqual(["first", "second"]));
        // An older server is not an error to put in front of the user.
        expect(result.current.error).toBeNull();
    });

    it("reports a refused connection instead of showing an empty log", async () => {
        global.fetch = jest.fn(async () => ({ ok: false,
            status: 403,
            body: streamOf([]) })) as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);

        await waitFor(() => expect(result.current.error).toContain("admin role"));
        expect(result.current.transport).not.toBe("live");
    });

    it("prefers the server's own explanation to an HTTP code", async () => {
        // What the admin gate answers when the backend has no way to tell an
        // admin from the internet. "HTTP 501" over the top of this would throw
        // away the only sentence that says what to change.
        const message = "Logs is admin-only, and this server has no authentication configured.";
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 501,
            body: streamOf([]),
            json: async () => ({ error: { code: "ADMIN_SURFACE_UNAVAILABLE",
                message } })
        })) as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);

        await waitFor(() => expect(result.current.error).toBe(message));
    });

    it("carries the auth token — the stream is admin-only", async () => {
        const fetchMock = jest.fn(async () => sseResponse([frame("snapshot", { entries: [],
total: 0 })]));
        global.fetch = fetchMock as unknown as typeof fetch;

        renderHook(() => useLogTail(allLevels) as TailResult);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const init = (fetchMock.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
        expect(init.headers.Authorization).toBe("Bearer token");
        expect(init.headers.Accept).toBe("text/event-stream");
    });
});

describe("useLogTail over a live connection", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        tokenProvider = async () => "token";
        setVisibility("visible");
    });

    /** Open the hook against a stream this test drives frame by frame. */
    function renderAgainstStream(filters: LogTailFilters = allLevels) {
        const stream = controllableStream();
        const fetchMock = jest.fn(async () => ({ ok: true,
            status: 200,
            body: stream.body }));
        global.fetch = fetchMock as unknown as typeof fetch;
        const rendered = renderHook(
            (props: LogTailFilters = filters) => useLogTail(props) as TailResult,
            { initialProps: filters }
        );
        return { ...rendered,
            stream,
            fetchMock };
    }

    it("appends successive frames rather than replacing the window", async () => {
        const { result, stream } = renderAgainstStream();
        stream.push(frame("snapshot", { entries: [entry(1, "one")],
            total: 1 }));
        await waitFor(() => expect(result.current.logs).toHaveLength(1));

        stream.push(frame("append", { entries: [entry(2, "two")] }));
        await waitFor(() => expect(result.current.logs).toHaveLength(2));
        stream.push(frame("append", { entries: [entry(3, "three"), entry(4, "four")] }));
        await waitFor(() => expect(result.current.logs).toHaveLength(4));

        expect(result.current.logs.map(l => l.message)).toEqual(["one", "two", "three", "four"]);
    });

    it("bounds what it keeps, so a long tail cannot grow without limit", async () => {
        const { result, stream } = renderAgainstStream();
        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        await waitFor(() => expect(result.current.transport).toBe("live"));

        // Past the 1000-entry client cap. Nothing else here ever drops an entry,
        // so without the cap an afternoon on a busy backend is an OOM.
        for (let batch = 0; batch < 13; batch++) {
            stream.push(frame("append", {
                entries: Array.from({ length: 100 }, (_, i) => entry(batch * 100 + i, `e${batch * 100 + i}`))
            }));
        }
        await waitFor(() => expect(result.current.logs.length).toBe(1000));

        // The newest survive: dropping the recent end would show the past and call
        // it the present.
        expect(result.current.logs[999].message).toBe("e1299");
        expect(result.current.logs[0].message).toBe("e300");
    });

    it("surfaces the entries the server had to drop", async () => {
        const { result, stream } = renderAgainstStream();
        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        await waitFor(() => expect(result.current.transport).toBe("live"));

        stream.push(frame("append", { entries: [entry(1, "kept")],
            dropped: 35 }));
        await waitFor(() => expect(result.current.dropped).toBe(35));

        // Accumulated across frames: each one reports only its own gap, and a view
        // that showed the latest number would understate the hole.
        stream.push(frame("append", { entries: [entry(2, "also kept")],
            dropped: 5 }));
        await waitFor(() => expect(result.current.dropped).toBe(40));
    });

    it("stays at zero dropped when the server sends no count", async () => {
        const { result, stream } = renderAgainstStream();
        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        stream.push(frame("append", { entries: [entry(1, "fine")] }));
        await waitFor(() => expect(result.current.logs).toHaveLength(1));

        expect(result.current.dropped).toBe(0);
    });

    it("passes an `error` frame through to the view", async () => {
        const { result, stream } = renderAgainstStream();
        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        await waitFor(() => expect(result.current.transport).toBe("live"));

        stream.push("event: error\ndata: the tail broke\n\n");
        await waitFor(() => expect(result.current.error).toBe("the tail broke"));
    });

    it("reconnects when the server closes the stream", async () => {
        const first = controllableStream();
        const second = controllableStream();
        const bodies = [first, second];
        const fetchMock = jest.fn(async () => ({ ok: true,
            status: 200,
            body: bodies.shift()!.body }));
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);
        first.push(frame("snapshot", { entries: [entry(1, "before restart")],
            total: 1 }));
        await waitFor(() => expect(result.current.logs).toHaveLength(1));

        // A redeploy: the socket ends with no error. The old view would sit there
        // showing a frozen log with no indication it had stopped being a log.
        first.end();
        await waitFor(() => expect(result.current.transport).toBe("connecting"));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 4000 });

        // The new connection's snapshot replaces the window, so nothing is shown
        // twice across a reconnect.
        second.push(frame("snapshot", { entries: [entry(1, "before restart"), entry(9, "after restart")],
            total: 2 }));
        await waitFor(() => expect(result.current.logs).toHaveLength(2));
        expect(result.current.transport).toBe("live");
        expect(result.current.logs.map(l => l.message)).toEqual(["before restart", "after restart"]);
    });

    it("reads the token again on every reconnect", async () => {
        // A token that rotates. Caching the first one means the tail dies for good
        // the moment the original expires, and looks like a permissions problem.
        let issued = 0;
        tokenProvider = async () => `token-${++issued}`;

        const first = controllableStream();
        const second = controllableStream();
        const bodies = [first, second];
        const fetchMock = jest.fn(async () => ({ ok: true,
            status: 200,
            body: bodies.shift()!.body }));
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);
        first.push(frame("snapshot", { entries: [],
            total: 0 }));
        await waitFor(() => expect(result.current.transport).toBe("live"));
        first.end();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 4000 });
        const headersOf = (call: number) =>
            ((fetchMock.mock.calls[call] as unknown[])[1] as { headers: Record<string, string> }).headers;
        expect(headersOf(0).Authorization).toBe("Bearer token-1");
        expect(headersOf(1).Authorization).toBe("Bearer token-2");
    });

    it("reopens the connection when the filter changes, and clears the window", async () => {
        const first = controllableStream();
        const second = controllableStream();
        const bodies = [first, second];
        const urls: string[] = [];
        const fetchMock = jest.fn(async (input: unknown) => {
            urls.push(String(input));
            return { ok: true,
                status: 200,
                body: bodies.shift()!.body };
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result, rerender } = renderHook(
            (props: LogTailFilters) => useLogTail(props) as TailResult,
            { initialProps: allLevels as LogTailFilters }
        );
        first.push(frame("snapshot", { entries: [entry(1, "unfiltered")],
            total: 1 }));
        await waitFor(() => expect(result.current.logs).toHaveLength(1));

        rerender({ level: "error",
            source: "all",
            search: "" });

        // Cleared straight away rather than left showing entries the new filter
        // excludes — the alternative is a view that lies until the snapshot lands.
        await waitFor(() => expect(result.current.logs).toHaveLength(0));
        await waitFor(() => expect(urls).toHaveLength(2));
        expect(urls[1]).toContain("level=error");
    });

    it("drops the connection while the tab is hidden and picks it back up", async () => {
        const first = controllableStream();
        const second = controllableStream();
        const bodies = [first, second];
        const fetchMock = jest.fn(async () => ({ ok: true,
            status: 200,
            body: bodies.shift()!.body }));
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);
        first.push(frame("snapshot", { entries: [entry(1, "watched")],
            total: 1 }));
        await waitFor(() => expect(result.current.logs).toHaveLength(1));

        // Nobody is looking: pushing entries to a hidden tab is bandwidth spent on
        // a view that will be rebuilt from a snapshot anyway.
        setVisibility("hidden");
        await waitFor(() => expect(result.current.logs).toHaveLength(1));
        expect(fetchMock).toHaveBeenCalledTimes(1);

        setVisibility("visible");
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        second.push(frame("snapshot", { entries: [entry(1, "watched"), entry(2, "missed")],
            total: 2 }));
        await waitFor(() => expect(result.current.logs).toHaveLength(2));
        // What happened while it was hidden is not lost — it comes back in the
        // reconnect's snapshot.
        expect(result.current.logs.map(l => l.message)).toEqual(["watched", "missed"]);
    });

    it("stops touching state once unmounted", async () => {
        const errors: unknown[] = [];
        const spy = jest.spyOn(console, "error").mockImplementation((...args) => {
            errors.push(args);
        });

        const { result, unmount, stream } = renderAgainstStream();
        stream.push(frame("snapshot", { entries: [entry(1, "one")],
            total: 1 }));
        await waitFor(() => expect(result.current.logs).toHaveLength(1));

        unmount();
        // Frames still arriving at a hook nobody is rendering. A setState here is
        // a React warning at best and a retained tree at worst.
        stream.push(frame("append", { entries: [entry(2, "after unmount")] }));
        stream.end();
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(errors).toEqual([]);
        spy.mockRestore();
    });

    it("recovers from a malformed frame instead of freezing", async () => {
        const first = controllableStream();
        const second = controllableStream();
        const bodies = [first, second];
        const fetchMock = jest.fn(async () => ({ ok: true,
            status: 200,
            body: bodies.shift()!.body }));
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);
        first.push(frame("snapshot", { entries: [],
            total: 0 }));
        await waitFor(() => expect(result.current.transport).toBe("live"));

        // Truncated JSON — a proxy that cut the body, or a version mismatch. The
        // tail must not end here permanently.
        first.push("event: append\ndata: {\"entries\": [{\"id\"\n\n");
        await waitFor(() => expect(result.current.transport).not.toBe("live"));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 4000 });

        second.push(frame("snapshot", { entries: [entry(5, "recovered")],
            total: 1 }));
        await waitFor(() => expect(result.current.logs.map(l => l.message)).toEqual(["recovered"]));
        expect(result.current.error).toBeNull();
    });

    it("keeps multi-byte text intact when a chunk splits a character", async () => {
        const stream = controllableStream();
        const fetchMock = jest.fn(async () => ({ ok: true,
            status: 200,
            body: stream.body }));
        global.fetch = fetchMock as unknown as typeof fetch;
        const { result } = renderHook(() => useLogTail(allLevels) as TailResult);

        const payload = frame("snapshot", { entries: [entry(1, "GET /café/🚀 200")],
            total: 1 });
        const bytes = new TextEncoder().encode(payload);
        // Split inside the rocket's four bytes. A decoder without `stream: true`
        // turns each half into a replacement character and the JSON stops parsing.
        const rocket = bytes.indexOf(0xf0);
        expect(rocket).toBeGreaterThan(0);
        stream.pushBytes(bytes.slice(0, rocket + 2));
        await new Promise(resolve => setTimeout(resolve, 10));
        stream.pushBytes(bytes.slice(rocket + 2));

        await waitFor(() => expect(result.current.logs).toHaveLength(1));
        expect(result.current.logs[0].message).toBe("GET /café/🚀 200");
    });
});
