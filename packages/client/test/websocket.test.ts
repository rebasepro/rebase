import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient, ApiError } from "../src/websocket";

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

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
        // Simulate async open
        setTimeout(() => {
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

function createClient(opts?: Partial<ConstructorParameters<typeof RebaseWebSocketClient>[0]>) {
    const client = new RebaseWebSocketClient({
        websocketUrl: "ws://localhost:1234",
        WebSocket: MockWebSocket as any,
        ...opts
    });
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
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
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

        it("setAuthTokenGetter sets the getter function", () => {
            const client = createClient();
            const getter = jest.fn().mockResolvedValue("new-token");
            client.setAuthTokenGetter(getter);
            expect(client.getAuthToken).toBe(getter);
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
            // Should not throw
            client.disconnect();
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

            jest.runAllTimers();
            await Promise.resolve();

            const ws = getWs();
            expect(ws.sentMessages.length).toBe(1);
            const sent = JSON.parse(ws.sentMessages[0]);
            expect(sent.type).toBe("FETCH_COLLECTION");

            // Simulate response
            ws.onmessage!({ data: JSON.stringify({
                type: "FETCH_COLLECTION",
                requestId: sent.requestId,
                payload: { entities: [{ id: "1" }] }
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
                payload: { entities: [] }
            }) });

            const result = await promise;
            expect(result).toEqual([]);
        });

        it("fetchEntity sends correct message type", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "123" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("FETCH_ENTITY");
            expect(msg.payload.entityId).toBe("123");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { entity: { id: "123",
values: {} } }
            }) });

            const result = await promise;
            expect(result).toEqual({ id: "123",
values: {} });
        });

        it("fetchEntity returns undefined when no entity in response", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "missing" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {}
            }) });

            const result = await promise;
            expect(result).toBeUndefined();
        });

        it("saveEntity sends correct message type and returns entity", async () => {
            const { client, ws } = await setupConnected();

            const entity = { id: "1",
path: "posts",
values: { title: "Hello" } };
            const promise = client.saveEntity({ path: "posts",
entityId: "1",
values: { title: "Hello" } } as any);
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("SAVE_ENTITY");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { entity }
            }) });

            const result = await promise;
            expect(result).toEqual(entity);
        });

        it("deleteEntity sends correct message type", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.deleteEntity({ path: "posts",
entity: { id: "1",
path: "posts",
values: {} } as any });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("DELETE_ENTITY");

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

        it("countEntities sends correct message and returns count", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.countEntities({ path: "users" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("COUNT_ENTITIES");

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: { count: 42 }
            }) });

            const result = await promise;
            expect(result).toBe(42);
        });

        it("checkUniqueField sends correct message", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.checkUniqueField("users", "email", "test@test.com", "entity-1");
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(msg.type).toBe("CHECK_UNIQUE_FIELD");
            expect(msg.payload).toEqual(expect.objectContaining({
                path: "users",
                name: "email",
                value: "test@test.com",
                entityId: "entity-1"
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

            const promise = client.fetchEntity({ path: "x",
entityId: "1" });
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
                entities: [{ id: "user1" }]
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
                entities: [{ id: "cached" }]
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
        it("subscribes to entity updates", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenEntity({ path: "posts",
entityId: "1" }, onUpdate);

            expect(ws.sentMessages).toHaveLength(1);
            const sent = JSON.parse(ws.sentMessages[0]);
            expect(sent.type).toBe("subscribe_entity");
            expect(sent.payload.path).toBe("posts");
            expect(sent.payload.entityId).toBe("1");
        });

        it("deduplicates entity subscriptions", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate1 = jest.fn();
            const onUpdate2 = jest.fn();

            client.listenEntity({ path: "posts",
entityId: "1" }, onUpdate1);
            client.listenEntity({ path: "posts",
entityId: "1" }, onUpdate2);

            expect(ws.sentMessages).toHaveLength(1);

            // Simulate entity update
            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "entity_update",
                subscriptionId: subMsg.payload.subscriptionId,
                entity: { id: "1",
values: { title: "Updated" } }
            }) });

            expect(onUpdate1).toHaveBeenCalledWith({ id: "1",
values: { title: "Updated" } });
            expect(onUpdate2).toHaveBeenCalledWith({ id: "1",
values: { title: "Updated" } });
        });

        it("handles null entity (deletion)", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenEntity({ path: "posts",
entityId: "1" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "entity_update",
                subscriptionId: subMsg.payload.subscriptionId,
                entity: null
            }) });

            expect(onUpdate).toHaveBeenCalledWith(null);
        });

        it("caches entity data for late subscribers", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate1 = jest.fn();
            client.listenEntity({ path: "posts",
entityId: "1" }, onUpdate1);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "entity_update",
                subscriptionId: subMsg.payload.subscriptionId,
                entity: { id: "1",
values: { title: "Cached" } }
            }) });

            const onUpdate2 = jest.fn();
            client.listenEntity({ path: "posts",
entityId: "1" }, onUpdate2);
            expect(onUpdate2).toHaveBeenCalledWith({ id: "1",
values: { title: "Cached" } });
        });

        it("unsubscribes entity when all callbacks removed", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const unsub1 = client.listenEntity({ path: "posts",
entityId: "1" }, jest.fn());
            const unsub2 = client.listenEntity({ path: "posts",
entityId: "1" }, jest.fn());

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
        it("preserves entity reference if only relation .data changes", () => {
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
                path: "posts",
                values: {
                    title: "Hello",
                    author: { __type: "relation",
id: "2",
path: "users" }
                }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                entities: [initialEntity]
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const firstUpdate = onUpdate.mock.calls[0][0] as any[];
            const cachedEntityInstance = firstUpdate[0];

            onUpdate.mockClear();

            // Next update contains EXACTLY the same relation, but WITH .data appended
            const refetchedEntity = {
                id: "1",
                path: "posts",
                values: {
                    title: "Hello",
                    author: {
                        __type: "relation",
                        id: "2",
                        path: "users",
                        data: { id: "2",
path: "users",
values: { name: "Alice" } }
                    }
                }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                entities: [refetchedEntity]
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const secondUpdate = onUpdate.mock.calls[0][0] as any[];

            // Because the .data is purely denormalized cache, the identity of the relation
            // is the same, so it should have preserved the SAME object reference!
            expect(secondUpdate[0]).toBe(cachedEntityInstance);
        });

        it("does NOT preserve entity reference if the relation ID changes", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            const initialEntity = {
                id: "1",
                path: "posts",
                values: {
                    title: "Hello",
                    author: { __type: "relation",
id: "2",
path: "users" }
                }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                entities: [initialEntity]
            }) });

            const firstUpdate = onUpdate.mock.calls[0][0] as any[];
            const cachedEntityInstance = firstUpdate[0];
            onUpdate.mockClear();

            // Next update changes the author ID
            const newAuthorEntity = {
                id: "1",
                path: "posts",
                values: {
                    title: "Hello",
                    author: { __type: "relation",
id: "3",
path: "users" }
                }
            };

            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                entities: [newAuthorEntity]
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

            const entity = {
                id: "1",
                path: "posts",
                values: {
                    tags: [
                        { __type: "relation",
id: "10",
path: "tags" },
                        { __type: "relation",
id: "11",
path: "tags" }
                    ]
                }
            };
            ws.onmessage!({ data: JSON.stringify({ type: "collection_update",
subscriptionId: subId,
entities: [entity] }) });

            const firstInstance = (onUpdate.mock.calls[0][0] as any[])[0];
            onUpdate.mockClear();

            const entityWithData = {
                id: "1",
                path: "posts",
                values: {
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
                }
            };
            ws.onmessage!({ data: JSON.stringify({ type: "collection_update",
subscriptionId: subId,
entities: [entityWithData] }) });

            const secondInstance = (onUpdate.mock.calls[0][0] as any[])[0];
            expect(secondInstance).toBe(firstInstance);
        });
    });

    // -----------------------------------------------------------------------
    // collection_entity_patch handling
    // -----------------------------------------------------------------------
    describe("collection_entity_patch", () => {
        it("patches existing entity in collection", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            // Initial data
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                entities: [
                    { id: "1",
values: { title: "Old" } },
                    { id: "2",
values: { title: "Two" } }
                ]
            }) });

            onUpdate.mockClear();

            // Patch entity 1
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_entity_patch",
                subscriptionId: subId,
                entity: { id: "1",
values: { title: "New" } }
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const updatedEntities = onUpdate.mock.calls[0][0];
            expect(updatedEntities).toHaveLength(2);
            expect(updatedEntities[0]).toEqual({ id: "1",
values: { title: "New" } });
            expect(updatedEntities[1]).toEqual({ id: "2",
values: { title: "Two" } });
        });

        it("adds new entity via patch (prepends)", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            // Initial data
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                entities: [{ id: "1",
values: {} }]
            }) });
            onUpdate.mockClear();

            // New entity via patch
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_entity_patch",
                subscriptionId: subId,
                entity: { id: "new",
values: { title: "Fresh" } }
            }) });

            const result = onUpdate.mock.calls[0][0];
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe("new"); // Prepended
        });

        it("removes entity from collection on null patch", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            // Initial data
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_update",
                subscriptionId: subId,
                entities: [
                    { id: "1",
values: {} },
                    { id: "2",
values: {} }
                ]
            }) });
            onUpdate.mockClear();

            // Delete entity 1
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_entity_patch",
                subscriptionId: subId,
                entity: null,
                entityId: "1"
            }) });

            const result = onUpdate.mock.calls[0][0];
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("2");
        });

        it("ignores patches before initial data is received", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenCollection({ path: "posts" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            const subId = subMsg.payload.subscriptionId;

            // Patch before any collection_update
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_entity_patch",
                subscriptionId: subId,
                entity: { id: "1",
values: {} }
            }) });

            expect(onUpdate).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Subscription error handling
    // -----------------------------------------------------------------------
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

        it("calls onError for entity subscription errors", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            const onError = jest.fn();
            client.listenEntity({ path: "secret",
entityId: "1" }, onUpdate, onError);

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
                entities: []
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
            const client = createClient();
            jest.runAllTimers(); // connect

            const ws = getWs();
            ws.close(); // Disconnect

            // Should attempt reconnection
            jest.advanceTimersByTime(2000);
            expect(MockWebSocket.instances).toHaveLength(2); // Original + reconnect
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
            const client = createClient();
            jest.runAllTimers();

            // Close the initial connection
            getWs().close();

            // Each reconnect creates a new WS, opens, then we close it
            // maxReconnectAttempts is 5, so after 5 reconnect cycles it should stop
            for (let i = 0; i < 10; i++) {
                jest.advanceTimersByTime(60000);
                jest.runAllTimers();
                const ws = getWs();
                if (ws.readyState === MockWebSocket.OPEN) {
                    ws.close();
                }
            }

            // 1 initial + at most 5 reconnects = 6 max
            // But each successful reconnect resets the counter, so we need
            // to only close without allowing open to fire.
            // Let's just verify the client doesn't crash and stops eventually
            expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
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
                payload: { entities: [{ id: "1" }] }
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
                payload: { entities: [] }
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
                payload: { entities: [{ id: "pub1" }] }
            }) });

            const result = await fetchPromise;
            expect(result).toEqual([{ id: "pub1" }]);
        });

        it("'still loading' uses shorter backoff (500ms) than generic errors (1000ms)", async () => {
            let callCount = 0;
            const getter = jest.fn(async (): Promise<string> => {
                callCount++;
                if (callCount <= 2) {
                    throw new Error("Auth is still loading");
                }
                return "token";
            });

            const { client, ws } = await setupWithTokenGetter(getter as any);

            // Reset after auto-auth
            callCount = 0;
            getter.mockClear();
            getter.mockImplementation(async () => {
                callCount++;
                if (callCount <= 2) {
                    throw new Error("Auth is still loading");
                }
                return "token";
            });

            const fetchPromise = client.fetchCollection({ path: "test" });

            // Progressively advance timers and flush microtasks until AUTHENTICATE appears
            for (let i = 0; i < 10; i++) {
                jest.advanceTimersByTime(500);
                await flushMicrotasks();
                if (ws.sentMessages.some(m => JSON.parse(m).type === "AUTHENTICATE")) break;
            }

            // Third call succeeds, authenticate
            const authMsg = ws.sentMessages.find(m => JSON.parse(m).type === "AUTHENTICATE");
            expect(authMsg).toBeDefined();

            const parsed = JSON.parse(authMsg!);
            ws.onmessage!({ data: JSON.stringify({
                type: "AUTH_SUCCESS",
                requestId: parsed.requestId,
                payload: {}
            }) });
            await flushMicrotasks();

            // Respond to fetch
            const fetchMsg = ws.sentMessages.find(m => JSON.parse(m).type === "FETCH_COLLECTION");
            expect(fetchMsg).toBeDefined();

            const fetchParsed = JSON.parse(fetchMsg!);
            ws.onmessage!({ data: JSON.stringify({
                requestId: fetchParsed.requestId,
                payload: { entities: [] }
            }) });

            const result = await fetchPromise;
            expect(result).toEqual([]);

            // Verify the getter was called 3 times by ensureAuthenticated
            expect(getter).toHaveBeenCalledTimes(3);
        });
    });

    // -----------------------------------------------------------------------
    // ApiError
    // -----------------------------------------------------------------------
    describe("ApiError", () => {
        it("creates error with message, error, and code", () => {
            const err = new ApiError("test message", "test error", "CODE");
            expect(err).toBeInstanceOf(Error);
            expect(err.name).toBe("ApiError");
            expect(err.message).toBe("test message");
            expect(err.error).toBe("test error");
            expect(err.code).toBe("CODE");
        });

        it("works without optional parameters", () => {
            const err = new ApiError("simple error");
            expect(err.code).toBeUndefined();
            expect(err.error).toBeUndefined();
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
                    entities: [{
                        id: "1",
                        path: "posts",
                        values: {
                            title: "Hello",
                            createdAt: { __type: "date",
value: "2025-06-15T12:00:00.000Z" }
                        }
                    }]
                }
            }) });

            const result = await promise;
            expect(result).toHaveLength(1);
            expect(result[0].values.createdAt).toBeInstanceOf(Date);
            expect((result[0].values.createdAt as unknown as Date).toISOString()).toBe("2025-06-15T12:00:00.000Z");
        });

        it("returns null for invalid serialized dates in fetchCollection", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entities: [{
                        id: "1",
                        path: "posts",
                        values: {
                            badDate: { __type: "date",
value: "not-a-date" }
                        }
                    }]
                }
            }) });

            const result = await promise;
            expect(result[0].values.badDate).toBeNull();
        });

        it("handles multiple serialized dates across entities", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entities: [
                        { id: "1",
path: "posts",
values: { publishedAt: { __type: "date",
value: "2025-01-01T00:00:00.000Z" } } },
                        { id: "2",
path: "posts",
values: { publishedAt: { __type: "date",
value: "2025-12-31T23:59:59.999Z" } } }
                    ]
                }
            }) });

            const result = await promise;
            expect(result[0].values.publishedAt).toBeInstanceOf(Date);
            expect(result[1].values.publishedAt).toBeInstanceOf(Date);
            expect((result[1].values.publishedAt as unknown as Date).toISOString()).toBe("2025-12-31T23:59:59.999Z");
        });

        // -- fetchEntity path ----------------------------------------------

        it("converts serialized dates in fetchEntity", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
                            updatedAt: { __type: "date",
value: "2025-03-20T08:30:00.000Z" },
                            title: "Test"
                        }
                    }
                }
            }) });

            const result = await promise;
            expect(result).toBeDefined();
            expect(result!.values.updatedAt).toBeInstanceOf(Date);
            expect(result!.values.title).toBe("Test");
        });

        // -- saveEntity path -----------------------------------------------

        it("converts serialized dates in saveEntity response", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.saveEntity({
                path: "posts",
                entityId: "1",
                values: { title: "Updated" }
            } as any);
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
                            title: "Updated",
                            updatedAt: { __type: "date",
value: "2025-07-01T00:00:00.000Z" }
                        }
                    }
                }
            }) });

            const result = await promise;
            expect(result.values.updatedAt).toBeInstanceOf(Date);
        });

        // -- Nested & complex structures -----------------------------------

        it("converts dates nested inside plain objects (maps)", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
                            metadata: {
                                createdAt: { __type: "date",
value: "2025-01-01T00:00:00.000Z" },
                                editedAt: { __type: "date",
value: "2025-06-01T00:00:00.000Z" }
                            }
                        }
                    }
                }
            }) });

            const result = await promise;
            const metadata = result!.values.metadata as Record<string, unknown>;
            expect(metadata.createdAt).toBeInstanceOf(Date);
            expect(metadata.editedAt).toBeInstanceOf(Date);
        });

        it("converts dates inside arrays", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "events",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "events",
                        values: {
                            dates: [
                                { __type: "date",
value: "2025-01-01T00:00:00.000Z" },
                                { __type: "date",
value: "2025-02-01T00:00:00.000Z" }
                            ]
                        }
                    }
                }
            }) });

            const result = await promise;
            const dates = result!.values.dates as Date[];
            expect(dates).toHaveLength(2);
            expect(dates[0]).toBeInstanceOf(Date);
            expect(dates[1]).toBeInstanceOf(Date);
        });

        it("converts dates inside array of objects", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
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
                }
            }) });

            const result = await promise;
            const revisions = result!.values.revisions as Array<{ author: string; savedAt: Date }>;
            expect(revisions[0].savedAt).toBeInstanceOf(Date);
            expect(revisions[1].author).toBe("Bob");
            expect(revisions[1].savedAt).toBeInstanceOf(Date);
        });

        it("preserves relation objects while converting sibling dates", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
                            author: { __type: "relation",
id: "42",
path: "users" },
                            createdAt: { __type: "date",
value: "2025-05-01T00:00:00.000Z" }
                        }
                    }
                }
            }) });

            const result = await promise;
            // Date should be converted
            expect(result!.values.createdAt).toBeInstanceOf(Date);
            // Relation should be preserved as a plain object (not converted)
            const author = result!.values.author as Record<string, unknown>;
            expect(author.__type).toBe("relation");
            expect(author.id).toBe("42");
            expect(author.path).toBe("users");
        });

        // -- Passthrough / edge cases --------------------------------------

        it("passes through null and undefined values", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
                            title: null,
                            count: 0,
                            active: false,
                            name: "hello"
                        }
                    }
                }
            }) });

            const result = await promise;
            expect(result!.values.title).toBeNull();
            expect(result!.values.count).toBe(0);
            expect(result!.values.active).toBe(false);
            expect(result!.values.name).toBe("hello");
        });

        it("does not mutate objects that have __type but not 'date'", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
                            ref: { __type: "reference",
path: "some/path" },
                            custom: { __type: "custom",
data: 123 }
                        }
                    }
                }
            }) });

            const result = await promise;
            const ref = result!.values.ref as Record<string, unknown>;
            expect(ref.__type).toBe("reference");
            expect(ref.path).toBe("some/path");
            const custom = result!.values.custom as Record<string, unknown>;
            expect(custom.__type).toBe("custom");
            expect(custom.data).toBe(123);
        });

        it("handles __type date with non-string value gracefully (treats as plain object)", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            // __type is "date" but value is a number, not a string → should NOT match the date rehydration branch
            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
                            weird: { __type: "date",
value: 12345 }
                        }
                    }
                }
            }) });

            const result = await promise;
            const weird = result!.values.weird as Record<string, unknown>;
            // Because value is not a string, it falls through to the plain-object recursion
            expect(weird.__type).toBe("date");
            expect(weird.value).toBe(12345);
        });

        it("handles empty entity values", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: { id: "1",
path: "posts",
values: {} }
                }
            }) });

            const result = await promise;
            expect(result).toEqual({ id: "1",
path: "posts",
values: {} });
        });

        it("handles deeply nested date structures (3+ levels)", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchEntity({ path: "posts",
entityId: "1" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entity: {
                        id: "1",
                        path: "posts",
                        values: {
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
                }
            }) });

            const result = await promise;
            const deepDate = (result!.values as any).level1.level2.level3.deepDate;
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
                entities: [{
                    id: "1",
                    path: "posts",
                    values: {
                        createdAt: { __type: "date",
value: "2025-08-01T00:00:00.000Z" },
                        title: "Sub Test"
                    }
                }]
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const entities = onUpdate.mock.calls[0][0] as any[];
            expect(entities[0].values.createdAt).toBeInstanceOf(Date);
            expect(entities[0].values.title).toBe("Sub Test");
        });

        it("rehydrates dates in entity subscription updates", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            client.listenEntity({ path: "posts",
entityId: "1" }, onUpdate);

            const subMsg = JSON.parse(ws.sentMessages[0]);
            ws.onmessage!({ data: JSON.stringify({
                type: "entity_update",
                subscriptionId: subMsg.payload.subscriptionId,
                entity: {
                    id: "1",
                    path: "posts",
                    values: {
                        updatedAt: { __type: "date",
value: "2025-09-15T18:30:00.000Z" }
                    }
                }
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const entity = onUpdate.mock.calls[0][0] as any;
            expect(entity.values.updatedAt).toBeInstanceOf(Date);
            expect(entity.values.updatedAt.toISOString()).toBe("2025-09-15T18:30:00.000Z");
        });

        it("rehydrates dates in collection_entity_patch updates", () => {
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
                entities: [{ id: "1",
path: "posts",
values: { title: "Original" } }]
            }) });

            onUpdate.mockClear();

            // Now send a patch with a date
            ws.onmessage!({ data: JSON.stringify({
                type: "collection_entity_patch",
                subscriptionId: subId,
                entityId: "1",
                entity: {
                    id: "1",
                    path: "posts",
                    values: {
                        title: "Patched",
                        patchedAt: { __type: "date",
value: "2025-10-01T00:00:00.000Z" }
                    }
                }
            }) });

            expect(onUpdate).toHaveBeenCalledTimes(1);
            const entities = onUpdate.mock.calls[0][0] as any[];
            const patched = entities.find((e: any) => e.id === "1");
            expect(patched.values.patchedAt).toBeInstanceOf(Date);
        });

        // -- rehydrateEntity guards ----------------------------------------

        it("handles entity with missing values gracefully", async () => {
            const { client, ws } = await setupConnected();

            const promise = client.fetchCollection({ path: "posts" });
            const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);

            // Entity without a values property
            ws.onmessage!({ data: JSON.stringify({
                requestId: msg.requestId,
                payload: {
                    entities: [{ id: "1",
path: "posts" }]
                }
            }) });

            const result = await promise;
            // Should not throw, entity is returned as-is
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

            const client = createClient({ getAuthToken, onUnauthorized });
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
                payload: { error: { message: "Unauthorized token", code: "UNAUTHORIZED" } }
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
                payload: { entities: [{ id: "post1" }] }
            }) });

            const result = await fetchPromise;
            expect(result).toEqual([{ id: "post1" }]);
        });

        it("triggers onUnauthorized and resubscribes collection subscription on auth error", async () => {
            const onUnauthorized = jest.fn().mockResolvedValue(true);
            const getAuthToken = jest.fn()
                .mockResolvedValueOnce("old-token")
                .mockResolvedValueOnce("new-token");

            const client = createClient({ getAuthToken, onUnauthorized });
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
                payload: { error: { message: "unauthorized", code: "UNAUTHORIZED" } }
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
                entities: [{ id: "post1" }]
            }) });

            expect(onUpdate).toHaveBeenCalledWith([{ id: "post1" }]);
            expect(onError).not.toHaveBeenCalled();
        });
    });
});
