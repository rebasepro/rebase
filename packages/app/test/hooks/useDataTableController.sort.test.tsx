/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook } from "@testing-library/react";

/**
 * A collection's default `sort` used to survive mount and then vanish.
 *
 * `useUpdateUrl` mirrors the sort into the address bar with
 * `window.history.replaceState`, which react-router does not observe — so the
 * `useLocation()` this hook reads keeps reporting the search string the view
 * mounted with. The URL-sync effect guarded against that with a one-shot ref
 * that skipped only the *first* run, so the second run parsed that unchanged,
 * empty search and called `setSortBy(undefined)`, discarding the collection's
 * own default before any user had asked for something else.
 *
 * Re-running the effect takes nothing exotic: it depends on `fixedFilter`, and
 * a caller passing a fresh object literal — the ordinary way to pass that prop —
 * is enough. That is what this pins.
 */

const mockLocation = { pathname: "/c/customers",
search: "",
hash: "",
state: null,
key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

jest.mock("../../src/hooks", () => ({
    useData: () => ({ collection: () => ({ find: jest.fn().mockResolvedValue({ data: [] }) }) }),
    useRebaseContext: () => ({})
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataTableController } from "../../src/components/common/useDataTableController";

const collection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: { id: { name: "ID",
type: "string" },
is_vip: { name: "VIP",
type: "boolean" } },
    sort: [["is_vip", "desc"], ["lifetime_value", "desc"]]
} as any;

describe("useDataTableController — the collection's default sort", () => {

    beforeEach(() => {
        mockLocation.search = "";
        window.history.replaceState({}, "", "/c/customers");
    });

    it("is applied on mount", () => {
        const { result } = renderHook(() => useDataTableController({
            path: "customers",
collection,
updateUrl: true
        }));
        expect(result.current.sortBy).toEqual([["is_vip", "desc"], ["lifetime_value", "desc"]]);
    });

    it("survives a re-render that changes a dependency of the URL-sync effect", () => {
        // A fresh `fixedFilter` object per render, which is how a caller passing
        // an object literal behaves — and what used to re-arm the sync effect
        // against an unchanged, empty search.
        const { result, rerender } = renderHook(
            ({ filter }) => useDataTableController({
                path: "customers",
collection,
updateUrl: true,
fixedFilter: filter
            }),
            { initialProps: { filter: { is_vip: ["==", true] } as any } }
        );

        expect(result.current.sortBy).toEqual([["is_vip", "desc"], ["lifetime_value", "desc"]]);

        rerender({ filter: { is_vip: ["==", true] } as any });
        rerender({ filter: { is_vip: ["==", true] } as any });

        expect(result.current.sortBy).toEqual([["is_vip", "desc"], ["lifetime_value", "desc"]]);
    });

    it("still yields to an explicit sort in the URL", () => {
        mockLocation.search = "?__sort=email&__sort_order=desc";
        const { result } = renderHook(() => useDataTableController({
            path: "customers",
collection,
updateUrl: true
        }));
        expect(result.current.sortBy).toEqual([["email", "desc"]]);
    });
});
