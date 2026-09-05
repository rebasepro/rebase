import { beforeEach, describe, expect, it, jest } from "@jest/globals";
// Asserted rather than restated: these tests previously wrote `limit: 20`, a
// number the client invented and no layer of the stack agreed with. Naming the
// constant is what makes the assertion about the server's page size instead of
// about the line above it.
import { DEFAULT_LIST_LIMIT, isUnsupported } from "@rebasepro/types";
import { createCollectionClient } from "../src/collection";
import { Transport } from "../src/transport";
import { RebaseWebSocketClient } from "../src/websocket";


/** Shape of the mock "posts" model used across tests. */
interface PostModel {
    title: string;
    status?: string;
    tags?: string[];
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
    };
    return { transport,
mockRequest };
}

describe("createCollectionClient", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<Transport["request"]>;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport());
    });

    it("exposes all CRUD methods", () => {
        const client = createCollectionClient<PostModel>(transport, "posts");
        expect(typeof client.find).toBe("function");
        expect(typeof client.findById).toBe("function");
        expect(typeof client.create).toBe("function");
        expect(typeof client.update).toBe("function");
        expect(typeof client.delete).toBe("function");
    });

    it("exposes fluent query builder methods", () => {
        const client = createCollectionClient<PostModel>(transport, "posts");
        expect(typeof client.where).toBe("function");
        expect(typeof client.orderBy).toBe("function");
        expect(typeof client.limit).toBe("function");
        expect(typeof client.offset).toBe("function");
        expect(typeof client.search).toBe("function");
        expect(typeof client.include).toBe("function");
    });

    // -----------------------------------------------------------------------
    // find
    // -----------------------------------------------------------------------
    describe("find", () => {
        it("calls GET /data/slug with correct query parameters and returns flat rows", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [{ id: 1,
title: "Hello" }],
meta: { total: 1,
limit: 10,
offset: 20,
hasMore: false } });

            const result = await client.find({ limit: 10,
offset: 20 });

            expect(result).toEqual({
                data: [{ id: 1,
title: "Hello" }],
                meta: { total: 1,
limit: 10,
offset: 20,
hasMore: false }
            });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts?limit=10&offset=20", { method: "GET" });
        });

        it("calls GET /data/slug without query string if no params are passed", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [],
meta: { total: 0,
limit: 20,
offset: 0,
hasMore: false } });

            const result = await client.find();
            expect(result.data).toEqual([]);
            expect(mockRequest).toHaveBeenCalledWith("/data/posts", { method: "GET" });
        });

        it("handles empty/missing data array gracefully", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: undefined,
meta: {} });

            const result = await client.find();
            expect(result.data).toEqual([]);
        });

        it("returns multiple rows as flat objects", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({
                data: [
                    { id: "a",
title: "First",
status: "published" },
                    { id: "b",
title: "Second",
status: "draft" }
                ],
                meta: { total: 2 }
            });

            const result = await client.find();
            expect(result.data).toHaveLength(2);
            expect(result.data[0]).toEqual({ id: "a",
title: "First",
status: "published" });
            expect(result.data[1]).toEqual({ id: "b",
title: "Second",
status: "draft" });
        });

        it("passes where filter parameters correctly", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [],
meta: {} });

            await client.find({ where: { status: "eq.published" } });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts?status=eq.published", { method: "GET" });
        });

        it("uses orderBy together with other params", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [],
meta: {} });

            await client.find({ limit: 5,
orderBy: ["title", "asc"] });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts?limit=5&orderBy=title%3Aasc", { method: "GET" });
        });
    });

    // -----------------------------------------------------------------------
    // findById
    // -----------------------------------------------------------------------
    describe("findById", () => {
        it("calls GET /data/slug/id and returns flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "123",
title: "Test" });

            const result = await client.findById("123");
            expect(result).toEqual({ id: "123",
title: "Test" });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/123", { method: "GET" });
        });

        it("returns undefined when backend returns falsy", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce(null);

            const result = await client.findById("999");
            expect(result).toBeUndefined();
        });

        it("URI encodes the ID", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "a/b",
title: "Encoded" });

            await client.findById("a/b");
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/a%2Fb", { method: "GET" });
        });

        it("handles numeric IDs by converting to string", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 42,
title: "Numeric" });

            await client.findById(42);
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/42", { method: "GET" });
        });
    });

    // -----------------------------------------------------------------------
    // create
    // -----------------------------------------------------------------------
    describe("create", () => {
        it("calls POST /data/slug with JSON body and returns flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 1,
title: "New" });

            const input: Partial<PostModel> = { title: "New" };
            const result = await client.create(input);

            expect(result).toEqual({ id: 1,
title: "New" });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts", { method: "POST",
body: JSON.stringify(input) });
        });

        it("includes id in POST body when provided", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "custom-id",
title: "Custom" });

            const input: Partial<PostModel> = { title: "Custom" };
            const result = await client.create(input, "custom-id");

            expect(result).toEqual({ id: "custom-id",
title: "Custom" });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts", {
                method: "POST",
                body: JSON.stringify({ title: "Custom",
id: "custom-id" })
            });
        });

        it("includes numeric id in POST body", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 7,
title: "T" });

            await client.create({ title: "T" }, 7);
            const body = JSON.parse(mockRequest.mock.calls[0][1]!.body as string);
            expect(body.id).toBe(7);
        });
    });

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------
    describe("update", () => {
        it("calls PUT /data/slug/id with JSON body and returns flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 1,
title: "Updated" });

            const patch: Partial<PostModel> = { title: "Updated" };
            const result = await client.update(1, patch);

            expect(result).toEqual({ id: 1,
title: "Updated" });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/1", { method: "PATCH",
body: JSON.stringify(patch) });
        });

        it("encodes special characters in update ID", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "x/y",
title: "Updated" });

            await client.update("x/y", { title: "Updated" });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/x%2Fy", expect.any(Object));
        });
    });

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
    describe("delete", () => {
        it("calls DELETE /data/slug/id", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce(undefined);

            await client.delete(42);
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/42", { method: "DELETE" });
        });

        it("encodes special characters in delete ID", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce(undefined);

            await client.delete("a/b");
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/a%2Fb", { method: "DELETE" });
        });
    });

    // -----------------------------------------------------------------------
    // listen (with WebSocket)
    // -----------------------------------------------------------------------
    /**
     * A count is a property of the query, not of the caller.
     *
     * `listenCollection` collapses identical queries onto one socket
     * subscription but keeps one callback per subscriber, and every subscriber
     * re-counts on each push. A table with one relation column mounts one
     * selector per visible cell, so a single `collection_update` fanned out
     * into one identical count request per row.
     */
    /**
     * `create`, `createMany`, `updateMany`, `delete` and `deleteMany` all took
     * `WriteOptions`; the single-row `update` did not, so it was the one write
     * on the surface that could not be made idempotent. A client that never
     * sees the response retries, and without a key the server cannot tell that
     * retry from a second deliberate edit — which on a `PATCH` that increments
     * or appends is a second edit applied.
     */
    describe("update takes WriteOptions like every other write", () => {
        it("sends the idempotency key", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValue({ id: 1 } as never);

            await client.update(1, { title: "x" }, { idempotencyKey: "attempt-1" });

            expect(mockRequest).toHaveBeenCalledWith("/data/posts/1", expect.objectContaining({
                method: "PATCH",
                headers: { "Idempotency-Key": "attempt-1" }
            }));
        });

        it("sends no header when no key was given", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValue({ id: 1 } as never);

            await client.update(1, { title: "x" });

            expect(mockRequest.mock.calls[0][1]).not.toHaveProperty("headers");
        });
    });

    describe("count request de-duplication", () => {
        it("issues one request for concurrent identical counts", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            let resolveCount: (v: { count: number }) => void = () => {};
            mockRequest.mockReturnValue(new Promise<{ count: number }>(r => { resolveCount = r; }) as never);

            const results = Promise.all([client.count(), client.count(), client.count()]);
            resolveCount({ count: 7 });

            expect(await results).toEqual([7, 7, 7]);
            expect(mockRequest).toHaveBeenCalledTimes(1);
        });

        it("keeps different queries apart", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValue({ count: 1 } as never);

            await Promise.all([
                client.count({ where: { status: ["==", "draft"] } }),
                client.count({ where: { status: ["==", "published"] } })
            ]);

            expect(mockRequest).toHaveBeenCalledTimes(2);
        });

        // Merging concurrent callers must not turn into a cache: a later count
        // is a fresh question about a collection that may have changed.
        it("does not serve a settled count to a later caller", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValue({ count: 3 } as never);

            await client.count();
            await client.count();

            expect(mockRequest).toHaveBeenCalledTimes(2);
        });

        /**
         * A request key is a path and a query string. It says nothing about
         * *who* is asking — and the map used to be module-level, shared by
         * every client in the process. So an admin panel beside a signed-in
         * user's client, or two per-request server clients, counting the same
         * collection shared one request, and whichever arrived second was
         * answered with the first one's total. Row-level security makes those
         * genuinely different numbers.
         */
        it("does not share a count between two clients on different transports", async () => {
            const a = createMockTransport();
            const b = createMockTransport();
            let resolveA: (v: { count: number }) => void = () => {};
            a.mockRequest.mockReturnValue(new Promise<{ count: number }>(r => { resolveA = r; }) as never);
            let resolveB: (v: { count: number }) => void = () => {};
            b.mockRequest.mockReturnValue(new Promise<{ count: number }>(r => { resolveB = r; }) as never);

            const clientA = createCollectionClient<PostModel>(a.transport, "posts");
            const clientB = createCollectionClient<PostModel>(b.transport, "posts");

            const both = Promise.all([clientA.count(), clientB.count()]);
            resolveA({ count: 7 });
            resolveB({ count: 2 });

            // Two requests, and each client is told its own answer.
            expect(await both).toEqual([7, 2]);
            expect(a.mockRequest).toHaveBeenCalledTimes(1);
            expect(b.mockRequest).toHaveBeenCalledTimes(1);
        });

        it("propagates a failure to every sharing caller and clears the entry", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockRejectedValueOnce(new Error("boom") as never);

            const both = Promise.allSettled([client.count(), client.count()]);
            expect((await both).map(r => r.status)).toEqual(["rejected", "rejected"]);
            expect(mockRequest).toHaveBeenCalledTimes(1);

            // The failed entry must not be left behind to poison later counts.
            mockRequest.mockResolvedValue({ count: 5 } as never);
            expect(await client.count()).toBe(5);
        });
    });

    describe("listen / listenById", () => {
        it("stubs listen/listenById with the reason when no websocket is provided", () => {
            // They used to be absent, so the failure a caller saw depended on
            // how deep they were: the query builder said "realtime: false" and
            // `client.listen(...)` said `undefined is not a function`.
            const client = createCollectionClient<PostModel>(transport, "posts");
            expect(() => client.listen(undefined, jest.fn())).toThrow(/realtime: false/);
            expect(() => client.listenById("p1", jest.fn())).toThrow(/realtime: false/);
            expect(isUnsupported(client.listen)).toBe(true);
            expect(isUnsupported(client.listenById)).toBe(true);
        });

        it("exposes listen/listenById when websocket is provided", () => {
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(() => {}),
                listenOne: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            expect(typeof client.listen).toBe("function");
            expect(typeof client.listenById).toBe("function");
        });

        it("listen passes correct parameters to ws.listenCollection", () => {
            const unsubFn = jest.fn();
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(unsubFn),
                listenOne: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            const onUpdate = jest.fn();
            const onError = jest.fn();

            const result = client.listen({ limit: 10,
orderBy: ["title", "desc"] }, onUpdate, onError);

            expect(mockWs.listenCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "posts",
                    limit: 10,
                    // The subscribe frame carries the same list form the fetch
                    // path does; a field name plus a separate `order` cannot
                    // express a second sort key.
                    orderBy: [["title", "desc"]]
                }),
                expect.any(Function),
                onError
            );
            expect(result).toBeDefined();
        });

        it("listen callback waits for count and fires once with authoritative meta", async () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenOne: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            // Hold the count open so the *waiting* is observable. With a count
            // that resolves immediately this body is indistinguishable from
            // "listen fires once even when count matches heuristic" below, and
            // neither would notice a client that emitted heuristic meta first
            // and corrected it afterwards — the flicker this behaviour exists
            // to prevent.
            let resolveCount!: (n: number) => void;
            client.count = jest.fn().mockReturnValue(new Promise<number>(r => { resolveCount = r; }));
            const onUpdate = jest.fn();
            client.listen(undefined, onUpdate);

            const entities: Entity[] = [
                { id: "1",
path: "posts",
values: { title: "A" } },
                { id: "2",
path: "posts",
values: { title: "B" } }
            ];
            capturedCallback!(entities);

            // Rows in hand, total still outstanding: nothing may be emitted.
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(onUpdate).not.toHaveBeenCalled();

            resolveCount(37);
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith({
                data: entities,
                meta: {
                    total: 37,
                    limit: DEFAULT_LIST_LIMIT,
                    offset: 0,
                    hasMore: true
                }
            });
        });

        it("listen callback fires once with authoritative count when available", async () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenOne: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            client.count = jest.fn().mockResolvedValue(100);

            const onUpdate = jest.fn();
            client.listen({ limit: 10, offset: 5 }, onUpdate);

            const entities: Entity[] = [
                { id: "1", path: "posts", values: { title: "A" } },
                { id: "2", path: "posts", values: { title: "B" } }
            ];

            capturedCallback!(entities);

            // Wait for count promise to resolve
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(client.count).toHaveBeenCalledWith({ limit: 10, offset: 5 });
            // Single emission with authoritative meta
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith({
                data: entities,
                meta: {
                    total: 100,
                    limit: 10,
                    offset: 5,
                    hasMore: true
                }
            });
        });

        it("listen fires once even when count matches heuristic", async () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenOne: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            client.count = jest.fn().mockResolvedValue(2);

            const onUpdate = jest.fn();
            client.listen(undefined, onUpdate);

            const entities: Entity[] = [
                { id: "1", path: "posts", values: { title: "A" } },
                { id: "2", path: "posts", values: { title: "B" } }
            ];

            capturedCallback!(entities);

            // Wait for count promise to resolve
            await new Promise(resolve => setTimeout(resolve, 0));

            // Single emission — count matched the heuristic
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith({
                data: entities,
                meta: {
                    total: 2,
                    limit: DEFAULT_LIST_LIMIT,
                    offset: 0,
                    hasMore: false
                }
            });
        });

        it("listen falls back to heuristic meta when count rejects", async () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenOne: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            client.count = jest.fn().mockRejectedValue(new Error("Network error"));

            const onUpdate = jest.fn();
            client.listen(undefined, onUpdate);

            const entities: Entity[] = [
                { id: "1", path: "posts", values: { title: "A" } }
            ];

            capturedCallback!(entities);

            // Wait for count rejection to settle
            await new Promise(resolve => setTimeout(resolve, 0));

            // Single emission with heuristic meta, no estimated flag
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith({
                data: entities,
                meta: {
                    total: 1,
                    limit: DEFAULT_LIST_LIMIT,
                    offset: 0,
                    hasMore: false
                }
            });
        });

        it("listenById passes correct parameters to ws.listenOne", () => {
            const unsubFn = jest.fn();
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(() => {}),
                listenOne: jest.fn().mockReturnValue(unsubFn)
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            const onUpdate = jest.fn();

            client.listenById("abc", onUpdate);

            expect(mockWs.listenOne).toHaveBeenCalledWith(
                { path: "posts",
id: "abc" },
                expect.any(Function),
                undefined
            );
        });

        it("listenById callback passes entity or undefined", () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(() => {}),
                listenOne: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                })
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            const onUpdate = jest.fn();
            client.listenById("abc", onUpdate);

            // Entity exists
            const entity: Entity = { id: "abc",
path: "posts",
values: { title: "Test" } };
            capturedCallback!(entity);
            expect(onUpdate).toHaveBeenCalledWith(entity);

            // Entity deleted / null
            onUpdate.mockClear();
            capturedCallback!(null);
            expect(onUpdate).toHaveBeenCalledWith(undefined);
        });

        it("listen parses where filter parameters", () => {
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(() => {}),
                listenOne: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            client.listen(
                { where: { status: ["==", "published"] },
searchString: "test" },
                jest.fn()
            );

            expect(mockWs.listenCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "posts",
                    searchString: "test",
                    filter: expect.objectContaining({
                        status: ["==", "published"]
                    })
                }),
                expect.any(Function),
                undefined
            );
        });
    });

    // -----------------------------------------------------------------------
    // Fluent query builder integration
    // -----------------------------------------------------------------------
    describe("Fluent QueryBuilder integration", () => {
        it("where() returns a QueryBuilder that can call find()", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [],
meta: {} });

            const qb = client.where("status", "==", "published");
            expect(qb).toBeDefined();
            expect(typeof qb.find).toBe("function");

            await qb.find();
            expect(mockRequest).toHaveBeenCalledWith(
                expect.stringContaining("/data/posts"),
                expect.objectContaining({ method: "GET" })
            );
        });

        it("orderBy() returns a QueryBuilder", () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            const qb = client.orderBy("title", "asc");
            expect(typeof qb.find).toBe("function");
        });

        it("limit() returns a QueryBuilder", () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            const qb = client.limit(10);
            expect(typeof qb.find).toBe("function");
        });

        it("offset() returns a QueryBuilder", () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            const qb = client.offset(5);
            expect(typeof qb.find).toBe("function");
        });

        it("search() returns a QueryBuilder", () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            const qb = client.search("hello");
            expect(typeof qb.find).toBe("function");
        });

        it("include() returns a QueryBuilder", () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            const qb = client.include("tags", "author");
            expect(typeof qb.find).toBe("function");
        });

        it("chains multiple fluent methods together", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [{ id: 1,
title: "Match" }],
meta: {} });

            const result = await client
                .where("status", "==", "active")
                .orderBy("title", "desc")
                .limit(10)
                .offset(0)
                .find();

            expect(result.data).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // Regression: id and fields at top level of flat row
    // -----------------------------------------------------------------------
    describe("id preservation in flat row (regression)", () => {
        it("find keeps id at top level of flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [{ id: "abc",
title: "Test" }],
meta: {} });

            const result = await client.find();
            expect(result.data[0]).toHaveProperty("id", "abc");
            expect(result.data[0]).toHaveProperty("title", "Test");
        });

        it("findById keeps id at top level of flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 42,
title: "Test" });

            const result = await client.findById(42);
            expect(result!.id).toBe(42);
            expect(result!).toHaveProperty("title", "Test");
        });

        it("create keeps id at top level of flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "new-id",
title: "Created" });

            const result = await client.create({ title: "Created" });
            expect(result.id).toBe("new-id");
            expect(result).toHaveProperty("title", "Created");
        });

        it("update keeps id and all fields at top level of flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "existing",
title: "Updated",
status: "published" });

            const result = await client.update("existing", { title: "Updated" });
            expect(result.id).toBe("existing");
            expect(result).toHaveProperty("title", "Updated");
            expect(result).toHaveProperty("status", "published");
        });

        it("preserves all fields from server response in flat row", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 1,
title: "Full",
status: "draft",
tags: ["a", "b"],
extra_field: "kept" });

            const result = await client.findById(1);
            expect(result).toEqual({ id: 1,
title: "Full",
status: "draft",
tags: ["a", "b"],
extra_field: "kept" });
        });

        it("never leaks the CMS Entity wrapper (no path / values fields)", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [{ id: "1",
title: "Flat" }],
meta: { total: 1 } });

            const { data } = await client.find();
            const row = data[0] as Record<string, unknown>;
            // The SDK surface returns plain rows — the Entity view-model
            // (`{ id, path, values }`) must not bleed through.
            expect(row).not.toHaveProperty("path");
            expect(row).not.toHaveProperty("values");
            expect(row.title).toBe("Flat");
        });
    });
});

