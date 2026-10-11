/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { resolveClientListLimit } from "@rebasepro/types";

/**
 * The controller between a view and its window: the view says which rows it
 * draws, and gets those kept current; leaving a scrolled view keeps the rows
 * around what it showed, and coming back shows them where they were and reads
 * those, not every row the view had held.
 *
 * Coming back to a table scrolled to 10,000 rows used to read the first page
 * and then all 9,950 rows past it (ten 1,000-row reads) before showing any,
 * and the scroll cache had kept every one of them meanwhile.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

type Row = { id: string; path: string; values: { name: string } };
let mockRows: Row[] = [];
const mockReads: { limit: number; offset: number }[] = [];
let mockPush: (() => void) | undefined;
const mockAccessor = {
    find: (params: { limit?: number; offset?: number }) => {
        const limit = resolveClientListLimit(params.limit);
        const offset = params.offset ?? 0;
        mockReads.push({ limit, offset });
        return Promise.resolve({ data: mockRows.slice(offset, offset + limit), meta: { total: mockRows.length, limit, offset, hasMore: true } });
    },
    listen: (params: { limit?: number }, onUpdate: (response: unknown) => void) => {
        mockPush = () => onUpdate({ data: mockRows.slice(0, params.limit), meta: { total: mockRows.length, limit: params.limit, offset: 0, hasMore: true } });
        return () => {
            mockPush = undefined;
        };
    }
};
const mockData = { collection: () => mockAccessor };
jest.mock("../../src/hooks", () => ({
    useData: () => mockData,
    useRebaseContext: () => ({})
}));

import { useDataTableController } from "../../src/components/common/useDataTableController";
import { clearCollectionScrollCache, useScrollRestoration } from "../../src/components/common/useScrollRestoration";

const collection = { slug: "customers", name: "Customers", table: "customers", properties: { name: { type: "string" } } } as never;

function rowsOf(n: number): Row[] {
    return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, path: "customers", values: { name: `n${i}` } }));
}

const flush = () => act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
});

// eslint-disable-next-line react-hooks/rules-of-hooks -- holds no state
const scrollRestoration = useScrollRestoration();

/** A table scrolled to `held` rows, with rows `[start, end)` on screen. */
async function scrolledTable(held: number, start: number, end: number) {
    const hook = renderHook(() => useDataTableController({ path: "customers", collection, scrollRestoration }));
    act(() => mockPush!());
    act(() => hook.result.current.setItemCount!(held));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(held));
    act(() => hook.result.current.onRowsRendered!({ start, end }));
    await flush();
    return hook;
}

describe("useDataTableController — the rows a view draws", () => {

    beforeEach(() => {
        mockRows = rowsOf(20_000);
        mockReads.length = 0;
        clearCollectionScrollCache();
    });

    it("re-reads the rows on screen per push, not every row held", async () => {
        await scrolledTable(10_000, 9_000, 9_020);
        mockReads.length = 0;
        mockRows = mockRows.map(row => ({ ...row, values: { name: `${row.values.name}!` } }));
        act(() => mockPush!());
        await flush();
        expect(mockReads).toEqual([{ limit: 120, offset: 8_950 }]);
    });

    it("keeps the rows around the screen for the way back, and reads only those on return", async () => {
        const first = await scrolledTable(10_000, 9_000, 9_020);
        act(() => first.result.current.onScroll!({ scrollDirection: "forward", scrollOffset: 9_000 * 54, scrollUpdateWasRequested: false }));
        const saved = scrollRestoration.getCollectionScroll("customers")!;
        expect(saved.dataOffset).toBe(8_950);
        expect(saved.data).toHaveLength(120);
        first.unmount();

        mockReads.length = 0;
        const back = renderHook(() => useDataTableController({ path: "customers", collection, scrollRestoration }));
        // Before anything is read, the kept rows are where they were.
        expect(back.result.current.sparseData).toHaveLength(9_070);
        expect(back.result.current.sparseData![9_000]?.id).toBe("c9000");
        expect(back.result.current.sparseData![100]).toBeUndefined();
        expect(back.result.current.data).toHaveLength(0);
        expect(back.result.current.initialScroll).toBe(9_000 * 54);

        // The view draws them, and says so.
        act(() => back.result.current.onRowsRendered!({ start: 9_000, end: 9_020 }));
        act(() => mockPush!());
        await flush();

        // The first page and the kept rows; none of the 8,900 above them.
        expect(mockReads).toEqual([{ limit: 120, offset: 8_950 }]);
        expect(back.result.current.sparseData![9_010]?.id).toBe("c9010");
        expect(back.result.current.data).toHaveLength(50 + 120);
    });
});
