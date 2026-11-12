import { jest } from "@jest/globals";
import { createTableClient } from "./table";
import type { Transport } from "./transport";
import { RebaseClientError } from "@rebasepro/types";
import { createMockTransport as createSharedMockTransport, type RequestAnswer } from "../test/support/fake-transport";
import { mockRealtime } from "../test/support/fake-realtime";

/** A transport whose requests answer `{}` until a test says otherwise. */
function createMockTransport() {
    const mocks = createSharedMockTransport({ baseUrl: "http://localhost:3000" });
    mocks.mockRequest.mockResolvedValue({});
    return mocks;
}

describe("createTableClient", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<RequestAnswer>;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport());
    });

    describe("count()", () => {
        it("should call the /count endpoint and return the count", async () => {
            mockRequest.mockResolvedValue({ count: 42 });

            const client = createTableClient(transport, "products");
            const result = await client.count();

            expect(mockRequest).toHaveBeenCalledWith(
                "/data/products/count",
                { method: "GET" }
            );
            expect(result).toBe(42);
        });

        it("should forward where filters to the count endpoint", async () => {
            mockRequest.mockResolvedValue({ count: 7 });

            const client = createTableClient(transport, "products");
            const result = await client.count({
                where: { status: ["==", "published"] }
            });

            expect(mockRequest).toHaveBeenCalledWith(
                expect.stringContaining("/data/products/count?"),
                { method: "GET" }
            );
            // Verify the query string includes the filter
            const calledUrl = mockRequest.mock.calls[0][0];
            expect(calledUrl).toContain("status=");
            expect(result).toBe(7);
        });

        it("should forward orderBy to the count endpoint", async () => {
            mockRequest.mockResolvedValue({ count: 15 });

            const client = createTableClient(transport, "items");
            const result = await client.count({
                orderBy: ["created_at", "desc"]
            });

            const calledUrl = mockRequest.mock.calls[0][0];
            expect(calledUrl).toContain("/data/items/count?");
            expect(calledUrl).toContain("orderBy=");
            expect(result).toBe(15);
        });

        it("should NOT include limit or offset in the count request", async () => {
            mockRequest.mockResolvedValue({ count: 100 });

            const client = createTableClient(transport, "users");
            // Even if the caller passes limit/offset in params, they should be stripped
            await client.count({ limit: 50,
offset: 10 });

            const calledUrl = mockRequest.mock.calls[0][0];
            expect(calledUrl).not.toContain("limit=");
            expect(calledUrl).not.toContain("offset=");
        });

        it("should return 0 when meta.count is missing", async () => {
            mockRequest.mockResolvedValue({});

            const client = createTableClient(transport, "empty");
            const result = await client.count();

            expect(result).toBe(0);
        });

        it("should forward searchString to the count endpoint", async () => {
            mockRequest.mockResolvedValue({ count: 3 });

            const client = createTableClient(transport, "articles");
            const result = await client.count({
                searchString: "hello world"
            });

            const calledUrl = mockRequest.mock.calls[0][0];
            expect(calledUrl).toContain("searchString=");
            expect(calledUrl).toContain("hello");
            expect(result).toBe(3);
        });

        it("should forward multiple where filters correctly", async () => {
            mockRequest.mockResolvedValue({ count: 5 });

            const client = createTableClient(transport, "orders");
            await client.count({
                where: {
                    status: ["==", "active"],
                    total: [">=", 100]
                }
            });

            const calledUrl = mockRequest.mock.calls[0][0];
            expect(calledUrl).toContain("status=");
            expect(calledUrl).toContain("total=");
        });
    });

    describe("find()", () => {
        it("should call the list endpoint and return flat rows", async () => {
            mockRequest.mockResolvedValue({
                data: [{ id: "1",
name: "Product A" }],
                meta: { total: 1,
limit: 20,
offset: 0,
hasMore: false }
            });

            const client = createTableClient(transport, "products");
            const result = await client.find();

            expect(mockRequest).toHaveBeenCalledWith(
                "/data/products",
                { method: "GET" }
            );
            expect(result.data).toHaveLength(1);
            // Flat row access — no .values wrapper
            expect(result.data[0].id).toBe("1");
            expect((result.data[0] as Record<string, unknown>).name).toBe("Product A");
            // No path field — that's admin leakage
            expect((result.data[0] as Record<string, unknown>).path).toBeUndefined();
            expect(result.meta.total).toBe(1);
        });
    });

    describe("findById()", () => {
        it("should return a flat row directly", async () => {
            mockRequest.mockResolvedValue({ id: "42", title: "Hello" });

            const client = createTableClient(transport, "posts");
            const result = await client.findById("42");

            expect(mockRequest).toHaveBeenCalledWith(
                "/data/posts/42",
                { method: "GET" },
                // The out-parameter `findById` reads the row's ETag from.
                expect.any(Object)
            );
            expect(result).toBeDefined();
            expect(result!.id).toBe("42");
            expect((result as Record<string, unknown>).title).toBe("Hello");
        });

        it("should return undefined for 404", async () => {
            const { RebaseApiError } = await import("./transport");
            mockRequest.mockRejectedValue(
                new RebaseApiError("Not Found", { status: 404 })
            );

            const client = createTableClient(transport, "posts");
            const result = await client.findById("999");
            expect(result).toBeUndefined();
        });
    });

    describe("create()", () => {
        it("should return a flat row", async () => {
            mockRequest.mockResolvedValue({ id: "new-1", title: "Created" });

            const client = createTableClient(transport, "posts");
            const result = await client.create({ title: "Created" } as Record<string, unknown>);

            expect(result.id).toBe("new-1");
            expect((result as Record<string, unknown>).title).toBe("Created");
        });
    });

    describe("update()", () => {
        it("should return a flat row", async () => {
            mockRequest.mockResolvedValue({ id: "1", title: "Updated" });

            const client = createTableClient(transport, "posts");
            const result = await client.update("1", { title: "Updated" } as Record<string, unknown>);

            expect(result.id).toBe("1");
            expect((result as Record<string, unknown>).title).toBe("Updated");
        });

        it("should throw RebaseApiError for 404", async () => {
            const { RebaseApiError } = await import("./transport");
            mockRequest.mockRejectedValue(
                new RebaseApiError("Not Found", { status: 404 })
            );

            const client = createTableClient(transport, "posts");
            await expect(
                client.update("999", { title: "Nope" } as Record<string, unknown>)
            ).rejects.toMatchObject({ status: 404 });
        });
    });

    describe("delete()", () => {
        it("should throw RebaseApiError for 404", async () => {
            const { RebaseApiError } = await import("./transport");
            mockRequest.mockRejectedValue(
                new RebaseApiError("Not Found", { status: 404 })
            );

            const client = createTableClient(transport, "posts");
            await expect(client.delete("999")).rejects.toMatchObject({ status: 404 });
        });

        it("should propagate non-404 errors", async () => {
            const { RebaseApiError } = await import("./transport");
            mockRequest.mockRejectedValue(
                new RebaseApiError("Internal Server Error", { status: 500 })
            );

            const client = createTableClient(transport, "posts");
            await expect(client.delete("1")).rejects.toThrow("Internal Server Error");
        });
    });

    /**
     * `listen()` branches on `client.count` being present, and consumers such
     * as EntitiesCount do the same. Asserting `typeof client.count ===
     * "function"` on an object literal the factory just built cannot fail;
     * what can regress is the branch downstream of it — whether the
     * authoritative total actually reaches the subscriber, or whether the
     * heuristic row count silently stands in for it.
     */
    describe("listen() total comes from count()", () => {
        /** A WS double that hands the collection callback one page of rows. */
        function wsDeliveringRows(rows: Record<string, unknown>[]) {
            const { realtime, listeners } = mockRealtime();
            return { ws: realtime,
deliver: () => listeners.collection?.(rows) };
        }

        it("reports the authoritative count, not the number of rows delivered", async () => {
            mockRequest.mockResolvedValue({ count: 137 });
            const { ws, deliver } = wsDeliveringRows([{ id: "1" }, { id: "2" }]);

            const client = createTableClient(transport, "products", ws);
            const updates: any[] = [];
            client.listen!({ limit: 2 }, (res) => { updates.push(res); });
            deliver();
            await new Promise(r => setImmediate(r));

            expect(updates).toHaveLength(1);
            expect(updates[0].meta.total).toBe(137);
            // 0 + 2 < 137, so the page is not the end of the collection.
            expect(updates[0].meta.hasMore).toBe(true);
        });

        it("falls back to the row count when the count request fails", async () => {
            mockRequest.mockRejectedValue(new Error("boom"));
            const { ws, deliver } = wsDeliveringRows([{ id: "1" }, { id: "2" }]);

            const client = createTableClient(transport, "products", ws);
            const updates: any[] = [];
            client.listen!({ limit: 2 }, (res) => { updates.push(res); });
            deliver();
            await new Promise(r => setImmediate(r));

            expect(updates).toHaveLength(1);
            expect(updates[0].meta.total).toBe(2);
            // A full page with no authoritative total: assume there is more.
            expect(updates[0].meta.hasMore).toBe(true);
        });
    });

    /**
     * A `listen()` is the same query as the `find()` beside it, and the two
     * used to disagree about what a query may say. `find()` refuses an
     * `undefined` filter value; the socket serialised it as JSON, where it
     * becomes `null` — so `["!=", uid]` with `uid` unset subscribed to every
     * row whose owner is NOT NULL, the ownership filter widened instead of
     * refused. And `after`, the keyset cursor, was dropped without a word: the
     * subscription streamed page one to a caller who had asked for page two.
     */
    describe("listen() refuses what it cannot ask for", () => {
        const mockWs = () => mockRealtime().realtime;
        const flush = () => new Promise(r => setImmediate(r));

        it("refuses an undefined filter value, as find() does, and opens nothing", async () => {
            const ws = mockWs();
            const client = createTableClient(transport, "posts", ws);
            const onError = jest.fn<(error: Error) => void>();

            client.listen!({ where: { owner_id: ["!=", undefined] } }, jest.fn(), onError);
            await flush();

            expect(ws.listenCollection).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledTimes(1);
            const error = onError.mock.calls[0][0] as RebaseClientError;
            expect(error).toBeInstanceOf(RebaseClientError);
            expect(error.code).toBe("INVALID_FILTER");
            expect((error.details as { field?: string }).field).toBe("owner_id");
        });

        it("refuses a hole in an `in` list", async () => {
            const ws = mockWs();
            const client = createTableClient(transport, "posts", ws);
            const onError = jest.fn<(error: Error) => void>();

            client.listen!({ where: { id: ["in", ["a", undefined]] } }, jest.fn(), onError);
            await flush();

            expect(ws.listenCollection).not.toHaveBeenCalled();
            expect((onError.mock.calls[0][0] as RebaseClientError).code).toBe("INVALID_FILTER");
        });

        it("refuses a cursor, which a subscription cannot continue from", async () => {
            const ws = mockWs();
            const client = createTableClient(transport, "posts", ws);
            const onError = jest.fn<(error: Error) => void>();

            client.listen!({ orderBy: ["created_at", "desc"], limit: 20, after: "eyJrIjpbMV19" }, jest.fn(), onError);
            await flush();

            expect(ws.listenCollection).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledTimes(1);
            expect((onError.mock.calls[0][0] as RebaseClientError).code).toBe("CURSOR_NOT_LIVE");
        });

        it("says nothing to a listener that already left", async () => {
            const client = createTableClient(transport, "posts", mockWs());
            const onError = jest.fn();

            const stop = client.listen!({ after: "eyJrIjpbMV19" }, jest.fn(), onError);
            stop();
            await flush();

            expect(onError).not.toHaveBeenCalled();
        });

        it("observe() reports the refusal once, not once per half", async () => {
            const ws = mockWs();
            const client = createTableClient(transport, "posts", ws);
            const onError = jest.fn<(error: Error) => void>();

            client.observe({ where: { owner_id: ["==", undefined] } }, jest.fn(), onError);
            await flush();

            expect(ws.listenCollection).not.toHaveBeenCalled();
            expect(mockRequest).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledTimes(1);
            expect((onError.mock.calls[0][0] as RebaseClientError).code).toBe("INVALID_FILTER");
        });

        it("observe() without the live half still pages by cursor", async () => {
            mockRequest.mockResolvedValue({ data: [], meta: {} });
            const ws = mockWs();
            const client = createTableClient(transport, "posts", ws);
            const onError = jest.fn();

            client.observe({ after: "eyJrIjpbMV19" }, jest.fn(), onError, { realtime: false });
            await flush();

            expect(onError).not.toHaveBeenCalled();
            expect(mockRequest.mock.calls[0][0]).toContain("after=eyJrIjpbMV19");
        });
    });
});

