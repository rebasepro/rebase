import { jest } from "@jest/globals";
import { createRebaseClient } from "./index";

/**
 * A WebSocket stand-in that records construction. The real socket keeps the Node
 * event loop alive, which is what makes a one-shot script hang; here we only
 * need to know whether one would have been opened at all.
 */
function trackingWebSocket() {
    const opened: string[] = [];
    const closed: string[] = [];

    class FakeWebSocket {
        static readonly OPEN = 1;
        readyState = 0;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: (() => void) | null = null;

        constructor(public url: string) {
            opened.push(url);
        }

        close() {
            closed.push(this.url);
        }

        send() { /* no-op */ }
    }

    return { FakeWebSocket: FakeWebSocket as unknown as typeof WebSocket, opened, closed };
}

describe("realtime opt-out", () => {
    const original = globalThis.WebSocket;

    afterEach(() => {
        globalThis.WebSocket = original;
        jest.restoreAllMocks();
    });

    it("opens the socket by default", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        createRebaseClient({ baseUrl: "http://localhost:3000/api" });

        expect(opened).toHaveLength(1);
    });

    it("opens no socket when realtime is disabled", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({
            baseUrl: "http://localhost:3000/api",
            realtime: false
        });

        // The socket is what keeps a CLI / cron / ETL process alive past its work.
        expect(opened).toHaveLength(0);
        expect(client.ws).toBeUndefined();
    });

    it("opens no socket when realtime is disabled even if a websocketUrl is given", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        createRebaseClient({
            baseUrl: "http://localhost:3000/api",
            websocketUrl: "ws://localhost:3000",
            realtime: false
        });

        expect(opened).toHaveLength(0);
    });

    it("close() releases the socket", () => {
        const { FakeWebSocket, opened, closed } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({ baseUrl: "http://localhost:3000/api" });
        expect(opened).toHaveLength(1);

        client.close();

        expect(closed).toHaveLength(1);
    });

    it("close() is safe when realtime was never started, and when called twice", () => {
        const { FakeWebSocket } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const offline = createRebaseClient({ baseUrl: "http://localhost:3000/api", realtime: false });
        expect(() => offline.close()).not.toThrow();

        const live = createRebaseClient({ baseUrl: "http://localhost:3000/api" });
        live.close();
        expect(() => live.close()).not.toThrow();
    });

    it("leaves listen() absent so callers can feature-detect, and says why via the query builder", () => {
        const { FakeWebSocket } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({
            baseUrl: "http://localhost:3000/api",
            realtime: false
        });

        // `listen` stays undefined rather than becoming a throwing stub: the
        // optional type is what makes `if (client.listen)` work and what makes
        // TypeScript reject a bare call.
        expect(client.collection("posts").listen).toBeUndefined();
        expect(() => client.data.posts.include("author").listen(() => { /* noop */ }))
            .toThrow(/realtime: false/);
    });
});
