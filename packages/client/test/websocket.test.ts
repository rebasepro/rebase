import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";
// The WS client now throws the unified RebaseApiError. Aliased to `ApiError`
// so the existing instanceof/code assertions below read unchanged.
import { RebaseApiError as ApiError } from "@rebasepro/types";

/**
 * The key columns the server sends alongside a collection's rows. Rows carry no
 * address, so recognising one — to patch it, or to keep its reference across a
 * refetch — means deriving the address from these. The fixtures here are all
 * keyed on `id`, which the server reports like any other key.
 */
const ID_PKS = [{ fieldName: "id",
type: "string" as const }];

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------
class MockWebSocket {
    static instances: MockWebSocket[] = [];
    url: string;
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: any) => void;
    onclose?: () => void;
    onerror?: (error: any) => void;
    sentMessages: string[] = [];

    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    /**
     * Make every new socket fail to come up, as an unreachable server does.
     *
     * The default mock always opens, which is enough for most tests but cannot
     * express "the server is down" — and therefore cannot exhaust the
     * reconnect budget, since every attempt would succeed and reset it.
     */
    static failToConnect = false;

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
        setTimeout(() => {
            if (MockWebSocket.failToConnect) {
                this.readyState = MockWebSocket.CLOSED;
                this.onclose?.();
                return;
            }
            this.readyState = MockWebSocket.OPEN;
            if (this.onopen) this.onopen();
        }, 10);
    }

    send(data: string) {
        this.sentMessages.push(data);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose();
    }
}

let createdClients: RebaseWebSocketClient[] = [];

/**
 * Construct a client and connect it.
 *
 * The constructor deliberately no longer dials — a client is built whenever
 * realtime is not disabled, so connecting there opened a socket on every page
 * load of every app that merely might subscribe later. These are tests *of the
 * socket*, so they want one; `ensureConnected()` is what a subscribe or a
 * channel operation calls for them in real use.
 */
function createClient(opts?: Partial<ConstructorParameters<typeof RebaseWebSocketClient>[0]>) {
    const client = new RebaseWebSocketClient({
        websocketUrl: "ws://localhost:1234",
        WebSocket: MockWebSocket as any,
        ...opts
    });
    client.ensureConnected();
    createdClients.push(client);
    return client;
}

