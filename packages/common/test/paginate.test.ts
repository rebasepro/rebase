import { buildSdkData } from "../src/data/buildRebaseData";
import { RebasePaginationError } from "../src/data/paginate";
import { DataDriver, FetchCollectionProps, RebaseSdkData, SDKCollectionClient } from "@rebasepro/types";

/**
 * `iterate()` / `findAll()` on the **in-process** accessor — `rebase.data.*`
 * and `context.data.*`.
 *
 * The HTTP client has the same helpers, backed by the same engine. If one of
 * these behaviours held on one transport and not the other, the SDK contract
 * would be a lie the type system cannot catch, so the same cases are asserted
 * on both sides.
 */

interface Row extends Record<string, unknown> {
    id: number;
}

/**
 * `RebaseSdkData`'s dynamic index signature is a union of a collection accessor
 * and the `collection()` method that shares the namespace with it, so tsc
 * cannot narrow a bare `data.jobs` on its own. A project generates a `Database`
 * type and gets the narrowing for free; a test does it here.
 */
function jobsOf(data: RebaseSdkData): SDKCollectionClient<Row> {
    return data.jobs as SDKCollectionClient<Row>;
}

function rows(from: number, count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({ id: from + i }));
}

/**
 * A driver serving `total` rows, honouring `limit`/`offset` the way a real one
 * does. `count` is what makes the accessor compute a truthful `hasMore`.
 */
function createPagedDriver(total: number, calls: FetchCollectionProps[] = []): DataDriver {
    return {
        fetchCollection: jest.fn(async (props: FetchCollectionProps) => {
            calls.push(props);
            const offset = props.offset ?? 0;
            const limit = props.limit ?? 20;
            return rows(1, total).slice(offset, offset + limit);
        }),
        fetchOne: jest.fn().mockResolvedValue(undefined),
        save: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(total)
    } as unknown as DataDriver;
}

describe("in-process accessor pagination", () => {
    it("exposes iterate() and findAll() on the flat SDK data layer", () => {
        const data = buildSdkData(createPagedDriver(0));
        expect(typeof jobsOf(data).iterate).toBe("function");
        expect(typeof jobsOf(data).findAll).toBe("function");
    });

    it("yields every row across pages exactly once", async () => {
        const data = buildSdkData(createPagedDriver(7));

        const seen: number[] = [];
        for await (const row of jobsOf(data).iterate({ pageSize: 3 })) {
            seen.push(row.id as number);
        }

        expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("does not stop early when the last page is exactly full", async () => {
        // 6 rows at a page size of 3: the final page is full, and `hasMore` is
        // the only thing that says it is the last one.
        const data = buildSdkData(createPagedDriver(6));

        const seen: number[] = [];
        for await (const row of jobsOf(data).iterate({ pageSize: 3 })) {
            seen.push(row.id as number);
        }

        expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("requests the configured pageSize and walks the offset", async () => {
        const calls: FetchCollectionProps[] = [];
        const data = buildSdkData(createPagedDriver(5, calls));

        for await (const _row of jobsOf(data).iterate({ pageSize: 2 })) { /* drain */ }

        expect(calls.map((c) => [c.limit, c.offset])).toEqual([[2, 0], [2, 2], [2, 4]]);
    });

    it("terminates on an empty page even when the driver claims there is more", async () => {
        // `count` lies about the total, so `hasMore` never goes false; the
        // empty page has to be what stops the walk.
        const driver = {
            fetchCollection: jest.fn(async (props: FetchCollectionProps) => {
                const offset = props.offset ?? 0;
                return offset === 0 ? rows(1, 2) : [];
            }),
            fetchOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            count: jest.fn().mockResolvedValue(1_000_000)
        } as unknown as DataDriver;

        const seen: number[] = [];
        for await (const row of jobsOf(buildSdkData(driver)).iterate({ pageSize: 2 })) {
            seen.push(row.id as number);
        }

        expect(seen).toEqual([1, 2]);
    });

    it("gives up loudly on a driver that never reaches the end", async () => {
        const driver = {
            fetchCollection: jest.fn(async () => rows(1, 2)),
            fetchOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            count: jest.fn().mockResolvedValue(1_000_000)
        } as unknown as DataDriver;

        await expect((async () => {
            for await (const _row of jobsOf(buildSdkData(driver)).iterate({ pageSize: 2, maxPages: 3 })) {
                // drain
            }
        })()).rejects.toThrow(RebasePaginationError);
        expect(driver.fetchCollection).toHaveBeenCalledTimes(3);
    });

    it("findAll collects every page", async () => {
        const data = buildSdkData(createPagedDriver(5));
        const all = await jobsOf(data).findAll({ pageSize: 2 });
        expect(all.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it("findAll throws rather than truncating when the cap is hit", async () => {
        const data = buildSdkData(createPagedDriver(50));
        await expect(jobsOf(data).findAll({ pageSize: 10, maxRows: 20 }))
            .rejects.toMatchObject({ code: "max-rows" });
    });

    it("findAll returns flat rows, not Entity wrappers", async () => {
        const data = buildSdkData(createPagedDriver(2));
        const all = await jobsOf(data).findAll({ pageSize: 2 });
        expect(all[0].id).toBe(1);
        expect((all[0] as Record<string, unknown>).values).toBeUndefined();
    });

    it("cursor mode seeks with a where clause instead of an offset", async () => {
        const calls: FetchCollectionProps[] = [];
        const TOTAL = 3;
        /** Rows strictly after the cursor the caller sent, if any. */
        const remaining = (filter: unknown): Row[] => {
            const seek = (filter as Record<string, [string, number]> | undefined)?.id;
            const after = seek ? seek[1] : 0;
            return rows(1, TOTAL).filter((r) => r.id > after);
        };
        const driver = {
            fetchCollection: jest.fn(async (props: FetchCollectionProps) => {
                calls.push(props);
                return remaining(props.filter).slice(0, props.limit ?? 20);
            }),
            fetchOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            // A real count applies the same filter, so once the cursor has moved
            // the total is the number of rows *left* — which is what makes
            // `hasMore` truthful in cursor mode.
            count: jest.fn(async ({ filter }: { filter?: unknown }) => remaining(filter).length)
        } as unknown as DataDriver;

        const seen: number[] = [];
        for await (const row of jobsOf(buildSdkData(driver)).iterate({ pageSize: 2, cursor: "id" })) {
            seen.push(row.id as number);
        }

        expect(seen).toEqual([1, 2, 3]);
        expect(calls).toHaveLength(2);
        expect(calls[0].offset).toBeUndefined();
        expect(calls[0].orderBy).toEqual([["id", "asc"]]);
        // The second page seeks past the last row it saw.
        expect(calls[1].filter).toMatchObject({ id: [">", 2] });
        expect(calls[1].offset).toBeUndefined();
    });

    it("cursor mode refuses a cursor that disagrees with orderBy", async () => {
        const data = buildSdkData(createPagedDriver(5));
        await expect((async () => {
            for await (const _row of jobsOf(data).iterate({ cursor: "id", orderBy: ["name", "asc"] })) { /* drain */ }
        })()).rejects.toMatchObject({ code: "cursor-order-mismatch" });
    });
});
