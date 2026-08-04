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

    it("opens NO socket on construction, even with realtime enabled", () => {
        // Changed deliberately. Constructing a client is not a statement that
        // the app wants a socket — `createRebaseClient` builds one whenever
        // realtime is not explicitly disabled, so dialling here cost a
        // connection on every page load of every app that merely *might*
        // subscribe later. Anonymous-first apps paid it on every visit to
        // authenticate with nothing.
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        createRebaseClient({ baseUrl: "http://localhost:3000" });

        expect(opened).toHaveLength(0);
    });

    it("opens the socket on the first channel operation", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

        // Asking for the channel is not using it.
        const channel = client.realtime.channel("doc:1");
        expect(opened).toHaveLength(0);

        void channel.join();
        expect(opened).toHaveLength(1);
    });

    it("opens the socket on the first collection subscription", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });
        expect(opened).toHaveLength(0);

        client.collection("posts").listen!(undefined, () => { /* noop */ });

        expect(opened).toHaveLength(1);
    });

    it("opens exactly one socket however many things subscribe", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

        client.collection("posts").listen!(undefined, () => { /* noop */ });
        client.collection("authors").listen!(undefined, () => { /* noop */ });
        void client.realtime.channel("doc:1").join();

        expect(opened).toHaveLength(1);
    });

    it("stays silent for an anonymous client that never subscribes", () => {
        // The motivating case: most page loads of an anonymous-first app.
        // No socket, and no console noise either.
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;
        const warn = jest.spyOn(console, "warn").mockImplementation(() => { /* capture */ });
        const debug = jest.spyOn(console, "debug").mockImplementation(() => { /* capture */ });

        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });
        void client.realtime.channel("doc:1"); // obtained, never used

        expect(opened).toHaveLength(0);
        expect(warn).not.toHaveBeenCalled();
        expect(debug).not.toHaveBeenCalled();
    });

    it("says nothing about a missing WebSocket until something needs one", () => {
        // The environment warning used to fire on construction, so a Node
        // process that never subscribed was told off for a socket it did not
        // want.
        // @ts-expect-error deliberately removing the global
        delete globalThis.WebSocket;
        const warn = jest.spyOn(console, "warn").mockImplementation(() => { /* capture */ });

        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });
        expect(warn).not.toHaveBeenCalled();

        void client.realtime.channel("doc:1").join();
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/WebSocket is not defined/));

        // ...and only once, however many times it is asked.
        void client.realtime.channel("doc:2").join();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("opens no socket when realtime is disabled", () => {
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({
            baseUrl: "http://localhost:3000",
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
            baseUrl: "http://localhost:3000",
            websocketUrl: "ws://localhost:3000",
            realtime: false
        });

        expect(opened).toHaveLength(0);
    });

    it("close() releases a socket that was opened", () => {
        const { FakeWebSocket, opened, closed } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });
        client.collection("posts").listen!(undefined, () => { /* noop */ });
        expect(opened).toHaveLength(1);

        client.close();

        expect(closed).toHaveLength(1);
    });

    it("close() is final — a later subscribe does not redial", () => {
        // Otherwise one queued frame could reopen the socket that close() just
        // released, and the Node process this method exists to let exit would
        // stay alive anyway.
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({ baseUrl: "http://localhost:3000" });
        client.collection("posts").listen!(undefined, () => { /* noop */ });
        expect(opened).toHaveLength(1);

        client.close();
        client.collection("authors").listen!(undefined, () => { /* noop */ });

        expect(opened).toHaveLength(1);
    });

    it("close() is safe when realtime was never started, and when called twice", () => {
        const { FakeWebSocket } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const offline = createRebaseClient({ baseUrl: "http://localhost:3000", realtime: false });
        expect(() => offline.close()).not.toThrow();

        const live = createRebaseClient({ baseUrl: "http://localhost:3000" });
        live.close();
        expect(() => live.close()).not.toThrow();
    });

    it("still refuses channels when realtime is disabled", () => {
        // `realtime: false` remains a hard opt-out. Only the *default* changed
        // — from "connected eagerly" to "connected on use".
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({
            baseUrl: "http://localhost:3000",
            realtime: false
        });

        expect(() => client.realtime.channel("doc:1")).toThrow(/realtime: false/);
        expect(opened).toHaveLength(0);
    });

    it("signing in does not by itself open a socket", async () => {
        // Authenticating is not a request for realtime. If it dialled, every
        // app with a login would lose lazy connect at the moment of login.
        // Merely registering a listener does not show that: the SIGNED_IN
        // branch that could dial is only reached by an actual sign-in.
        const { FakeWebSocket, opened } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const loginBody = {
            tokens: {
                accessToken: "jwt",
                refreshToken: "refresh",
                accessTokenExpiresAt: Date.now() + 3600_000
            },
            user: { uid: "usr_1",
email: "u@example.com",
displayName: "U",
photoURL: null,
roles: ["user"],
providerId: "local",
isAnonymous: false }
        };
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(loginBody),
            json: async () => loginBody,
            headers: new Headers()
        })) as unknown as typeof globalThis.fetch;

        const client = createRebaseClient({
            baseUrl: "http://localhost:3000",
            fetch: fetchMock
        });

        const events: string[] = [];
        client.auth.onAuthStateChange((event) => { events.push(event); });

        const result = await client.auth.signInWithEmail("u@example.com", "pw");

        expect(result.user.uid).toBe("usr_1");
        expect(events).toEqual(["SIGNED_IN"]);
        expect(opened).toHaveLength(0);

        client.close();
    });

    it("leaves listen() absent so callers can feature-detect, and says why via the query builder", () => {
        const { FakeWebSocket } = trackingWebSocket();
        globalThis.WebSocket = FakeWebSocket;

        const client = createRebaseClient({
            baseUrl: "http://localhost:3000",
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
