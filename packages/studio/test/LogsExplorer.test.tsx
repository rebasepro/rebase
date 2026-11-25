/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { FakeResponse } from "./helpers/fakeResponse";
import { useEnTranslation } from "./en-translation";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";
import { ReadableStream as NodeReadableStream } from "stream/web";

// jsdom has no streams; installed as the globals, so the test builds its
// streams through the same (DOM-typed) names the view reads them with.
Object.assign(globalThis, { TextDecoder: NodeTextDecoder,
    TextEncoder: NodeTextEncoder,
    ReadableStream: NodeReadableStream });

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
    useApiBase: () => "http://api.test/api",
    useTranslation: () => useEnTranslation()
}));


const { LogsExplorer } = require("../src/components/LogsExplorer/LogsExplorer");

function controllableStream() {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
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
    const fetchMock = jest.fn<typeof fetch>(async () => new FakeResponse({ body: stream.body }));
    global.fetch = fetchMock;
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
        await waitFor(() => expect(screen.getByText("1 entry")).toBeTruthy());
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

    it("says it shows only the instance serving it, and names that instance", async () => {
        // The log lives in each server process's memory. With two replicas,
        // "Live" alone read as the whole backend's log.
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", { entries: [],
            total: 0,
            instance: "api-7d9f-xk2" }));

        expect(await screen.findByText("This instance: api-7d9f-xk2")).toBeTruthy();
        expect(screen.getByTitle(/only the one serving this view/)).toBeTruthy();
        expect(screen.getByText(/as this instance serves requests/)).toBeTruthy();
    });

    it("says when it has fallen back to polling an older server", async () => {
        global.fetch = jest.fn<typeof fetch>(async (input) => {
            if (String(input).includes("/logs/stream")) {
                return new FakeResponse({ status: 404 });
            }
            return new FakeResponse({ json: { entries: [entry(1, "polled line")] } });
        });

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

    it("reads a request entry as one line, its status coloured and its failure after it", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", {
            entries: [
                entry(1, "GET /api/data/rooms/DJBH 404 16ms — NOT_FOUND: No row DJBH", {
                    level: "warn",
                    metadata: {
                        method: "GET",
                        path: "/api/data/rooms/DJBH",
                        status: 404,
                        duration: 16,
                        requestId: "req-7f3a",
                        collection: "rooms",
                        errorCode: "NOT_FOUND",
                        errorMessage: "No row DJBH"
                    }
                }),
                entry(2, "POST /api/fn/charge 500 3ms", {
                    level: "error",
                    metadata: { method: "POST", path: "/api/fn/charge", status: 500, latencyMs: 3 }
                }),
                entry(3, "GET /api/posts 200 4ms", {
                    metadata: { method: "GET", path: "/api/posts", status: 200, duration: 4 }
                })
            ],
            total: 3
        }));

        const status = await screen.findByText("404");
        expect(status.className).toContain("text-amber-600");
        expect(screen.getByText("500").className).toContain("text-red-600");
        expect(screen.getByText("200").className).toContain("text-emerald-700");
        expect(screen.getByText(/· 16 ms/)).toBeTruthy();
        // `latencyMs`, the stdout record's spelling, reads the same.
        expect(screen.getByText(/· 3 ms/)).toBeTruthy();
        expect(screen.getByText(/— NOT_FOUND: No row DJBH/)).toBeTruthy();
        // The sentence replaces the message rather than repeating it.
        expect(screen.queryByText(/404 16ms/)).toBeNull();
        // The pills carry what the sentence does not: the request id first.
        const row = screen.getAllByRole("button", { expanded: false })[0];
        expect(within(row).getByText("requestId")).toBeTruthy();
        expect(within(row).getByText("req-7f3a")).toBeTruthy();
        expect(within(row).getByText("rooms")).toBeTruthy();
        expect(within(row).queryByText("errorCode")).toBeNull();
    });

    it("opens a row from the keyboard to show its metadata, and closes it again", async () => {
        const { stream } = renderStreaming();
        stream.push(frame("snapshot", {
            entries: [
                entry(1, "Function threw", { level: "error",
                    metadata: { component: "functions", requestId: "req-1", errorCode: "E_STRIPE", attempt: 2, uid: "u_9", extra: "x" } }),
                entry(2, "plain line")
            ],
            total: 2
        }));

        await screen.findByText("Function threw");
        const row = screen.getByRole("button", { expanded: false });
        // Collapsed: four pills, most useful first, and how many more there are.
        expect(within(row).getByText("requestId")).toBeTruthy();
        expect(within(row).getByText("errorCode")).toBeTruthy();
        expect(within(row).getByText("uid")).toBeTruthy();
        expect(within(row).getByText("component")).toBeTruthy();
        expect(within(row).getByText("+2")).toBeTruthy();
        // A line with no metadata has nothing to open, so it is not a control.
        expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(1);

        fireEvent.keyDown(row, { key: "Enter" });
        expect(row.getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByText(/"errorCode": "E_STRIPE"/)).toBeTruthy();
        expect(screen.getByText(/"attempt": 2/)).toBeTruthy();
        // Open, the JSON says it all and the pills step aside.
        expect(within(row).queryByText("requestId")).toBeNull();

        fireEvent.keyDown(row, { key: " " });
        expect(row.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByText(/"attempt": 2/)).toBeNull();
    });

    it("copies an open entry, and everything shown, as JSON", async () => {
        const writeText = jest.fn<(text: string) => Promise<void>>(async () => undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

        const { stream } = renderStreaming();
        stream.push(frame("snapshot", {
            entries: [
                entry(1, "first", { metadata: { requestId: "req-1" } }),
                entry(2, "second")
            ],
            total: 2
        }));
        await screen.findByText("second");

        fireEvent.click(screen.getByRole("button", { expanded: false }));
        fireEvent.click(screen.getByRole("button", { name: "Copy this entry as JSON" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
            timestamp: "2026-08-17T09:41:02.000Z",
            level: "info",
            source: "api",
            message: "first",
            metadata: { requestId: "req-1" }
        });

        fireEvent.click(screen.getByRole("button", { name: "Copy what is shown as JSON lines" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
        const lines = writeText.mock.calls[1][0].split("\n").map(line => JSON.parse(line) as { message: string; metadata?: unknown });
        expect(lines.map(l => l.message)).toEqual(["first", "second"]);
        expect(lines[1].metadata).toBeUndefined();
    });

    it("offers each level as a floor, as the server reads it", async () => {
        const { stream, fetchMock } = renderStreaming();
        stream.push(frame("snapshot", { entries: [],
            total: 0 }));
        await screen.findByText("Live");

        const names = screen.getAllByRole("option", { hidden: true }).map(o => o.textContent);
        expect(names).toEqual(expect.arrayContaining(["All levels", "Info and above", "Warn and above", "Error"]));
        expect(names).not.toContain("Debug");
        expect(fetchMock).toHaveBeenCalled();
    });
});
