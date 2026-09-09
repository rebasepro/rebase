import { createCollectionClient } from "../src/collection";
import type { Transport } from "../src/transport";

/**
 * The read methods the SDK did not have, and the round trip it no longer makes.
 *
 * Every gap here was the same shape: the REST route served the capability and
 * the SDK had no way to ask for it, so the only route from a typed client was
 * to hand-build the URL — which is what a typed client exists to stop.
 */

interface Post extends Record<string, unknown> {
    id: string;
    title: string;
    status: string;
    total: number;
}

function createMockTransport() {
    const mockRequest = jest.fn();
    const transport = {
        request: mockRequest,
        baseUrl: "",
        apiPath: "/api"
    } as unknown as Transport;
    return { transport, mockRequest };
}

describe("SDK read methods", () => {
    let transport: Transport;
    let mockRequest: jest.Mock;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport() as never);
    });

    const url = (call = 0) => decodeURIComponent(String(mockRequest.mock.calls[call][0]));

    describe("aggregate()", () => {
        it("spells the aggregates the way the route parses them", async () => {
            const client = createCollectionClient<Post>(transport, "orders");
            mockRequest.mockResolvedValueOnce({ data: [{ status: "paid", sum_total: 41822.5 }] });

            const rows = await client.aggregate({
                select: [{ fn: "sum", field: "total" }, { fn: "count" }],
                groupBy: ["status"]
            });

            expect(url()).toContain("/data/orders/aggregate");
            expect(url()).toContain("select=sum(total),count()");
            expect(url()).toContain("groupBy=status");
            expect(rows).toEqual([{ status: "paid", sum_total: 41822.5 }]);
        });

        it("carries the builder's filters into the aggregate", async () => {
            const client = createCollectionClient<Post>(transport, "orders");
            mockRequest.mockResolvedValueOnce({ data: [] });

            await client.where("status", "==", "paid")
                .aggregate({ select: [{ fn: "count" }] });

            // The same rows a `find()` with that filter would have returned —
            // which is the whole reason to reach for an aggregate rather than
            // `findAll()` and a reduce.
            expect(url()).toContain("status=eq.paid");
            expect(url()).toContain("select=count()");
        });

        it("returns an empty list rather than undefined for no groups", async () => {
            const client = createCollectionClient<Post>(transport, "orders");
            mockRequest.mockResolvedValueOnce({});
            expect(await client.aggregate({ select: [{ fn: "count" }] })).toEqual([]);
        });
    });

    describe("fields() and distinct()", () => {
        it("sends the columns as a projection", async () => {
            const client = createCollectionClient<Post>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [], meta: {} });

            await client.fields("id", "title").find();

            expect(url()).toContain("fields=id,title");
        });

        it("sends distinct only when it is on", async () => {
            const client = createCollectionClient<Post>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [], meta: {} });
            await client.fields("status").distinct().find();
            expect(url()).toContain("distinct=true");

            mockRequest.mockResolvedValueOnce({ data: [], meta: {} });
            await client.fields("status").distinct(false).find();
            // `?distinct=false` is the default and says nothing, while the
            // server refuses anything that is neither true nor false.
            expect(url(1)).not.toContain("distinct=");
        });
    });

    describe("orderBy nulls placement", () => {
        it("sends the third segment when one is named", async () => {
            const client = createCollectionClient<Post>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [], meta: {} });

            await client.orderBy("title", "desc", "last").find();

            expect(url()).toContain("orderBy=title:desc:last");
        });

        it("leaves a sort without one exactly as it was", async () => {
            const client = createCollectionClient<Post>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [], meta: {} });

            await client.orderBy("title", "desc").find();

            expect(url()).toContain("orderBy=title:desc");
            expect(url()).not.toContain(":desc:");
        });
    });

    describe("after()", () => {
        it("passes the cursor through unread", async () => {
            const client = createCollectionClient<Post>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [], meta: {} });

            await client.after("OPAQUE-CURSOR").find();

            expect(url()).toContain("after=OPAQUE-CURSOR");
        });
    });

    describe("listen() no longer counts on every push", () => {
        /** A socket stub whose `listenCollection` we can drive by hand. */
        const socket = () => {
            const calls: { onUpdate: (rows: Record<string, unknown>[], meta?: unknown) => void }[] = [];
            return {
                calls,
                ws: {
                    listenCollection: jest.fn((_props: unknown, onUpdate: never) => {
                        calls.push({ onUpdate: onUpdate as never });
                        return () => {};
                    }),
                    listenOne: jest.fn(() => () => {})
                } as never
            };
        };

        it("reads total and hasMore off the frame", async () => {
            const { calls, ws } = socket();
            const client = createCollectionClient<Post>(transport, "posts", ws);
            const seen: unknown[] = [];
            client.listen({ limit: 2 }, (result) => seen.push(result.meta));

            calls[0].onUpdate([{ id: "1" }], { total: 42, limit: 2, offset: 0, hasMore: true, nextCursor: "C1" });
            await Promise.resolve();

            // Every push used to be followed by a `GET /count` from here — one
            // extra round trip per write, per subscriber, forever.
            expect(mockRequest).not.toHaveBeenCalled();
            expect(seen[0]).toMatchObject({ total: 42, hasMore: true, nextCursor: "C1" });
        });

        it("keeps the last real total when a frame's count failed", async () => {
            const { calls, ws } = socket();
            const client = createCollectionClient<Post>(transport, "posts", ws);
            const seen: { total: number }[] = [];
            client.listen({ limit: 2 }, (result) => seen.push(result.meta as never));

            calls[0].onUpdate([{ id: "1" }], { total: 42, limit: 2, offset: 0, hasMore: true });
            await Promise.resolve();
            // `partial`: the server's count threw, so the frame carries no
            // total. A count that failed is not evidence about the size of the
            // collection — substituting `rows.length` would claim a page read
            // at offset 10 held two rows.
            calls[0].onUpdate([{ id: "1" }], { limit: 2, offset: 0, hasMore: true, partial: true });
            await Promise.resolve();

            expect(mockRequest).not.toHaveBeenCalled();
            expect(seen[1].total).toBe(42);
        });

        it("falls back to one count when no frame has ever carried a total", async () => {
            // A server too old to send `meta` at all. Asked once, on the first
            // push, rather than on every one.
            const { calls, ws } = socket();
            mockRequest.mockResolvedValue({ count: 7 });
            const client = createCollectionClient<Post>(transport, "posts", ws);
            const seen: { total: number }[] = [];
            client.listen({ limit: 2 }, (result) => seen.push(result.meta as never));

            calls[0].onUpdate([{ id: "1" }]);
            await new Promise(resolve => setTimeout(resolve, 0));
            calls[0].onUpdate([{ id: "1" }]);
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockRequest).toHaveBeenCalledTimes(1);
            expect(seen[seen.length - 1].total).toBe(7);
        });
    });
});
