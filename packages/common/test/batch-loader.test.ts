import { createBatchLoader } from "../src/util/download-url-cache";

/**
 * The batching under a storage source's signed-URL lookups: the loads a page
 * starts in one burst travel as one request per hundred keys.
 */
describe("createBatchLoader", () => {
    const answerAll = (keys: string[]) => new Map<string, string | Error>(keys.map(key => [key, `meta:${key}`]));

    it("sends the keys asked for in one burst as one request, each answered with its own value", async () => {
        const loadMany = jest.fn(async (keys: string[]) => answerAll(keys));
        const loadOne = jest.fn(async (key: string) => `one:${key}`);
        const load = createBatchLoader({ loadMany, loadOne });

        const keys = Array.from({ length: 30 }, (_, i) => `photos/${i}.png`);
        const answers = await Promise.all(keys.map(key => load(key)));

        expect(loadMany).toHaveBeenCalledTimes(1);
        expect(loadMany.mock.calls[0][0]).toEqual(keys);
        expect(loadOne).not.toHaveBeenCalled();
        expect(answers).toEqual(keys.map(key => `meta:${key}`));
    });

    it("waits for lookups of the same burst that arrive a few awaits apart", async () => {
        const loadMany = jest.fn(async (keys: string[]) => answerAll(keys));
        const load = createBatchLoader({ loadMany, loadOne: async (key: string) => key });
        // Each lookup reads a token first, some through more awaits than others.
        const lookup = async (key: string, awaits: number) => {
            for (let i = 0; i < awaits; i++) await undefined;
            return load(key);
        };

        await Promise.all([lookup("a", 0), lookup("b", 2), lookup("c", 5)]);

        expect(loadMany).toHaveBeenCalledTimes(1);
        expect(loadMany.mock.calls[0][0]).toEqual(["a", "b", "c"]);
    });

    it("sends its requests under fake timers, which an application's tests may install", async () => {
        jest.useFakeTimers();
        try {
            const loadMany = jest.fn(async (keys: string[]) => answerAll(keys));
            const load = createBatchLoader({ loadMany, loadOne: async (key: string) => key });
            await expect(Promise.all([load("a"), load("b")])).resolves.toEqual(["meta:a", "meta:b"]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("splits a burst into requests of at most a hundred keys", async () => {
        const loadMany = jest.fn(async (keys: string[]) => answerAll(keys));
        const load = createBatchLoader({ loadMany, loadOne: async (key: string) => key });

        await Promise.all(Array.from({ length: 250 }, (_, i) => load(`k${i}`)));

        expect(loadMany.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 50]);
    });

    it("asks for a key on its own the way it always did", async () => {
        const loadMany = jest.fn(async (keys: string[]) => answerAll(keys));
        const loadOne = jest.fn(async (key: string) => `one:${key}`);
        const load = createBatchLoader({ loadMany, loadOne });

        expect(await load("a.png")).toBe("one:a.png");
        expect(loadMany).not.toHaveBeenCalled();
    });

    it("fails only the key the server refused", async () => {
        const refusal = new Error("Not authorized for this object");
        const load = createBatchLoader({
            loadMany: async (keys: string[]) => new Map<string, string | Error>(keys.map(key => [key, key === "bob.png" ? refusal : `meta:${key}`])),
            loadOne: async (key: string) => key
        });

        const results = await Promise.allSettled(["alice.png", "bob.png", "carol.png"].map(key => load(key)));

        expect(results).toEqual([
            { status: "fulfilled", value: "meta:alice.png" },
            { status: "rejected", reason: refusal },
            { status: "fulfilled", value: "meta:carol.png" }
        ]);
    });

    it("falls back to one request per key, from then on, on a server without the batch route", async () => {
        const missingRoute = Object.assign(new Error("Not Found"), { status: 404 });
        const loadMany = jest.fn(async (): Promise<Map<string, string | Error>> => { throw missingRoute; });
        const loadOne = jest.fn(async (key: string) => `one:${key}`);
        const load = createBatchLoader({
            loadMany,
            loadOne,
            isUnsupported: (error: unknown) => error === missingRoute
        });

        expect(await Promise.all(["a", "b", "c"].map(key => load(key)))).toEqual(["one:a", "one:b", "one:c"]);
        expect(await Promise.all(["d", "e"].map(key => load(key)))).toEqual(["one:d", "one:e"]);

        expect(loadMany).toHaveBeenCalledTimes(1);
        expect(loadOne).toHaveBeenCalledTimes(5);
    });

    it("fails every key of a request that failed as a whole", async () => {
        const outage = Object.assign(new Error("Service Unavailable"), { status: 503 });
        const load = createBatchLoader({
            loadMany: async (): Promise<Map<string, string | Error>> => { throw outage; },
            loadOne: async (key: string) => key,
            isUnsupported: () => false
        });

        const results = await Promise.allSettled(["a", "b"].map(key => load(key)));
        expect(results).toEqual([{ status: "rejected", reason: outage }, { status: "rejected", reason: outage }]);
    });
});
