/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { resolveClientListLimit } from "@rebasepro/types";

/**
 * `pagination: false` loads every row, as the docs promise — and said nothing
 * when "every row" grew to tens of thousands, held in memory and re-rendered
 * on every change. In development the controller now warns, once per
 * collection, when it holds more than 10,000 rows with pagination off. A
 * production build stays silent.
 */

const mockLocation = { pathname: "/c/events", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

type Row = { id: string; path: string; values: { name: string } };
let mockRows: Row[] = [];
const mockFind = jest.fn();
const mockAccessor = { find: mockFind };
const mockData = { collection: () => mockAccessor };
const mockContext = {};
jest.mock("../../src/hooks", () => ({
    useData: () => mockData,
    useRebaseContext: () => mockContext
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataTableController } from "../../src/components/common/useDataTableController";

function collectionNamed(slug: string, pagination: boolean | number = false) {
    return { slug, name: slug, table: slug, pagination, properties: { name: { type: "string" } } } as any;
}

function rowsOf(n: number): Row[] {
    return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, path: "events", values: { name: `n${i}` } }));
}

jest.setTimeout(60_000);

describe("useDataTableController — a large collection with pagination off", () => {
    const originalEnv = process.env.NODE_ENV;
    let warn: jest.SpyInstance;

    beforeEach(() => {
        mockFind.mockReset();
        mockFind.mockImplementation((params: { limit?: number; offset?: number }) => {
            const limit = resolveClientListLimit(params.limit);
            const offset = params.offset ?? 0;
            return Promise.resolve({
                data: mockRows.slice(offset, offset + limit),
                meta: { total: mockRows.length, limit, offset, hasMore: offset + limit < mockRows.length }
            });
        });
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
        process.env.NODE_ENV = originalEnv;
    });

    const unpaginatedWarnings = () => warn.mock.calls.filter(([message]) => String(message).includes("pagination: false"));

    it("warns once in development when it holds 10,001 rows", async () => {
        mockRows = rowsOf(10_001);
        const collection = collectionNamed("events");
        const first = renderHook(() => useDataTableController({ path: "events", collection }));
        await waitFor(() => expect(first.result.current.data).toHaveLength(10_001), { timeout: 30_000 });
        expect(unpaginatedWarnings()).toHaveLength(1);
        expect(String(unpaginatedWarnings()[0][0])).toContain("events");

        // The same collection opened again does not repeat it.
        first.unmount();
        const second = renderHook(() => useDataTableController({ path: "events", collection }));
        await waitFor(() => expect(second.result.current.data).toHaveLength(10_001), { timeout: 30_000 });
        expect(unpaginatedWarnings()).toHaveLength(1);
    });

    it("says nothing at 10,000 rows, or with pagination on", async () => {
        mockRows = rowsOf(10_000);
        const { result } = renderHook(() => useDataTableController({ path: "logs", collection: collectionNamed("logs") }));
        await waitFor(() => expect(result.current.data).toHaveLength(10_000), { timeout: 30_000 });
        expect(unpaginatedWarnings()).toHaveLength(0);
    });

    it("says nothing in a production build", async () => {
        process.env.NODE_ENV = "production";
        mockRows = rowsOf(10_001);
        const { result } = renderHook(() => useDataTableController({ path: "audit", collection: collectionNamed("audit") }));
        await waitFor(() => expect(result.current.data).toHaveLength(10_001), { timeout: 30_000 });
        expect(unpaginatedWarnings()).toHaveLength(0);
    });
});
