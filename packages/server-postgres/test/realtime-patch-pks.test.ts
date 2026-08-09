import { CollectionConfig } from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A realtime message names rows by address; the subscriber's cached rows are
 * columns only, and the SDK holds no collection config to derive an address
 * from. So the message carries the key columns, and this pins that it actually
 * does — the client-side half lives in `@rebasepro/client`
 * (realtime-row-identity.test.ts), and the two only work together.
 *
 * This used to be asserted on `collection_patch`, the immediate row patch that
 * preceded the refetch. That patch carried the writer's row to every
 * subscriber, so it was removed; the key columns now ride the
 * `collection_update` that the subscriber-scoped refetch sends. Same contract,
 * one message later.
 */
describe("realtime updates — the key columns ride along", () => {
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
    const updatesSent = () => messagesOfType("collection_update");

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
        // `notes` is registered too — otherwise subscribing to it errors before
        // any message is built, and the point here is what the message says
        // about keys, not what happens to an unregistered path.
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "sku_items") return table("sku_items", ["sku", "label"]) as never;
            if (name === "notes") return table("notes", ["body"]) as never;
            return undefined;
        });

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

    it("includes the resolved key columns in the update", async () => {
        await subscribe("sku_items");
        ws.send.mockClear(); // drop the initial subscribe payload

        await realtimeService.notifyUpdate(
            "sku_items", "ABC-1", { sku: "ABC-1",
label: "Widget" }, undefined, false
        );
        await jest.advanceTimersByTimeAsync(400);

        const [update] = updatesSent();
        expect(update).toBeDefined();
        expect(update.pks).toEqual([{ fieldName: "sku",
type: "string",
isUUID: false }]);
    });

    // Gone with the patch: "omits `pks` for a collection whose keys it cannot
    // resolve". That case used to be observable because the immediate
    // `collection_patch` was sent regardless of whether the collection could be
    // read. Delivery is now the scoped refetch, and a collection with no
    // resolvable key fails in the read path before any message is built — so
    // there is no message left to assert `pks === undefined` on. The branch
    // still exists in `primaryKeysForPath`; it is private, and faking a
    // readable-but-unkeyable collection would be testing the mock rather than
    // the code. Recorded here rather than silently dropped.

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

    it("sends the keys on the refetch, which is now the only delivery", async () => {
        // Keys used to ride the immediate patch, so a collection written from
        // outside the API — where no patch was ever sent — never received them
        // and every refetch replaced every row's reference. There is no patch
        // on any path now, so this is the case that used to be the exception
        // and is now the rule.
        await subscribe("sku_items");
        ws.send.mockClear();

        await realtimeService.notifyUpdate(
            "sku_items", "ABC-1", { _rebase_invalidated: true }, undefined, false
        );
        // The refetch is debounced behind a timer, and its body awaits the read.
        await jest.advanceTimersByTimeAsync(500);

        expect(messagesOfType("collection_patch")).toHaveLength(0);
        const [update] = messagesOfType("collection_update");
        expect(update).toBeDefined();
        expect(update.pks).toEqual([{ fieldName: "sku",
type: "string",
isUUID: false }]);
    });
});