/**
 * `findById` returns `M | undefined`, so every caller had to prove the row was
 * there before touching a field — `post.title` is TS18048, and the `!` that
 * follows is the reflex. But a row fetched by an id that came from a link, a
 * route parameter or another row is *expected* to exist; its absence is the
 * error case, not a value to thread through the rest of the function.
 *
 * `get` is the throwing counterpart. Same split as Prisma's `findUnique` /
 * `findUniqueOrThrow`: two contracts, both wanted, named so the call site says
 * which one it means.
 */
describe("get", () => {
    it("returns the row when it is there, typed as present", async () => {
        const { transport, mockRequest } = createMockTransport();
        mockRequest.mockResolvedValue({ id: 7, title: "Hello" });
        const client = createTableClient(transport, "posts");
        const row = await client.get(7);
        // No `!` and no narrowing: the point of the method.
        expect(row.title).toBe("Hello");
    });

    it("throws NOT_FOUND when the row is absent, where findById returns undefined", async () => {
        const { transport, mockRequest } = createMockTransport();
        mockRequest.mockResolvedValue(undefined);
        const client = createTableClient(transport, "posts");

        await expect(client.findById(7)).resolves.toBeUndefined();
        await expect(client.get(7)).rejects.toMatchObject({
            code: "NOT_FOUND",
            status: 404
        });
    });

    it("names the collection and the id, so the message stands alone in a log", async () => {
        const { transport, mockRequest } = createMockTransport();
        mockRequest.mockResolvedValue(undefined);
        const client = createTableClient(transport, "posts");
        await expect(client.get("abc")).rejects.toThrow('No record with id "abc" in "posts".');
    });
});
