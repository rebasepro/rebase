/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * A collection with a `fixedFilter` still offers the filters dialog and the
 * header filters, and used to drop whatever the user applied there: the
 * controller returned early with a console warning, the dialog closed, the
 * badge stayed at zero and the rows did not change, with nothing on screen to
 * say why. The user's filters now combine with the fixed one (AND); the fixed
 * filter's own fields stay as the collection declared them.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const mockFind = jest.fn();
const mockClient = { collection: () => ({ find: mockFind }) };
jest.mock("../../src/hooks", () => ({
    useData: () => mockClient,
    useRebaseContext: () => ({})
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataTableController } from "../../src/components/common/useDataTableController";

const collection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: { name: { type: "string" }, status: { type: "string" }, city: { type: "string" } },
    fixedFilter: { status: ["==", "active"] }
} as any;

const lastWhere = () => mockFind.mock.calls[mockFind.mock.calls.length - 1][0].where;

describe("useDataTableController — user filters on a collection with a fixedFilter", () => {

    beforeEach(() => {
        mockFind.mockReset();
        mockFind.mockResolvedValue({ data: [] });
        mockLocation.search = "";
    });

    it("applies a user filter on top of the fixed one", async () => {
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection }));
        await waitFor(() => expect(mockFind).toHaveBeenCalled());

        act(() => result.current.setFilterValues!({ name: ["==", "bob"] }));

        expect(result.current.filterValues).toEqual({ name: ["==", "bob"], status: ["==", "active"] });
        await waitFor(() => expect(lastWhere()).toEqual({ name: ["==", "bob"], status: ["==", "active"] }));
    });

    it("keeps the fixed field as declared, whatever the user sends for it", async () => {
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection }));
        await waitFor(() => expect(mockFind).toHaveBeenCalled());

        act(() => result.current.setFilterValues!({ status: ["==", "archived"], city: ["==", "Rome"] }));

        expect(result.current.filterValues).toEqual({ status: ["==", "active"], city: ["==", "Rome"] });
    });

    it("clearing goes back to the fixed filter alone", async () => {
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection }));
        await waitFor(() => expect(mockFind).toHaveBeenCalled());
        act(() => result.current.setFilterValues!({ name: ["==", "bob"] }));

        act(() => result.current.setFilterValues!(undefined));
        expect(result.current.filterValues).toEqual({ status: ["==", "active"] });

        act(() => result.current.setFilterValues!({ name: ["==", "bob"] }));
        act(() => result.current.clearFilter!());
        expect(result.current.filterValues).toEqual({ status: ["==", "active"] });
    });

    it("opens with the collection's default filter combined with the fixed one", async () => {
        const { result } = renderHook(() => useDataTableController({
            path: "customers",
            collection: { ...collection, defaultFilter: { city: ["==", "Rome"] } }
        }));
        expect(result.current.filterValues).toEqual({ city: ["==", "Rome"], status: ["==", "active"] });
        await waitFor(() => expect(lastWhere()).toEqual({ city: ["==", "Rome"], status: ["==", "active"] }));
    });

    it("opens a shared link's filter combined with the fixed one", () => {
        mockLocation.search = "?name_op=%3D%3D&name_value=bob";
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection, updateUrl: true }));
        expect(result.current.filterValues).toEqual({ name: ["==", "bob"], status: ["==", "active"] });
    });
});
