import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";

/**
 * The list bound at the Mongo realtime ingress.
 *
 * `subscribe_collection` unpacked the client's `limit` straight into the
 * subscription config, applying none of the guarantee every other ingress
 * applies. Two failures in one: an ABSENT limit reached the driver as
 * `undefined`, which emits no limit at all, so a single subscribe frame
 * streamed the whole collection — and re-streamed it on every matching write.
 * And an over-large limit was honoured verbatim.
 *
 * Bounding it is only half the answer. A limit above the ceiling is *refused*,
 * not shrunk: `collection_update` carries rows and nothing else — no `total`,
 * no `hasMore` — so a subscriber handed a quietly smaller page cannot tell it
 * apart from a collection that small.
 */
jest.mock("@rebasepro/server", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import type { Db } from "mongodb";
import type { MongoDriver } from "../src/services/MongoDriver";

function mount() {
    const changeStream = { on: jest.fn(), close: jest.fn(async () => undefined) };
    const db = {
        collection: jest.fn(() => ({ watch: jest.fn(() => changeStream) }))
    } as unknown as Db;

    const fetchCollection = jest.fn(async () => []);
    const driver = {
        registry: { getCollectionByPath: jest.fn(() => undefined) },
        withAuth: jest.fn(async () => ({ fetchCollection }))
    } as unknown as MongoDriver;

    const service = new MongoRealtimeService(db);
    service.setDataDriver(driver);

    const ws = { on: jest.fn(), send: jest.fn() };
    service.addClient("client-1", ws as never);

    // `subscribeToCollection` kicks the initial read off without awaiting it,
    // so the assertions need the microtask queue drained first.
    const subscribe = async (payload: Record<string, unknown>) => {
        await service.handleClientMessage("client-1", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-1", ...payload }
        });
        await new Promise(resolve => setImmediate(resolve));
    };

    const frames = () => ws.send.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));

    return { service, fetchCollection, subscribe, frames };
}

describe("MongoRealtimeService — subscribe_collection list bounds", () => {
    it("defaults an absent limit instead of streaming the whole collection", async () => {
        const { fetchCollection, subscribe } = mount();

        await subscribe({});

        expect(fetchCollection).toHaveBeenCalledWith(
            expect.objectContaining({ limit: DEFAULT_LIST_LIMIT })
        );
    });

    it("passes a limit within the ceiling through untouched", async () => {
        const { fetchCollection, subscribe } = mount();

        await subscribe({ limit: 25 });

        expect(fetchCollection).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
    });

    it("refuses an over-large limit with an error frame naming the ceiling", async () => {
        const { service, fetchCollection, subscribe, frames } = mount();

        await subscribe({ limit: 100_000_000 });

        expect(fetchCollection).not.toHaveBeenCalled();
        expect(service.getSubscriptions().has("sub-1")).toBe(false);

        const error = frames().find((f: { type: string }) => f.type === "ERROR");
        expect(error).toBeDefined();
        expect(error.subscriptionId).toBe("sub-1");
        expect(error.payload.error.code).toBe("INVALID_LIMIT");
        expect(error.payload.error.message).toContain(String(MAX_LIST_LIMIT));
        expect(frames().some((f: { type: string }) => f.type === "collection_update")).toBe(false);
    });

    it("refuses a zero limit, which no read can serve", async () => {
        const { fetchCollection, subscribe, frames } = mount();

        await subscribe({ limit: 0 });

        expect(fetchCollection).not.toHaveBeenCalled();
        expect(frames().find((f: { type: string }) => f.type === "ERROR").payload.error.code)
            .toBe("INVALID_LIMIT");
    });
});
