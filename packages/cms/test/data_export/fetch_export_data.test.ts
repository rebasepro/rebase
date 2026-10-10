import { describe, expect, test } from "@jest/globals";
import { Entity, FindParams, FindResponse, resolveClientListLimit } from "@rebasepro/types";
import { fetchAllEntitiesForExport, MAX_EXPORT_ROWS } from "../../src/data_export/export/fetch_export_data";

/**
 * A collection accessor that answers the way the REST ingress does.
 *
 * The point of the fixture is what an absent `limit` costs: it resolves to
 * `DEFAULT_LIST_LIMIT` (50), so a walk that never asks for a page size reads
 * the first page and calls it the collection.
 *
 * `maxLimit` models the *other* half — a backend that hands back fewer rows
 * than it was asked for. Rebase itself no longer does that (an over-large
 * `limit` is refused outright rather than shrunk), which is why the clamp here
 * is written out rather than borrowed from `resolveClientListLimit`: the walk
 * still must not assume the page it asked for is the page it got, because an
 * older or third-party backend with a lower ceiling will do exactly this.
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
                const asked = resolveClientListLimit(params?.limit);
                const limit = options.maxLimit ? Math.min(asked, options.maxLimit) : asked;
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

        expect(progress[0]).toEqual([1000, 1100]);
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

    describe("seeking with the server's cursor", () => {

        /**
         * Like the REST listing: `meta.nextCursor` whenever another page
         * follows, `after` continues strictly after it, and `after` with
         * `offset` is refused (`CURSOR_WITH_OFFSET`).
         */
        function makeSeekingAccessor(rowCount: number, options: { cursor?: "always" | "never" | "stalls" } = {}) {
            const calls: FindParams<any>[] = [];
            const mode = options.cursor ?? "always";
            return {
                calls,
                accessor: {
                    async find(params?: FindParams<any>): Promise<FindResponse<any> & { meta: { nextCursor?: string } }> {
                        calls.push(params ?? {});
                        if (params?.after !== undefined && params?.offset !== undefined) {
                            throw new Error("CURSOR_WITH_OFFSET");
                        }
                        const limit = resolveClientListLimit(params?.limit);
                        const start = params?.after !== undefined ? Number(params.after.slice(1)) : (params?.offset ?? 0);
                        const end = Math.min(start + limit, rowCount);
                        const data = Array.from({ length: end - start }, (_, i) => ({
                            id: `row-${start + i}`,
                            path: "orders",
                            values: { index: start + i }
                        }));
                        const hasMore = end < rowCount;
                        const nextCursor = !hasMore || mode === "never" ? undefined
                            : mode === "stalls" && params?.after ? params.after
                                : `c${end}`;
                        return {
                            data,
                            meta: { total: rowCount, limit, offset: start, hasMore, ...(nextCursor ? { nextCursor } : {}) }
                        };
                    }
                }
            };
        }

        test("a 100,000-row export reads 100 pages, each after the first by cursor", async () => {
            const { accessor, calls } = makeSeekingAccessor(100_000);

            const result = await fetchAllEntitiesForExport({ accessor });

            expect(result).toHaveLength(100_000);
            expect(new Set(result.map(r => r.id)).size).toEqual(100_000);
            expect(calls).toHaveLength(100);
            expect(calls[0].offset).toEqual(0);
            expect(calls[0].after).toBeUndefined();
            calls.slice(1).forEach((call, i) => {
                expect(call.after).toEqual(`c${(i + 1) * 1000}`);
                expect(call.offset).toBeUndefined();
            });
        });

        test("pages by offset where the server issues no cursor", async () => {
            const { accessor, calls } = makeSeekingAccessor(2_500, { cursor: "never" });

            const result = await fetchAllEntitiesForExport({ accessor });

            expect(result).toHaveLength(2_500);
            expect(calls.map(c => c.offset)).toEqual([0, 1000, 2000]);
            calls.forEach(call => expect(call.after).toBeUndefined());
        });

        test("falls back to offset from where it got to when a cursor stops advancing", async () => {
            const { accessor, calls } = makeSeekingAccessor(3_500, { cursor: "stalls" });

            const result = await fetchAllEntitiesForExport({ accessor });

            expect(result).toHaveLength(3_500);
            expect(new Set(result.map(r => r.id)).size).toEqual(3_500);
            calls.forEach(call => expect(call.after !== undefined && call.offset !== undefined).toBe(false));
        });
    });
});
