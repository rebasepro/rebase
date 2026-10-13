import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createRebaseClient, CreateRebaseClientOptions, CreateRebaseClientResult } from "../src/index";

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

/**
 * The socket authenticates from `getAuthToken`, which refreshes a token that is
 * about to expire first. It used to hold on to the session it read *before*
 * that refresh and fall back to its token whenever the refresh failed — and a
 * refresh fails with NOT_SIGNED_IN precisely because the user signed out while
 * it was in flight. The socket then authenticated as the account that had just
 * signed out.
 */
describe("the socket's token when the session ends during its refresh", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("is no one's, not the token of the account that signed out", async () => {
        let answerRefresh!: (response: Response) => void;
        const refreshAnswered = new Promise<Response>((resolve) => { answerRefresh = resolve; });
        const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
            const path = String(input);
            if (path.endsWith("/auth/login")) {
                // Inside the socket's ten-second refresh window from the start.
                return new Response(JSON.stringify({
                    tokens: { accessToken: "token-of-u1", refreshToken: "refresh-of-u1", accessTokenExpiresAt: Date.now() + 5_000 },
                    user: { uid: "u1" }
                }), { status: 200, headers: { "content-type": "application/json" } });
            }
            if (path.endsWith("/auth/refresh")) return refreshAnswered;
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        });
        const rebase = createRebaseClient({
            baseUrl: "http://api.test",
            fetch: fetchMock as typeof fetch,
            auth: { persistSession: false, autoRefresh: false }
        });
        try {
            await rebase.auth.signInWithEmail("u1@example.test", "pw");

            const token = rebase.ws!.getAuthToken!();
            await rebase.auth.signOut();
            // The refresh answers for a session that has ended; the SDK drops
            // it and reports NOT_SIGNED_IN.
            answerRefresh(new Response(JSON.stringify({
                tokens: { accessToken: "token-after-sign-out", refreshToken: "r2", accessTokenExpiresAt: Date.now() + 3_600_000 },
                user: { uid: "u1" }
            }), { status: 200, headers: { "content-type": "application/json" } }));

            expect(await token).toBeNull();
        } finally {
            rebase.close();
        }
    });

    it("keeps the held token when the refresh only failed to reach the server", async () => {
        const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
            const path = String(input);
            if (path.endsWith("/auth/login")) {
                return new Response(JSON.stringify({
                    tokens: { accessToken: "token-of-u1", refreshToken: "refresh-of-u1", accessTokenExpiresAt: Date.now() + 5_000 },
                    user: { uid: "u1" }
                }), { status: 200, headers: { "content-type": "application/json" } });
            }
            if (path.endsWith("/auth/refresh")) throw new TypeError("fetch failed");
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        });
        const rebase = createRebaseClient({
            baseUrl: "http://api.test",
            fetch: fetchMock as typeof fetch,
            auth: { persistSession: false, autoRefresh: false }
        });
        try {
            await rebase.auth.signInWithEmail("u1@example.test", "pw");

            // Still signed in, and the token has seconds left: worth trying.
            expect(await rebase.ws!.getAuthToken!()).toBe("token-of-u1");
        } finally {
            rebase.close();
        }
    });
});

/**
 * Bring-your-own auth: a host that signs its users in with its own provider —
 * Clerk, Firebase, a session of its own — hands the client one token getter.
 * That one call has to authenticate the realtime socket as well as HTTP, and in
 * the same order HTTP resolves a token in. It used to reach HTTP only: the
 * socket read the client's own session and the static `token`, so it stayed
 * anonymous, and every live query ran as a visitor while the same query over
 * HTTP ran as the user.
 */
