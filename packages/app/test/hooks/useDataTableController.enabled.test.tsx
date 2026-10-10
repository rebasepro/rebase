/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A controller nobody is showing reads nothing.
 *
 * The collection view builds its table controller in every view mode, the
 * board included, where only the search and the filters are read from it —
 * each column runs its own window. So in kanban the table's first page was one
 * more live subscription nobody rendered: one more server re-read and count on
 * every write to the collection, and one more re-render of the whole view per
 * push.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const mockFind = jest.fn();
const mockListen = jest.fn();
const mockAccessor = { find: mockFind, listen: mockListen };
const mockData = { collection: () => mockAccessor };
const mockContext = {};
jest.mock("../../src/hooks", () => ({
    useData: () => mockData,
    useRebaseContext: () => mockContext
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataTableController } from "../../src/components/common/useDataTableController";

type Customer = { name: string };

const collection: AdminCollection<Customer> = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: { name: { type: "string" } }
};

describe("useDataTableController — enabled", () => {
    const unsubscribe = jest.fn();

    beforeEach(() => {
        mockFind.mockReset();
        mockListen.mockReset();
        unsubscribe.mockReset();
        mockFind.mockResolvedValue({ data: [] });
        mockListen.mockReturnValue(unsubscribe);
    });

    it("opens no subscription and reads nothing while disabled, and says it is not loading", async () => {
        const { result } = renderHook(() =>
            useDataTableController<Customer>({ path: "customers", collection, enabled: false }));
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(mockListen).not.toHaveBeenCalled();
        expect(mockFind).not.toHaveBeenCalled();
        expect(result.current.dataLoading).toBe(false);
    });

    it("subscribes when enabled, and lets go when disabled again", async () => {
        const { rerender } = renderHook(
            ({ enabled }) => useDataTableController<Customer>({ path: "customers", collection, enabled }),
            { initialProps: { enabled: false } }
        );
        expect(mockListen).not.toHaveBeenCalled();

        rerender({ enabled: true });
        await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));

        rerender({ enabled: false });
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(mockListen).toHaveBeenCalledTimes(1);
    });

    it("is enabled by default", async () => {
        renderHook(() => useDataTableController<Customer>({ path: "customers", collection }));
        await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));
    });
});
