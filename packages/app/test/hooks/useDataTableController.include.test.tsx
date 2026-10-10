/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { resolveCollectionRelations } from "@rebasepro/common";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * What a collection view's reads ask the server to embed.
 *
 * The table, list, card and board views used to send `include: ["*"]` as soon
 * as the collection had one relation property. The server reads `*` as "every
 * relation the collection declares", and that includes the ones declared only
 * in `relations: []` for a record's tabs — relations no property names, which
 * no list cell can render. A `companies` table with one `owner` column and a
 * `hasMany activities` tab embedded every activity of every company on the
 * page: 50 rows × 2,000 activities per read, again for every scrolled page and
 * every realtime re-read.
 *
 * A read now names the relations a property declares, and nothing else: the
 * rows each property renders are byte-for-byte what they were.
 */

const mockLocation = { pathname: "/c/orders", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

type Row = { id: string; path: string; values: Record<string, unknown> };
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

const customers: AdminCollection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: { name: { type: "string" } }
};
const orderItems: AdminCollection = {
    slug: "order_items",
    name: "Order items",
    table: "order_items",
    properties: { quantity: { type: "number" } }
};
const shipments: AdminCollection = {
    slug: "shipments",
    name: "Shipments",
    table: "shipments",
    properties: { carrier: { type: "string" } }
};

// One relation column, two relations declared for the record's tabs only —
// the shape of the demo `orders` collection.
const orders: AdminCollection = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        reference: { type: "string" },
        customer: {
            type: "relation",
            relation: { kind: "belongsTo", target: () => customers }
        }
    },
    relations: [
        { kind: "hasMany", relationName: "order_items", target: () => orderItems },
        { kind: "hasMany", relationName: "shipments", target: () => shipments }
    ]
};

function rowsOf(n: number): Row[] {
    return Array.from({ length: n }, (_, i) => ({ id: `o${i}`, path: "orders", values: { reference: `R${i}` } }));
}

describe("useDataTableController — what a read embeds", () => {

    beforeEach(() => {
        mockFind.mockReset();
        mockListen.mockReset();
    });

    it("names the one relation a property declares, not the three the collection declares", async () => {
        // Three relations are declared…
        expect(Object.keys(resolveCollectionRelations(orders)).sort()).toEqual(["customer", "order_items", "shipments"]);

        const rows = rowsOf(80);
        mockListen.mockImplementation((params: { limit: number }, onUpdate: (response: { data: Row[] }) => void) => {
            onUpdate({ data: rows.slice(0, params.limit) });
            return () => undefined;
        });
        mockFind.mockImplementation((params: { limit: number; offset?: number }) =>
            Promise.resolve({ data: rows.slice(params.offset ?? 0, (params.offset ?? 0) + params.limit) }));

        const { result } = renderHook(() => useDataTableController({ path: "orders", collection: orders }));
        await waitFor(() => expect(result.current.data).toHaveLength(50));

        // …the first page, live, asks for the one a cell renders.
        expect(mockListen).toHaveBeenCalledTimes(1);
        expect(mockListen.mock.calls[0][0].include).toEqual(["customer"]);

        // And so does every page read past it.
        act(() => result.current.setItemCount!(100));
        await waitFor(() => expect(result.current.data).toHaveLength(80));
        expect(mockFind).toHaveBeenCalled();
        for (const [params] of mockFind.mock.calls) {
            expect(params.include).toEqual(["customer"]);
        }
    });

    it("asks for no relations when no property declares one", async () => {
        const tabsOnly: AdminCollection = {
            slug: "customers",
            name: "Customers",
            table: "customers",
            properties: { name: { type: "string" } },
            relations: [{ kind: "hasMany", relationName: "orders", target: () => orders }]
        };
        mockListen.mockImplementation((_params: unknown, onUpdate: (response: { data: Row[] }) => void) => {
            onUpdate({ data: [] });
            return () => undefined;
        });
        const { result } = renderHook(() => useDataTableController({ path: "customers", collection: tabsOnly }));
        await waitFor(() => expect(result.current.dataLoading).toBe(false));
        expect(mockListen.mock.calls[0][0].include).toBeUndefined();
    });
});
