/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook } from "@testing-library/react";

/**
 * A filter URL written by something that is not this hook.
 *
 * `useUpdateUrl` mirrors the table's filters into the address bar as one
 * `<field>_op` / `<field>_value` pair per field, and `parseFilterAndSort` reads
 * them back. That round trip is covered by the app using it — but the same
 * format is also a public entry point: a link in a report, an alert or an email
 * that opens the admin with the rows already filtered, composed by code that
 * has no access to this hook and can only follow the shape.
 *
 * rebase-growth's morning brief does exactly that; every count it posts to
 * Discord is a link to the rows it counted. Renaming either suffix, or dropping
 * the `JSON.parse` that turns `false` into a boolean, breaks every one of those
 * links silently — the collection opens unfiltered, showing a plausible table
 * that is not the set the number promised.
 *
 * So this pins the format from the outside, the way an external caller sees it.
 */

const mockLocation = { pathname: "/c/leads",
search: "",
hash: "",
state: null,
key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const mockFind = jest.fn();
const mockData = { collection: () => ({ find: mockFind }) };
jest.mock("../../src/hooks", () => ({
    useData: () => mockData,
    useRebaseContext: () => ({})
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { act } from "@testing-library/react";
import { FilterValues } from "@rebasepro/types";
import { useDataTableController } from "../../src/components/common/useDataTableController";

const collection = {
    slug: "leads",
    name: "Leads",
    table: "leads",
    properties: { id: { name: "ID",
type: "string" },
status: { name: "Status",
type: "string" } }
} as any;

const filtersFrom = (search: string) => {
    mockLocation.search = search;
    const { result } = renderHook(() => useDataTableController({ path: "leads",
collection,
updateUrl: true } as any));
    return result.current.filterValues;
};

describe("useDataTableController — a hand-written filter URL", () => {

    beforeEach(() => {
        mockLocation.pathname = "/c/leads";
        window.history.replaceState({}, "", "/c/leads");
        mockFind.mockReset();
        mockFind.mockResolvedValue({ data: [] });
    });

    it("applies one field, with the operator percent-encoded", () => {
        // `==` has to arrive as %3D%3D: unencoded, the second `=` ends the
        // parameter and the filter silently disappears.
        expect(filtersFrom("?status_op=%3D%3D&status_value=new"))
            .toEqual({ status: ["==", "new"] });
    });

    it("applies several fields at once", () => {
        expect(filtersFrom("?kind_op=%3D%3D&kind_value=reply&handled_op=%3D%3D&handled_value=false"))
            // `false` reaches the API as a boolean, which is what the column
            // holds — a string "false" would match nothing and read as an empty
            // queue rather than as a broken link.
            .toEqual({ kind: ["==", "reply"], handled: ["==", false] });
    });

    it("applies a comparison, not just equality", () => {
        expect(filtersFrom("?status_op=%3D%3D&status_value=pending&due_date_op=%3C&due_date_value=2026-09-11"))
            .toEqual({ status: ["==", "pending"], due_date: ["<", "2026-09-11"] });
    });

    it("ignores a value with no operator beside it", () => {
        // Half a pair is a truncated or hand-edited link. Guessing `==` would
        // invent a filter the caller never asked for.
        expect(filtersFrom("?status_value=new")).toBeUndefined();
    });
});

/**
 * The URL this hook writes is read back by the same hook, and not only on a
 * reload: opening a record carries the address bar's query onto the record URL
 * (`withListState`), react-router reports that as a new `location.search`, and
 * the sync effect parses it into the live filter the list is subscribed with.
 *
 * So whatever the encoder loses, one row click loses too. `false` and `0` were
 * written as `null`, and `["==", null]` is IS NULL on the server — "Active is
 * false" quietly became "Active is empty", and a select-all-matching delete
 * then acted on those rows. A range kept only its first bound, and a field
 * whose name contains `_op` (`shop_open`) was cut to a different field name.
 */
describe("useDataTableController — the filter URL it writes, read back", () => {

    beforeEach(() => {
        mockLocation.pathname = "/c/leads";
        mockLocation.search = "";
        window.history.replaceState({}, "", "/c/leads");
        mockFind.mockReset();
        mockFind.mockResolvedValue({ data: [] });
    });

    const lastWhere = () => mockFind.mock.calls[mockFind.mock.calls.length - 1][0].where;

    /** Set a filter, then open a record the way `navigateToEntity` does. */
    const filterThenOpenRecord = (filter: FilterValues<string>, defaultFilter?: FilterValues<string>) => {
        const { result, rerender } = renderHook(() => useDataTableController({
            path: "leads",
            collection: { ...collection, defaultFilter },
            updateUrl: true
        }));
        act(() => result.current.setFilterValues(filter));
        mockLocation.pathname = "/c/leads/5";
        mockLocation.search = window.location.search;
        rerender();
        return result;
    };

    /** Set a filter, then open the URL it wrote in a fresh view. */
    const filterThenReload = (filter: FilterValues<string>) => {
        const { result } = renderHook(() => useDataTableController({ path: "leads",
collection,
updateUrl: true }));
        act(() => result.current.setFilterValues(filter));
        return filtersFrom(window.location.search);
    };

    it.each([
        ["false", { handled: ["==", false] }],
        ["zero", { stock: ["==", 0] }],
        ["an empty string", { status: ["==", ""] }],
        ["a two-condition range", { stock: [[">=", 5], ["<", 10]] }],
        ["a field whose name contains _op", { shop_open: ["==", true] }]
    ] satisfies [string, FilterValues<string>][])("keeps %s when a record is opened", (_label, filter) => {
        const result = filterThenOpenRecord(filter);
        expect(result.current.filterValues).toEqual(filter);
        expect(lastWhere()).toEqual(filter);
    });

    it.each([
        ["false", { handled: ["==", false] }],
        ["zero", { stock: ["==", 0] }],
        ["a two-condition range", { stock: [[">=", 5], ["<", 10]] }],
        ["a field whose name contains _op", { shop_open: ["==", true] }]
    ] satisfies [string, FilterValues<string>][])("reads %s back from a reload", (_label, filter) => {
        expect(filterThenReload(filter)).toEqual(filter);
    });

    it("writes a single condition in the format external links use", () => {
        const { result } = renderHook(() => useDataTableController({ path: "leads",
collection,
updateUrl: true }));
        act(() => result.current.setFilterValues({ handled: ["==", false] }));
        expect(window.location.search).toBe("?handled_op=%3D%3D&handled_value=false");
    });

    it("does not bring a cleared default filter back when a record is opened", () => {
        // The URL cannot tell "no filter" from "the default" — both are an
        // absent param — so reading it back after the user cleared the default
        // put the default straight back on.
        const { result, rerender } = renderHook(() => useDataTableController({
            path: "leads",
            collection: { ...collection, defaultFilter: { status: ["==", "new"] }, sort: [["status", "asc"]] },
            updateUrl: true
        }));
        expect(result.current.filterValues).toEqual({ status: ["==", "new"] });
        act(() => result.current.clearFilter!());
        mockLocation.pathname = "/c/leads/5";
        mockLocation.search = window.location.search;
        rerender();
        expect(result.current.filterValues).toBeUndefined();
        expect(lastWhere()).toBeUndefined();
    });

    it("still follows a URL it did not write (back/forward)", () => {
        const { result, rerender } = renderHook(() => useDataTableController({ path: "leads",
collection,
updateUrl: true }));
        act(() => result.current.setFilterValues({ status: ["==", "new"] }));
        mockLocation.search = "?status_op=%3D%3D&status_value=done";
        rerender();
        expect(result.current.filterValues).toEqual({ status: ["==", "done"] });
    });

    it("keeps a search containing a percent sign across a reload", () => {
        const { result } = renderHook(() => useDataTableController({ path: "leads",
collection,
updateUrl: true }));
        act(() => result.current.setSearchString!("50% off"));
        mockLocation.search = window.location.search;
        const { result: reloaded } = renderHook(() => useDataTableController({ path: "leads",
collection,
updateUrl: true }));
        expect(reloaded.current.searchString).toBe("50% off");
    });
});
