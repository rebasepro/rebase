import { describe, expect, test } from "@jest/globals";
import { CollectionConfig, Entity, FindParams, FindResponse, RebaseSdkData, resolveClientListLimit } from "@rebasepro/types";
import type { EntitySelection, RowSelection } from "@rebasepro/cms-types";
import {
    MAX_SELECTION_ROWS,
    resolveEntitySelection,
    resolveSelection,
    selectionQueryToFindParams,
    serializeSelectionQuery
} from "../../src/selection/resolve_selection";

function makeAccessor(rowCount: number) {
    const calls: FindParams<any>[] = [];
    const rows: Entity<any>[] = Array.from({ length: rowCount }, (_, i) => ({
        id: `row-${i}`,
        path: "orders",
        values: { index: i }
    }));

    return {
        calls,
        accessor: {
            async find(params?: FindParams<any>): Promise<FindResponse<any>> {
                calls.push(params ?? {});
                const limit = resolveClientListLimit(params?.limit);
                const offset = params?.offset ?? 0;
                const data = rows.slice(offset, offset + limit);
                return {
                    data,
                    meta: {
                        total: rowCount,
                        limit,
                        offset,
                        hasMore: offset + data.length < rowCount
                    }
                };
            }
        }
    };
}

function entity(id: string, path = "orders"): Entity<any> {
    return { id, path, values: {} };
}

describe("resolveEntitySelection", () => {

    test("an entities selection is already resolved and never reads", async () => {
        const { accessor, calls } = makeAccessor(1000);
        const selection: EntitySelection<any> = {
            type: "entities",
            entities: [entity("row-1"), entity("row-2")]
        };

        const rows = await resolveEntitySelection({ selection, accessor });

        expect(rows.map(r => r.id)).toEqual(["row-1", "row-2"]);
        expect(calls).toHaveLength(0);
    });

    /**
     * The failure this whole model exists to prevent. The array it replaced
     * held only what the view had scrolled, so a bulk action over "all 1,200
     * matching" acted on the first page and reported success.
     */
    test("a query selection reads every matching row, not the first page", async () => {
        const { accessor } = makeAccessor(1200);
        const selection: EntitySelection<any> = {
            type: "query",
            query: { path: "orders" },
            excluded: [],
            count: 1200
        };

        const rows = await resolveEntitySelection({ selection, accessor });

        expect(rows).toHaveLength(1200);
        expect(rows[0].id).toBe("row-0");
        expect(rows[1199].id).toBe("row-1199");
    });

    test("unticked rows are dropped from a query selection", async () => {
        const { accessor } = makeAccessor(10);
        const selection: EntitySelection<any> = {
            type: "query",
            query: { path: "orders" },
            excluded: [entity("row-3"), entity("row-7")],
            count: 10
        };

        const rows = await resolveEntitySelection({ selection, accessor });

        expect(rows).toHaveLength(8);
        expect(rows.map(r => r.id)).not.toContain("row-3");
        expect(rows.map(r => r.id)).not.toContain("row-7");
    });

    /** Same id at a different path is a different row — junction-backed tabs. */
    test("an exclusion is matched on path as well as id", async () => {
        const { accessor } = makeAccessor(3);
        const selection: EntitySelection<any> = {
            type: "query",
            query: { path: "orders" },
            excluded: [entity("row-1", "other_orders")],
            count: 3
        };

        const rows = await resolveEntitySelection({ selection, accessor });

        expect(rows.map(r => r.id)).toEqual(["row-0", "row-1", "row-2"]);
    });

    test("refuses before walking when the count is already over the ceiling", async () => {
        const { accessor, calls } = makeAccessor(10);
        const selection: EntitySelection<any> = {
            type: "query",
            query: { path: "orders" },
            excluded: [],
            count: MAX_SELECTION_ROWS + 1
        };

        await expect(resolveEntitySelection({ selection, accessor })).rejects.toThrow(/more than/);
        expect(calls).toHaveLength(0);
    });

    /**
     * A count is a forecast taken when the selection was made; rows can arrive
     * after it. Truncating there would produce a prefix that is
     * indistinguishable from a complete answer.
     */
    test("refuses mid-walk when the rows outrun a count that looked safe", async () => {
        const { accessor } = makeAccessor(50);
        const selection: EntitySelection<any> = {
            type: "query",
            query: { path: "orders" },
            excluded: [],
            count: 5
        };

        await expect(resolveEntitySelection({ selection, accessor, maxRows: 20 })).rejects.toThrow(/more than/);
    });

    test("aborting between pages returns what was read rather than spinning on", async () => {
        const { accessor, calls } = makeAccessor(2000);
        const signal = { aborted: false };
        const selection: EntitySelection<any> = {
            type: "query",
            query: { path: "orders" },
            excluded: [],
            count: 2000
        };

        const rows = await resolveEntitySelection({
            selection,
            accessor,
            pageSize: 100,
            signal,
            onProgress: (loaded) => {
                if (loaded >= 300) signal.aborted = true;
            }
        });

        expect(rows).toHaveLength(300);
        expect(calls).toHaveLength(3);
    });
});

