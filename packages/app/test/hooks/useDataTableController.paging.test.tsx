/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { MAX_LIST_LIMIT, resolveClientListLimit } from "@rebasepro/types";

/**
 * Scrolling a table, list or card view past row 1,000.
 *
 * The next page used to be the same read with `limit` raised by a page, so
 * page k re-read every row before it, and the read that reached row 1,001
 * asked for `limit=1050` — which the API refuses. The view then showed the
 * server's "`limit` 1050 is above the maximum of 1000" error, every further
 * scroll fired another refused read, and no row past 1,000 could be reached.
 *
 * The fake below serves a collection the way the server does: it pages by
 * `offset`, and refuses a `limit` above the ceiling through the same
 * `resolveClientListLimit` every ingress uses.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

type Row = { id: string; path: string; values: { name: string } };
let mockRows: Row[] = [];
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

const collection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: { name: { type: "string" } }
} as any;

function rowsOf(n: number, prefix = "c"): Row[] {
    return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, path: "customers", values: { name: `n${i}` } }));
}

/** One read, answered the way the server answers it. */
function serve(params: { limit?: number; offset?: number }) {
    const limit = resolveClientListLimit(params.limit);
    const offset = params.offset ?? 0;
    return { data: mockRows.slice(offset, offset + limit), meta: { total: mockRows.length, limit, offset, hasMore: offset + limit < mockRows.length } };
}

/** Do what every view's "reached the end" handler does, until it stops. */
async function scrollToTheEnd(result: { current: ReturnType<typeof useDataTableController> }) {
    for (let step = 0; step < 100 && !result.current.noMoreToLoad; step++) {
        const next = (result.current.itemCount ?? 0) + result.current.pageSize!;
        act(() => result.current.setItemCount!(next));
        await waitFor(() => expect(result.current.dataLoading).toBe(false));
    }
}

jest.setTimeout(30_000);

describe("useDataTableController — paging past the read ceiling", () => {

    beforeEach(() => {
        mockFind.mockReset();
        mockListen.mockReset();
        delete mockAccessor.listen;
        mockFind.mockImplementation((params: { limit?: number; offset?: number }) => {
            try {
                return Promise.resolve(serve(params));
            } catch (error) {
                return Promise.reject(error);
            }
        });
    });

    it("reaches every row of a 1,200-row collection, reading only the next page each time", async () => {
        mockRows = rowsOf(1200);
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection }));
        await waitFor(() => expect(result.current.data).toHaveLength(50));

        await scrollToTheEnd(result);

        expect(result.current.dataLoadingError).toBeUndefined();
        expect(result.current.noMoreToLoad).toBe(true);
        expect(result.current.data.map(row => row.id)).toEqual(mockRows.map(row => row.id));

        const reads = mockFind.mock.calls.map(([params]) => params as { limit: number; offset?: number });
        // No read the server would refuse.
        expect(Math.max(...reads.map(read => read.limit))).toBeLessThanOrEqual(MAX_LIST_LIMIT);
        // Each page reads only itself: no row is read twice on the way down.
        const rowsRead = reads.reduce((sum, read) => sum + read.limit, 0);
        expect(rowsRead).toBeLessThanOrEqual(1200 + 50);
        for (const read of reads.slice(1)) {
            expect(read.limit).toBe(50);
        }
    });

    it("keeps every held row live: a write past the first page reaches the screen", async () => {
        mockRows = rowsOf(120);
        let push: ((response: { data: Row[] }) => void) | undefined;
        mockAccessor.listen = mockListen;
        mockListen.mockImplementation((params: { limit?: number; offset?: number }, onUpdate: (response: { data: Row[] }) => void) => {
            push = onUpdate;
            onUpdate(serve(params));
            return () => undefined;
        });
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection }));
        await waitFor(() => expect(result.current.data).toHaveLength(50));
        // The subscription is the first page only.
        expect(mockListen.mock.calls[0][0].limit).toBe(50);

        act(() => result.current.setItemCount!(100));
        await waitFor(() => expect(result.current.data).toHaveLength(100));

        // Someone renames row 80 — far past the subscribed page. The server
        // re-runs the subscription on every write, so its push is the signal.
        mockRows = mockRows.map(row => row.id === "c80" ? { ...row, values: { name: "renamed" } } : row);
        await act(async () => push!(serve({ limit: 50 })));

        await waitFor(() => expect(result.current.data.find(row => row.id === "c80")?.values.name).toBe("renamed"));
        expect(result.current.data).toHaveLength(100);
        const reads = mockFind.mock.calls.map(([params]) => params as { limit: number });
        expect(Math.max(...reads.map(read => read.limit))).toBeLessThanOrEqual(MAX_LIST_LIMIT);
    });

    it("loads every row when pagination is off, in reads the server serves", async () => {
        mockRows = rowsOf(2300);
        const { result } = renderHook(() => useDataTableController({
            path: "customers",
            collection: { ...collection, pagination: false }
        }));

        await waitFor(() => expect(result.current.noMoreToLoad).toBe(true));
        expect(result.current.dataLoadingError).toBeUndefined();
        expect(result.current.data).toHaveLength(2300);
        const reads = mockFind.mock.calls.map(([params]) => params as { limit?: number });
        for (const read of reads) {
            expect(read.limit).toBeDefined();
            expect(read.limit!).toBeLessThanOrEqual(MAX_LIST_LIMIT);
        }
    });
});
