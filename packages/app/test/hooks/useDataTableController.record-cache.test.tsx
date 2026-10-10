/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * A collection view used to write every row it held into the record cache on
 * every update — scrolled to 10,000 rows, each push wrote 10,000 entries, and
 * none of them was ever let go. A record is opened from a list by a click, and
 * the click is what caches that one row now.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const stored = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, path: "customers", values: {} }));
const find = jest.fn((params: { limit: number; offset?: number }) =>
    Promise.resolve({ data: stored.slice(params.offset ?? 0, (params.offset ?? 0) + params.limit) }));
const mockClient = { collection: () => ({ find }) };
jest.mock("../../src/hooks", () => ({
    useData: () => mockClient,
    useRebaseContext: () => ({})
}));
const mockPopulate = jest.fn();
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: mockPopulate }));

import { useDataTableController } from "../../src/components/common/useDataTableController";

const collection = { slug: "customers", name: "Customers", properties: { id: { name: "ID", type: "string" } } } as never;

describe("useDataTableController and the record cache", () => {
    it("writes none of the rows it reads into it", async () => {
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection }));
        act(() => result.current.setItemCount?.(300));
        await waitFor(() => expect(result.current.data).toHaveLength(300));
        expect(mockPopulate).not.toHaveBeenCalled();
    });
});
