import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { parseCdcPayload, type CdcChangeEvent } from "../src/services/cdc/CdcListener";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { spiedDrizzle, transactionalDrizzle } from "./helpers/spg-a-db";
import { openSocket, sentFrames, type OpenSocket } from "./helpers/spg-a-socket";

// The RLS-bound refetch path (fetchCollectionWithAuth / fetchEntityWithAuth)
// builds a DataService inside the auth transaction — mock it so no real DB is hit.
// Each read returns a row no earlier read returned: a refetch that reads what
// its subscriber was last sent sends nothing, and these tests are about whether
// a change reaches a subscriber, so every read here is news.
let mockReads = 0;
const mockFetchCollection = jest.fn(async () => [
    { id: 1, path: "posts", values: { title: "From RLS refetch", read: ++mockReads } }
]);
const mockFetchEntity = jest.fn(async (): Promise<Record<string, unknown> | null> =>
    ({ id: 1, path: "posts", values: { title: "From RLS refetch", read: ++mockReads } })
);
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        // The refetch reads through the REST pipeline — the same methods the
        // HTTP routes call — and counts beside the rows for the frame's `meta`.
        fetchCollectionForRest: mockFetchCollection,
        fetchOneForRest: mockFetchEntity,
        count: jest.fn().mockResolvedValue(1),
        cursorFor: jest.fn().mockReturnValue(undefined),
        fetchCollection: mockFetchCollection,
        fetchOne: mockFetchEntity,
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

const postsCollection: LegacyCollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" }
    }
};

/** Drive a CDC change event through the private handler. */
function emitCdc(service: RealtimeService, event: CdcChangeEvent): Promise<void> {
    return service["handleCdcEvent"](event);
}

describe("RealtimeService — database-level CDC", () => {
    let service: RealtimeService;
    let registry: PostgresTableRegistry;
    let db: NodePgDatabase;

    beforeEach(() => {
        jest.useFakeTimers();

        ({ db } = transactionalDrizzle());

        registry = new FixtureTableRegistry();
        registry.registerMultiple([postsCollection]);

        service = new RealtimeService(db, registry);
        // The refetch reads through a driver only when one is attached; the
        // reads themselves are the mocked DataService above.
        service.setDataDriver(new PostgresBackendDriver(db, service, registry));

        // Activate CDC without opening a real LISTEN connection: install the
        // reverse table map and flip the flag the way enableCdc() would.
        service["cdcTableMap"] = service["buildCdcTableMap"]();
        service["cdcActive"] = true;
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    async function flushTimers() {
        jest.advanceTimersByTime(350);
        // A drain, not a measurement: a delivery is a fetch, then the count
        // that fills the frame's `meta`, then the hooks around both. Too few
        // iterations here does not fail loudly — it observes the state before
        // the delivery and asserts against it.
        for (let i = 0; i < 30; i++) await Promise.resolve();
    }

    it("maps a table change to its collection and delivers via an RLS-bound refetch (no raw patch)", async () => {
        const ws = openSocket();
        service.addClient("client-1", ws.ws);
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
        const sent = JSON.parse(String(ws.send.mock.calls.at(-1)![0]));
        expect(sent.type).toBe("collection_update");
        expect(sent.rows[0].values.title).toBe("From RLS refetch");
    });

    it("delivers a delete to a single-row subscriber", async () => {
        const ws = openSocket();
        service.addClient("client-2", ws.ws);
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

        const sent = JSON.parse(String(ws.send.mock.calls.at(-1)![0]));
        expect(sent.type).toBe("single_update");
        expect(sent.subscriptionId).toBe("sub-2");
        expect(sent.row).toBeNull();
    });

    it("ignores changes on tables not backed by a collection", async () => {
        const ws = openSocket();
        service.addClient("client-3", ws.ws);
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
        const ws = openSocket();
        service.addClient("client-4", ws.ws);
        await service.handleClientMessage("client-4", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "sub-4" }
        });
        ws.send.mockClear();

        // App path (Rebase-API mutation) records the emit and schedules the
        // subscriber-scoped refetch. It no longer delivers the written row
        // inline, so the delivery only happens once the debounce fires.
        await service.notifyUpdate("posts", "1", { id: 1, path: "posts", values: { title: "via API" } }, undefined, true, "app");

        // The same committed change echoes back through CDC — NOTIFY is
        // delivered at commit, so before that refetch has run. It must NOT
        // double-deliver.
        jest.advanceTimersByTime(20);
        await emitCdc(service, { schema: "public", table: "posts", op: "UPDATE", row: { id: 1, title: "via API" } });
        await flushTimers();

        expect(ws.send.mock.calls.length).toBe(1);
        await flushTimers();
        expect(ws.send.mock.calls.length).toBe(1);
    });

    it("delivers another writer's change to the same row once the app write's refetch has run", async () => {
        // An app save that touches no row of the table (a to-many relation
        // only, an empty payload) is announced, but no trigger fires, so no
        // echo ever comes to consume its mark. Held for seconds, that mark
        // swallowed the next change anyone else made to the row — psql, a
        // cron, another instance — and the subscriber kept the old rows.
        const ws = openSocket();
        service.addClient("client-6", ws.ws);
        await service.handleClientMessage("client-6", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "sub-6" }
        });
        await service.notifyUpdate("posts", "1", null, undefined, true, "app");
        await flushTimers();
        ws.send.mockClear();
        mockFetchEntity.mockClear();

        jest.advanceTimersByTime(1000);
        await emitCdc(service, { schema: "public", table: "posts", op: "UPDATE", row: { id: 1, title: "closed in psql" } });
        await flushTimers();

        expect(mockFetchEntity).toHaveBeenCalled();
        expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it("does NOT suppress a CDC event for a different row", async () => {
        const ws = openSocket();
        service.addClient("client-5", ws.ws);
        await service.handleClientMessage("client-5", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-5" }
        });

        // App emit for id 1 records only id 1.
        await service.notifyUpdate("posts", "1", { id: 1, path: "posts", values: {} }, undefined, true, "app");
        ws.send.mockClear();
        mockFetchCollection.mockClear();

        // External write to id 2 is not deduped → must be delivered.
        await emitCdc(service, { schema: "public", table: "posts", op: "INSERT", row: { id: 2, title: "new external row" } });
        await flushTimers();

        expect(mockFetchCollection).toHaveBeenCalled();
        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining("collection_update"));
    });

    /** Subscribe `clientId` to one row of posts per id, and return its socket. */
    async function subscribeRows(clientId: string, ids: string[]) {
        const ws = openSocket();
        service.addClient(clientId, ws.ws);
        for (const id of ids) {
            await service.handleClientMessage(clientId, {
                type: "subscribe_one",
                payload: { path: "posts", id, subscriptionId: `row-${id}` }
            });
        }
        await flushTimers();
        ws.send.mockClear();
        mockFetchEntity.mockClear();
        return ws;
    }

    const sentTo = (ws: OpenSocket): string[] =>
        sentFrames(ws.send).map((frame) => String(frame.subscriptionId)).sort();

    it("delivers a statement's batch to the subscriber of each row it names, and of no other", async () => {
        const ws = await subscribeRows("client-batch", ["2", "3", "9"]);

        // One notification for a statement that updated rows 1–4.
        const events = parseCdcPayload(JSON.stringify({ schema: "public", table: "posts", op: "UPDATE", cols: ["id"], keys: [1, 2, 3, 4] }));
        for (const event of events ?? []) await emitCdc(service, event);
        await flushTimers();

        expect(sentTo(ws)).toEqual(["row-2", "row-3"]);
    });

    it("delivers a TRUNCATE to every subscription on the collection, single-row ones included", async () => {
        const ws = await subscribeRows("client-truncate", ["1", "2"]);
        await service.handleClientMessage("client-truncate", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "list" }
        });
        await flushTimers();
        ws.send.mockClear();
        mockFetchEntity.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

        await emitCdc(service, { schema: "public", table: "posts", op: "TRUNCATE", row: {} });
        await flushTimers();

        expect(sentTo(ws)).toEqual(["list", "row-1", "row-2"]);
        const rows = sentFrames(ws.send).filter((frame) => frame.type === "single_update");
        expect(rows.map((frame) => frame.row)).toEqual([null, null]);
    });

    it("delivers a change that names no row — a key too large to notify — to the single-row subscribers too", async () => {
        const ws = await subscribeRows("client-unkeyed", ["5"]);

        await emitCdc(service, { schema: "public", table: "posts", op: "UPDATE", row: {}, truncated: true });
        await flushTimers();

        expect(sentTo(ws)).toEqual(["row-5"]);
    });
});

