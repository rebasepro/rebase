import { CollectionConfig } from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A `collection_patch` names a row by address; the subscriber's cached rows are
 * columns only, and the SDK holds no collection config to derive an address
 * from. So the patch carries the key columns, and this pins that it actually
 * does — the client-side half lives in `@rebasepro/client`
 * (realtime-row-identity.test.ts), and the two only work together.
 */
describe("collection_patch — the key columns ride along", () => {
    class MockWebSocket {
        public readyState = 1;
        public send = jest.fn();
        public on = jest.fn();
    }

    const skuItemsCollection: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        },
        idField: "sku"
    };

    // No isId, no registered table: keys cannot be resolved for this one.
    const notesCollection: CollectionConfig = {
        slug: "notes",
        name: "Notes",
        table: "notes",
        properties: { body: { type: "string" } }
    };

    let realtimeService: RealtimeService;
    let registry: PostgresCollectionRegistry;
    let ws: MockWebSocket;

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const messagesOfType = (type: string) => ws.send.mock.calls
        .map(call => JSON.parse(call[0] as string))
        .filter(message => message.type === type);
    const patchesSent = () => messagesOfType("collection_patch");

    beforeEach(async () => {
        jest.useFakeTimers();
        jest.restoreAllMocks();

        // `fetchCollectionWithAuth` wraps the read in a transaction to scope the
        // RLS role to it, and builds a DataService over the tx — so the read
        // goes through the real fetch path, not the injected driver. The chain
        // resolves to no rows; what is under test is the message, not the data.
        const db = {
            execute: jest.fn().mockResolvedValue({ rows: [] }),
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            offset: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            $dynamic: jest.fn().mockReturnThis()
        } as unknown as jest.Mocked<NodePgDatabase<Record<string, unknown>>>;
        (db as unknown as { transaction: unknown }).transaction =
            jest.fn((callback: (tx: unknown) => unknown) => callback(db));
        (db as unknown as { then: unknown }).then =
            jest.fn((resolve: (rows: unknown[]) => void) => resolve([]));

        registry = new PostgresCollectionRegistry();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("sku_items")) return skuItemsCollection;
            if (path.startsWith("notes")) return notesCollection;
            return undefined;
        });
        jest.spyOn(registry, "getTable").mockImplementation(name =>
            name === "sku_items" ? table("sku_items", ["sku", "label"]) as never : undefined);

        realtimeService = new RealtimeService(
            db,
            registry,
            { defaultDatabaseName: "main" } as never,
            "test-instance",
            { accessTokenSecret: "secret" } as never
        );
        realtimeService.setDataDriver({
            fetchCollection: jest.fn().mockResolvedValue([]),
            fetchOne: jest.fn().mockResolvedValue(null)
        } as never);

        ws = new MockWebSocket();
        realtimeService.addClient("client-1", ws as never);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const subscribe = (path: string) =>
        realtimeService.handleClientMessage("client-1", {
            type: "subscribe_collection",
            payload: { path,
subscriptionId: "sub-1" }
        });

    it("includes the resolved key columns in the patch", async () => {
        await subscribe("sku_items");

        await realtimeService.notifyUpdate(
            "sku_items", "ABC-1", { sku: "ABC-1",
label: "Widget" }, undefined, false
        );

        const [patch] = patchesSent();
        expect(patch).toBeDefined();
        expect(patch.id).toBe("ABC-1");
        expect(patch.pks).toEqual([{ fieldName: "sku",
type: "string",
isUUID: false }]);
    });

    it("omits `pks` for a collection whose keys it cannot resolve", async () => {
        // No primary key and no `id` column: these rows have no address, and
        // saying so is the honest answer — a subscriber that invented one would
        // recognise rows that are not there.
        await subscribe("notes");

        await realtimeService.notifyUpdate(
            "notes", "n-1", { body: "hello" }, undefined, false
        );

        const [patch] = patchesSent();
        expect(patch).toBeDefined();
        expect(patch.pks).toBeUndefined();
    });

    it("sends the keys with the rows of the initial subscription", async () => {
        // The subscriber needs them before any patch exists — the first merge
        // of a refetch already has to recognise the rows it cached.
        await subscribe("sku_items");

        const [update] = messagesOfType("collection_update");
        expect(update).toBeDefined();
        expect(update.pks).toEqual([{ fieldName: "sku",
type: "string",
isUUID: false }]);
    });

    it("sends the keys on a refetch that no patch preceded", async () => {
        // A CDC-originated change carries an invalidation marker: no patch is
        // sent at all, only the deferred refetch. Keys that rode on patches
        // alone would never reach a collection written from outside the API,
        // and every refetch would replace every row's reference.
        await subscribe("sku_items");
        ws.send.mockClear();

        await realtimeService.notifyUpdate(
            "sku_items", "ABC-1", { _rebase_invalidated: true }, undefined, false
        );
        // The refetch is debounced behind a timer, and its body awaits the read.
        await jest.advanceTimersByTimeAsync(500);

        expect(patchesSent()).toHaveLength(0);
        const [update] = messagesOfType("collection_update");
        expect(update).toBeDefined();
        expect(update.pks).toEqual([{ fieldName: "sku",
type: "string",
isUUID: false }]);
    });
});
