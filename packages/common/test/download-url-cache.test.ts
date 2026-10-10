import { createConcurrencyLimit, createDownloadUrlCache } from "../src/util/download-url-cache";

const config = (url: string) => ({ url });

describe("createDownloadUrlCache", () => {
    it("never holds more than its cap, dropping the least recently used first", async () => {
        const cache = createDownloadUrlCache({ maxEntries: 3 });
        for (const key of ["a", "b", "c"]) await cache.get(key, async () => ({ config: config(key) }));
        // Touch "a", so "b" is now the least recently used.
        await cache.get("a", async () => { throw new Error("cached"); });
        await cache.get("d", async () => ({ config: config("d") }));

        expect(cache.size).toBe(3);
        expect(cache.peek("b")).toBeUndefined();
        expect(cache.peek("a")).toEqual(config("a"));

        for (let i = 0; i < 1_000; i++) await cache.get(`k${i}`, async () => ({ config: config(`k${i}`) }));
        expect(cache.size).toBe(3);
    });

    it("hands out an entry until it expires, and loads again after", async () => {
        let now = 1_000;
        const cache = createDownloadUrlCache({ now: () => now });
        const load = jest.fn(async () => ({ config: config(`u${now}`), expiresAt: now + 100 }));

        await cache.get("a", load);
        now += 99;
        await cache.get("a", load);
        expect(load).toHaveBeenCalledTimes(1);

        now += 1;
        expect(cache.peek("a")).toBeUndefined();
        await expect(cache.get("a", load)).resolves.toEqual(config("u1100"));
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("shares one load between concurrent lookups of a key", async () => {
        const cache = createDownloadUrlCache();
        let release!: () => void;
        const load = jest.fn(() => new Promise<{ config: { url: string } }>(resolve => {
            release = () => resolve({ config: config("u") });
        }));

        const all = Promise.all(Array.from({ length: 20 }, () => cache.get("a", load)));
        release();
        expect(await all).toHaveLength(20);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("does not keep a failure or a noStore answer", async () => {
        const cache = createDownloadUrlCache();
        await expect(cache.get("a", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
        await cache.get("b", async () => ({ config: { url: null, fileNotFound: true }, noStore: true }));
        expect(cache.size).toBe(0);
    });
});

/**
 * A cached URL carries a download token minted for whoever asked. A user
 * signing out — or another signing in, in the same tab — must not be handed the
 * previous user's URLs for the rest of their life (~5 min).
 */
describe("createDownloadUrlCache across a change of user", () => {
    it("claim() keeps a returning owner's entries and empties the cache for a new one", async () => {
        const cache = createDownloadUrlCache();
        cache.claim("user-a");
        await cache.get("private/report.pdf", async () => ({ config: config("minted-for-a") }));

        expect(cache.claim("user-a")).toBe(false);
        expect(cache.peek("private/report.pdf")).toEqual(config("minted-for-a"));

        expect(cache.claim("user-b")).toBe(true);
        expect(cache.owner).toBe("user-b");
        expect(cache.size).toBe(0);
        await expect(cache.get("private/report.pdf", async () => ({ config: config("minted-for-b") })))
            .resolves.toEqual(config("minted-for-b"));
    });

    it("a load in flight when the cache is emptied neither lands in it nor is joined after", async () => {
        const cache = createDownloadUrlCache();
        cache.claim("user-a");
        let releaseA!: () => void;
        const forA = cache.get("private/report.pdf", () => new Promise(resolve => {
            releaseA = () => resolve({ config: config("minted-for-a") });
        }));

        cache.claim("user-b");
        // B's lookup starts its own load rather than waiting on A's.
        const loadB = jest.fn(async () => ({ config: config("minted-for-b") }));
        const forB = cache.get("private/report.pdf", loadB);
        releaseA();

        await expect(forA).resolves.toEqual(config("minted-for-a"));
        await expect(forB).resolves.toEqual(config("minted-for-b"));
        expect(loadB).toHaveBeenCalledTimes(1);
        expect(cache.peek("private/report.pdf")).toEqual(config("minted-for-b"));
    });

    it("clear() is the same boundary", async () => {
        const cache = createDownloadUrlCache();
        let release!: () => void;
        const pending = cache.get("k", () => new Promise(resolve => {
            release = () => resolve({ config: config("before") });
        }));
        cache.clear();
        release();
        await pending;
        expect(cache.peek("k")).toBeUndefined();
    });
});

describe("createConcurrencyLimit", () => {
    it("runs at most `max` tasks at once and all of them in the end", async () => {
        const limit = createConcurrencyLimit(3);
        let running = 0;
        let peak = 0;
        const task = async () => {
            running++;
            peak = Math.max(peak, running);
            await new Promise(resolve => setTimeout(resolve, 1));
            running--;
        };
        await Promise.all(Array.from({ length: 30 }, () => limit(task)));
        expect(peak).toBe(3);
    });

    it("frees the slot of a task that fails", async () => {
        const limit = createConcurrencyLimit(1);
        await expect(limit(async () => { throw new Error("x"); })).rejects.toThrow("x");
        await expect(limit(async () => "next")).resolves.toBe("next");
    });
});
