import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";

/**
 * What it costs the client to merge a refetched frame into the rows it holds.
 *
 * Every frame is the whole page, refetched, and the merge keeps the cached
 * object for each row that did not change, so a table re-renders only the rows
 * that did. Two costs rode along with it on every frame, in production:
 *
 * - every row that did change was diffed key by key, serialised with
 *   `JSON.stringify(…, null, 2)` and handed to `console.debug` — a bulk write
 *   to a 1,000-row live list was 1,000 stringify calls and ~96 KB of console
 *   text per frame, which a browser keeps for DevTools;
 * - every cached row and every incoming row was deep-copied before it was
 *   compared, to leave a relation's `data` out of the comparison — two copies
 *   per row per frame, most of which then compared equal.
 *
 * The diff is now written only while realtime debugging is switched on
 * (`globalThis.__REBASE_DEBUG_REALTIME__ = true`), and rows are compared in
 * place.
 */

const ID_PKS = [{ fieldName: "id", type: "number" as const }];
const DEBUG_FLAG = "__REBASE_DEBUG_REALTIME__";

/** A client holding `cached` under one collection subscription. */
function holding(cached: Record<string, unknown>[]) {
    const client = new RebaseWebSocketClient({ websocketUrl: "ws://localhost:1234" });
    const internals = client as unknown as {
        backendToCollectionKey: Map<string, string>;
        collectionSubscriptions: Map<string, { latestData: Record<string, unknown>[] }>;
        handleWebSocketMessage: (message: unknown) => void;
    };
    internals.backendToCollectionKey.set("backend-1", "sub-key");
    internals.collectionSubscriptions.set("sub-key", {
        backendSubscriptionId: "backend-1",
        callbacks: new Map([["cb", { onUpdate: () => undefined }]]),
        props: { path: "posts" },
        latestData: cached,
        pks: ID_PKS,
        isInitialDataReceived: true
    } as unknown as { latestData: Record<string, unknown>[] });
    return {
        receive: (rows: Record<string, unknown>[]) => internals.handleWebSocketMessage({
            type: "collection_update",
            subscriptionId: "backend-1",
            rows,
            pks: ID_PKS
        }),
        held: () => internals.collectionSubscriptions.get("sub-key")!.latestData
    };
}

/** A row with the shapes a frame carries: nested values, a date, a relation with its loaded row. */
const row = (id: number, title: string, withData = false) => ({
    id,
    title,
    meta: { tags: ["a", "b"], rank: id, published: new Date(Date.UTC(2026, 0, id % 28 + 1)) },
    author: {
        __type: "relation",
        id: String(id % 10),
        path: "users",
        ...(withData ? { data: { id: String(id % 10), name: `user ${id % 10}` } } : {})
    }
});

afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, DEBUG_FLAG);
});

describe("merging a refetched frame", () => {
    it("writes nothing to the console and serialises nothing for the rows that changed", () => {
        const debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);
        const cached = Array.from({ length: 1000 }, (_, i) => row(i, "before"));
        const { receive, held } = holding(cached);
        const stringify = jest.spyOn(JSON, "stringify");

        receive(Array.from({ length: 1000 }, (_, i) => row(i, "after")));

        expect(held().every((merged, i) => merged !== cached[i] && merged.title === "after")).toBe(true);
        expect(debug).not.toHaveBeenCalled();
        expect(stringify).not.toHaveBeenCalled();
    });

    it("explains each changed row while realtime debugging is on", () => {
        const debug = jest.spyOn(console, "debug").mockImplementation(() => undefined);
        const { receive } = holding([row(1, "before"), row(2, "same")]);
        Reflect.set(globalThis, DEBUG_FLAG, true);

        receive([row(1, "after"), row(2, "same")]);

        expect(debug).toHaveBeenCalledTimes(1);
        const [line, diff] = debug.mock.calls[0] as [string, string];
        expect(line).toContain("Row 1 refetch mismatch");
        expect(JSON.parse(diff)).toEqual({ title: { cached: "before", incoming: "after" } });
    });

    it("compares the rows in place, without copying either side", () => {
        const cached = Array.from({ length: 100 }, (_, i) => row(i, "same"));
        const { receive, held } = holding(cached);
        // The copies were built key by key with `Object.entries`; nothing else
        // in the merge enumerates a row that way.
        const entries = jest.spyOn(Object, "entries");

        // The same rows, refetched — and now with each relation's row loaded,
        // which a relation does not compare by.
        receive(Array.from({ length: 100 }, (_, i) => row(i, "same", true)));

        expect(entries).not.toHaveBeenCalled();
        expect(held().every((merged, i) => merged === cached[i])).toBe(true);
    });

    it("still sees a change inside a nested value, a date or a relation's key", () => {
        const cached = [row(1, "x"), row(2, "x"), row(3, "x")];
        const { receive, held } = holding(cached);
        const changedDate = row(1, "x");
        changedDate.meta.published = new Date(Date.UTC(2027, 0, 1));
        const changedTag = row(2, "x");
        changedTag.meta.tags = ["a", "c"];
        const changedAuthor = row(3, "x");
        changedAuthor.author.id = "9";

        receive([changedDate, changedTag, changedAuthor]);

        expect(held()).toEqual([changedDate, changedTag, changedAuthor]);
        expect(held().some((merged, i) => merged === cached[i])).toBe(false);
    });
});
