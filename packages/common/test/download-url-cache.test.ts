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
