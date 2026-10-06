import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { IMPERSONATE_HEADER } from "@rebasepro/types";
import { createTransport } from "./transport";
import { RebaseWebSocketClient } from "./websocket";
import { createRebaseClient } from "./index";

/**
 * `impersonate` runs a client's requests as another user. It has to reach
 * both doors a client talks through — the header on every HTTP request, and
 * the realtime socket's sign-in — because a door it missed would answer as
 * the administrator whose token the client carries.
 */

/** A socket that opens on the next tick and accepts any `AUTHENTICATE`. */
function fakeSocket() {
    const sent: Array<{ type?: string; payload?: unknown }> = [];

    class FakeWS {
        static readonly OPEN = 1;
        readyState = 1;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;

        constructor(public url: string) {
            setTimeout(() => this.onopen?.(), 0);
        }

        send(raw: string) {
            const message = JSON.parse(raw) as { type?: string; requestId?: string; payload?: unknown };
            sent.push(message);
            if (message.type === "AUTHENTICATE") {
                setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "AUTH_SUCCESS", requestId: message.requestId }) }), 0);
            }
        }

        close() { /* noop */ }
    }

    return { FakeWS: FakeWS as unknown as typeof WebSocket, sent };
}

/** Let the fake socket open and answer, under fake timers. */
const settle = () => jest.advanceTimersByTimeAsync(50);

describe("impersonate", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("puts the uid on every HTTP request, beside the token", () => {
        const headers = createTransport({ token: "admin-token", impersonate: "user-b" }).getHeaders();
        expect(headers[IMPERSONATE_HEADER]).toBe("user-b");
        expect(headers.Authorization).toBe("Bearer admin-token");
    });

    it("sends no header when it is not set", () => {
        expect(createTransport({ token: "admin-token" }).getHeaders()).not.toHaveProperty(IMPERSONATE_HEADER);
    });

    it("signs the socket in with it", async () => {
        const { FakeWS, sent } = fakeSocket();
        const ws = new RebaseWebSocketClient({
            websocketUrl: "ws://localhost:1234",
            WebSocket: FakeWS,
            getAuthToken: async () => "admin-token",
            impersonate: "user-b"
        });
        const stop = ws.listenCollection({ path: "notes" }, () => undefined, () => undefined);
        await settle();

        expect(sent.find(m => m.type === "AUTHENTICATE")?.payload).toEqual({ token: "admin-token", impersonate: "user-b" });
        stop();
        ws.disconnect(true);
    });

    it("signs a socket without it in as the token's own user", async () => {
        const { FakeWS, sent } = fakeSocket();
        const ws = new RebaseWebSocketClient({
            websocketUrl: "ws://localhost:1234",
            WebSocket: FakeWS,
            getAuthToken: async () => "admin-token"
        });
        const stop = ws.listenCollection({ path: "notes" }, () => undefined, () => undefined);
        await settle();

        expect(sent.find(m => m.type === "AUTHENTICATE")?.payload).toEqual({ token: "admin-token" });
        stop();
        ws.disconnect(true);
    });

    it("reaches both doors from createRebaseClient", async () => {
        const { FakeWS, sent } = fakeSocket();
        const original = globalThis.WebSocket;
        globalThis.WebSocket = FakeWS;
        const fetchMock = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
        try {
            const client = createRebaseClient({
                baseUrl: "http://api.test",
                websocketUrl: "ws://api.test/ws",
                token: "admin-token",
                impersonate: "user-b",
                fetch: fetchMock
            });

            await client.data.collection("notes").find();
            const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
            expect(headers?.[IMPERSONATE_HEADER]).toBe("user-b");

            const stop = client.data.collection("notes").listen({}, () => undefined, () => undefined);
            await settle();
            expect(sent.find(m => m.type === "AUTHENTICATE")?.payload).toEqual({ token: "admin-token", impersonate: "user-b" });

            stop();
            client.close();
        } finally {
            globalThis.WebSocket = original;
        }
    });
});
