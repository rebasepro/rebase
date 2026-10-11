import { describe, expect, it, jest } from "@jest/globals";
import { resolvePagination, runLocalQuery } from "../src/offline-query";
import { createRebaseClient } from "../src/index";
import { buildQueryBody, buildQueryString } from "../src/transport";

/**
 * The offline evaluator answers a read from the local database. A read with
 * both `page` and `offset` is refused there with the code the server refuses it
 * with (`PAGE_WITH_OFFSET`), rather than quietly applying `page`.
 */
describe("page together with offset, answered offline", () => {
    it("is refused with PAGE_WITH_OFFSET", () => {
        expect(() => resolvePagination({ page: 2, offset: 10 }))
            .toThrow(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
        const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
        expect(() => runLocalQuery(rows, { page: 2, offset: 10, limit: 5 }))
            .toThrow(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
    });

    it("still pages by either one alone", () => {
        expect(resolvePagination({ page: 2, limit: 5 })).toEqual({ limit: 5, offset: 5 });
        expect(resolvePagination({ offset: 3, limit: 5 })).toEqual({ limit: 5, offset: 3 });
    });
});

/**
 * Over HTTP the pair is refused before any request, with the code the server
 * would answer, so the caller learns it without a round trip.
 */
describe("page together with offset, sent over HTTP", () => {
    it("is refused locally with PAGE_WITH_OFFSET and nothing is sent", async () => {
        const fetchMock = jest.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [] }), {
            status: 200, headers: { "Content-Type": "application/json" }
        }));
        const client = createRebaseClient({
            baseUrl: "http://localhost:3000",
            fetch: fetchMock as typeof fetch,
            anonymous: true,
            realtime: false
        });
        const error = await client.data.collection("posts").find({ page: 2, offset: 10 }).catch((e: unknown) => e);

        expect(error).toEqual(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses the pair in both the query string and the query body", () => {
        expect(() => buildQueryString({ page: 2, offset: 10 }))
            .toThrow(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
        expect(() => buildQueryBody({ page: 2, offset: 10 }))
            .toThrow(expect.objectContaining({ code: "PAGE_WITH_OFFSET" }));
        expect(buildQueryString({ page: 2, limit: 5 })).toBe("?limit=5&page=2");
        expect(buildQueryString({ offset: 3, limit: 5 })).toBe("?limit=5&offset=3");
    });
});