describe("selectionQueryToFindParams", () => {

    test("an empty filter is omitted rather than sent as {}", () => {
        expect(selectionQueryToFindParams({ path: "orders", filterValues: {} }).where).toBeUndefined();
        expect(selectionQueryToFindParams({ path: "orders", sortBy: [] }).orderBy).toBeUndefined();
    });

    test("carries the filter, search and sort the selection was made against", () => {
        const params = selectionQueryToFindParams({
            path: "orders",
            filterValues: { status: ["==", "open"] } as any,
            searchString: "acme",
            sortBy: [["created_at", "desc"]]
        });

        expect(params.where).toEqual({ status: ["==", "open"] });
        expect(params.searchString).toBe("acme");
        expect(params.orderBy).toEqual([["created_at", "desc"]]);
    });
});

describe("serializeSelectionQuery", () => {

    /**
     * `filterValues` is rebuilt on most renders and its key order follows
     * whatever order the columns were touched in. Keyed on insertion order, the
     * view would report the same filter as a different one and drop the
     * selection on the next render.
     */
    test("the same filter in a different key order is the same query", () => {
        const a = serializeSelectionQuery({
            path: "orders",
            filterValues: { status: ["==", "open"], total: [">", 10] } as any
        });
        const b = serializeSelectionQuery({
            path: "orders",
            filterValues: { total: [">", 10], status: ["==", "open"] } as any
        });

        expect(a).toBe(b);
    });

    test("a changed filter, search or sort is a different query", () => {
        const base = { path: "orders", filterValues: { status: ["==", "open"] } as any };

        expect(serializeSelectionQuery(base))
            .not.toBe(serializeSelectionQuery({ ...base, searchString: "acme" }));
        expect(serializeSelectionQuery(base))
            .not.toBe(serializeSelectionQuery({ ...base, filterValues: { status: ["==", "closed"] } as any }));
        expect(serializeSelectionQuery(base))
            .not.toBe(serializeSelectionQuery({ ...base, sortBy: [["created_at", "desc"]] }));
    });
});

