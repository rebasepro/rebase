import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { CollectionConfig } from "@rebasepro/types";
import type { CdcChangeEvent } from "../src/services/cdc/CdcListener";

// The RLS-bound refetch path (fetchCollectionWithAuth / fetchEntityWithAuth)
// builds a DataService inside the auth transaction — mock it so no real DB is hit.
const mockFetchCollection = jest.fn().mockResolvedValue([
    { id: 1, path: "posts", values: { title: "From RLS refetch" } }
]);
const mockFetchEntity = jest.fn().mockResolvedValue(
    { id: 1, path: "posts", values: { title: "From RLS refetch" } }
);
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: mockFetchCollection,
        fetchOne: mockFetchEntity,
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

class MockWebSocket {
    public readyState = 1;
    public send = jest.fn();
    public on = jest.fn();
}

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" }
    }
} as unknown as CollectionConfig;

/** Drive a CDC change event through the private handler. */
function emitCdc(service: RealtimeService, event: CdcChangeEvent): Promise<void> {
    return (service as any).handleCdcEvent(event);
}

describe("RealtimeService — database-level CDC", () => {
    let service: RealtimeService;
    let registry: PostgresCollectionRegistry;
    let db: jest.Mocked<NodePgDatabase<any>>;

    beforeEach(() => {
        jest.useFakeTimers();

        db = {
            execute: jest.fn().mockResolvedValue({ rows: [] }),
            transaction: jest.fn((cb) => cb(db))
        } as unknown as jest.Mocked<NodePgDatabase<any>>;

        registry = new PostgresCollectionRegistry();
        registry.registerMultiple([postsCollection]);

        const mockDriver = {
            fetchCollection: mockFetchCollection,
            fetchOne: mockFetchEntity
        };

        service = new RealtimeService(db, registry);
        service.setDataDriver(mockDriver as any);

        // Activate CDC without opening a real LISTEN connection: install the
        // reverse table map and flip the flag the way enableCdc() would.
        (service as any).cdcTableMap = (service as any).buildCdcTableMap();
        (service as any).cdcActive = true;
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    async function flushTimers() {
        jest.advanceTimersByTime(350);
        for (let i = 0; i < 10; i++) await Promise.resolve();
    }

    it("maps a table change to its collection and delivers via an RLS-bound refetch (no raw patch)", async () => {
        const ws = new MockWebSocket() as any;
        service.addClient("client-1", ws);
        await service.handleClientMessage("client-1", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-1" }
        });
        ws.send.mockClear();

        // A raw SQL UPDATE captured by the trigger — this instance did NOT originate it.
        await emitCdc(service, { schema: "public", table: "posts", op: "UPDATE", row: { id: 1, title: "Edited in psql" } });

        // RLS-safe: the raw tuple is never forwarded as an instant patch...
        expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining("collection_patch"));

        // ...instead each subscriber re-reads under its own auth context.
        await flushTimers();
        expect(mockFetchCollection).toHaveBeenCalled();
        const sent = JSON.parse(ws.send.mock.calls.at(-1)![0]);
        expect(sent.type).toBe("collection_update");
        expect(sent.rows[0].values.title).toBe("From RLS refetch");
    });

    it("delivers a delete to a single-row subscriber", async () => {
        const ws = new MockWebSocket() as any;
        service.addClient("client-2", ws);
        await service.handleClientMessage("client-2", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "sub-2" }
        });
        ws.send.mockClear();

        // Delivery is the debounced, subscriber-scoped refetch — nothing is
        // pushed straight from the event any more. So the row really is gone
        // when the refetch runs, which is what makes `row: null` correct rather
        // than an artefact of the event payload.
        mockFetchEntity.mockResolvedValueOnce(null);

        await emitCdc(service, { schema: "public", table: "posts", op: "DELETE", row: { id: 1 } });
        await flushTimers();

        const sent = JSON.parse(ws.send.mock.calls.at(-1)![0]);
        expect(sent.type).toBe("single_update");
        expect(sent.subscriptionId).toBe("sub-2");
        expect(sent.row).toBeNull();
    });

    it("ignores changes on tables not backed by a collection", async () => {
        const ws = new MockWebSocket() as any;
        service.addClient("client-3", ws);
        await service.handleClientMessage("client-3", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-3" }
        });
        ws.send.mockClear();
        mockFetchCollection.mockClear(); // ignore the initial-subscribe fetch

        await emitCdc(service, { schema: "public", table: "audit_log", op: "INSERT", row: { id: 9 } });
        await flushTimers();

        expect(ws.send).not.toHaveBeenCalled();
        expect(mockFetchCollection).not.toHaveBeenCalled();
    });

    it("suppresses the CDC echo of a mutation this instance already delivered via the app path", async () => {
        const ws = new MockWebSocket() as any;
        service.addClient("client-4", ws);
        await service.handleClientMessage("client-4", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "sub-4" }
        });
        ws.send.mockClear();

        // App path (Rebase-API mutation) records the emit and schedules the
        // subscriber-scoped refetch. It no longer delivers the written row
        // inline, so the delivery only happens once the debounce fires.
        await service.notifyUpdate("posts", "1", { id: 1, path: "posts", values: { title: "via API" } } as any, undefined, true, "app");
        await flushTimers();
        const afterApp = ws.send.mock.calls.length;
        expect(afterApp).toBeGreaterThan(0);

        // The same committed change echoes back through CDC — it must NOT double-deliver.
        await emitCdc(service, { schema: "public", table: "posts", op: "UPDATE", row: { id: 1, title: "via API" } });
        await flushTimers();

        expect(ws.send.mock.calls.length).toBe(afterApp);
    });

    it("does NOT suppress a CDC event for a different row", async () => {
        const ws = new MockWebSocket() as any;
        service.addClient("client-5", ws);
        await service.handleClientMessage("client-5", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-5" }
        });

        // App emit for id 1 records only id 1.
        await service.notifyUpdate("posts", "1", { id: 1, path: "posts", values: {} } as any, undefined, true, "app");
        ws.send.mockClear();
        mockFetchCollection.mockClear();

        // External write to id 2 is not deduped → must be delivered.
        await emitCdc(service, { schema: "public", table: "posts", op: "INSERT", row: { id: 2, title: "new external row" } });
        await flushTimers();

        expect(mockFetchCollection).toHaveBeenCalled();
        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining("collection_update"));
    });
});
