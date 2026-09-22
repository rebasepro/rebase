/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A table without realtime — a client with no socket, or `realtime: false` —
 * reads its rows with one `find` per query instead of a subscription.
 *
 * Nothing cancelled a read that a newer query had superseded, so the answers
 * landed in whatever order the network returned them: type "ch", then
 * "chair", and the slower "ch" response replaced the rows for "chair". And
 * nothing re-read after a delete or an "add existing": the table was handed
 * `lastDeleteTimestamp` for exactly that and read it nowhere, so the deleted
 * row stayed on screen.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const mockFind = jest.fn();
const mockListen = jest.fn();
const mockAccessor: { find: typeof mockFind; listen?: typeof mockListen } = { find: mockFind };
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

const row = (id: string, name: string) => ({ id, path: "customers", values: { name } });

describe("useDataTableController — without realtime", () => {

    beforeEach(() => {
        mockFind.mockReset();
        mockListen.mockReset();
        delete mockAccessor.listen;
        mockFind.mockResolvedValue({ data: [] });
    });

    it("a slower, older search cannot overwrite a newer one", async () => {
        const reads: Record<string, (value: { data: unknown[] }) => void> = {};
        mockFind.mockImplementation((params: { searchString?: string }) => new Promise(resolve => {
            reads[params.searchString ?? ""] = resolve;
        }));
        const { result } = renderHook(() => useDataTableController<Customer>({ path: "customers", collection }));
        await waitFor(() => expect(reads[""]).toBeDefined());

        act(() => result.current.setSearchString!("ch"));
        await waitFor(() => expect(reads.ch).toBeDefined());
        act(() => result.current.setSearchString!("chair"));
        await waitFor(() => expect(reads.chair).toBeDefined());

        await act(async () => reads.chair({ data: [row("1", "chair")] }));
        await act(async () => reads.ch({ data: [row("2", "chest"), row("3", "church")] }));

        expect(result.current.data.map(e => e.id)).toEqual(["1"]);
    });

    it("re-reads the rows after a delete", async () => {
        const { rerender } = renderHook(
            ({ ts }) => useDataTableController<Customer>({ path: "customers", collection, lastDeleteTimestamp: ts }),
            { initialProps: { ts: 0 } }
        );
        await waitFor(() => expect(mockFind).toHaveBeenCalledTimes(1));

        rerender({ ts: 1_700_000_000_000 });

        await waitFor(() => expect(mockFind).toHaveBeenCalledTimes(2));
    });

    it("leaves a live subscription alone on a delete — the socket already delivers it", async () => {
        mockAccessor.listen = mockListen;
        mockListen.mockReturnValue(() => undefined);
        const { rerender } = renderHook(
            ({ ts }) => useDataTableController<Customer>({ path: "customers", collection, lastDeleteTimestamp: ts }),
            { initialProps: { ts: 0 } }
        );
        await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));

        rerender({ ts: 1_700_000_000_000 });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(mockListen).toHaveBeenCalledTimes(1);
    });
});