describe("resolveSelection over context.data", () => {
    const orders = {
        slug: "orders",
        name: "Orders",
        properties: { id: { type: "string", name: "Id", isId: true }, placed: { type: "date", name: "Placed" } }
    } as unknown as CollectionConfig;
    const PLACED = "2026-11-08T09:30:00.000Z";

    function flatData(rowCount: number) {
        const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `row-${i}`, placed: PLACED }));
        return {
            collection: () => ({
                find: async (params?: FindParams<any>) => {
                    const limit = resolveClientListLimit(params?.limit);
                    const offset = params?.offset ?? 0;
                    const data = rows.slice(offset, offset + limit);
                    return { data, meta: { total: rowCount, limit, offset, hasMore: offset + data.length < rowCount } };
                }
            })
        } as unknown as Pick<RebaseSdkData, "collection">;
    }

    test("hands back ticked rows as they are, reading nothing", async () => {
        const row = { id: "row-1", placed: PLACED };
        const selection: RowSelection = { type: "rows", ids: ["row-1"], rows: [row] };
        const progress: number[] = [];
        const rows = await resolveSelection({
            selection,
            data: flatData(0),
            collection: orders,
            onProgress: (loaded) => progress.push(loaded)
        });
        expect(rows).toEqual([row]);
        expect(progress).toEqual([1]);
    });

    test("reads a query selection's rows, leaving out the ids ticked off", async () => {
        const selection: RowSelection = {
            type: "query",
            query: { path: "orders" },
            excludedIds: ["row-1"]
        };
        const rows = await resolveSelection({ selection, data: flatData(3), collection: orders });
        expect(rows).toEqual([{ id: "row-0", placed: PLACED }, { id: "row-2", placed: PLACED }]);
    });

    test("reads a query selection's rows with the relations the view loads, so both modes hand one shape", async () => {
        const customers = {
            slug: "customers",
            name: "Customers",
            properties: { id: { type: "string", name: "Id", isId: true }, name: { type: "string", name: "Name" } }
        } as unknown as CollectionConfig;
        const withCustomer = {
            ...orders,
            properties: {
                ...orders.properties,
                customer: { type: "relation", name: "Customer", relation: { kind: "belongsTo", target: () => customers, localKey: "customer_id" } }
            }
        } as unknown as CollectionConfig;
        const asked: FindParams<any>[] = [];
        const row = { id: "row-0", placed: PLACED, customerId: "c1", customer: { id: "c1", name: "Ada" } };
        const data = {
            collection: () => ({
                find: async (params: FindParams<any>) => {
                    asked.push(params);
                    // As REST answers: the relation nested only where it was included.
                    const included = Array.isArray(params.include) && params.include.includes("customer");
                    const served = included ? row : { id: row.id, placed: PLACED, customerId: "c1" };
                    return { data: [served], meta: { total: 1, limit: 500, offset: 0, hasMore: false } };
                }
            })
        } as unknown as Pick<RebaseSdkData, "collection">;

        const fromQuery = await resolveSelection({
            selection: { type: "query", query: { path: "orders" }, excludedIds: [] },
            data,
            collection: withCustomer
        });
        const fromRows = await resolveSelection({
            selection: { type: "rows", ids: ["row-0"], rows: [row] },
            data,
            collection: withCustomer
        });
        expect(asked[0].include).toEqual(["customer"]);
        expect(fromQuery).toEqual(fromRows);
    });

    test("leaves out ticked-off ids however they are spelt", async () => {
        const numbered = {
            slug: "orders",
            name: "Orders",
            properties: { id: { type: "number", name: "Id", isId: true } }
        } as unknown as CollectionConfig;
        const data = {
            collection: () => ({
                find: async () => ({ data: [{ id: 5 }, { id: 7 }], meta: { total: 2, limit: 500, offset: 0, hasMore: false } })
            })
        } as unknown as Pick<RebaseSdkData, "collection">;
        const rows = await resolveSelection({
            selection: { type: "query", query: { path: "orders" }, excludedIds: ["5"] },
            data,
            collection: numbered
        });
        expect(rows).toEqual([{ id: 7 }]);
    });

    test("refuses before reading when the count is over the ceiling", async () => {
        const selection: RowSelection = {
            type: "query",
            query: { path: "orders" },
            excludedIds: ["row-1"],
            count: MAX_SELECTION_ROWS + 2
        };
        await expect(resolveSelection({ selection, data: flatData(3), collection: orders }))
            .rejects.toThrow(/more than/);
    });
});
