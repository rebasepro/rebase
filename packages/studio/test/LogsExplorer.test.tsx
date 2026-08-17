/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "util";
import { ReadableStream } from "stream/web";

Object.assign(globalThis, { TextDecoder,
    TextEncoder,
    ReadableStream });

/**
 * The view, wired to the tail.
 *
 * `useLogTail.test.tsx` covers the transport and the server suites cover the
 * stream. What neither reaches is the join between them: whether entries pushed
 * down a socket actually reach the DOM, whether the view says out loud that it is
 * live or has fallen back to polling, and whether the "N dropped" notice — the
 * only thing standing between a gap in the log and a silent lie — renders at all.
 *
 * That join is where this change could be complete on both sides and still show
 * the user nothing.
 */

jest.mock("@rebasepro/app", () => ({
    useApiConfig: () => ({
        apiUrl: "http://api.test",
        apiPath: "/api",
        getAuthToken: async () => "token"
    }),
    useApiBase: () => "http://api.test/api"
}));


const { LogsExplorer } = require("../src/components/LogsExplorer/LogsExplorer");

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
        end: () => controller.close()
    };
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const entry = (id: number, message: string, over: Record<string, unknown> = {}) => ({
    id: `log_${id}`,
    timestamp: "2026-08-17T09:41:02.000Z",
    level: "info",
    source: "api",
    message,
    ...over
});

function renderStreaming() {
    const stream = controllableStream();
    const fetchMock = jest.fn(async () => ({ ok: true,
        status: 200,
        body: stream.body }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return { ...render(<LogsExplorer/>),
        stream,
        fetchMock };
}

describe("LogsExplorer", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("renders entries pushed down the stream", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", {
            entries: [entry(1, "GET /api/posts 200 4ms")],
            total: 1
        }));

        expect(await screen.findByText("GET /api/posts 200 4ms")).toBeTruthy();
        // Level and source are their own columns, so the row is scannable.
        expect(screen.getByText("info")).toBeTruthy();
        expect(screen.getByText("[api]")).toBeTruthy();
        await waitFor(() => expect(screen.getByText("1 entries")).toBeTruthy());
    });

    it("appends a live entry without redrawing the ones already there", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", { entries: [entry(1, "first line")],
            total: 1 }));
        const first = await screen.findByText("first line");

        stream.push(frame("append", { entries: [entry(2, "second line")] }));
        expect(await screen.findByText("second line")).toBeTruthy();

        // The same DOM node, still: an append that re-created every row would lose
        // text selection and hover state on every frame.
        expect(screen.getByText("first line")).toBe(first);
        await waitFor(() => expect(screen.getByText("2 entries")).toBeTruthy());
    });

    it("says it is live, so an idle log is not mistaken for a dead one", async () => {
        const { stream } = renderStreaming();
        // Before any frame it is still connecting.
        expect(screen.getByText("Connecting")).toBeTruthy();

        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        expect(await screen.findByText("Live")).toBeTruthy();
        // And the empty state explains itself rather than looking broken.
        expect(screen.getByText(/No log entries yet/)).toBeTruthy();
    });

    it("says when it has fallen back to polling an older server", async () => {
        global.fetch = jest.fn(async (input: unknown) => {
            if (String(input).includes("/logs/stream")) {
                return { ok: false,
                    status: 404,
                    body: null };
            }
            return { ok: true,
                status: 200,
                json: async () => ({ entries: [entry(1, "polled line")] }) };
        }) as unknown as typeof fetch;

        render(<LogsExplorer/>);

        expect(await screen.findByText("Polling")).toBeTruthy();
        expect(await screen.findByText("polled line")).toBeTruthy();
    });

    it("admits the gap when the server had to drop entries", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        await screen.findByText("Live");

        stream.push(frame("append", { entries: [entry(1, "kept")],
            dropped: 12 }));

        // The whole point of the server counting them. Without this the view is a
        // tail with a hole in it that looks complete.
        expect(await screen.findByText(/12 entries were dropped/)).toBeTruthy();
        expect(screen.getByText(/arriving faster than this view can read it/)).toBeTruthy();
    });

    it("counts a single dropped entry in the singular", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        await screen.findByText("Live");

        stream.push(frame("append", { entries: [entry(1, "kept")],
            dropped: 1 }));
        expect(await screen.findByText(/1 entry was dropped/)).toBeTruthy();
    });

    it("keeps a failure on screen over the entries it already has", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", { entries: [entry(1, "still here")],
            total: 1 }));
        await screen.findByText("still here");

        stream.push("event: error\ndata: the tail broke\n\n");

        // Both: a view that swapped the log for the error would throw away what
        // the user was reading, and one that hid the error would look frozen.
        expect(await screen.findByText("the tail broke")).toBeTruthy();
        expect(screen.getByText("still here")).toBeTruthy();
    });

    it("colours the level, so an error is findable by eye", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", {
            entries: [
                entry(1, "a warning", { level: "warn" }),
                entry(2, "a failure", { level: "error",
source: "auth" })
            ],
            total: 2
        }));

        await screen.findByText("a failure");
        expect(screen.getByText("error").className).toContain("text-red-600");
        expect(screen.getByText("warn").className).toContain("text-amber-600");
        expect(screen.getByText("[auth]").className).toContain("text-purple-600");
    });
});
