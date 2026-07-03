import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { SnapshotCollection } from "@rebasepro/types";

const mockFetchCollection = jest.fn().mockResolvedValue([{ id: 1,
path: "posts",
values: { title: "Refetched Title" } }]);
const mockFetchSnapshot = jest.fn().mockResolvedValue({ id: 1,
path: "posts",
values: { title: "Refetched Snapshot Title" } });

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: mockFetchCollection,
        fetchOne: mockFetchSnapshot,
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

const mockPostsCollection: SnapshotCollection = {
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
values: { title: "Refetched Snapshot Title" } })
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
            const dummySnapshot = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummySnapshot, undefined, false);

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

        it("sends instant row patch for valid row updates without _rebase_invalidated", async () => {
             const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-1", ws);

            await realtimeService.handleClientMessage("client-1", {
                type: "subscribe_collection",
                payload: { path: "posts",
subscriptionId: "sub-1" }
            });

            // Simulated normal Local update
            const freshSnapshot = { id: "1",
path: "posts",
values: { title: "Immediate Patch" } } as any;
            await realtimeService.notifyUpdate("posts", "1", freshSnapshot, undefined, false);

            // Phase 1: It SHOULD send immediate patch
            expect(ws.send).toHaveBeenCalled();
            let lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            let parsed = JSON.parse(lastCall);
            expect(parsed.type).toBe("collection_patch");
            expect(parsed.row.values.title).toBe("Immediate Patch");

            // Phase 2: Refetch
            jest.advanceTimersByTime(350);
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }
            lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            parsed = JSON.parse(lastCall);
            expect(parsed.type).toBe("collection_update");
        });
    });

    describe("Snapshot Synchronization", () => {
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
            const dummySnapshot = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummySnapshot, undefined, false);

            // Important: we patched notifyPathUpdate to NOT send snapshot_update directly if invalidated
            expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining("_rebase_invalidated"));

            // Fast forward refetch timer
            jest.advanceTimersByTime(350);
            await Promise.resolve();
            await Promise.resolve();

            // It should fetch the single row
            expect(mockFetchSnapshot).toHaveBeenCalledWith("posts", "1", undefined);

            // It should send row update
            expect(ws.send).toHaveBeenCalled();
            const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            const parsed = JSON.parse(lastCall);

            expect(parsed.type).toBe("single_update");
            expect(parsed.subscriptionId).toBe("sub-2");
            expect(parsed.row.values.title).toBe("Refetched Snapshot Title");
        });

        it("sends instant row update if valid payload (local mutation)", async () => {
             const ws = new MockWebSocket() as any;
            realtimeService.addClient("client-2", ws);

            await realtimeService.handleClientMessage("client-2", {
                type: "subscribe_one",
                payload: { path: "posts",
id: "1",
subscriptionId: "sub-2" }
            });

            const freshSnapshot = { id: "1",
path: "posts",
values: { title: "Pure Patch" } } as any;
            await realtimeService.notifyUpdate("posts", "1", freshSnapshot, undefined, false);

            expect(ws.send).toHaveBeenCalled();
            const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
            const parsed = JSON.parse(lastCall);

            expect(parsed.type).toBe("single_update");
            expect(parsed.row.values.title).toBe("Pure Patch");
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
            const dummySnapshot = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummySnapshot, undefined, false);

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

            const dummySnapshot = { id: "1", _rebase_invalidated: true } as any;
            await realtimeService.notifyUpdate("posts", "1", dummySnapshot, undefined, false);

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

