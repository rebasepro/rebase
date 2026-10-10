/**
 * @jest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";

/**
 * The record cache is what lets a record open with its values on screen while
 * its listener catches up. It used to be fed every row a collection view held,
 * on every update, and never let go of one: 100,000 rows scrolled through kept
 * ~260 MB alive after the view closed. It keeps the 2,000 records written or
 * read most recently now.
 */

// A listener that never answers: what is on screen at first is the cache.
const mockClient = { collection: () => ({ listenById: () => () => undefined }) };
jest.mock("../../src/hooks/data/useData", () => ({ useData: () => mockClient }));
jest.mock("../../src/hooks/useRebaseContext", () => ({ useRebaseContext: () => ({}) }));

import { clearFetchCache, populateFetchCache, useFetch } from "../../src/hooks/data/useFetch";

const collection = { slug: "products", properties: {} } as never;
const row = (i: number): Entity => ({ id: `p${i}`, path: "products", values: { i } });

/** Whether `useFetch` opens this record with a cached entity on screen. */
function opensCached(id: string): boolean {
    const { result, unmount } = renderHook(() => useFetch({ path: "products", entityId: id, collection }));
    const cached = result.current.entity !== undefined && !result.current.dataLoading;
    unmount();
    return cached;
}

describe("the record cache", () => {
    beforeEach(() => clearFetchCache());

    it("keeps the 2,000 most recent records, not every one it was given", () => {
        populateFetchCache("products", Array.from({ length: 100_000 }, (_, i) => row(i)));
        expect(opensCached("p0")).toBe(false);
        expect(opensCached("p97999")).toBe(false);
        expect(opensCached("p98000")).toBe(true);
        expect(opensCached("p99999")).toBe(true);
    });

    it("counts a read as a use", () => {
        populateFetchCache("products", Array.from({ length: 2_000 }, (_, i) => row(i)));
        // Opened, so it is the most recently used…
        expect(opensCached("p0")).toBe(true);
        populateFetchCache("products", [row(2_000)]);
        // …and the next oldest went in its place.
        expect(opensCached("p0")).toBe(true);
        expect(opensCached("p1")).toBe(false);
    });

    it("is emptied by a sign-out", () => {
        populateFetchCache("products", [row(1)]);
        clearFetchCache();
        expect(opensCached("p1")).toBe(false);
    });
});
