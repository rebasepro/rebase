/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook } from "@testing-library/react";

/**
 * Returning to a collection restores how many rows were loaded, so a scrolled
 * view does not snap back to its first page. That count becomes the read's
 * `limit`, which makes one restored value dangerous: an entry whose `data` is
 * empty.
 *
 * Empty entries are ordinary. `updateCollectionScroll` records what was on
 * screen, so any filter combination matching no rows saves `data: []` under its
 * own (path, filters) key. Restored through `??` — which falls back on
 * `null`/`undefined` but not on `0` — that asked the API for `limit=0`, which
 * it refuses: the collection rendered `Invalid limit: 0` where the table should
 * have been, and a client bug read as an API failure.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const find = jest.fn().mockResolvedValue({ data: [] });
jest.mock("../../src/hooks", () => ({
    useData: () => ({ collection: () => ({ find }) }),
    useRebaseContext: () => ({})
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { DEFAULT_PAGE_SIZE, useDataTableController } from "../../src/components/common/useDataTableController";
import type { ScrollRestorationController } from "../../src/components/common/useScrollRestoration";

const collection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: { id: { name: "ID", type: "string" } }
} as any;

/** A restoration controller serving one fixed entry, as a remount would find it. */
function restorationWith(entry: { scrollOffset: number, data: any[] } | undefined): ScrollRestorationController {
    return {
        getCollectionScroll: () => entry,
        updateCollectionScroll: jest.fn()
    };
}

function mount(scrollRestoration?: ScrollRestorationController) {
    return renderHook(() => useDataTableController({ path: "customers", collection, scrollRestoration }));
}

/** The `limit` that actually left the client on the mount read. */
function requestedLimit() {
    return find.mock.calls[0][0].limit;
}

describe("useDataTableController — the item count restored from a saved scroll", () => {

    beforeEach(() => {
        find.mockClear();
        mockLocation.search = "";
    });

    it("asks for a page when there is nothing saved", () => {
        const { result } = mount(restorationWith(undefined));
        expect(result.current.itemCount).toBe(DEFAULT_PAGE_SIZE);
        expect(requestedLimit()).toBe(DEFAULT_PAGE_SIZE);
    });

    it("asks for as many rows as were loaded last time", () => {
        const rows = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, values: {} }));
        const { result } = mount(restorationWith({ scrollOffset: 900, data: rows }));
        expect(result.current.itemCount).toBe(120);
        expect(requestedLimit()).toBe(120);
    });

    // The regression: an entry saved by a view that matched no rows.
    it("asks for a page — never zero — when the saved entry is empty", () => {
        const { result } = mount(restorationWith({ scrollOffset: 0, data: [] }));
        expect(result.current.itemCount).toBe(DEFAULT_PAGE_SIZE);
        expect(requestedLimit()).toBe(DEFAULT_PAGE_SIZE);
    });

    it("keeps a collection's own page size as the floor", () => {
        const paged = { ...collection, pagination: 20 };
        const { result } = renderHook(() => useDataTableController({
            path: "customers",
            collection: paged as any,
            scrollRestoration: restorationWith({ scrollOffset: 0, data: [] })
        }));
        expect(result.current.itemCount).toBe(20);
        expect(requestedLimit()).toBe(20);
    });

    // `pagination: 0` means pagination is off, not "read no rows" — and the
    // page size it yields travels on to the card, board and relation views.
    it("does not turn `pagination: 0` into a page size of zero", () => {
        const { result } = renderHook(() => useDataTableController({
            path: "customers",
            collection: { ...collection, pagination: 0 } as any
        }));
        expect(result.current.pageSize).toBe(DEFAULT_PAGE_SIZE);
        expect(result.current.itemCount).toBeUndefined();
        expect(requestedLimit()).toBeUndefined();
    });
});
