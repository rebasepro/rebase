import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createRebaseClient, CreateRebaseClientResult } from "../src/index";

/**
 * What the realtime socket holds on the server — its subscriptions, its channel
 * memberships — was authorized for whoever the socket was signed in as, and the
 * server re-runs every subscription as that principal for as long as it lives.
 * These pin what happens to that state when the account behind the client
 * changes, end to end through `createRebaseClient`'s auth wiring.
 */

class MockSocket {
    static instances: MockSocket[] = [];
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readyState = MockSocket.CONNECTING;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onerror?: (error: unknown) => void;
    sent: Array<{ type: string; requestId?: string; payload?: Record<string, unknown> }> = [];

    constructor(public url: string) {
        MockSocket.instances.push(this);
        setTimeout(() => {
            this.readyState = MockSocket.OPEN;
            this.onopen?.();
        }, 10);
    }

    send(data: string) {
        const frame = JSON.parse(data);
        this.sent.push(frame);
        // A server that accepts every token it is shown.
        if (frame.type === "AUTHENTICATE") {
            queueMicrotask(() => this.onmessage?.({
                data: JSON.stringify({ type: "AUTH_SUCCESS", requestId: frame.requestId, payload: {} })
            }));
        }
    }

    close() {
        this.readyState = MockSocket.CLOSED;
        this.onclose?.();
    }

    /** Answer this socket's latest subscribe with `rows`. */
    push(rows: Record<string, unknown>[]) {
        const subscribe = this.sent.filter(f => f.type === "subscribe_collection").at(-1)!;
        this.onmessage?.({ data: JSON.stringify({
            type: "collection_update",
            subscriptionId: subscribe.payload!.subscriptionId,
            rows
        }) });
    }
}

const latest = () => MockSocket.instances[MockSocket.instances.length - 1];

function loginAs(uid: string) {
    return new Response(JSON.stringify({
        tokens: {
            accessToken: `token-of-${uid}`,
            refreshToken: `refresh-of-${uid}`,
            accessTokenExpiresAt: Date.now() + 60 * 60 * 1000
        },
        user: { uid, email: `${uid}@example.test` }
    }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("the realtime socket across a change of account", () => {
    const originalWebSocket = (globalThis as Record<string, unknown>).WebSocket;
    let clients: CreateRebaseClientResult[] = [];

    beforeEach(() => {
        jest.useFakeTimers();
        MockSocket.instances = [];
        (globalThis as Record<string, unknown>).WebSocket = MockSocket;
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        jest.spyOn(console, "debug").mockImplementation(() => undefined);
    });

    afterEach(() => {
        clients.forEach(c => c.close());
        clients = [];
        (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    function client() {
        const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}"));
            if (String(input).endsWith("/auth/login")) return loginAs(String(body.email).split("@")[0]);
            return new Response(JSON.stringify({ data: [], meta: { total: 0, limit: 20, offset: 0, hasMore: false } }), {
                status: 200, headers: { "content-type": "application/json" }
            });
        });
        const created = createRebaseClient({
            baseUrl: "http://api.test",
            fetch: fetchMock as typeof fetch,
            auth: { persistSession: false }
        });
        clients.push(created);
        return created;
    }

    it("lets a visitor with no account subscribe, for the server to allow or refuse", async () => {
        const rebase = client();
        const onError = jest.fn();

        rebase.data.collection("posts").listen({}, jest.fn(), onError);
        await jest.advanceTimersByTimeAsync(10);

        expect(latest().sent.map(f => f.type)).toEqual(["subscribe_collection"]);
        expect(onError).not.toHaveBeenCalled();
    });

    /**
     * Signing in over a session emits `SIGNED_IN` and no `SIGNED_OUT`, and the
     * socket used to be re-authenticated in place. The server keeps each
     * subscription's principal from when it was made, so the previous
     * account's subscriptions went on pushing that account's rows into the
     * page the next account was now using — and the client's cache handed them
     * to every new listener on the same query without asking.
     */
    it("rebuilds the socket as the new account when a different one signs in", async () => {
        const rebase = client();
        await rebase.auth.signInWithEmail("alice@example.test", "pw");
        const mounted = jest.fn();
        rebase.data.collection("inbox").listen({}, mounted);
        await jest.advanceTimersByTimeAsync(10);
        const alices = latest();
        alices.push([{ id: "a-1", owner: "alice" }]);

        await rebase.auth.signInWithEmail("bob@example.test", "pw");
        const late = jest.fn();
        rebase.data.collection("inbox").listen({}, late);
        await jest.advanceTimersByTimeAsync(10);

        expect(alices.readyState).toBe(MockSocket.CLOSED);
        const bobs = latest();
        expect(bobs).not.toBe(alices);
        expect(bobs.sent[0]).toMatchObject({ type: "AUTHENTICATE", payload: { token: "token-of-bob" } });
        expect(bobs.sent.filter(f => f.type === "subscribe_collection")).toHaveLength(1);
        // Nothing of Alice's reached the listener that attached after Bob.
        await jest.advanceTimersByTimeAsync(0);
        expect(JSON.stringify(late.mock.calls)).not.toContain("alice");
    });

    it("re-subscribes a visitor's live query as the account they sign in to", async () => {
        const rebase = client();
        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        const anonymous = latest();

        await rebase.auth.signInWithEmail("carol@example.test", "pw");
        await jest.advanceTimersByTimeAsync(10);

        const carols = latest();
        expect(carols).not.toBe(anonymous);
        expect(carols.sent.map(f => f.type)).toEqual(["AUTHENTICATE", "subscribe_collection"]);
    });

    it("re-authenticates in place when the same account refreshes its token", async () => {
        const rebase = client();
        await rebase.auth.signInWithEmail("dave@example.test", "pw");
        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        const socket = latest();

        await rebase.auth.signInWithEmail("dave@example.test", "pw");
        await jest.advanceTimersByTimeAsync(10);

        expect(MockSocket.instances).toHaveLength(1);
        expect(socket.sent.filter(f => f.type === "AUTHENTICATE")).toHaveLength(2);
        expect(socket.sent.filter(f => f.type === "subscribe_collection")).toHaveLength(1);
    });
});
