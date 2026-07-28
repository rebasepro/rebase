import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createCollectionClient } from "../src/collection";
import { Transport } from "../src/transport";
import { RebasePaginationError } from "@rebasepro/common";

/**
 * `iterate()` / `findAll()` over the HTTP transport.
 *
 * The behaviours worth pinning are the ones whose failure mode is silent:
 * a walk that stops one page early because the last page was exactly full,
 * a walk that never stops, and a `findAll` that returns a truncated array
 * that reads like a complete one.
 */

interface JobModel {
    id: number;
    status?: string;
}

function createMockTransport(): { transport: Transport; mockRequest: jest.Mock<Transport["request"]> } {
    const mockRequest = jest.fn() as jest.Mock<Transport["request"]>;
    const transport: Transport = {
        request: mockRequest,
        baseUrl: "http://localhost",
        apiPath: "/api/v1",
        fetchFn: globalThis.fetch,
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({}),
        resolveToken: jest.fn().mockResolvedValue(null)
    } as unknown as Transport;
    return { transport, mockRequest };
}

/** A page of rows plus the meta the server would send alongside it. */
function page(rows: JobModel[], meta: { total: number; limit: number; offset: number; hasMore: boolean }) {
    return { data: rows, meta };
}

function rows(from: number, count: number): JobModel[] {
    return Array.from({ length: count }, (_, i) => ({ id: from + i }));
}

describe("CollectionClient.iterate", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<Transport["request"]>;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport());
    });

    it("yields every row across pages exactly once", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest
            .mockResolvedValueOnce(page(rows(1, 2), { total: 5, limit: 2, offset: 0, hasMore: true }))
            .mockResolvedValueOnce(page(rows(3, 2), { total: 5, limit: 2, offset: 2, hasMore: true }))
            .mockResolvedValueOnce(page(rows(5, 1), { total: 5, limit: 2, offset: 4, hasMore: false }));

        const seen: number[] = [];
        for await (const row of client.iterate({ pageSize: 2 })) {
            seen.push(row.id);
        }

        expect(seen).toEqual([1, 2, 3, 4, 5]);
        expect(mockRequest).toHaveBeenCalledTimes(3);
    });

    it("does not stop early when the final page is exactly full", async () => {
        // The bug this guards: inferring "done" from `rows.length < limit`.
        // Here every page is exactly `limit` long, including the last one.
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest
            .mockResolvedValueOnce(page(rows(1, 2), { total: 4, limit: 2, offset: 0, hasMore: true }))
            .mockResolvedValueOnce(page(rows(3, 2), { total: 4, limit: 2, offset: 2, hasMore: false }));

        const seen: number[] = [];
        for await (const row of client.iterate({ pageSize: 2 })) {
            seen.push(row.id);
        }

        expect(seen).toEqual([1, 2, 3, 4]);
        expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it("terminates on hasMore=false even when the page is full", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest.mockResolvedValueOnce(page(rows(1, 3), { total: 3, limit: 3, offset: 0, hasMore: false }));

        const seen: number[] = [];
        for await (const row of client.iterate({ pageSize: 3 })) {
            seen.push(row.id);
        }

        expect(seen).toEqual([1, 2, 3]);
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("terminates on an empty page even when the server insists there is more", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest
            .mockResolvedValueOnce(page(rows(1, 2), { total: 99, limit: 2, offset: 0, hasMore: true }))
            .mockResolvedValueOnce(page([], { total: 99, limit: 2, offset: 2, hasMore: true }));

        const seen: number[] = [];
        for await (const row of client.iterate({ pageSize: 2 })) {
            seen.push(row.id);
        }

        expect(seen).toEqual([1, 2]);
        expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it("gives up loudly on a server that never stops saying hasMore", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest.mockImplementation(async () =>
            page(rows(1, 2), { total: 99, limit: 2, offset: 0, hasMore: true }) as never);

        await expect((async () => {
            for await (const _row of client.iterate({ pageSize: 2, maxPages: 4 })) {
                // drain
            }
        })()).rejects.toThrow(RebasePaginationError);

        expect(mockRequest).toHaveBeenCalledTimes(4);
    });

    it("requests the configured pageSize and advances offset by rows received", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest
            .mockResolvedValueOnce(page(rows(1, 3), { total: 5, limit: 3, offset: 0, hasMore: true }))
            .mockResolvedValueOnce(page(rows(4, 2), { total: 5, limit: 3, offset: 3, hasMore: false }));

        for await (const _row of client.iterate({ pageSize: 3 })) { /* drain */ }

        expect(mockRequest).toHaveBeenNthCalledWith(1, "/data/jobs?limit=3&offset=0", { method: "GET" });
        expect(mockRequest).toHaveBeenNthCalledWith(2, "/data/jobs?limit=3&offset=3", { method: "GET" });
    });

    it("defaults to a page size of 200", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest.mockResolvedValueOnce(page(rows(1, 1), { total: 1, limit: 200, offset: 0, hasMore: false }));

        for await (const _row of client.iterate()) { /* drain */ }

        expect(mockRequest).toHaveBeenCalledWith("/data/jobs?limit=200&offset=0", { method: "GET" });
    });

    it("carries the caller's filters onto every page", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest
            .mockResolvedValueOnce(page(rows(1, 1), { total: 2, limit: 1, offset: 0, hasMore: true }))
            .mockResolvedValueOnce(page(rows(2, 1), { total: 2, limit: 1, offset: 1, hasMore: false }));

        for await (const _row of client.iterate({ pageSize: 1, where: { status: ["==", "queued"] } })) { /* drain */ }

        for (const call of mockRequest.mock.calls) {
            expect(String(call[0])).toContain("status=eq.queued");
        }
    });

    it("stops requesting as soon as the consumer breaks out", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest.mockImplementation(async () =>
            page(rows(1, 2), { total: 99, limit: 2, offset: 0, hasMore: true }) as never);

        const seen: number[] = [];
        for await (const row of client.iterate({ pageSize: 2 })) {
            seen.push(row.id);
            if (seen.length === 2) break;
        }

        expect(seen).toHaveLength(2);
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    // ── Keyset (cursor) mode ────────────────────────────────────────────────
    describe("cursor mode", () => {
        it("seeks past the last row instead of paging by offset", async () => {
            const client = createCollectionClient<JobModel>(transport, "jobs");
            mockRequest
                .mockResolvedValueOnce(page(rows(1, 2), { total: 3, limit: 2, offset: 0, hasMore: true }))
                .mockResolvedValueOnce(page(rows(3, 1), { total: 3, limit: 2, offset: 0, hasMore: false }));

            const seen: number[] = [];
            for await (const row of client.iterate({ pageSize: 2, cursor: "id" })) {
                seen.push(row.id);
            }

            expect(seen).toEqual([1, 2, 3]);
            const [first, second] = mockRequest.mock.calls.map((c) => String(c[0]));
            // No offset anywhere — the window is defined by the cursor.
            expect(first).not.toContain("offset=");
            expect(second).not.toContain("offset=");
            expect(first).toContain("orderBy=id%3Aasc");
            expect(second).toContain("id=gt.2");
        });

        it("seeks downwards when the cursor is descending", async () => {
            const client = createCollectionClient<JobModel>(transport, "jobs");
            mockRequest
                .mockResolvedValueOnce(page([{ id: 9 }, { id: 8 }], { total: 3, limit: 2, offset: 0, hasMore: true }))
                .mockResolvedValueOnce(page([{ id: 7 }], { total: 3, limit: 2, offset: 0, hasMore: false }));

            for await (const _row of client.iterate({ pageSize: 2, cursor: { field: "id", direction: "desc" } })) { /* drain */ }

            const [first, second] = mockRequest.mock.calls.map((c) => String(c[0]));
            expect(first).toContain("orderBy=id%3Adesc");
            expect(second).toContain("id=lt.8");
        });

        it("keeps the caller's own filter on the cursor column", async () => {
            const client = createCollectionClient<JobModel>(transport, "jobs");
            mockRequest
                .mockResolvedValueOnce(page(rows(5, 1), { total: 2, limit: 1, offset: 0, hasMore: true }))
                .mockResolvedValueOnce(page(rows(6, 1), { total: 2, limit: 1, offset: 0, hasMore: false }));

            for await (const _row of client.iterate({
                pageSize: 1,
                cursor: "id",
                where: { id: ["<", 100] }
            })) { /* drain */ }

            const second = String(mockRequest.mock.calls[1][0]);
            expect(second).toContain("id=lt.100");
            expect(second).toContain("id=gt.5");
        });

        it("refuses a cursor that disagrees with orderBy", async () => {
            const client = createCollectionClient<JobModel>(transport, "jobs");
            await expect((async () => {
                for await (const _row of client.iterate({ cursor: "id", orderBy: ["status", "asc"] })) { /* drain */ }
            })()).rejects.toMatchObject({ code: "cursor-order-mismatch" });
            expect(mockRequest).not.toHaveBeenCalled();
        });

        it("refuses to loop when the cursor column repeats across a page boundary", async () => {
            const client = createCollectionClient<JobModel>(transport, "jobs");
            mockRequest.mockImplementation(async () =>
                page([{ id: 1 }, { id: 7 }], { total: 99, limit: 2, offset: 0, hasMore: true }) as never);

            await expect((async () => {
                for await (const _row of client.iterate({ pageSize: 2, cursor: "id" })) { /* drain */ }
            })()).rejects.toMatchObject({ code: "cursor-stalled" });
        });
    });
});

