import { describe, expect, test } from "@jest/globals";
import { mapWithConcurrency } from "../../src/util/map_with_concurrency";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {

    test("results come back in the order the items were given", async () => {
        const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
            await new Promise(r => setTimeout(r, (5 - n) * 2));
            return n * 10;
        });

        expect(results).toEqual([10, 20, 30, 40, 50]);
    });

    /**
     * The point of the whole helper. The bulk delete was
     * `Promise.all(entities.map(performDelete))`, which for a "select all
     * 12,480 matching" is 12,480 simultaneous requests.
     */
    test("never runs more than `concurrency` tasks at once", async () => {
        let inFlight = 0;
        let peak = 0;

        await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 4, async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(r => setTimeout(r, 1));
            inFlight--;
            return true;
        });

        expect(peak).toBe(4);
    });

    test("fewer items than the limit starts only as many workers as there are items", async () => {
        let started = 0;
        await mapWithConcurrency([1, 2], 8, async (n) => {
            started++;
            return n;
        });
        expect(started).toBe(2);
    });

    test("an empty list resolves without running anything", async () => {
        const results = await mapWithConcurrency([], 4, async () => {
            throw new Error("should not run");
        });
        expect(results).toEqual([]);
    });

    /**
     * A rejection must not cancel the rest: the caller has already told the
     * user it is deleting 12,480 rows, and stopping at the first failure would
     * leave the other 12,479 in a state nobody can describe.
     */
    test("every task runs even when one rejects, and the first error is thrown", async () => {
        const ran: number[] = [];

        await expect(mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
            ran.push(n);
            if (n === 2) throw new Error("boom");
            return n;
        })).rejects.toThrow("boom");

        expect(ran.sort()).toEqual([1, 2, 3, 4]);
    });

    test("reports progress as tasks settle, failures included", async () => {
        const seen: number[] = [];

        await expect(mapWithConcurrency([1, 2, 3], 1, async (n) => {
            if (n === 2) throw new Error("boom");
            return n;
        }, (completed) => seen.push(completed))).rejects.toThrow("boom");

        expect(seen).toEqual([1, 2, 3]);
    });

    test("a concurrency below one is treated as one rather than deadlocking", async () => {
        const gate = deferred<void>();
        let started = 0;

        const run = mapWithConcurrency([1, 2], 0, async (n) => {
            started++;
            await gate.promise;
            return n;
        });

        await Promise.resolve();
        expect(started).toBe(1);

        gate.resolve();
        expect(await run).toEqual([1, 2]);
    });
});
