import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { DataService } from "../src/services/dataService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * `beforeDelete` returning `false` is a refusal, and has to look like one.
 *
 * The callback is typed `boolean | void` and documented as "return false or
 * throw to block deletion". Returning `false` did block the delete — and then
 * the route answered `204 No Content`, which means "the row is gone". The admin
 * panel removed it from the list; a client that trusted the status dropped it
 * from its cache; the next reload brought it back. A veto that reports success
 * is worse than no veto, because nothing in the trace says a rule fired.
 *
 * It now raises the same `CALLBACK_REJECTED` a throw does, at 403 — a flat
 * refusal with no author's message, rather than the 400 "your input is wrong"
 * that a thrown Error carries.
 */

const mockRealtimeService = {
    registerDataDriverSubscription: jest.fn(),
    addSubscriptionCallback: jest.fn(),
    removeSubscriptionCallback: jest.fn(),
    subscriptions: new Map(),
    notifyUpdate: jest.fn()
} as unknown as RealtimeService;

type CallbackError = {
    message: string;
    status?: number;
    statusCode?: number;
    code?: string;
    details?: { stage?: string; path?: string };
};

const mockDb = { transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ execute: jest.fn() })) } as unknown as NodePgDatabase;

function buildDriver(collection: CollectionConfig) {
    const registry = {
        getCollectionByPath: jest.fn().mockReturnValue(collection),
        getCollections: jest.fn().mockReturnValue([]),
        getTable: jest.fn().mockReturnValue({}),
        getGlobalCallbacks: jest.fn().mockReturnValue(undefined)
    } as any;
    return new PostgresBackendDriver(mockDb, mockRealtimeService, registry);
}

const articles = (callbacks: Record<string, unknown>) => ({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {},
    callbacks
} as unknown as CollectionConfig);

const deleteProps = (collection: CollectionConfig) => ({
    row: { id: "a1", path: "articles", values: { title: "Ada", status: "published" } },
    collection
});

describe("beforeDelete returning false", () => {
    let deleteSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        deleteSpy = jest.spyOn(DataService.prototype, "delete").mockResolvedValue(undefined as never);
    });

    it("leaves the row alone — the delete is never issued", async () => {
        const collection = articles({ beforeDelete: () => false });
        const driver = buildDriver(collection);

        await expect(driver.delete(deleteProps(collection) as never)).rejects.toBeDefined();

        expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("answers 403 CALLBACK_REJECTED naming beforeDelete, not a 2xx", async () => {
        const collection = articles({ beforeDelete: () => false });
        const driver = buildDriver(collection);

        const error = await driver.delete(deleteProps(collection) as never)
            .then(() => undefined, (e: CallbackError) => e);

        expect(error).toBeDefined();
        const status = error!.status ?? error!.statusCode;
        expect(status).toBe(403);
        expect(status).toBeGreaterThanOrEqual(400);
        expect(error!.code).toBe("CALLBACK_REJECTED");
        expect(error!.details?.stage).toBe("beforeDelete");
        expect(error!.details?.path).toBe("articles");
    });

    it("does not run afterDelete for a delete that did not happen", async () => {
        const ran: string[] = [];
        const collection = articles({
            beforeDelete: () => false,
            afterDelete: () => { ran.push("afterDelete"); }
        });
        const driver = buildDriver(collection);

        await expect(driver.delete(deleteProps(collection) as never)).rejects.toBeDefined();

        expect(ran).toEqual([]);
    });

    it("still deletes when the callback returns nothing", async () => {
        // The guard is `=== false`, not falsiness: a callback that just runs and
        // returns is the common case and must not veto.
        const collection = articles({ beforeDelete: () => undefined });
        const driver = buildDriver(collection);

        await driver.delete(deleteProps(collection) as never);

        expect(deleteSpy).toHaveBeenCalled();
    });

    it("still deletes when the callback returns true", async () => {
        const collection = articles({ beforeDelete: () => true });
        const driver = buildDriver(collection);

        await driver.delete(deleteProps(collection) as never);

        expect(deleteSpy).toHaveBeenCalled();
    });

    it("keeps a thrown RebaseApiError's own status rather than forcing 403", async () => {
        const collection = articles({
            beforeDelete: () => {
                throw Object.assign(new Error("Cannot delete a published article"), { status: 409 });
            }
        });
        const driver = buildDriver(collection);

        const error = await driver.delete(deleteProps(collection) as never)
            .then(() => undefined, (e: CallbackError) => e);

        expect(error!.status ?? error!.statusCode).toBe(409);
        expect(deleteSpy).not.toHaveBeenCalled();
    });
});
