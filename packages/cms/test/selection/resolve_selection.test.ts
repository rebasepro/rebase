import { describe, expect, test } from "@jest/globals";
import { Entity, FindParams, FindResponse, resolveClientListLimit } from "@rebasepro/types";
import { EntitySelection } from "@rebasepro/cms-types";
import {
    MAX_SELECTION_ROWS,
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

describe("resolveSelection", () => {

    test("an entities selection is already resolved and never reads", async () => {
        const { accessor, calls } = makeAccessor(1000);
        const selection: EntitySelection<any> = {
            type: "entities",
            entities: [entity("row-1"), entity("row-2")]
        };

        const rows = await resolveSelection({ selection, accessor });

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

        const rows = await resolveSelection({ selection, accessor });

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

        const rows = await resolveSelection({ selection, accessor });

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

        const rows = await resolveSelection({ selection, accessor });

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

        await expect(resolveSelection({ selection, accessor })).rejects.toThrow(/more than/);
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

        await expect(resolveSelection({ selection, accessor, maxRows: 20 })).rejects.toThrow(/more than/);
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

        const rows = await resolveSelection({
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