// --------------------------------------------------------------------------
// FilterValues passthrough (tuples are now passed directly to the driver)
// --------------------------------------------------------------------------
describe("FilterValues passthrough", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<Transport["request"]>;

    beforeEach(() => {
        const result = createMockTransport();
        transport = result.transport;
        mockRequest = result.mockRequest;
    });

    function createClientWithWs() {
        const mockWs = {
            listenCollection: jest.fn().mockReturnValue(() => {}),
            listenOne: jest.fn().mockReturnValue(() => {})
        } as unknown as RebaseWebSocketClient;
        return { client: createCollectionClient<PostModel>(transport, "posts", mockWs),
mockWs };
    }

    it("passes > operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { count: [">", 5] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.count).toEqual([">", 5]);
    });

    it("passes >= operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { count: [">=", 10] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.count).toEqual([">=", 10]);
    });

    it("passes < operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { count: ["<", 3] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.count).toEqual(["<", 3]);
    });

    it("passes != operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { status: ["!=", "draft"] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.status).toEqual(["!=", "draft"]);
    });

    it("passes in operator with array value through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { status: ["in", ["active", "pending"]] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.status).toEqual(["in", ["active", "pending"]]);
    });

    it("passes not-in operator through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { type: ["not-in", ["a", "b"]] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.type).toEqual(["not-in", ["a", "b"]]);
    });

    it("passes array-contains operator through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { tags: ["array-contains", "featured"] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.tags).toEqual(["array-contains", "featured"]);
    });

    it("passes array-contains-any operator through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { tags: ["array-contains-any", ["a", "b", "c"]] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.tags).toEqual(["array-contains-any", ["a", "b", "c"]]);
    });

    it("passes == with boolean true through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { active: ["==", true] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.active).toEqual(["==", true]);
    });

    it("passes == with null through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { deletedAt: ["==", null] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.deletedAt).toEqual(["==", null]);
    });

    it("passes == with string value through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen({ where: { status: ["==", "published"] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.status).toEqual(["==", "published"]);
    });
});



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
    };
    return { transport,
mockRequest };
}

// We need PostModel accessible at top level for the second describe block
interface PostModel {
    title: string;
    status?: string;
    tags?: string[];
}