describe("a client whose token comes from the host's own auth", () => {
    const originalWebSocket = (globalThis as Record<string, unknown>).WebSocket;
    let clients: CreateRebaseClientResult[] = [];
    let authorizations: Array<string | null> = [];

    beforeEach(() => {
        jest.useFakeTimers();
        MockSocket.instances = [];
        authorizations = [];
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

    /** `extra`'s properties are copied as declared, so a getter stays a getter. */
    function client(extra: Partial<CreateRebaseClientOptions> = {}) {
        const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            authorizations.push(new Headers(init?.headers).get("Authorization"));
            return new Response(JSON.stringify({ data: [], meta: { total: 0, limit: 20, offset: 0, hasMore: false } }), {
                status: 200, headers: { "content-type": "application/json" }
            });
        });
        const options: CreateRebaseClientOptions = {
            baseUrl: "http://api.test",
            fetch: fetchMock as typeof fetch,
            auth: { persistSession: false }
        };
        Object.defineProperties(options, Object.getOwnPropertyDescriptors(extra));
        const created = createRebaseClient(options);
        clients.push(created);
        return created;
    }

    const authFrames = (socket: MockSocket) => socket.sent.filter(f => f.type === "AUTHENTICATE");

    it("authenticates the socket with the getter's token when the client has no session", async () => {
        const rebase = client();
        rebase.setAuthTokenGetter(async () => "token-from-host");

        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        await rebase.data.collection("posts").find();

        expect(latest().sent[0]).toMatchObject({ type: "AUTHENTICATE", payload: { token: "token-from-host" } });
        expect(authorizations).toEqual(["Bearer token-from-host"]);
    });

    it("asks the getter again each time the socket authenticates", async () => {
        const rebase = client();
        let issued = 0;
        rebase.setAuthTokenGetter(async () => `token-${++issued}`);

        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        const first = latest();
        first.close();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(authFrames(first)[0].payload).toMatchObject({ token: "token-1" });
        expect(latest()).not.toBe(first);
        expect(authFrames(latest())[0].payload).toMatchObject({ token: "token-2" });
    });

    it("rebuilds a socket that was already open as the getter's user", async () => {
        const rebase = client();
        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        const anonymous = latest();
        expect(authFrames(anonymous)).toHaveLength(0);

        rebase.setAuthTokenGetter(async () => "token-from-host");
        await jest.advanceTimersByTimeAsync(10);

        expect(anonymous.readyState).toBe(MockSocket.CLOSED);
        expect(latest()).not.toBe(anonymous);
        expect(latest().sent.map(f => f.type)).toEqual(["AUTHENTICATE", "subscribe_collection"]);
        expect(authFrames(latest())[0].payload).toMatchObject({ token: "token-from-host" });
    });

    it("falls back to the static token when the getter answers nothing, as HTTP does", async () => {
        const rebase = client({ token: "service-key" });
        rebase.setAuthTokenGetter(async () => null);

        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        await rebase.data.collection("posts").find();

        expect(authFrames(latest())[0].payload).toMatchObject({ token: "service-key" });
        expect(authorizations).toEqual(["Bearer service-key"]);
    });

    it("authenticates the socket with a token set by setToken", async () => {
        const rebase = client();
        rebase.setToken("token-set-later");

        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);

        expect(authFrames(latest())[0].payload).toMatchObject({ token: "token-set-later" });
    });

    it("answers the socket's refused token with the handler set by setOnUnauthorized", async () => {
        const rebase = client();
        let issued = 0;
        rebase.setAuthTokenGetter(async () => `token-${++issued}`);
        const onUnauthorized = jest.fn(async () => true);
        rebase.setOnUnauthorized(onUnauthorized);

        rebase.data.collection("posts").listen({}, jest.fn(), jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        const socket = latest();
        const subscribe = socket.sent.find(f => f.type === "subscribe_collection")!;
        socket.onmessage?.({ data: JSON.stringify({
            type: "ERROR",
            subscriptionId: subscribe.payload!.subscriptionId,
            payload: { error: { message: "Token expired", code: "JWT_EXPIRED" } }
        }) });
        await jest.advanceTimersByTimeAsync(10);

        expect(onUnauthorized).toHaveBeenCalledTimes(1);
        expect(authFrames(socket).map(f => f.payload?.token)).toEqual(["token-1", "token-2"]);
        expect(socket.sent.filter(f => f.type === "subscribe_collection")).toHaveLength(2);
    });

    /**
     * The Rebase console borrows its own session for a tenant client by
     * declaring `token` as a getter on the options, so a token refreshed in the
     * background is the one handed over. It has to be read when a request or a
     * socket needs it, not once when the client is built.
     */
    it("reads a `token` declared as a getter when it is needed, on HTTP and the socket alike", async () => {
        let current = "token-at-mount";
        const rebase = client({
            get token() {
                return current;
            }
        });
        current = "token-after-refresh";

        rebase.data.collection("posts").listen({}, jest.fn());
        await jest.advanceTimersByTimeAsync(10);
        await rebase.data.collection("posts").find();

        expect(authFrames(latest())[0].payload).toMatchObject({ token: "token-after-refresh" });
        expect(authorizations).toEqual(["Bearer token-after-refresh"]);
    });
});
