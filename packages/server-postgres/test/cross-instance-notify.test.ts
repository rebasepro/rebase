import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * What a write costs on the cross-instance channel when change capture is off.
 *
 * Without CDC, each instance announces its own writes on
 * `rebase_entity_changes` and every other instance refetches its subscribers.
 * Two costs had nothing to show for them:
 *
 * - **A read per notification on every receiving instance.** The handler
 *   re-read the row on the owner connection "so row subscriptions receive the
 *   actual data", but no frame has carried a row since every delivery became a
 *   scoped refetch — the row went into `notifyUpdate` and was never looked at.
 *   A 1,000-row bulk save was 1,000 dead reads on each other instance, whether
 *   or not anyone there subscribed to the collection.
 * - **A `pg_notify` round trip per row on the writing instance**, awaited in
 *   turn after commit: 1,000 of them before a 1,000-row save could answer.
 */

const fetchCollectionForRest = jest.fn(async (..._args: unknown[]) => [{ id: 1, title: "Row" }]);
const fetchOneForRest = jest.fn(async (..._args: unknown[]) => ({ id: 1, title: "Row" }));
const fetchOne = jest.fn(async (..._args: unknown[]) => ({ id: 1, title: "Row" }));
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest,
        fetchOneForRest,
        fetchOne,
        count: jest.fn(async () => 1),
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { type: "number", isId: true }, title: { type: "string" } }
} as unknown as CollectionConfig;

/** The payloads one service sent with `pg_notify`, in order. */
type Wire = { payloads: string[] };

function createService(wire: Wire) {
    const db = {
        execute: jest.fn(async (statement: unknown) => {
            // drizzle's `sql` keeps its interpolated values on `queryChunks`.
            const chunks = (statement as { queryChunks?: unknown[] }).queryChunks ?? [];
            const text = JSON.stringify(statement);
            if (text.includes("pg_notify")) {
                const payload = chunks.find((chunk): chunk is string => typeof chunk === "string" && chunk.startsWith("{"));
                if (payload !== undefined) wire.payloads.push(payload);
            }
            return { rows: [] };
        }),
        transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
    };
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([posts]);
    const service = new RealtimeService(db as unknown as NodePgDatabase<Record<string, never>>, registry);
    const driverFetchOne = jest.fn(async () => ({ id: 1 }));
    service.setDataDriver({ callContextWithin: () => ({}), fetchOne: driverFetchOne } as never);
    // What `startListening` turns on, without a LISTEN connection.
    service["broadcasting"] = true;
    return { service, db, driverFetchOne };
}

const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

let services: RealtimeService[];

beforeEach(() => {
    services = [];
    fetchOne.mockClear();
    fetchOneForRest.mockClear();
});

afterEach(async () => {
    for (const service of services) await service.destroy();
});

describe("a change another instance announces", () => {
    it("is refetched for this instance's subscribers, and read nowhere else", async () => {
        const { service, driverFetchOne } = createService({ payloads: [] });
        services.push(service);
        const handle = (payload: string) => Reflect.apply(Reflect.get(service, "handleCrossInstanceNotification"), service, [payload]) as Promise<void>;

        await handle(JSON.stringify({ sid: "inst_other", p: "posts", eid: "1", db: null }));

        expect(driverFetchOne).not.toHaveBeenCalled();
        expect(fetchOne).not.toHaveBeenCalled();
        expect(fetchOneForRest).not.toHaveBeenCalled();
    });
});

describe("a bulk save on one instance", () => {
    it("is announced in a few notifications, each under the NOTIFY ceiling, and reaches every row on the other instance", async () => {
        const wire: Wire = { payloads: [] };
        const { service: writer } = createService(wire);
        const { service: reader } = createService({ payloads: [] });
        services.push(writer, reader);

        for (let i = 0; i < 1000; i++) {
            await writer.notifyUpdate("posts", String(i), { _rebase_invalidated: true });
        }
        await settle();

        // One `pg_notify` per row before.
        expect(wire.payloads.length).toBeGreaterThan(0);
        expect(wire.payloads.length).toBeLessThanOrEqual(10);
        for (const payload of wire.payloads) expect(Buffer.byteLength(payload)).toBeLessThan(8000);

        // Every address arrives: one subscriber per row on the reader, each
        // refetched once.
        const sockets = Array.from({ length: 1000 }, (_, i) => {
            const ws = { readyState: 1, send: jest.fn(), on: jest.fn(), close: jest.fn(), terminate: jest.fn() };
            reader.addClient(`c${i}`, ws as never);
            return ws;
        });
        for (let i = 0; i < 1000; i++) {
            await reader.handleClientMessage(`c${i}`, { type: "subscribe_one", payload: { path: "posts", id: String(i), subscriptionId: "s" } });
        }
        await settle();
        fetchOneForRest.mockClear();
        const scheduled = jest.spyOn(reader as never, "scheduleGroupRefetch");
        for (const payload of wire.payloads) {
            await Reflect.apply(Reflect.get(reader, "handleCrossInstanceNotification"), reader, [payload]);
        }
        expect(scheduled).toHaveBeenCalledTimes(1000);
        expect(sockets).toHaveLength(1000);
    });

    it("announces a single change in the shape an older instance reads", async () => {
        const wire: Wire = { payloads: [] };
        const { service } = createService(wire);
        services.push(service);

        await service.notifyUpdate("posts", "42", { _rebase_invalidated: true });
        await settle();

        expect(wire.payloads).toHaveLength(1);
        expect(Object.keys(JSON.parse(wire.payloads[0])).sort()).toEqual(["db", "eid", "p", "sid"]);
    });
});
