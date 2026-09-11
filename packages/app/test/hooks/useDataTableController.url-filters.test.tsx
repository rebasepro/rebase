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

jest.mock("../../src/hooks", () => ({
    useData: () => ({ collection: () => ({ find: jest.fn().mockResolvedValue({ data: [] }) }) }),
    useRebaseContext: () => ({})
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

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
        window.history.replaceState({}, "", "/c/leads");
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