function getWs(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("RebaseWebSocketClient", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        createdClients = [];
        jest.useFakeTimers();
        jest.spyOn(console, "log").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
        jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        createdClients.forEach(c => c.disconnect());
        createdClients = [];
        MockWebSocket.instances.forEach(ws => {
            ws.onclose = undefined;
            ws.onerror = undefined;
            ws.onmessage = undefined;
            ws.onopen = undefined;
            ws.close();
        });
        MockWebSocket.instances = [];
        // Clear all pending timers so reconnection/open callbacks don't fire
        // after the test is done.
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // Initialization & connection
    // -----------------------------------------------------------------------
    describe("Initialization & connection", () => {
        it("creates a WebSocket connection on init", () => {
            createClient();
            expect(MockWebSocket.instances).toHaveLength(1);
            expect(getWs().url).toBe("ws://localhost:1234");
        });

        it("does NOT connect until asked", () => {
            new RebaseWebSocketClient({
                websocketUrl: "ws://localhost:1234",
                WebSocket: MockWebSocket as any
            });

            expect(MockWebSocket.instances).toHaveLength(0);
        });

        it("ensureConnected is idempotent — repeated calls reuse one socket", () => {
            // Every operation that needs a socket calls it, so it runs far more
            // often than it connects.
            const client = createClient();
            client.ensureConnected();
            client.ensureConnected();

            expect(MockWebSocket.instances).toHaveLength(1);
        });

        it("reconnects on demand after a non-permanent disconnect", () => {
            // Signing out drops the socket but leaves the client usable.
            const client = createClient();
            client.disconnect();

            client.ensureConnected();

            expect(MockWebSocket.instances).toHaveLength(2);
        });

        it("never redials after a permanent disconnect", () => {
            const client = createClient();
            client.disconnect(true);

            client.ensureConnected();

            expect(MockWebSocket.instances).toHaveLength(1);
        });

        it("does not create connection if WebSocket is undefined", () => {
            const client = new RebaseWebSocketClient({
                websocketUrl: "ws://localhost:1234",
                WebSocket: undefined as any
            });
            createdClients.push(client);
            expect(MockWebSocket.instances).toHaveLength(0);
        });

        it("emits connect event on open", () => {
            const client = createClient();
            const connectCb = jest.fn();
            client.on("connect", connectCb);

            jest.runAllTimers();
            expect(connectCb).toHaveBeenCalledTimes(1);
        });

        it("emits disconnect event on close", () => {
            const client = createClient();
            const disconnectCb = jest.fn();
            client.on("disconnect", disconnectCb);

            jest.runAllTimers();
            getWs().close();
            expect(disconnectCb).toHaveBeenCalledTimes(1);
        });

        it("emits error event on WebSocket error", () => {
            const client = createClient();
            const errorCb = jest.fn();
            client.on("error", errorCb);

            jest.runAllTimers();
            getWs().onerror!({ type: "error" } as any);
            expect(errorCb).toHaveBeenCalledTimes(1);
        });

        it("on() returns an unsubscribe function", () => {
            const client = createClient();
            const cb = jest.fn();
            const unsub = client.on("connect", cb);

            unsub();
            jest.runAllTimers();
            expect(cb).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Authentication
    // -----------------------------------------------------------------------
    describe("Authentication", () => {
        it("auto-authenticates if getAuthToken is provided", async () => {
            const getAuthToken = jest.fn().mockResolvedValue("test-token");
            createClient({ getAuthToken });

            jest.runAllTimers();
            await Promise.resolve();

            expect(getAuthToken).toHaveBeenCalled();
            const ws = getWs();
            expect(ws.sentMessages).toHaveLength(1);
            const authMsg = JSON.parse(ws.sentMessages[0]);
            expect(authMsg.type).toBe("AUTHENTICATE");
            expect(authMsg.payload.token).toBe("test-token");
        });

        it("authenticate sends auth message and resolves on success", async () => {
            const client = createClient();
            jest.runAllTimers();

            const authPromise = client.authenticate("my-token");
            const ws = getWs();

            const authMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            // Simulate success response
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_SUCCESS",
                requestId: authMsg.requestId,
                payload: {}
            }) });

            await authPromise;
            // Should not throw
        });

        it("authenticate rejects on error response", async () => {
            const client = createClient();
            jest.runAllTimers();

            const authPromise = client.authenticate("bad-token");
            const ws = getWs();

            const authMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_ERROR",
                requestId: authMsg.requestId,
                payload: { error: { message: "Invalid token",
code: "AUTH_FAILED" } }
            }) });

            await expect(authPromise).rejects.toThrow("Invalid token");
        });

        it("setAuthTokenGetter authenticates a socket that is already open", async () => {
            // Asserting `client.getAuthToken === getter` only restates the
            // assignment. What the setter is for is the useEffect ordering
            // where the token arrives *after* connect: the socket must then
            // authenticate itself rather than sit there anonymous.
            const client = createClient();
            await jest.advanceTimersByTimeAsync(10); // let the socket open
            const ws = getWs();
            ws.sentMessages.length = 0;

            const getter = jest.fn(async () => "new-token");
            client.setAuthTokenGetter(getter);
            await jest.advanceTimersByTimeAsync(0);

            expect(getter).toHaveBeenCalled();
            expect(ws.sentMessages.map(m => JSON.parse(m))).toContainEqual(
                expect.objectContaining({ type: "AUTHENTICATE",
payload: { token: "new-token" } })
            );
        });
    });

    // -----------------------------------------------------------------------
    // disconnect
    // -----------------------------------------------------------------------
    describe("disconnect", () => {
        it("closes WebSocket and clears auth state", () => {
            const client = createClient();
            jest.runAllTimers();

            client.disconnect();
            expect(getWs().readyState).toBe(MockWebSocket.CLOSED);
        });

        it("handles disconnect when no WebSocket exists", () => {
            const client = new RebaseWebSocketClient({
                websocketUrl: "ws://localhost",
                WebSocket: undefined as any
            });
            createdClients.push(client);

            // "Should not throw" was a comment, so the runner was never told
            // what this test was for: it reported a pass whether `disconnect()`
            // guarded the missing socket or silently stopped doing anything.
            // Both halves are stated now — it must not throw, and it must still
            // leave the client disconnected, which is the reason to call it.
            expect(() => client.disconnect()).not.toThrow();
            // And it is still teardown: nothing armed survives it, and calling
            // it again on an already-torn-down client is safe. Asserting the
            // pending-timer count rather than spying on a call keeps this true
            // of whatever internal path removes the handle.
            expect(jest.getTimerCount()).toBe(0);
            expect(() => client.disconnect()).not.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // Message queuing
    // -----------------------------------------------------------------------
    describe("Message queuing", () => {
        it("queues messages when disconnected and sends on connect", async () => {
            const client = createClient();

            // Client is not yet connected
            const fetchPromise = client.fetchCollection({ path: "users" });
            expect((client as any).messageQueue.length).toBe(1);

            jest.runOnlyPendingTimers();
            await Promise.resolve();

            const ws = getWs();
            expect(ws.sentMessages.length).toBe(1);
            const sent = JSON.parse(ws.sentMessages[0]);
            expect(sent.type).toBe("FETCH_COLLECTION");

            // Simulate response
            ws.onmessage!({ data: JSON.stringify({
                type: "FETCH_COLLECTION",
                requestId: sent.requestId,
                payload: { rows: [{ id: "1" }] }
            }) });

            const result = await fetchPromise;
            expect(result).toEqual([{ id: "1" }]);
        });
    });

    // -----------------------------------------------------------------------
    // Data source methods
    // -----------------------------------------------------------------------
    describe("Data source methods", () => {
        async function setupConnected() {
            const client = createClient();
            jest.runAllTimers();
            await Promise.resolve();
            return { client,
ws: getWs() };
        }

        it("fetchCollection sends correct message type", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_COLLECTION");
            expect(msg.payload.path).toBe("posts");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { rows: [] }
            }) });

            const result = await promise;
            expect(result).toEqual([]);
        });

        it("fetchOne sends correct message type", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "123" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_ONE");
            expect(msg.payload.id).toBe("123");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { row: { id: "123" } }
            }) });

            const result = await promise;
            expect(result).toEqual({ id: "123" });
        });

        it("fetchOne returns undefined when no row in response", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "missing" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {}
            }) });

            const result = await promise;
            expect(result).toBeUndefined();
        });

        it("save sends correct message type and returns row", async () => {
            const { client, ws } = await setupConnected();

            const wireEntity = { id: "1",
title: "Hello" };
            const promise = client.save({ path: "posts",
id: "1",
values: { title: "Hello" } } as any);
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("SAVE");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { row: wireEntity }
            }) });

            const result = await promise;
            expect(result).toEqual({ id: "1", title: "Hello" });
        });

        it("delete sends correct message type", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.delete({ path: "posts",
row: { id: "1",
path: "posts",
values: {} } as any });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("DELETE");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {}
            }) });

            await promise; // Should resolve without throwing
        });

        it("executeSql sends SQL and returns results", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.executeSql("SELECT * FROM users", { database: "main",
role: "admin" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("EXECUTE_SQL");
            expect(msg.payload.sql).toBe("SELECT * FROM users");
            expect(msg.payload.options).toEqual({ database: "main",
role: "admin" });

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { result: [{ id: 1 }, { id: 2 }] }
            }) });

            const result = await promise;
            expect(result).toEqual([{ id: 1 }, { id: 2 }]);
        });

        it("executeSql returns empty array when no result", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.executeSql("DELETE FROM users");
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {}
            }) });

            const result = await promise;
            expect(result).toEqual([]);
        });

        it("count sends correct message and returns count", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.count({ path: "users" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("COUNT");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { count: 42 }
            }) });

            const result = await promise;
            expect(result).toBe(42);
        });

        it("checkUniqueField sends correct message", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.checkUniqueField("users", "email", "test@test.com", "row-1");
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("CHECK_UNIQUE_FIELD");
            expect(msg.payload).toEqual(expect.objectContaining({
                path: "users",
                name: "email",
                value: "test@test.com",
                id: "row-1"
            }));

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { isUnique: true }
            }) });

            const result = await promise;
            expect(result).toBe(true);
        });

        it("fetchAvailableDatabases returns database list", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchAvailableDatabases();
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_DATABASES");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { databases: ["main", "analytics"] }
            }) });

            const result = await promise;
            expect(result).toEqual(["main", "analytics"]);
        });

        it("fetchAvailableRoles returns roles list", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchAvailableRoles();
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_ROLES");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { roles: ["admin", "reader"] }
            }) });

            const result = await promise;
            expect(result).toEqual(["admin", "reader"]);
        });

        it("fetchCurrentDatabase returns current database", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCurrentDatabase();
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_CURRENT_DATABASE");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { database: "production" }
            }) });

            const result = await promise;
            expect(result).toBe("production");
        });

        it("fetchUnmappedTables returns table list", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchUnmappedTables(["users"]);
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_UNMAPPED_TABLES");
            expect(msg.payload.mappedPaths).toEqual(["users"]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { tables: ["orders", "products"] }
            }) });

            const result = await promise;
            expect(result).toEqual(["orders", "products"]);
        });

        it("fetchTableMetadata returns metadata with defaults", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchTableMetadata("users");
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_TABLE_METADATA");
            expect(msg.payload.tableName).toBe("users");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {}
            }) });

            const result = await promise;
            expect(result).toEqual({ columns: [],
foreignKeys: [],
junctions: [],
policies: [] });
        });
    });

    // -----------------------------------------------------------------------
    // Error handling in responses
    // -----------------------------------------------------------------------
    describe("Error handling", () => {
        async function setupConnected() {
            const client = createClient();
            jest.runAllTimers();
            await Promise.resolve();
            return { client,
ws: getWs() };
        }

        it("rejects pending request on ERROR type", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "forbidden" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                requestId: msg.requestId,
                payload: { error: { message: "Forbidden",
code: "FORBIDDEN" } }
            }) });

            await expect(promise).rejects.toThrow("Forbidden");

            try {
                await promise;
            } catch (e) {
                expect(e).toBeInstanceOf(ApiError);
                expect((e as ApiError).code).toBe("FORBIDDEN");
            }
        });

        it("rejects pending request when message has error field", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "x",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                error: "Something went wrong"
            }) });

            await expect(promise).rejects.toThrow();
        });

        it("handles nested error object in payload", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "test" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                requestId: msg.requestId,
                payload: { error: { message: "Detailed error",
code: "ERR_001" } }
            }) });

            // Guard first: everything below lives in a catch block, so a
            // promise that *resolved* would run zero assertions and pass.
            await expect(promise).rejects.toThrow("Detailed error");

            try {
                await promise;
            } catch (e) {
                expect(e).toBeInstanceOf(ApiError);
                const err = e as ApiError;
                expect(err.message).toBe("Detailed error");
                expect(err.code).toBe("ERR_001");
            }
        });

        it("handles string error in payload", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "test" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                requestId: msg.requestId,
                payload: { error: "Simple error string" }
            }) });

            await expect(promise).rejects.toThrow("Simple error string");
        });
    });

    // -----------------------------------------------------------------------
    // Subscription deduplication
    // -----------------------------------------------------------------------
    describe("Subscription deduplication", () => {
        it("deduplicates collection subscriptions with same params", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate1 = jest.fn();
            const onUpdate2 = jest.fn();

            client.listenCollection({ path: "users" }, onUpdate1);
            client.listenCollection({ path: "users" }, onUpdate2);

            // Only one subscribe message
            expect(ws.sentMessages).toHaveLength(1);
            const sent = JSON.parse(ws.sentMessages[0]);
            expect(sent.type).toBe("subscribe_collection");

            // Simulate update
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: sent.payload.subscriptionId,
                rows: [{ id: "user1" }]
            }) });

            expect(onUpdate1).toHaveBeenCalledWith([{ id: "user1" }]);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "user1" }]);
        });

        it("creates separate subscriptions for different params", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            client.listenCollection({ path: "users",
limit: 10 }, jest.fn());
            client.listenCollection({ path: "users",
limit: 20 }, jest.fn());

            expect(ws.sentMessages).toHaveLength(2);
        });

        it("unsubscribes from backend only when last callback is removed", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const unsub1 = client.listenCollection({ path: "users" }, jest.fn());
            const unsub2 = client.listenCollection({ path: "users" }, jest.fn());

            unsub1();
            expect(ws.sentMessages).toHaveLength(1); // No unsub yet

            unsub2();
            expect(ws.sentMessages).toHaveLength(2); // Unsub sent
            const unsubMsg = JSON.parse(ws.sentMessages[1]);
            expect(unsubMsg.type).toBe("unsubscribe");
        });

        it("provides cached data to late-joining subscriptions", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate1 = jest.fn();
            client.listenCollection({ path: "users" }, onUpdate1);

            const subMsg = JSON.parse(ws.sentMessages[0]);

            // Simulate initial data
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subMsg.payload.subscriptionId,
                rows: [{ id: "cached" }]
            }) });

            expect(onUpdate1).toHaveBeenCalledWith([{ id: "cached" }]);

            // Late joiner should get cached data immediately
            const onUpdate2 = jest.fn();
            client.listenCollection({ path: "users" }, onUpdate2);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "cached" }]);
        });
    });

    // -----------------------------------------------------------------------
    // Entity subscriptions
    // -----------------------------------------------------------------------
    describe("Entity subscriptions", () => {
        it("subscribes to row updates", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenOne({ path: "posts",
id: "1" }, onUpdate);

            expect(ws.sentMessages).toHaveLength(1);
            const sent = JSON.parse(ws.sentMessages[0]);
            expect(sent.type).toBe("subscribe_one");
            expect(sent.payload.path).toBe("posts");
            expect(sent.payload.id).toBe("1");
        });

        it("deduplicates row subscriptions", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate1 = jest.fn();
            const onUpdate2 = jest.fn();

            client.listenOne({ path: "posts",
id: "1" }, onUpdate1);
            client.listenOne({ path: "posts",
id: "1" }, onUpdate2);

            expect(ws.sentMessages).toHaveLength(1);

            // Simulate row update
            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "single_update",
                subscriptionId: subMsg.payload.subscriptionId,
                row: { id: "1",
title: "Updated" }
            }) });

            expect(onUpdate1).toHaveBeenCalledWith({ id: "1",
title: "Updated" });
            expect(onUpdate2).toHaveBeenCalledWith({ id: "1",
title: "Updated" });
        });

        it("handles null row (deletion)", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenOne({ path: "posts",
id: "1" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "single_update",
                subscriptionId: subMsg.payload.subscriptionId,
                row: null
            }) });

            expect(onUpdate).toHaveBeenCalledWith(null);
        });

        it("caches row data for late subscribers", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate1 = jest.fn();
            client.listenOne({ path: "posts",
id: "1" }, onUpdate1);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "single_update",
                subscriptionId: subMsg.payload.subscriptionId,
                row: { id: "1",
title: "Cached" }
            }) });

            const onUpdate2 = jest.fn();
            client.listenOne({ path: "posts",
id: "1" }, onUpdate2);
            expect(onUpdate2).toHaveBeenCalledWith({ id: "1",
title: "Cached" });
        });

        it("unsubscribes row when all callbacks removed", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const unsub1 = client.listenOne({ path: "posts",
id: "1" }, jest.fn());
            const unsub2 = client.listenOne({ path: "posts",
id: "1" }, jest.fn());

            unsub1();
            expect(ws.sentMessages).toHaveLength(1); // Just subscribe

            unsub2();
            expect(ws.sentMessages).toHaveLength(2); // + unsubscribe
        });
    });

    // -----------------------------------------------------------------------
    // mergeEntities structural equality and normalization
    // -----------------------------------------------------------------------
    describe("mergeEntities structural equality and normalization", () => {
        it("preserves row reference if only relation .data changes", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            // Initial data contains a relation without .data
            const initialEntity = {
                id: "1",
                title: "Hello",
                author: { __type: "relation",
id: "2",
path: "users" }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                rows: [initialEntity],
                pks: ID_PKS
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const firstUpdate = onUpdate.mock.calls[0][0] as any[];
            const cachedEntityInstance = firstUpdate[0];

            onUpdate.mockClear();

            // Next update contains EXACTLY the same relation, but WITH .data appended
            const refetchedEntity = {
                id: "1",
                title: "Hello",
                author: {
                    __type: "relation",
                    id: "2",
                    path: "users",
                    data: { id: "2",
name: "Alice" }
                }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                rows: [refetchedEntity],
                pks: ID_PKS
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const secondUpdate = onUpdate.mock.calls[0][0] as any[];

            // Because the .data is purely denormalized cache, the identity of the relation
            // is the same, so it should have preserved the SAME object reference!
            expect(secondUpdate[0]).toBe(cachedEntityInstance);
        });

        it("does NOT preserve row reference if the relation ID changes", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            const initialEntity = {
                id: "1",
                title: "Hello",
                author: { __type: "relation",
id: "2",
path: "users" }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                rows: [initialEntity],
                pks: ID_PKS
            }) });

            const firstUpdate = onUpdate.mock.calls[0][0] as any[];
            const cachedEntityInstance = firstUpdate[0];
            onUpdate.mockClear();

            // Next update changes the author ID
            const newAuthorEntity = {
                id: "1",
                title: "Hello",
                author: { __type: "relation",
id: "3",
path: "users" }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                rows: [newAuthorEntity],
                pks: ID_PKS
            }) });

            const secondUpdate = onUpdate.mock.calls[0][0] as any[];
            // It should be a new reference because the value is structurally different
            expect(secondUpdate[0]).not.toBe(cachedEntityInstance);
        });

        it("preserves relation identity inside array of relations", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subId = JSON.parse(ws.sentMessages[0]).payload.subscriptionId;

            const row = {
                id: "1",
                tags: [
                    { __type: "relation",
id: "10",
path: "tags" },
                    { __type: "relation",
id: "11",
path: "tags" }
                ]
            };
            ws.onmessage!({ data: JSON.stringify({ type: "collection_update",
subscriptionId: subId,
rows: [row],
pks: ID_PKS }) });

            const firstInstance = (onUpdate.mock.calls[0][0] as any[])[0];
            onUpdate.mockClear();

            const entityWithData = {
                id: "1",
                tags: [
                    { __type: "relation",
id: "10",
path: "tags",
data: { id: "10" } },
                    { __type: "relation",
id: "11",
path: "tags",
data: { id: "11" } }
                ]
            };
            ws.onmessage!({ data: JSON.stringify({ type: "collection_update",
subscriptionId: subId,
rows: [entityWithData],
pks: ID_PKS }) });

            const secondInstance = (onUpdate.mock.calls[0][0] as any[])[0];
            expect(secondInstance).toBe(firstInstance);
        });
    });

    // -----------------------------------------------------------------------
    // collection_entity_patch handling
    // -----------------------------------------------------------------------
    // The `collection_patch` block was here — three tests for the immediate
    // row-level patch. Nothing sends one: the server replaced it with a scoped
    // refetch, which is the only delivery on any path, and the client's handler
    // for it went with these. The cache-merge rules they covered are asserted
    // on the refetch in `realtime-row-identity.test.ts`, where they now live.

    describe("Subscription errors", () => {
        it("calls onError for collection subscription errors", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            const onError = jest.fn();
            client.listenCollection({ path: "secret" }, onUpdate, onError);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                subscriptionId: subMsg.payload.subscriptionId,
                payload: { error: { message: "Access denied",
code: "FORBIDDEN" } }
            }) });

            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0][0]).toBeInstanceOf(ApiError);
            expect(onError.mock.calls[0][0].message).toBe("Access denied");
        });

        it("calls onError for row subscription errors", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            const onError = jest.fn();
            client.listenOne({ path: "secret",
id: "1" }, onUpdate, onError);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                subscriptionId: subMsg.payload.subscriptionId,
                payload: { error: { message: "Not found" } }
            }) });

            expect(onError).toHaveBeenCalledTimes(1);
        });

        it("handles errors in collection subscription callbacks gracefully", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const badCb = jest.fn().mockImplementation(() => { throw new Error("callback error"); });
            const onError = jest.fn();
            client.listenCollection({ path: "users" }, badCb, onError);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subMsg.payload.subscriptionId,
                rows: []
            }) });

            // Error should have been caught and reported to onError
            expect(onError).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // -----------------------------------------------------------------------
    // Reconnection
    // -----------------------------------------------------------------------
    describe("Reconnection", () => {
        it("attempts reconnection on close with exponential backoff", () => {
            createClient();
            jest.runAllTimers(); // connect

            // The delay is 1000 * 2^attempt, capped at 30s. Pinning the whole
            // schedule is the point: "a second socket exists after 2s" holds
            // just as well for a client that redials immediately, or on a flat
            // interval, which is what the backoff is there to prevent.
            MockWebSocket.failToConnect = true;
            try {
                getWs().close();

                const expectedDelays = [2000, 4000, 8000, 16000, 30000];
                let sockets = 1;
                for (const delay of expectedDelays) {
                    jest.advanceTimersByTime(delay - 1);
                    expect(MockWebSocket.instances).toHaveLength(sockets);
                    jest.advanceTimersByTime(1);
                    sockets++;
                    expect(MockWebSocket.instances).toHaveLength(sockets);
                    // The failed dial reports its close on the next tick, which
                    // is what schedules the following retry.
                    jest.advanceTimersByTime(10);
                }
            } finally {
                MockWebSocket.failToConnect = false;
            }
        });

        it("emits reconnect event on subsequent connections", () => {
            const client = createClient();
            const reconnectCb = jest.fn();
            client.on("reconnect", reconnectCb);

            jest.runAllTimers();
            getWs().close();

            // Reconnect
            jest.advanceTimersByTime(2000);
            jest.runAllTimers();

            expect(reconnectCb).toHaveBeenCalled();
        });

        /**
         * Five attempts with exponential backoff is about a minute. A laptop
         * lid, a wifi handover and a backend rollout all exceed that, and the
         * client used to treat exhausting the budget as terminal: `onclose`
         * left the dead socket on `this.ws`, which is exactly the condition
         * `ensureConnected` bails on, so nothing could redial for the life of
         * the page.
         */
        describe("after the backoff budget runs out", () => {
            /** Take the server away, then let every scheduled retry fire and fail. */
            const exhaustRetries = () => {
                MockWebSocket.failToConnect = true;
                getWs().close();
                // 5 attempts, the last backing off 30s. 8 x 60s clears them all.
                for (let i = 0; i < 8; i++) jest.advanceTimersByTime(60_000);
            };

            /** Whatever a test does next happens against a reachable server. */
            const serverIsBack = () => { MockWebSocket.failToConnect = false; };

            /**
             * A `window` with just the two methods the client uses.
             *
             * These tests run in the node environment, where there is none —
             * and the client correctly installs no listener there. Standing one
             * up is how the browser path gets covered without moving the whole
             * file to jsdom.
             */
            const listeners = new Set<() => void>();
            let hadWindow = false;
            beforeEach(() => {
                hadWindow = "window" in globalThis;
                if (hadWindow) return;
                listeners.clear();
                (globalThis as Record<string, unknown>).window = {
                    addEventListener: (type: string, fn: () => void) => { if (type === "online") listeners.add(fn); },
                    removeEventListener: (type: string, fn: () => void) => { if (type === "online") listeners.delete(fn); }
                };
            });
            afterEach(() => {
                MockWebSocket.failToConnect = false;
                if (!hadWindow) delete (globalThis as Record<string, unknown>).window;
            });

            /** Fire the browser's `online` event at whoever is listening. */
            const goOnline = () => { for (const fn of [...listeners]) fn(); };

            it("stops retrying on its own", () => {
                createClient();
                jest.runAllTimers();
                exhaustRetries();
                const settled = MockWebSocket.instances.length;
                jest.advanceTimersByTime(120_000);
                expect(MockWebSocket.instances).toHaveLength(settled);
            });

            it("dials again when something asks for a connection", () => {
                const client = createClient();
                jest.runAllTimers();
                exhaustRetries();
                const settled = MockWebSocket.instances.length;

                serverIsBack();
                client.ensureConnected();
                expect(MockWebSocket.instances.length).toBeGreaterThan(settled);
            });

            it("dials again when the browser comes back online", () => {
                createClient();
                jest.runAllTimers();
                exhaustRetries();
                const settled = MockWebSocket.instances.length;

                serverIsBack();
                goOnline();
                expect(MockWebSocket.instances.length).toBeGreaterThan(settled);
            });

            it("stays down after an explicit close, online event or not", () => {
                const client = createClient();
                jest.runAllTimers();
                exhaustRetries();
                client.disconnect(true);
                const settled = MockWebSocket.instances.length;

                serverIsBack();
                goOnline();
                client.ensureConnected();
                expect(MockWebSocket.instances).toHaveLength(settled);
            });
        });

        it("re-queues pending requests on disconnect", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            // Start a request
            const promise = client.fetchCollection({ path: "test" });
            const sentCount = ws.sentMessages.length;

            // Disconnect
            ws.close();

            // The message should be re-queued
            expect((client as any).messageQueue.length).toBeGreaterThan(0);
        });

        it("stops reconnecting after max attempts", () => {
            createClient();
            jest.runAllTimers();
            expect(MockWebSocket.instances).toHaveLength(1);

            // The server has to stay away for the budget to be exhausted at
            // all: a socket that comes up resets `reconnectAttempts`, so a
            // client that let each retry succeed would redial forever and
            // still satisfy a ">= 2 sockets" assertion.
            MockWebSocket.failToConnect = true;
            try {
                getWs().close();
                // 5 retries, the last backing off 30s — 10 x 60s is far more
                // than enough for every one of them to fire and fail.
                for (let i = 0; i < 10; i++) jest.advanceTimersByTime(60_000);

                // maxReconnectAttempts is 5: the initial dial plus exactly five
                // retries, and then nothing, however long we wait.
                expect(MockWebSocket.instances).toHaveLength(6);
                jest.advanceTimersByTime(10 * 60_000);
                expect(MockWebSocket.instances).toHaveLength(6);
            } finally {
                MockWebSocket.failToConnect = false;
            }
        });
    });

    // -----------------------------------------------------------------------
    // ensureAuthenticated – on-demand auth with retry logic
    // -----------------------------------------------------------------------
    describe("ensureAuthenticated (on-demand auth)", () => {

        /**
         * Helper: create a client that is connected and has a token getter,
         * but is NOT yet authenticated.  This mimics the startup race where the
         * ConfigControllerProvider fires a request before the WS has authed.
         *
         * NOTE: `setAuthTokenGetter` auto-triggers an auth attempt when the WS
         * is already connected.  We flush that call and clear the mock so that
         * subsequent call-count assertions only reflect the `ensureAuthenticated`
         * path triggered by data requests.
         */
        async function setupWithTokenGetter(
            getter: jest.Mock<() => Promise<string>>
        ) {
            // Create client WITHOUT a built-in getAuthToken so onopen doesn't auto-auth
            const client = createClient();
            jest.runAllTimers(); // open the WS
            await Promise.resolve(); // flush microtasks

            // Now install the getter *after* connect (mimics useEffect ordering).
            // This fires an auto-auth attempt asynchronously via getAuthToken().then(...)
            client.setAuthTokenGetter(getter);

            // Flush the auto-auth microtask so it resolves / rejects
            await Promise.resolve();
            await Promise.resolve();

            // Reset the mock so tests only count ensureAuthenticated calls
            getter.mockClear();

            return { client,
ws: getWs() };
        }

        /** Drain pending microtasks by chaining multiple Promise.resolve() calls */
        async function flushMicrotasks(n = 10) {
            for (let i = 0; i < n; i++) {
                await Promise.resolve();
            }
        }

        it("retries on 'still loading' and succeeds once token becomes available", async () => {
            let callCount = 0;
            const getter = jest.fn(async () => {
                callCount++;
                if (callCount <= 2) {
                    throw new Error("Auth is still loading");
                }
                return "valid-token";
            });

            const { client, ws } = await setupWithTokenGetter(getter as any);

            // Reset callCount after auto-auth consumed one call
            callCount = 0;
            getter.mockClear();
            getter.mockImplementation(async () => {
                callCount++;
                if (callCount <= 2) {
                    throw new Error("Auth is still loading");
                }
                return "valid-token";
            });

            // Start a request that will trigger ensureAuthenticated
            const fetchPromise = client.fetchCollection({ path: "posts" });

            // Progressively advance timers and flush microtasks until AUTHENTICATE appears
            for (let i = 0; i < 10; i++) {
                jest.advanceTimersByTime(500);
                await flushMicrotasks();
                if (ws.sentMessages.some(m => JSON.parse(m).type === "AUTHENTICATE")) break;
            }

            // Find and respond to the AUTHENTICATE message
            const authMsg = ws.sentMessages.find(
                m => JSON.parse(m).type === "AUTHENTICATE"
            );
            expect(authMsg).toBeDefined();
            const parsed = JSON.parse(authMsg!);
            expect(parsed.payload.token).toBe("valid-token");

            // Simulate auth success
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_SUCCESS",
                requestId: parsed.requestId,
                payload: {}
            }) });

            // Flush until the FETCH_COLLECTION is sent
            await flushMicrotasks();

            const fetchMsg = ws.sentMessages.find(
                m => JSON.parse(m).type === "FETCH_COLLECTION"
            );
            expect(fetchMsg).toBeDefined();

            // Respond to the fetch
            const fetchParsed = JSON.parse(fetchMsg!);
            ws.onmessage!({ data: JSON.stringify({
                requestId: fetchParsed.requestId,
                payload: { rows: [{ id: "1" }] }
            }) });

            const result = await fetchPromise;
            expect(result).toEqual([{ id: "1" }]);

            // Verify it retried (3 calls from ensureAuthenticated)
            expect(getter).toHaveBeenCalledTimes(3);
        });

        it("immediately fails on 'not logged in' without retrying", async () => {
            const getter = jest.fn(async (): Promise<string> => {
                throw new Error("User is not logged in");
            });

            const { client } = await setupWithTokenGetter(getter as any);

            const promise = client.fetchCollection({ path: "posts" });

            // Flush microtasks to let ensureAuthenticated run
            await Promise.resolve();
            await Promise.resolve();

            await expect(promise).rejects.toThrow("not logged in");
            // ensureAuthenticated should call getter exactly once — no retries
            expect(getter).toHaveBeenCalledTimes(1);
        });

        it("immediately fails on 'Session expired' without retrying", async () => {
            const getter = jest.fn(async (): Promise<string> => {
                throw new Error("Session expired. Please login again.");
            });

            const { client } = await setupWithTokenGetter(getter as any);

            const promise = client.fetchCollection({ path: "users" });

            await Promise.resolve();
            await Promise.resolve();

            await expect(promise).rejects.toThrow("Session expired");
            expect(getter).toHaveBeenCalledTimes(1);
        });

        it("returns falsy token (empty string) as 'not logged in'", async () => {
            const getter = jest.fn(async () => "");
            const { client } = await setupWithTokenGetter(getter as any);

            const promise = client.fetchCollection({ path: "test" });
            await Promise.resolve();
            await Promise.resolve();

            await expect(promise).rejects.toThrow("not logged in");
        });

        it("retries generic errors with backoff and eventually fails", async () => {
            const getter = jest.fn(async (): Promise<string> => {
                throw new Error("Network unavailable");
            });

            const { client } = await setupWithTokenGetter(getter as any);
            const promise = client.fetchCollection({ path: "test" });

            // Attempt 1 — immediate
            await Promise.resolve();
            await Promise.resolve();

            // Advance past the first retry delay (1000ms)
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
            await Promise.resolve();

            // Advance past the second retry delay (2000ms)
            jest.advanceTimersByTime(2000);
            await Promise.resolve();
            await Promise.resolve();

            // All 3 attempts exhausted
            await expect(promise).rejects.toThrow("Network unavailable");
            expect(getter).toHaveBeenCalledTimes(3);
        });

        it("skips auth entirely when already authenticated", async () => {
            const getter = jest.fn(async () => "token-123");
            const client = createClient({ getAuthToken: getter });

            jest.runAllTimers();
            await Promise.resolve();

            // The client auto-authenticates on connect — simulate auth success
            const ws = getWs();
            const authMsg = ws.sentMessages.find(m => JSON.parse(m).type === "AUTHENTICATE");
            if (authMsg) {
                const parsed = JSON.parse(authMsg);
                ws.onmessage!({ data: JSON.stringify({
                    type: "AUTH_SUCCESS",
                    requestId: parsed.requestId,
                    payload: {}
                }) });
            }
            await Promise.resolve();

            // Reset call count after auto-auth
            getter.mockClear();

            // Now make a data request — ensureAuthenticated should skip
            const fetchPromise = client.fetchCollection({ path: "users" });
            const fetchMsg = ws.sentMessages.find(m => JSON.parse(m).type === "FETCH_COLLECTION");
            expect(fetchMsg).toBeDefined();

            const fetchParsed = JSON.parse(fetchMsg!);
            ws.onmessage!({ data: JSON.stringify({
                requestId: fetchParsed.requestId,
                payload: { rows: [] }
            }) });

            await fetchPromise;
            // Token getter should NOT have been called again since we're already authed
            expect(getter).not.toHaveBeenCalled();
        });

        it("skips auth when no token getter is set", async () => {
            const client = createClient();
            jest.runAllTimers();
            await Promise.resolve();

            // No getAuthToken set — ensureAuthenticated should be a no-op
            const ws = getWs();
            const fetchPromise = client.fetchCollection({ path: "public" });

            const fetchMsg = ws.sentMessages.find(m => JSON.parse(m).type === "FETCH_COLLECTION");
            expect(fetchMsg).toBeDefined();

            const fetchParsed = JSON.parse(fetchMsg!);
            ws.onmessage!({ data: JSON.stringify({
                requestId: fetchParsed.requestId,
                payload: { rows: [{ id: "pub1" }] }
            }) });

            const result = await fetchPromise;
            expect(result).toEqual([{ id: "pub1" }]);
        });

        it("'still loading' uses shorter backoff (500ms) than generic errors (1000ms)", async () => {
            /**
             * The two branches differ in nothing but the sleep between
             * attempts, so only the clock can tell them apart: start the retry
             * loop, then probe one tick either side of the expected delay.
             * A test that merely advances until AUTHENTICATE appears passes for
             * both delays — and for no delay at all.
             */
            const startRetryLoop = async (errorMessage: string) => {
                const getter = jest.fn(async (): Promise<string> => {
                    throw new Error(errorMessage);
                });
                const { client } = await setupWithTokenGetter(getter as any);

                const fetchPromise = client.fetchCollection({ path: "test" });
                // The getter never yields a token, so this request is doomed;
                // claim the rejection now so it is never unhandled.
                const settled = fetchPromise.then(() => undefined, () => undefined);
                await flushMicrotasks();
                expect(getter).toHaveBeenCalledTimes(1);
                return { getter,
settled };
            };

            const loading = await startRetryLoop("Auth is still loading");
            await jest.advanceTimersByTimeAsync(499);
            expect(loading.getter).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);
            expect(loading.getter).toHaveBeenCalledTimes(2);
            // Let the loop run out (attempt 2 sleeps 1000ms) so its timers do
            // not bleed into the measurement below.
            await jest.advanceTimersByTimeAsync(5000);
            await loading.settled;

            const generic = await startRetryLoop("boom");
            await jest.advanceTimersByTimeAsync(999);
            expect(generic.getter).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);
            expect(generic.getter).toHaveBeenCalledTimes(2);
            await jest.advanceTimersByTimeAsync(5000);
            await generic.settled;
        });
    });

    // -----------------------------------------------------------------------
    // ApiError
    // -----------------------------------------------------------------------
    describe("RebaseApiError (thrown by the WS client)", () => {
        it("creates error with message and code", () => {
            const err = new ApiError("test message", { code: "CODE" });
            expect(err).toBeInstanceOf(Error);
            expect(err.name).toBe("RebaseApiError");
            expect(err.message).toBe("test message");
            expect(err.code).toBe("CODE");
        });

        it("works without optional parameters", () => {
            const err = new ApiError("simple error");
            expect(err.code).toBeUndefined();
            expect(err.status).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // rehydrateServerValues / rehydrateEntity  (tested via public API)
    // -----------------------------------------------------------------------
    describe("rehydrateServerValues (date rehydration)", () => {
        async function setupConnected() {
            const client = createClient();
            jest.runAllTimers();
            await Promise.resolve();
            return { client,
ws: getWs() };
        }

        // -- fetchCollection path ------------------------------------------

        it("converts serialized date objects to Date instances in fetchCollection", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    rows: [{
                        id: "1",
                        title: "Hello",
                        createdAt: { __type: "date",
value: "2025-06-15T12:00:00.000Z" }
                    }]
                }
            }) });

            const result = await promise;
            expect(result).toHaveLength(1);
            expect(result[0].createdAt).toBeInstanceOf(Date);
            expect((result[0].createdAt as unknown as Date).toISOString()).toBe("2025-06-15T12:00:00.000Z");
        });

        it("returns null for invalid serialized dates in fetchCollection", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    rows: [{
                        id: "1",
                        badDate: { __type: "date",
value: "not-a-date" }
                    }]
                }
            }) });

            const result = await promise;
            expect(result[0].badDate).toBeNull();
        });

        it("handles multiple serialized dates across rows", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    rows: [
                        { id: "1",
publishedAt: { __type: "date",
value: "2025-01-01T00:00:00.000Z" } },
                        { id: "2",
publishedAt: { __type: "date",
value: "2025-12-31T23:59:59.999Z" } }
                    ]
                }
            }) });

            const result = await promise;
            expect(result[0].publishedAt).toBeInstanceOf(Date);
            expect(result[1].publishedAt).toBeInstanceOf(Date);
            expect((result[1].publishedAt as unknown as Date).toISOString()).toBe("2025-12-31T23:59:59.999Z");
        });

        // -- fetchOne path ----------------------------------------------

        it("converts serialized dates in fetchOne", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        updatedAt: { __type: "date",
value: "2025-03-20T08:30:00.000Z" },
                        title: "Test"
                    }
                }
            }) });

            const result = await promise;
            expect(result).toBeDefined();
            expect(result!.updatedAt).toBeInstanceOf(Date);
            expect(result!.title).toBe("Test");
        });

        // -- save path -----------------------------------------------

        it("converts serialized dates in save response", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.save({
                path: "posts",
                id: "1",
                values: { title: "Updated" }
            } as any);
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        title: "Updated",
                        updatedAt: { __type: "date",
value: "2025-07-01T00:00:00.000Z" }
                    }
                }
            }) });

            const result = await promise;
            expect(result.updatedAt).toBeInstanceOf(Date);
        });

        // -- Nested & complex structures -----------------------------------

        it("converts dates nested inside plain objects (maps)", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        metadata: {
                            createdAt: { __type: "date",
value: "2025-01-01T00:00:00.000Z" },
                            editedAt: { __type: "date",
value: "2025-06-01T00:00:00.000Z" }
                        }
                    }
                }
            }) });

            const result = await promise;
            const metadata = result!.metadata as Record<string, unknown>;
            expect(metadata.createdAt).toBeInstanceOf(Date);
            expect(metadata.editedAt).toBeInstanceOf(Date);
        });

        it("converts dates inside arrays", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "events",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        dates: [
                            { __type: "date",
value: "2025-01-01T00:00:00.000Z" },
                            { __type: "date",
value: "2025-02-01T00:00:00.000Z" }
                        ]
                    }
                }
            }) });

            const result = await promise;
            const dates = result!.dates as Date[];
            expect(dates).toHaveLength(2);
            expect(dates[0]).toBeInstanceOf(Date);
            expect(dates[1]).toBeInstanceOf(Date);
        });

        it("converts dates inside array of objects", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        revisions: [
                            { author: "Alice",
savedAt: { __type: "date",
value: "2025-03-01T10:00:00.000Z" } },
                            { author: "Bob",
savedAt: { __type: "date",
value: "2025-03-02T10:00:00.000Z" } }
                        ]
                    }
                }
            }) });

            const result = await promise;
            const revisions = result!.revisions as Array<{ author: string; savedAt: Date }>;
            expect(revisions[0].savedAt).toBeInstanceOf(Date);
            expect(revisions[1].author).toBe("Bob");
            expect(revisions[1].savedAt).toBeInstanceOf(Date);
        });

        it("preserves relation objects while converting sibling dates", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        author: { __type: "relation",
id: "42",
path: "users" },
                        createdAt: { __type: "date",
value: "2025-05-01T00:00:00.000Z" }
                    }
                }
            }) });

            const result = await promise;
            // Date should be converted
            expect(result!.createdAt).toBeInstanceOf(Date);
            // Relation should be preserved as a plain object (not converted)
            const author = result!.author as Record<string, unknown>;
            expect(author.__type).toBe("relation");
            expect(author.id).toBe("42");
            expect(author.path).toBe("users");
        });

        // -- Passthrough / edge cases --------------------------------------

        it("passes through null and undefined values", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        title: null,
                        count: 0,
                        active: false,
                        name: "hello"
                    }
                }
            }) });

            const result = await promise;
            expect(result!.title).toBeNull();
            expect(result!.count).toBe(0);
            expect(result!.active).toBe(false);
            expect(result!.name).toBe("hello");
        });

        it("does not mutate objects that have __type but not 'date'", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        ref: { __type: "reference",
path: "some/path" },
                        custom: { __type: "custom",
data: 123 }
                    }
                }
            }) });

            const result = await promise;
            const ref = result!.ref as Record<string, unknown>;
            expect(ref.__type).toBe("reference");
            expect(ref.path).toBe("some/path");
            const custom = result!.custom as Record<string, unknown>;
            expect(custom.__type).toBe("custom");
            expect(custom.data).toBe(123);
        });

        it("handles __type date with non-string value gracefully (treats as plain object)", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            // __type is "date" but value is a number, not a string → should NOT match the date rehydration branch
            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        weird: { __type: "date",
value: 12345 }
                    }
                }
            }) });

            const result = await promise;
            const weird = result!.weird as Record<string, unknown>;
            // Because value is not a string, it falls through to the plain-object recursion
            expect(weird.__type).toBe("date");
            expect(weird.value).toBe(12345);
        });

        it("handles empty row values", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: { id: "1" }
                }
            }) });

            const result = await promise;
            expect(result).toEqual({ id: "1" });
        });

        it("handles deeply nested date structures (3+ levels)", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchOne({ path: "posts",
id: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    row: {
                        id: "1",
                        level1: {
                            level2: {
                                level3: {
                                    deepDate: { __type: "date",
value: "2024-12-25T00:00:00.000Z" }
                                }
                            }
                        }
                    }
                }
            }) });

            const result = await promise;
            const deepDate = (result as any).level1.level2.level3.deepDate;
            expect(deepDate).toBeInstanceOf(Date);
            expect(deepDate.toISOString()).toBe("2024-12-25T00:00:00.000Z");
        });

        // -- Subscription paths --------------------------------------------

        it("rehydrates dates in collection subscription updates", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subMsg.payload.subscriptionId,
                rows: [{
                    id: "1",
                    createdAt: { __type: "date",
value: "2025-08-01T00:00:00.000Z" },
                    title: "Sub Test"
                }]
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const rows = onUpdate.mock.calls[0][0] as any[];
            expect(rows[0].createdAt).toBeInstanceOf(Date);
            expect(rows[0].title).toBe("Sub Test");
        });

        it("rehydrates dates in row subscription updates", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenOne({ path: "posts",
id: "1" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "single_update",
                subscriptionId: subMsg.payload.subscriptionId,
                row: {
                    id: "1",
                    updatedAt: { __type: "date",
value: "2025-09-15T18:30:00.000Z" }
                }
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const row = onUpdate.mock.calls[0][0] as any;
            expect(row.updatedAt).toBeInstanceOf(Date);
            expect(row.updatedAt.toISOString()).toBe("2025-09-15T18:30:00.000Z");
        });

        it("rehydrates dates in collection updates", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            // Send initial data so the subscription has isInitialDataReceived = true
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                rows: [{ id: "1",
title: "Original" }]
            }) });

            onUpdate.mockClear();

            // Now send a refetch carrying a date.
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                rows: [{
                    id: "1",
                    title: "Patched",
                    patchedAt: { __type: "date",
value: "2025-10-01T00:00:00.000Z" }
                }]
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const rows = onUpdate.mock.calls[0][0] as any[];
            const patched = rows.find((e: any) => e.id === "1");
            expect(patched.patchedAt).toBeInstanceOf(Date);
        });

        // -- rehydrateEntity guards ----------------------------------------

        it("handles row with missing values gracefully", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            // Entity without a values property
            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    rows: [{ id: "1" }]
                }
            }) });

            const result = await promise;
            // Should not throw, row is returned as-is
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("1");
        });
    });

    // -----------------------------------------------------------------------
    // WebSocket Token Refresh and Request Retry
    // -----------------------------------------------------------------------
    describe("WebSocket Token Refresh and Request Retry", () => {
        async function flushMicrotasks(n = 10) {
            for (let i = 0; i < n; i++) {
                await Promise.resolve();
            }
        }

        it("triggers onUnauthorized and retries pending request on auth error", async () => {
            const onUnauthorized = jest.fn().mockResolvedValue(true);
            const getAuthToken = jest.fn()
                .mockResolvedValueOnce("old-token")
                .mockResolvedValueOnce("new-token");

            const client = createClient({ getAuthToken,
onUnauthorized });
            jest.runAllTimers();
            await Promise.resolve();

            const ws = getWs();
            // Get initial auth request and simulate success
            const initialAuth = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_SUCCESS",
                requestId: initialAuth.requestId,
                payload: {}
            }) });
            await flushMicrotasks();

            // Clear sent messages
            ws.sentMessages = [];

            // Make a data request
            const fetchPromise = client.fetchCollection({ path: "posts" });
            expect(ws.sentMessages).toHaveLength(1);
            const dataMsg = JSON.parse(ws.sentMessages[0]);

            // Simulate auth error response
            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                requestId: dataMsg.requestId,
                payload: { error: { message: "Unauthorized token",
code: "UNAUTHORIZED" } }
            }) });

            // Allow async handlers to run (onUnauthorized and handleAuthFailure)
            await flushMicrotasks();

            expect(onUnauthorized).toHaveBeenCalled();
            expect(getAuthToken).toHaveBeenCalledTimes(2);

            // Re-auth should have been sent
            const reauthMsg = JSON.parse(ws.sentMessages[1]);
            expect(reauthMsg.type).toBe("AUTHENTICATE");
            expect(reauthMsg.payload.token).toBe("new-token");

            // Simulate reauth success
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_SUCCESS",
                requestId: reauthMsg.requestId,
                payload: {}
            }) });
            await flushMicrotasks();

            // The data request should have been retried
            const retriedMsg = JSON.parse(ws.sentMessages[2]);
            expect(retriedMsg.type).toBe("FETCH_COLLECTION");
            expect(retriedMsg.payload.path).toBe("posts");

            // Complete the data request
            ws.onmessage!({ data: JSON.stringify({
                type: "FETCH_COLLECTION",
                requestId: retriedMsg.requestId,
                payload: { rows: [{ id: "post1" }] }
            }) });

            const result = await fetchPromise;
            expect(result).toEqual([{ id: "post1" }]);
        });

        it("triggers onUnauthorized and resubscribes collection subscription on auth error", async () => {
            const onUnauthorized = jest.fn().mockResolvedValue(true);
            const getAuthToken = jest.fn()
                .mockResolvedValueOnce("old-token")
                .mockResolvedValueOnce("new-token");

            const client = createClient({ getAuthToken,
onUnauthorized });
            jest.runAllTimers();
            await Promise.resolve();

            const ws = getWs();
            // Handle initial auth
            const initialAuth = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_SUCCESS",
                requestId: initialAuth.requestId,
                payload: {}
            }) });
            await flushMicrotasks();

            ws.sentMessages = [];

            // Setup collection subscription
            const onUpdate = jest.fn();
            const onError = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate, onError);

            expect(ws.sentMessages).toHaveLength(1);
            const subMsg = JSON.parse(ws.sentMessages[0]);
            expect(subMsg.type).toBe("subscribe_collection");

            // Simulate subscription auth error
            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                subscriptionId: subMsg.payload.subscriptionId,
                payload: { error: { message: "unauthorized",
code: "UNAUTHORIZED" } }
            }) });

            await flushMicrotasks();

            expect(onUnauthorized).toHaveBeenCalled();

            // Check re-authenticate message
            const reauthMsg = JSON.parse(ws.sentMessages[1]);
            expect(reauthMsg.type).toBe("AUTHENTICATE");
            expect(reauthMsg.payload.token).toBe("new-token");

            // Simulate reauth success
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_SUCCESS",
                requestId: reauthMsg.requestId,
                payload: {}
            }) });
            await flushMicrotasks();

            // Check that it re-subscribed
            const resubMsg = JSON.parse(ws.sentMessages[2]);
            expect(resubMsg.type).toBe("subscribe_collection");
            expect(resubMsg.payload.path).toBe("posts");
            expect(resubMsg.payload.subscriptionId).not.toBe(subMsg.payload.subscriptionId);

            // Send collection update on the new subscription
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: resubMsg.payload.subscriptionId,
                rows: [{ id: "post1" }]
            }) });

            expect(onUpdate).toHaveBeenCalledWith([{ id: "post1" }]);
            expect(onError).not.toHaveBeenCalled();
        });
    });
});
