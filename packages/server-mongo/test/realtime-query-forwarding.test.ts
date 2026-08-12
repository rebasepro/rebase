/**
 * A subscription is a query, and every field a query has it has too.
 *
 * `MongoDriver.fetchCollection` was fixed once by forwarding its props whole,
 * with the reason written next to it: the hand-written list named eight of the
 * eleven fields the type declares, so `logical` and `offset` were accepted at
 * every type-checked boundary and then dropped. The realtime path re-listed
 * them in three more places and lost the same two fields — twice per
 * subscription, once on the way in and once on every re-fetch.
 *
 * What that costs: an `or(...)` subscription re-fetches with the group gone,
 * so the subscriber is pushed every row its policies allow rather than the
 * rows it asked for; and a subscription to page two is pushed page one. A
 * `collection_update` frame carries rows and nothing else — no window, no
 * total — so neither is visible from the client.
 *
 * Asserted at the far end on purpose. Checking that the socket handler copies a
 * field would pass with the re-fetch still dropping it, which is exactly the
 * shape of the bug.
 */
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { CollectionSubscriptionConfig } from "@rebasepro/types";

const setup = () => {
    const changeStream = { on() { return this; }, close: async () => undefined };
    const db = { collection: () => ({ watch: () => changeStream }) };

    const fetches: Record<string, unknown>[] = [];
    const scoped = {
        fetchCollection: async (props: Record<string, unknown>) => { fetches.push(props); return []; },
        fetchOne: async () => null
    };
    const driver = { registry: { getCollectionByPath: () => undefined }, withAuth: () => scoped };

    const service = new MongoRealtimeService(db as any);
    service.setDataDriver(driver as any);
    return { service, fetches };
};

const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Every query field a collection subscription can carry. */
const fullConfig: CollectionSubscriptionConfig = {
    clientId: "c1",
    path: "notes",
    filter: { done: ["==", false] },
    logical: { or: [{ owner: ["==", "a"] }, { owner: ["==", "b"] }] } as any,
    offset: 20,
    orderBy: "created_at",
    order: "desc",
    limit: 10,
    startAfter: { created_at: "2026-01-01" },
    searchString: "meeting",
    searchExplain: true
};

describe("MongoDB realtime query forwarding", () => {

    it("re-fetches with every field the subscription was created with", async () => {
        const { service, fetches } = setup();

        service.subscribeToCollection("s1", fullConfig, () => undefined);
        await settle();

        expect(fetches).toHaveLength(1);
        const props = fetches[0];

        // The two that were dropped, named individually so a regression says
        // which one came back.
        expect(props.logical).toEqual(fullConfig.logical);
        expect(props.offset).toBe(20);

        for (const key of ["path", "orderBy", "order", "limit", "startAfter", "searchString", "searchExplain"] as const) {
            expect(props[key]).toEqual(fullConfig[key]);
        }
        expect(props.filter).toEqual(fullConfig.filter);
    });

    it("does not forward who is watching as part of the query", async () => {
        const { service, fetches } = setup();

        service.subscribeToCollection("s1", { ...fullConfig, authContext: { uid: "u1", roles: [] } } as any,
            () => undefined);
        await settle();

        expect(fetches[0]).not.toHaveProperty("clientId");
        expect(fetches[0]).not.toHaveProperty("authContext");
    });

    it("forwards the same fields on a driver subscription", async () => {
        const { service, fetches } = setup();
        const { MongoDriver } = require("../src/services/MongoDriver");

        const driver = Object.create(MongoDriver.prototype);
        driver.realtimeService = service;
        driver.generateSubscriptionId = () => "drv1";

        driver.listenCollection({
            path: "notes",
            logical: fullConfig.logical,
            offset: 20,
            limit: 10,
            onUpdate: () => undefined
        });
        await settle();

        expect(fetches[0].logical).toEqual(fullConfig.logical);
        expect(fetches[0].offset).toBe(20);
    });
});
