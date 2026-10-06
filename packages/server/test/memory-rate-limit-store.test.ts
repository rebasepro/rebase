/**
 * The in-memory rate-limit store: exact sliding-window counts, at a cost that
 * does not grow with the limit.
 *
 * Each hit used to `filter` the caller's whole window of timestamps into a new
 * array: O(limit) work and garbage per request, on the event loop. At a raised
 * limit of 100,000 (an integration key's `rate_limit`) that was over a
 * millisecond of blocked loop and 700 KB copied per request. Timestamps arrive
 * in time order, so the expired ones are always at the front: the store now
 * moves a head index past them instead.
 *
 * The counts must not move by a single request at any edge, so they are driven
 * with an injected clock against a straightforward model of the old store.
 */
import { MemoryRateLimitStore } from "../src/auth/rate-limit-store";

/** The previous implementation, verbatim in behaviour: the reference model. */
function referenceStore(now: () => number) {
    const store = new Map<string, number[]>();
    return {
        hit(key: string, windowMs: number, limit: number) {
            const t = now();
            const timestamps = (store.get(key) ?? []).filter(s => t - s < windowMs);
            if (timestamps.length >= limit) {
                store.set(key, timestamps);
                return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, timestamps[0] + windowMs - t) };
            }
            timestamps.push(t);
            store.set(key, timestamps);
            return { allowed: true, remaining: limit - timestamps.length, retryAfterMs: 0 };
        }
    };
}

describe("MemoryRateLimitStore", () => {
    let clock = 0;
    const now = () => clock;
    let store: MemoryRateLimitStore;

    beforeEach(() => {
        clock = 1_000_000;
        store = new MemoryRateLimitStore(60_000, now);
    });
    afterEach(() => store.dispose());

    it("decides exactly as the filtering store did, hit for hit, across window edges", async () => {
        const reference = referenceStore(now);
        // A deterministic, bursty schedule: runs of hits at the same instant,
        // gaps that cross the window edge exactly, and two keys interleaved.
        let seed = 7;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        for (let i = 0; i < 5000; i++) {
            const roll = random();
            clock += roll < 0.5 ? 0 : roll < 0.8 ? 7 : roll < 0.95 ? 100 : 1000;
            const key = random() < 0.7 ? "a" : "b";
            expect(await store.hit(key, 1000, 25)).toEqual(reference.hit(key, 1000, 25));
        }
    });

    it("still counts correctly when the clock steps backwards", async () => {
        const reference = referenceStore(now);
        const steps = [0, 10, 20, -500, 5, 5, 600, -50, 900, 300, 0, 2000, -1990, 10];
        for (const step of steps) {
            clock += step;
            for (const key of ["a", "a", "b"]) {
                expect(await store.hit(key, 1000, 4)).toEqual(reference.hit(key, 1000, 4));
            }
        }
    });

    it("expires at exactly windowMs", async () => {
        expect((await store.hit("k", 1000, 1)).allowed).toBe(true);
        clock += 999;
        expect(await store.hit("k", 1000, 1)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1 });
        clock += 1;
        expect((await store.hit("k", 1000, 1)).allowed).toBe(true);
    });

    /**
     * Steady state at 90% of the limit: the old store cost ~100× more per hit
     * at limit 100,000 than at 1,000. Compared at two sizes, as a ratio, with
     * a wide margin — a scaling test, not a stopwatch.
     */
    it("costs about the same per hit at a limit of 1,000 and of 100,000", async () => {
        const perHit = async (limit: number): Promise<number> => {
            const subject = new MemoryRateLimitStore(60_000, now);
            const windowMs = 1_000_000;
            const step = windowMs / (limit * 0.9);
            // Fill to 90% of the limit, then measure hits in steady state.
            for (let i = 0; i < limit * 0.9; i++) {
                clock += step;
                await subject.hit("k", windowMs, limit);
            }
            let best = Infinity;
            for (let round = 0; round < 3; round++) {
                const started = process.hrtime.bigint();
                for (let i = 0; i < 2000; i++) {
                    clock += step;
                    await subject.hit("k", windowMs, limit);
                }
                best = Math.min(best, Number(process.hrtime.bigint() - started));
            }
            subject.dispose();
            return best;
        };

        const small = await perHit(1_000);
        const large = await perHit(100_000);

        expect(large / small).toBeLessThan(10);
    });
});