describe("CollectionClient.findAll", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<Transport["request"]>;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport());
    });

    it("collects every page into one array", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest
            .mockResolvedValueOnce(page(rows(1, 2), { total: 3, limit: 2, offset: 0, hasMore: true }))
            .mockResolvedValueOnce(page(rows(3, 1), { total: 3, limit: 2, offset: 2, hasMore: false }));

        const all = await client.findAll({ pageSize: 2 });

        expect(all.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it("throws rather than returning a silently truncated array when the cap is hit", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest.mockImplementation(async () =>
            page(rows(1, 2), { total: 99, limit: 2, offset: 0, hasMore: true }) as never);

        await expect(client.findAll({ pageSize: 2, maxRows: 3 }))
            .rejects.toMatchObject({ code: "max-rows" });
        await expect(client.findAll({ pageSize: 2, maxRows: 3 }))
            .rejects.toThrow(/more than 3 rows/);
    });

    it("returns the rows when the match count sits exactly on the cap", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        mockRequest.mockResolvedValueOnce(page(rows(1, 4), { total: 4, limit: 4, offset: 0, hasMore: false }));

        const all = await client.findAll({ pageSize: 4, maxRows: 4 });

        expect(all).toHaveLength(4);
    });

    it("defaults its ceiling to 10 000 rows", async () => {
        const client = createCollectionClient<JobModel>(transport, "jobs");
        // 11 pages of 1000 = 11 000 rows available, so the default cap bites.
        mockRequest.mockImplementation(async () =>
            page(rows(1, 1000), { total: 11_000, limit: 1000, offset: 0, hasMore: true }) as never);

        await expect(client.findAll({ pageSize: 1000 })).rejects.toMatchObject({ code: "max-rows" });
        expect(mockRequest).toHaveBeenCalledTimes(11);
    });
});
