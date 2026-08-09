import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { CollectionConfig, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";

const mockFetchCollection = jest.fn().mockResolvedValue([{ id: 1,
path: "posts",
values: { title: "Refetched Title" } }]);
const mockFetchEntity = jest.fn().mockResolvedValue({ id: 1,
path: "posts",
values: { title: "Refetched Entity Title" } });

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: mockFetchCollection,
        fetchOne: mockFetchEntity,
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

// --- Mock Classes ---
class MockWebSocket {
    public readyState = 1;
    public send = jest.fn();
    public on = jest.fn();
    constructor() {}
}

const mockPostsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" }
    },
    idField: "id"
};

describe("RealtimeService", () => {
    let realtimeService: RealtimeService;
    let db: jest.Mocked<NodePgDatabase<any>>;
    let registry: PostgresCollectionRegistry;
    let mockDriver: any;

    beforeEach(() => {
        jest.useFakeTimers();

        db = {
            execute: jest.fn().mockResolvedValue({ rows: [] }),
            transaction: jest.fn((callback) => callback(db)),
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis()
        } as unknown as jest.Mocked<NodePgDatabase<any>>;
        (db as any).then = jest.fn((resolve) => resolve([]));

        registry = new PostgresCollectionRegistry();
        jest.spyOn(registry, "getCollectionByPath").mockReturnValue(mockPostsCollection);

        mockDriver = {
            fetchCollection: jest.fn().mockResolvedValue([{ id: 1,
path: "posts",
values: { title: "Refetched Title" } }]),
            fetchOne: jest.fn().mockResolvedValue({ id: 1,
path: "posts",
values: { title: "Refetched Entity Title" } })
        };

        const mockPoolManager = {
            defaultDatabaseName: "main"
        };

        const mockAuthSettings = {
            accessTokenSecret: "secret"
        };

        realtimeService = new RealtimeService(db, registry, mockPoolManager as any, "test-instance", mockAuthSettings);
        realtimeService.setDataDriver(mockDriver);
        realtimeService.setDataDriver(mockDriver);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe("Client Management", () => {
        it("adds and removes clients safely", () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);
            expect(realtimeService.clients.has("client-1")).toBe(true);

            realtimeService.removeClient("client-1");
            expect(realtimeService.clients.has("client-1")).toBe(false);
        });

        it("removes client subscriptions upon disconnect", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);
            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts",
subscriptionId: "sub-1" }
            });

            expect(realtimeService.subscriptions.has("sub-1")).toBe(true);
            realtimeService.removeClient("client-1");
            expect(realtimeService.subscriptions.has("sub-1")).toBe(false);
        });
    });

    describe("Subscription limit bounds", () => {
        it("refuses an over-large client limit on subscribe instead of clamping it", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);

            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-1", limit: 100000000 }
            });

            // A `collection_update` frame carries rows and nothing else — no
            // `total`, no `hasMore` — so a subscriber quietly handed 1 000 rows
            // has no way at all to learn it is not seeing the collection. The
            // frame that goes back has to be the error.
            expect(mockFetchCollection).not.toHaveBeenCalled();
            expect(realtimeService.subscriptions.has("sub-1")).toBe(false);

            const sent = ws.send.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
            const error = sent.find((m: { type: string }) => m.type === "error");
            expect(error).toBeDefined();
            expect(error.subscriptionId).toBe("sub-1");
            expect(error.payload.error.code).toBe("INVALID_LIMIT");
            expect(error.payload.error.message).toContain(String(MAX_LIST_LIMIT));
            expect(sent.some((m: { type: string }) => m.type === "collection_update")).toBe(false);
        });

        it("defaults an absent client limit instead of fetching the whole table", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);

            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-1" }
            });

            expect(mockFetchCollection).toHaveBeenCalledWith(
                "posts",
                expect.objectContaining({ limit: DEFAULT_LIST_LIMIT })
            );
            const stored = realtimeService.subscriptions.get("sub-1");
            expect(stored.collectionRequest.limit).toBe(DEFAULT_LIST_LIMIT);
        });
    });

    describe("Subscription narrowing", () => {
        // The subscribe payload is unpacked field by field into the stored
        // request, so anything left off that list is accepted over the wire and
        // then silently ignored — for the initial fetch and for every refetch
        // after it.

        it("pages a subscription by the offset it was given", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);

            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-1", limit: 10, offset: 20 }
            });

            // Without this a live list on page three served page one.
            expect(mockFetchCollection).toHaveBeenCalledWith(
                "posts",
                expect.objectContaining({ offset: 20 })
            );
            const stored = realtimeService.subscriptions.get("sub-1");
            expect(stored.collectionRequest.offset).toBe(20);
        });

        it("applies the logical group it was given", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);

            const logical = {
                type: "or",
                conditions: [
                    { column: "status", operator: "==", value: "draft" },
                    { column: "status", operator: "==", value: "review" }
                ]
            };

            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-1", logical }
            });

            // A dropped filter does not fail the subscription — it widens it,
            // so the client was pushed every row instead of the ones it asked
            // for.
            expect(mockFetchCollection).toHaveBeenCalledWith(
                "posts",
                expect.objectContaining({ logical })
            );
            const stored = realtimeService.subscriptions.get("sub-1");
            expect(stored.collectionRequest.logical).toEqual(logical);
        });
    });

    describe("Collection Synchronization", () => {
        it("triggers debounced refetch and omits dummy rows on PG_NOTIFY invalidation", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);

            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts",
subscriptionId: "sub-1" }
            });

            // Simulate PG_NOTIFY listener receiving cross-instance payload
            const dummyEntity = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummyEntity, undefined, false);

            // Phase 1: sendCollectionPatch SHOULD NOT SEND for dummy
            expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining("collection_patch"));

            // Phase 2: Debounced refetch should kick in after 300ms
            jest.advanceTimersByTime(350);

            // Wait for async promises to drain
            await Promise.resolve();
            await Promise.resolve();

            // It should fetch the collection with auth
            expect(mockFetchCollection).toHaveBeenCalled();

            // It should send the refetched data
            expect(ws.send).toHaveBeenCalled();
            const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            const parsed = JSON.parse(lastCall);

            expect(parsed.type).toBe("collection_update");
            expect(parsed.subscriptionId).toBe("sub-1");
            expect(parsed.rows[0].values.title).toBe("Refetched Title");
        });

        /**
         * Rewritten into its opposite.
         *
         * This asserted that a local mutation's row is patched straight to the
         * subscriber before any refetch — "Phase 1: It SHOULD send immediate
         * patch". That row was read under the *writer's* scope, so the
         * assertion was pinning a leak: it is exactly how a subscriber received
         * a row its own RLS policies would have denied. The immediate patch is
         * gone; the refetch is the only delivery.
         */
        it("never patches the writer's row — the refetch is the only delivery", async () => {
             const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);

            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts",
subscriptionId: "sub-1" }
            });

            const sendsBefore = ws.send.mock.calls.length;

            // A local mutation, carrying the row the writer just saved.
            const freshEntity = { id: "1",
path: "posts",
values: { title: "Immediate Patch" } } as any;
            await realtimeService.notifyUpdate("posts", "1", freshEntity, undefined, false);

            // Nothing may go out before the scoped refetch, and in particular
            // the writer's title must never appear on this socket.
            const immediate = ws.send.mock.calls.slice(sendsBefore).map((c: any[]) => String(c[0]));
            expect(immediate.some(m => m.includes("collection_patch"))).toBe(false);
            expect(immediate.some(m => m.includes("Immediate Patch"))).toBe(false);

            // The refetch, read under this subscriber's own context, is what
            // reaches them.
            jest.advanceTimersByTime(350);
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }
            const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            const parsed = JSON.parse(lastCall);
            expect(parsed.type).toBe("collection_update");
        });
    });

    describe("Entity Synchronization", () => {
        it("triggers debounced refetch and omits dummy row update for single row subscriptions", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-2", ws);

            await realtimeService.handleClientMessage("client-2", {
                type: "subscribe_one",
                payload: { path: "posts",
id: "1",
subscriptionId: "sub-2" }
            });

            // Need to mock sendSingleUpdate
            const dummyEntity = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummyEntity, undefined, false);

            // Important: we patched notifyPathUpdate to NOT send entity_update directly if invalidated
            expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining("_rebase_invalidated"));

            // Fast forward refetch timer
            jest.advanceTimersByTime(350);
            await Promise.resolve();
            await Promise.resolve();

            // It should fetch the single row
            expect(mockFetchEntity).toHaveBeenCalledWith("posts", "1", undefined);

            // It should send row update
            expect(ws.send).toHaveBeenCalled();
            const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            const parsed = JSON.parse(lastCall);

            expect(parsed.type).toBe("single_update");
            expect(parsed.subscriptionId).toBe("sub-2");
            expect(parsed.row.values.title).toBe("Refetched Entity Title");
        });

        /**
         * Rewritten into its opposite, and this was the sharper of the two.
         *
         * A single-row subscription had no later correction: the collection
         * variant was at least overwritten ~300 ms on by the debounced refetch,
         * after the bytes had reached the browser, but this one simply pushed
         * the writer's row and stopped. `subscribe_one` on a row RLS denies is
         * accepted and answered `null` — and then the first update handed over
         * the whole row.
         */
        it("never pushes the writer's row to a single-row subscriber", async () => {
             const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-2", ws);

            await realtimeService.handleClientMessage("client-2", {
                type: "subscribe_one",
                payload: { path: "posts",
id: "1",
subscriptionId: "sub-2" }
            });

            const sendsBefore = ws.send.mock.calls.length;

            const freshEntity = { id: "1",
path: "posts",
values: { title: "Pure Patch" } } as any;
            await realtimeService.notifyUpdate("posts", "1", freshEntity, undefined, false);

            const immediate = ws.send.mock.calls.slice(sendsBefore).map((c: any[]) => String(c[0]));
            expect(immediate.some(m => m.includes("Pure Patch"))).toBe(false);

            // What arrives is the scoped re-read, not the payload.
            jest.advanceTimersByTime(350);
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }
            const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            expect(JSON.parse(lastCall).type).toBe("single_update");
        });
    });

    describe("RLS (Row Level Security)", () => {
        it("applies auth context correctly on debounced collection refetches", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-rls", ws);

            await realtimeService.handleClientMessage("client-rls", {
                type: "subscribe_collection",
                payload: { path: "posts",
subscriptionId: "sub-rls" }
            }, { userId: "user123",
roles: ["admin", "editor"] });

            // Simulate PG_NOTIFY invalidation
            const dummyEntity = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummyEntity, undefined, false);

            jest.advanceTimersByTime(350);
            await Promise.resolve();
            await Promise.resolve();

            expect(db.execute).toHaveBeenCalled();
            const executeCalls = db.execute.mock.calls.map(c => JSON.stringify(c[0]));

            expect(executeCalls.some(sql => sql.includes("set_config('app.user_id'"))).toBe(true);
            expect(executeCalls.some(sql => sql.includes("set_config('app.user_roles'"))).toBe(true);
        });

        it("applies auth context correctly on debounced row refetches", async () => {
            const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-rls-ent", ws);

            await realtimeService.handleClientMessage("client-rls-ent", {
                type: "subscribe_one",
                payload: { path: "posts",
id: "1",
subscriptionId: "sub-rls-ent" }
            }, { userId: "user456",
roles: ["viewer"] });

            const dummyEntity = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummyEntity, undefined, false);

            jest.advanceTimersByTime(350);
            await Promise.resolve();
            await Promise.resolve();

            expect(db.execute).toHaveBeenCalled();
            const executeCalls = db.execute.mock.calls.map(c => JSON.stringify(c[0]));

            expect(executeCalls.some(sql => sql.includes("set_config('app.user_id'"))).toBe(true);
            expect(executeCalls.some(sql => sql.includes("set_config('app.user_roles'"))).toBe(true);
        });
    });

});

