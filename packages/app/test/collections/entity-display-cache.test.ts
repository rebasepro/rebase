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
        const cache = new EntityDisplayCache();
        const resolver = jest.fn(() => Promise.reject(new Error("offline")));

        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(resolver).toHaveBeenCalledTimes(1);
    });

    it("records a throw the same way", async () => {
        const cache = new EntityDisplayCache();
        const resolver = jest.fn(() => {
            throw new Error("boom");
        });

        expect(await cache.resolve(key, resolver)).toBeNull();
        expect(cache.peek(key)).toBeNull();
        expect(resolver).toHaveBeenCalledTimes(1);
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
