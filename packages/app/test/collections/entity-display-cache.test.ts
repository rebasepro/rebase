import { EntityDisplayCache, entityDisplayKey } from "../../src/collections/entity-display-cache";

/**
 * The store behind a computed display value.
 *
 * Everything here exists because the alternative — resolving per component — is
 * what makes an async title a bad idea. Fifty rows must not become fifty reads,
 * a failure must not become a retry loop, and "resolved to nothing" must stay
 * distinguishable from "not resolved yet" or every row flashes its fallback on
 * every mount.
 */
const key = entityDisplayKey("exercises", "e1", "title");

describe("EntityDisplayCache", () => {

    it("resolves once and serves the value afterwards", async () => {
        const cache = new EntityDisplayCache();
        const resolver = jest.fn(() => "Deep squat");

        expect(await cache.resolve(key, resolver)).toBe("Deep squat");
        expect(await cache.resolve(key, resolver)).toBe("Deep squat");
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(cache.peek(key)).toBe("Deep squat");
    });

    it("shares one in-flight call between concurrent askers", async () => {
        const cache = new EntityDisplayCache();
        let release: (value: string) => void = () => undefined;
        const resolver = jest.fn(() => new Promise<string>(resolve => {
            release = resolve;
        }));

        const asks = [cache.resolve(key, resolver), cache.resolve(key, resolver), cache.resolve(key, resolver)];
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(cache.isLoading(key)).toBe(true);

        release("Deep squat");
        expect(await Promise.all(asks)).toEqual(["Deep squat", "Deep squat", "Deep squat"]);
        expect(cache.isLoading(key)).toBe(false);
    });

    it("never puts a synchronous resolver into the loading state", () => {
        // Otherwise every caller renders its fallback for one frame, for nothing.
        const cache = new EntityDisplayCache();
        cache.resolve(key, () => "Deep squat");
        expect(cache.isLoading(key)).toBe(false);
        expect(cache.peek(key)).toBe("Deep squat");
    });

    it("keeps 'resolved to nothing' distinct from 'not resolved yet'", async () => {
        const cache = new EntityDisplayCache();
        expect(cache.peek(key)).toBeUndefined();

        await cache.resolve(key, () => undefined);
        expect(cache.peek(key)).toBeNull();
    });

    it("treats an empty or blank string as nothing", async () => {
        const cache = new EntityDisplayCache();
        await cache.resolve(key, () => "   ");
        expect(cache.peek(key)).toBeNull();
    });

    it("trims what it stores", async () => {
        const cache = new EntityDisplayCache();
        await cache.resolve(key, () => "  Deep squat  ");
        expect(cache.peek(key)).toBe("Deep squat");
    });

    it("treats an empty array as nothing, so tags fall back", async () => {
        const cache = new EntityDisplayCache();
        const tagsKey = entityDisplayKey("exercises", "e1", "tags");
        await cache.resolve(tagsKey, () => []);
        expect(cache.peek(tagsKey)).toBeNull();
    });

    it("records a rejection as nothing rather than retrying it forever", async () => {
        // Muted: the failure is reported now, and the report is asserted below.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const cache = new EntityDisplayCache();
        const resolver = jest.fn(() => Promise.reject(new Error("offline")));

        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(resolver).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("records a throw the same way", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const cache = new EntityDisplayCache();
        const resolver = jest.fn(() => {
            throw new Error("boom");
        });

        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(cache.peek(key)).toBeNull();
        expect(resolver).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    /**
     * Recording the failure and reporting it are two obligations, and the tests
     * above only ever covered the first. `EntityDisplayResolver`'s contract says a
     * resolver that throws "is treated as `undefined` and logged once" — and the
     * one `console.warn` that said why lived in `useEntityDisplay`, attached as a
     * `.catch()` on this method. But both failure paths here swallow and return a
     * RESOLVED promise, so that catch could never run: a resolver that blew up
     * produced a blank chip and complete silence, in the browser and in the tests.
     *
     * Verified in the panel before fixing: a `tags` resolver that threw, and one
     * that rejected, each left the row rendering and logged nothing at all.
     *
     * So the cache reports it. It is the one place that knows the failure
     * happened, holds the key that identifies which role of which record it was,
     * and runs exactly once per key — which is what makes "once" true rather than
     * hopeful.
     */
    it("says why, once, when a resolver rejects", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const cache = new EntityDisplayCache();
        const resolver = jest.fn(() => Promise.reject(new Error("offline")));

        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(await cache.resolve(key, resolver)).toBeNull();

        // Once per key, not once per ask — the second caller reads the cache.
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("says why when a resolver throws synchronously", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const cache = new EntityDisplayCache();
        const resolver = jest.fn(() => {
            throw new Error("boom");
        });

        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("names the role and the record, and carries the cause", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const cache = new EntityDisplayCache();
        const cause = new Error("offline");

        await cache.resolve(entityDisplayKey("exercises", "e1", "tags"), () => Promise.reject(cause));

        const [message, reported] = warn.mock.calls[0];
        // Without the key the reader has a warning and no way to find the
        // resolver that produced it.
        expect(String(message)).toContain("tags");
        expect(String(message)).toContain("exercises");
        expect(String(message)).toContain("e1");
        expect(reported).toBe(cause);
        warn.mockRestore();
    });

    it("stays silent when a resolver legitimately answers nothing", async () => {
        // `undefined` is the documented way to say "this record has nothing for
        // this role". Warning about it would make the log useless for finding
        // real failures.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const cache = new EntityDisplayCache();

        expect(await cache.resolve(key, () => undefined)).toBeNull();
        expect(await cache.resolve(entityDisplayKey("exercises", "e2", "title"), async () => undefined)).toBeNull();

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("keys by role, so one record's title and image do not collide", async () => {
        const cache = new EntityDisplayCache();
        await cache.resolve(entityDisplayKey("exercises", "e1", "title"), () => "Deep squat");
        await cache.resolve(entityDisplayKey("exercises", "e1", "image"), () => "squat.png");

        expect(cache.peek(entityDisplayKey("exercises", "e1", "title"))).toBe("Deep squat");
        expect(cache.peek(entityDisplayKey("exercises", "e1", "image"))).toBe("squat.png");
    });

    it("keys by record, so two rows do not share a title", async () => {
        const cache = new EntityDisplayCache();
        await cache.resolve(entityDisplayKey("exercises", "e1", "title"), () => "Deep squat");
        await cache.resolve(entityDisplayKey("exercises", "e2", "title"), () => "Hip hinge");

        expect(cache.peek(entityDisplayKey("exercises", "e1", "title"))).toBe("Deep squat");
        expect(cache.peek(entityDisplayKey("exercises", "e2", "title"))).toBe("Hip hinge");
    });

    describe("invalidate", () => {

        it("drops one record's roles and leaves its neighbours alone", async () => {
            const cache = new EntityDisplayCache();
            await cache.resolve(entityDisplayKey("exercises", "e1", "title"), () => "Deep squat");
            await cache.resolve(entityDisplayKey("exercises", "e1", "image"), () => "squat.png");
            await cache.resolve(entityDisplayKey("exercises", "e2", "title"), () => "Hip hinge");

            cache.invalidate("exercises", "e1");

            expect(cache.peek(entityDisplayKey("exercises", "e1", "title"))).toBeUndefined();
            expect(cache.peek(entityDisplayKey("exercises", "e1", "image"))).toBeUndefined();
            expect(cache.peek(entityDisplayKey("exercises", "e2", "title"))).toBe("Hip hinge");
        });

        it("drops a whole collection when given no id", async () => {
            const cache = new EntityDisplayCache();
            await cache.resolve(entityDisplayKey("exercises", "e1", "title"), () => "Deep squat");
            await cache.resolve(entityDisplayKey("exercises", "e2", "title"), () => "Hip hinge");
            await cache.resolve(entityDisplayKey("customers", "c1", "title"), () => "Mary");

            cache.invalidate("exercises");

            expect(cache.peek(entityDisplayKey("exercises", "e1", "title"))).toBeUndefined();
            expect(cache.peek(entityDisplayKey("exercises", "e2", "title"))).toBeUndefined();
            expect(cache.peek(entityDisplayKey("customers", "c1", "title"))).toBe("Mary");
        });

        it("resolves again after being invalidated", async () => {
            const cache = new EntityDisplayCache();
            const resolver = jest.fn()
                .mockReturnValueOnce("Deep squat")
                .mockReturnValueOnce("Deep squat (revised)");

            await cache.resolve(key, resolver as () => unknown);
            cache.invalidate("exercises", "e1");
            expect(await cache.resolve(key, resolver as () => unknown)).toBe("Deep squat (revised)");
        });
    });

    describe("the row a value was computed from", () => {

        it("serves the value while the row is the same one", async () => {
            const cache = new EntityDisplayCache();
            const resolver = jest.fn(() => "7 in stock");

            await cache.resolve(key, resolver, { stock: 7 });
            expect(await cache.resolve(key, resolver, { stock: 7 })).toBe("7 in stock");
            expect(resolver).toHaveBeenCalledTimes(1);
        });

        it("resolves again once the row changed", async () => {
            // A product card's subtitle kept saying "7 in stock" after a
            // restock wrote 57, for as long as the page stayed open.
            const cache = new EntityDisplayCache();
            const subtitle = (row: { stock: number }) => () => `${row.stock} in stock`;

            await cache.resolve(key, subtitle({ stock: 7 }), { stock: 7 });
            expect(await cache.resolve(key, subtitle({ stock: 57 }), { stock: 57 })).toBe("57 in stock");
            expect(cache.peek(key)).toBe("57 in stock");
        });

        it("keeps the previous answer up while the new one is in flight", async () => {
            const cache = new EntityDisplayCache();
            await cache.resolve(key, () => "7 in stock", { stock: 7 });

            let release: (value: string) => void = () => undefined;
            const refresh = cache.resolve(key, () => new Promise<string>(resolve => {
                release = resolve;
            }), { stock: 57 });
            expect(cache.peek(key)).toBe("7 in stock");
            expect(cache.isLoading(key)).toBe(false);

            release("57 in stock");
            await refresh;
            expect(cache.peek(key)).toBe("57 in stock");
        });

        it("never lets a slow answer for an old row land over a newer one", async () => {
            const cache = new EntityDisplayCache();
            let releaseOld: (value: string) => void = () => undefined;
            const old = cache.resolve(key, () => new Promise<string>(resolve => {
                releaseOld = resolve;
            }), { stock: 7 });
            await cache.resolve(key, () => "57 in stock", { stock: 57 });

            releaseOld("7 in stock");
            await old;
            expect(cache.peek(key)).toBe("57 in stock");
        });

        it("is not consulted by a caller that names no row", async () => {
            const cache = new EntityDisplayCache();
            const resolver = jest.fn(() => "7 in stock");
            await cache.resolve(key, resolver, { stock: 7 });

            expect(await cache.resolve(key, () => "other")).toBe("7 in stock");
            expect(resolver).toHaveBeenCalledTimes(1);
        });
    });

    describe("subscribe", () => {

        it("notifies when a value lands", async () => {
            const cache = new EntityDisplayCache();
            const listener = jest.fn();
            cache.subscribe(listener);

            await cache.resolve(key, () => Promise.resolve("Deep squat"));
            expect(listener).toHaveBeenCalled();
        });

        it("stops notifying once unsubscribed", async () => {
            const cache = new EntityDisplayCache();
            const listener = jest.fn();
            cache.subscribe(listener)();

            await cache.resolve(key, () => "Deep squat");
            expect(listener).not.toHaveBeenCalled();
        });

        it("stays quiet when invalidating something it never held", () => {
            // The list re-renders on every notification, and a save invalidates
            // whether or not the row had a computed title.
            const cache = new EntityDisplayCache();
            const listener = jest.fn();
            cache.subscribe(listener);

            cache.invalidate("exercises", "nothing-cached");
            cache.clear();
            expect(listener).not.toHaveBeenCalled();
        });
    });
});
