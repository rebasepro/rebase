import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { DataService } from "../src/services/dataService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RebaseApiError } from "@rebasepro/types";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * The after-hook transaction contract, pinned.
 *
 * `afterSave` and `afterDelete` run INSIDE the transaction that carries the
 * write and are awaited. Two things follow, and both were undocumented and
 * untested until this suite:
 *
 * 1. A throw in an after-hook aborts the transaction, so the row is rolled
 *    back. The write and its consequences commit together or not at all.
 * 2. That throw has to be answerable. Left raw it reached the client as a
 *    masked `500 INTERNAL_ERROR` with the author's message visible only in the
 *    server log — indistinguishable from the database being down. It now goes
 *    through the same `toCallbackError` path a `before*` hook uses, so it is a
 *    400 `CALLBACK_REJECTED` whose `details.stage` names the hook that refused.
 *
 * The docs used to promise the opposite ("run after the transaction commits",
 * "do not block the HTTP response"). `hooks.md`, `callbacks.md` and the
 * `RebaseCallContext` JSDoc now say what this file asserts.
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

/**
 * A `db` whose `transaction()` behaves the way Postgres does: the callback's
 * rejection is the rollback. `committed` flips only when the callback resolved,
 * so an assertion on it is an assertion about the row's fate.
 */
function buildDb() {
    const state = { committed: false, rolledBack: false };
    const db = {
        transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
            const tx = { execute: jest.fn() };
            try {
                const out = await cb(tx);
                state.committed = true;
                return out;
            } catch (error) {
                state.rolledBack = true;
                throw error;
            }
        })
    } as unknown as NodePgDatabase;
    return { db, state };
}

function buildDriver(collection: CollectionConfig, db: NodePgDatabase) {
    const registry = {
        getCollectionByPath: jest.fn().mockReturnValue(collection),
        getCollections: jest.fn().mockReturnValue([]),
        getTable: jest.fn().mockReturnValue({}),
        getGlobalCallbacks: jest.fn().mockReturnValue(undefined)
    } as any;
    return new PostgresBackendDriver(db, mockRealtimeService, registry);
}

/** The row the DataService pretends to have written / deleted. */
const SAVED_ROW = { id: "a1", title: "Ada" };

/**
 * Stubbed on the prototype, not the instance: `withTransaction` builds a fresh
 * `DataService` bound to the transaction handle, so an instance spy on the base
 * driver's copy would never be the one the write goes through.
 */
function stubDataService() {
    jest.spyOn(DataService.prototype, "save").mockResolvedValue(SAVED_ROW as never);
    jest.spyOn(DataService.prototype, "delete").mockResolvedValue(undefined as never);
}

const articles = (callbacks: Record<string, unknown>) => ({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {},
    callbacks
} as unknown as CollectionConfig);

describe("afterSave throws", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("rolls the row back — the transaction never commits", async () => {
        const { db, state } = buildDb();
        const collection = articles({
            afterSave: async () => {
                throw new Error("the warehouse refused the order");
            }
        });
        const base = buildDriver(collection, db);
        stubDataService();
        const authed = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);

        await expect(authed.save({
            path: "articles",
            id: "a1",
            values: { title: "Ada" },
            collection,
            status: "new"
        } as never)).rejects.toBeDefined();

        expect(state.rolledBack).toBe(true);
        expect(state.committed).toBe(false);
    });

    it("answers 400 CALLBACK_REJECTED naming the stage, not a masked 500", async () => {
        const { db } = buildDb();
        const collection = articles({
            afterSave: async () => {
                throw new Error("the warehouse refused the order");
            }
        });
        const base = buildDriver(collection, db);
        stubDataService();
        const authed = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);

        const error = await authed.save({
            path: "articles",
            id: "a1",
            values: { title: "Ada" },
            collection,
            status: "new"
        } as never).then(() => undefined, (e: CallbackError) => e);

        expect(error).toBeDefined();
        expect(error!.status ?? error!.statusCode).toBe(400);
        expect(error!.code).toBe("CALLBACK_REJECTED");
        expect(error!.details?.stage).toBe("afterSave");
        expect(error!.details?.path).toBe("articles");
        // The author's message survives — the whole point of not masking it.
        expect(error!.message).toBe("the warehouse refused the order");
    });

    it("announces nothing to realtime subscribers for a row that was rolled back", async () => {
        const { db } = buildDb();
        const collection = articles({
            afterSave: async () => {
                throw new Error("nope");
            }
        });
        const base = buildDriver(collection, db);
        stubDataService();
        const authed = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);

        await expect(authed.save({
            path: "articles",
            id: "a1",
            values: { title: "Ada" },
            collection,
            status: "new"
        } as never)).rejects.toBeDefined();

        expect(mockRealtimeService.notifyUpdate).not.toHaveBeenCalled();
    });

    it("keeps a RebaseApiError's own status and code", async () => {
        const { db } = buildDb();
        const collection = articles({
            afterSave: async () => {
                throw new RebaseApiError("Stock moved under us", { status: 409, code: "STOCK_CONFLICT" });
            }
        });
        const base = buildDriver(collection, db);
        stubDataService();
        const authed = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);

        const error = await authed.save({
            path: "articles",
            id: "a1",
            values: { title: "Ada" },
            collection,
            status: "new"
        } as never).then(() => undefined, (e: CallbackError) => e);

        expect(error!.status ?? error!.statusCode).toBe(409);
        expect(error!.code).toBe("STOCK_CONFLICT");
    });

    it("still fires afterSaveError, so the failure path is not skipped", async () => {
        const { db } = buildDb();
        const seen: unknown[] = [];
        const collection = articles({
            afterSave: async () => {
                throw new Error("nope");
            },
            afterSaveError: async (props: unknown) => {
                seen.push(props);
            }
        });
        const base = buildDriver(collection, db);
        stubDataService();
        const authed = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);

        await expect(authed.save({
            path: "articles",
            id: "a1",
            values: { title: "Ada" },
            collection,
            status: "new"
        } as never)).rejects.toBeDefined();

        expect(seen).toHaveLength(1);
    });

    it("commits when the hook returns — the guard is the throw, not the hook", async () => {
        const { db, state } = buildDb();
        const ran: string[] = [];
        const collection = articles({
            afterSave: async () => {
                ran.push("afterSave");
            }
        });
        const base = buildDriver(collection, db);
        stubDataService();
        const authed = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);

        await authed.save({
            path: "articles",
            id: "a1",
            values: { title: "Ada" },
            collection,
            status: "new"
        } as never);

        expect(ran).toEqual(["afterSave"]);
        expect(state.committed).toBe(true);
        expect(state.rolledBack).toBe(false);
    });
});

describe("afterDelete throws", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("rolls the delete back and answers CALLBACK_REJECTED naming afterDelete", async () => {
        const { db, state } = buildDb();
        const collection = articles({
            afterDelete: async () => {
                throw new Error("comments could not be cascaded");
            }
        });
        const base = buildDriver(collection, db);
        stubDataService();
        const authed = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);

        const error = await authed.delete({
            row: { id: "a1", path: "articles", values: { title: "Ada" } },
            collection
        } as never).then(() => undefined, (e: CallbackError) => e);

        expect(error!.status ?? error!.statusCode).toBe(400);
        expect(error!.code).toBe("CALLBACK_REJECTED");
        expect(error!.details?.stage).toBe("afterDelete");
        expect(error!.message).toBe("comments could not be cascaded");
        expect(state.rolledBack).toBe(true);
        expect(state.committed).toBe(false);
    });
});