/**
 * The record of this instance's own writes, kept so their CDC echo is not
 * delivered twice, purged expired entries by walking the whole map on every
 * write once it held over 1,000 — and inside the 300 ms window nothing has
 * expired, so a burst of writes walked it all each time: 703 ms of event loop
 * for 20,000 marks.
 */
describe("RealtimeService — the record of its own writes", () => {
    /** A Map that counts the entries anything iterates out of it. */
    class CountingMap<K, V> extends Map<K, V> {
        visited = 0;
        *entries(): MapIterator<[K, V]> {
            for (const entry of super.entries()) {
                this.visited++;
                yield entry;
            }
        }
        [Symbol.iterator](): MapIterator<[K, V]> {
            return this.entries();
        }
    }

    const visitedFor = (marks: number): number => {
        const registry = new FixtureTableRegistry();
        const service = new RealtimeService(spiedDrizzle().db, registry);
        const recent = new CountingMap<string, number>();
        Reflect.set(service, "recentAppEmits", recent);
        const mark = Reflect.get(service, "markAppEmit") as (key: string) => void;
        // A burst inside one window, then one write per window for a while:
        // the burst's entries expire and are purged.
        for (let i = 0; i < marks; i++) mark.call(service, `::posts::${i}`);
        const afterBurst = recent.visited;
        for (let w = 0; w < 5; w++) {
            jest.advanceTimersByTime(400);
            mark.call(service, `::posts::late-${w}`);
        }
        expect(recent.size).toBeLessThan(10);
        return afterBurst;
    };

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("costs a burst of writes work in proportion to the burst, not its square", () => {
        const small = visitedFor(2_000);
        const large = visitedFor(8_000);
        expect(small).toBeLessThanOrEqual(2_000);
        expect(large).toBeLessThanOrEqual(8_000);
    });
});
