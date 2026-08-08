import { describe, expect, test } from "@jest/globals";
import { Entity, FindParams, FindResponse, resolveClientListLimit } from "@rebasepro/types";
import { fetchAllEntitiesForExport, MAX_EXPORT_ROWS } from "../../src/data_export/export/fetch_export_data";

/**
 * A collection accessor that answers the way the REST ingress does.
 *
 * The point of the fixture is the clamp: an absent `limit` resolves to
 * `DEFAULT_LIST_LIMIT` (50) and a supplied one is clamped to `MAX_LIST_LIMIT`
 * without an error or a header — so a walk that trusts the page size it asked
 * for, or that never asks for one, silently reads the first page and stops.
 */
function makeAccessor(rowCount: number, options: { reportMeta?: boolean, maxLimit?: number } = {}) {
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
                const limit = resolveClientListLimit(params?.limit, { maxLimit: options.maxLimit });
                const offset = params?.offset ?? 0;
                const data = rows.slice(offset, offset + limit);
                return {
                    data,
                    meta: options.reportMeta === false
                        ? (undefined as never)
                        : {
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

describe("fetchAllEntitiesForExport", () => {

    test("reads every row of a collection larger than the default page", async () => {
        const { accessor } = makeAccessor(1234);

        const result = await fetchAllEntitiesForExport({ accessor });

        expect(result).toHaveLength(1234);
        expect(result[0].id).toEqual("row-0");
        expect(result[1233].id).toEqual("row-1233");
    });

    test("never sends a request without an explicit limit", async () => {
        const { accessor, calls } = makeAccessor(120);

        await fetchAllEntitiesForExport({ accessor });

        expect(calls.length).toBeGreaterThan(0);
        // An absent limit is resolved server-side to 50 rows, so the walk would
        // hand back a page and call it the collection.
        calls.forEach(call => expect(typeof call.limit).toEqual("number"));
    });

    test("advances by the rows received, not by the page size it asked for", async () => {
        // A server whose ceiling is below the requested page size clamps in
        // silence; advancing by the request would skip everything it clamped.
        const { accessor } = makeAccessor(750, { maxLimit: 100 });

        const result = await fetchAllEntitiesForExport({ accessor });

        expect(result).toHaveLength(750);
        expect(new Set(result.map(r => r.id)).size).toEqual(750);
    });

    test("stops on an empty page when the response carries no metadata", async () => {
        const { accessor } = makeAccessor(120, { reportMeta: false });

        const result = await fetchAllEntitiesForExport({ accessor });

        expect(result).toHaveLength(120);
    });

    test("reports progress with the total the server gives", async () => {
        const { accessor } = makeAccessor(1100);
        const progress: Array<[number, number | undefined]> = [];

        await fetchAllEntitiesForExport({
            accessor,
            onProgress: (loaded, total) => progress.push([loaded, total])
        });

        expect(progress[0]).toEqual([500, 1100]);
        expect(progress[progress.length - 1]).toEqual([1100, 1100]);
    });

    test("refuses rather than returning a truncated export", async () => {
        const { accessor } = makeAccessor(2500);

        await expect(fetchAllEntitiesForExport({
            accessor,
            maxRows: 1000
        })).rejects.toThrow(/more than 1,000 rows/);
    });

    test("the declared ceiling is the one the dialog can state", () => {
        expect(MAX_EXPORT_ROWS).toBeGreaterThan(0);
    });
});
