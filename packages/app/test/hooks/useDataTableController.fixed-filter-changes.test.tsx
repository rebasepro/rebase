/**
 * @jest-environment jsdom
 */
/**
 * A fixed filter that changes after mount — `CollectionPanel`'s `where`
 * following a tab bar or a chart click. The table's filter state was built
 * from it once, at mount, so a new one used to change nothing.
 */
import { act, renderHook } from "@testing-library/react";
import type { FilterValues } from "@rebasepro/types";

const mockLocation = { pathname: "/my-page", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const mockFind = jest.fn();
const mockData = { collection: () => ({ find: mockFind }) };
jest.mock("../../src/hooks", () => ({ useRebaseContext: () => ({}) }));
jest.mock("../../src/hooks/data/useData", () => ({ useData: () => mockData }));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataTableController } from "../../src/components/common/useDataTableController";

function collectionWith(fixedFilter: FilterValues<string> | undefined) {
    return {
        slug: "orders",
        name: "Orders",
        table: "orders",
        fixedFilter,
        properties: {
            id: { name: "ID", type: "string" },
            status: { name: "Status", type: "string" },
            region: { name: "Region", type: "string" },
            total: { name: "Total", type: "number" }
        }
    } as never;
}

function renderController(fixedFilter: FilterValues<string> | undefined) {
    return renderHook(
        ({ filter }: { filter: FilterValues<string> | undefined }) =>
            useDataTableController({ path: "orders", collection: collectionWith(filter) }),
        { initialProps: { filter: fixedFilter } });
}

beforeEach(() => {
    mockFind.mockReset();
    mockFind.mockResolvedValue({ data: [] });
});

describe("useDataTableController — a fixed filter that changes", () => {
    it("moves the filter to the new one", () => {
        const { result, rerender } = renderController({ status: ["==", "pending"] });
        expect(result.current.filterValues).toEqual({ status: ["==", "pending"] });

        rerender({ filter: { status: ["==", "shipped"] } });
        expect(result.current.filterValues).toEqual({ status: ["==", "shipped"] });
    });

    it("drops the old fixed fields the new one leaves out, and filters nothing once it is gone", () => {
        const { result, rerender } = renderController({ status: ["==", "pending"] });
        rerender({ filter: { region: ["==", "eu"] } });
        expect(result.current.filterValues).toEqual({ region: ["==", "eu"] });

        rerender({ filter: undefined });
        expect(result.current.filterValues).toBeUndefined();
    });

    it("keeps the filters the person set on other fields", () => {
        const { result, rerender } = renderController({ status: ["==", "pending"] });
        act(() => result.current.setFilterValues?.({ status: ["==", "pending"], total: [">", 100] }));
        expect(result.current.filterValues).toEqual({ status: ["==", "pending"], total: [">", 100] });

        rerender({ filter: { status: ["==", "shipped"] } });
        expect(result.current.filterValues).toEqual({ status: ["==", "shipped"], total: [">", 100] });
    });

    it("leaves the state alone for an equal filter built again", () => {
        const { result, rerender } = renderController({ status: ["==", "pending"] });
        act(() => result.current.setFilterValues?.({ status: ["==", "pending"], total: [">", 100] }));
        const before = result.current.filterValues;

        rerender({ filter: { status: ["==", "pending"] } });
        expect(result.current.filterValues).toBe(before);
    });
});
