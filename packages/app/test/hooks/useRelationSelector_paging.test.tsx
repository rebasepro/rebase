import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { MAX_LIST_LIMIT, resolveClientListLimit } from "@rebasepro/types";
import { useRelationSelector } from "../../src/hooks/data/useRelationSelector";

/**
 * "Load more" in a relation picker raised one read's `limit` by a page. Every
 * page re-read the options before it, and once the picker held 1,000 options
 * the next read asked for more than the API serves and was refused: the
 * options past 1,000 could not be reached. The fake below serves the way the
 * server does — by offset, refusing a `limit` above the ceiling.
 */

jest.mock("../../src/hooks/data/useData", () => ({
    useData: () => (globalThis as { __mockDataClient?: unknown }).__mockDataClient
}));

const stored = Array.from({ length: 1_050 }, (_, i) => ({ id: `t${i}`, path: "tags", values: { name: `tag ${i}` } }));
const reads: { limit: number; offset: number }[] = [];

const collection = { slug: "tags", properties: { name: { type: "string" } } } as never;

describe("useRelationSelector — loading more options", () => {

    beforeEach(() => {
        reads.length = 0;
        (globalThis as { __mockDataClient?: unknown }).__mockDataClient = {
            collection: () => ({
                find: async (params: { limit?: number; offset?: number }) => {
                    const limit = resolveClientListLimit(params.limit);
                    const offset = params.offset ?? 0;
                    reads.push({ limit, offset });
                    return { data: stored.slice(offset, offset + limit), meta: { hasMore: offset + limit < stored.length } };
                }
            })
        };
    });

    afterEach(() => {
        delete (globalThis as { __mockDataClient?: unknown }).__mockDataClient;
    });

    it("reaches the options past 1,000, reading each page once", async () => {
        const state: { current?: ReturnType<typeof useRelationSelector> } = {};
        function Probe() {
            state.current = useRelationSelector({ path: "tags", collection, pageSize: 500 });
            return null;
        }
        render(<Probe/>);
        await waitFor(() => expect(state.current!.items).toHaveLength(500));

        for (let step = 0; step < 5 && state.current!.hasMore; step++) {
            act(() => state.current!.loadMore());
            await waitFor(() => expect(state.current!.isLoading).toBe(false));
        }

        expect(state.current!.error).toBeUndefined();
        expect(state.current!.items).toHaveLength(1_050);
        expect(state.current!.hasMore).toBe(false);
        expect(reads).toEqual([
            { limit: 500, offset: 0 },
            { limit: 500, offset: 500 },
            { limit: 500, offset: 1_000 }
        ]);
        expect(Math.max(...reads.map(read => read.limit))).toBeLessThanOrEqual(MAX_LIST_LIMIT);
    });
});
