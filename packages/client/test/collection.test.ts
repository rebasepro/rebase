import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createCollectionClient } from "../src/collection";
import { Transport } from "../src/transport";
import { RebaseWebSocketClient } from "../src/websocket";
import { Entity } from "@rebasepro/types";

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
        it("calls GET /data/slug with correct query parameters and wraps into Entity", async () => {
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
path: "posts",
values: { id: 1,
title: "Hello" } }],
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

        it("wraps multiple rows into correct Entity shape", async () => {
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
path: "posts",
values: { id: "a",
title: "First",
status: "published" } });
            expect(result.data[1]).toEqual({ id: "b",
path: "posts",
values: { id: "b",
title: "Second",
status: "draft" } });
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
        it("calls GET /data/slug/id and wraps into Entity", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "123",
title: "Test" });

            const result = await client.findById("123");
            expect(result).toEqual({ id: "123",
path: "posts",
values: { id: "123",
title: "Test" } });
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
        it("calls POST /data/slug with JSON body and wraps response into Entity", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 1,
title: "New" });

            const input: Partial<PostModel> = { title: "New" };
            const result = await client.create(input);

            expect(result).toEqual({ id: 1,
path: "posts",
values: { id: 1,
title: "New" } });
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
path: "posts",
values: { id: "custom-id",
title: "Custom" } });
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
        it("calls PUT /data/slug/id with JSON body and wraps response into Entity", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 1,
title: "Updated" });

            const patch: Partial<PostModel> = { title: "Updated" };
            const result = await client.update(1, patch);

            expect(result).toEqual({ id: 1,
path: "posts",
values: { id: 1,
title: "Updated" } });
            expect(mockRequest).toHaveBeenCalledWith("/data/posts/1", { method: "PUT",
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
    describe("listen / listenById", () => {
        it("does not expose listen/listenById when no websocket is provided", () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            expect(client.listen).toBeUndefined();
            expect(client.listenById).toBeUndefined();
        });

        it("exposes listen/listenById when websocket is provided", () => {
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(() => {}),
                listenEntity: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            expect(typeof client.listen).toBe("function");
            expect(typeof client.listenById).toBe("function");
        });

        it("listen passes correct parameters to ws.listenCollection", () => {
            const unsubFn = jest.fn();
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(unsubFn),
                listenEntity: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            const onUpdate = jest.fn();
            const onError = jest.fn();

            const result = client.listen!({ limit: 10,
orderBy: ["title", "desc"] }, onUpdate, onError);

            expect(mockWs.listenCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "posts",
                    limit: 10,
                    orderBy: "title",
                    order: "desc"
                }),
                expect.any(Function),
                onError
            );
            expect(result).toBeDefined();
        });

        it("listen callback transforms entities into the expected format", () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenEntity: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            const onUpdate = jest.fn();
            client.listen!(undefined, onUpdate);

            const entities: Entity[] = [
                { id: "1",
path: "posts",
values: { title: "A" } },
                { id: "2",
path: "posts",
values: { title: "B" } }
            ];
            capturedCallback!(entities);

            expect(onUpdate).toHaveBeenCalledWith({
                data: entities,
                meta: expect.objectContaining({
                    total: 2,
                    limit: 20,
                    offset: 0,
                    hasMore: false,
                    estimated: true
                })
            });
        });

        it("listen callback asynchronously fetches real count from count endpoint", async () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenEntity: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            client.count = jest.fn().mockResolvedValue(100);

            const onUpdate = jest.fn();
            client.listen!({ limit: 10, offset: 5 }, onUpdate);

            const entities: Entity[] = [
                { id: "1", path: "posts", values: { title: "A" } },
                { id: "2", path: "posts", values: { title: "B" } }
            ];

            // Trigger first synchronous update (heuristic meta)
            capturedCallback!(entities);

            expect(onUpdate).toHaveBeenLastCalledWith({
                data: entities,
                meta: {
                    total: 2,
                    limit: 10,
                    offset: 5,
                    hasMore: false,
                    estimated: true
                }
            });

            // Wait for count promise to resolve
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(client.count).toHaveBeenCalledWith({ limit: 10, offset: 5 });
            // Second emission has authoritative meta (no estimated flag)
            expect(onUpdate).toHaveBeenCalledTimes(2);
            expect(onUpdate).toHaveBeenLastCalledWith({
                data: entities,
                meta: {
                    total: 100,
                    limit: 10,
                    offset: 5,
                    hasMore: true
                }
            });
        });

        it("listen deduplicates when count matches the heuristic estimate", async () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenEntity: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            // Return a count that matches the heuristic: 2 entities, limit 20 → heuristic total=2, hasMore=false
            // Authoritative: count=2, hasMore=(0 + 2 < 2)=false → same as heuristic
            client.count = jest.fn().mockResolvedValue(2);

            const onUpdate = jest.fn();
            client.listen!(undefined, onUpdate);

            const entities: Entity[] = [
                { id: "1", path: "posts", values: { title: "A" } },
                { id: "2", path: "posts", values: { title: "B" } }
            ];

            capturedCallback!(entities);

            // First emission with estimated flag
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith({
                data: entities,
                meta: {
                    total: 2,
                    limit: 20,
                    offset: 0,
                    hasMore: false,
                    estimated: true
                }
            });

            // Wait for count promise to resolve
            await new Promise(resolve => setTimeout(resolve, 0));

            // No second emission — count matched the heuristic
            expect(onUpdate).toHaveBeenCalledTimes(1);
        });

        it("listen keeps estimated flag standing when count rejects", async () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                }),
                listenEntity: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            client.count = jest.fn().mockRejectedValue(new Error("Network error"));

            const onUpdate = jest.fn();
            client.listen!(undefined, onUpdate);

            const entities: Entity[] = [
                { id: "1", path: "posts", values: { title: "A" } }
            ];

            capturedCallback!(entities);

            // First emission with estimated flag
            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenCalledWith({
                data: entities,
                meta: {
                    total: 1,
                    limit: 20,
                    offset: 0,
                    hasMore: false,
                    estimated: true
                }
            });

            // Wait for count rejection to settle
            await new Promise(resolve => setTimeout(resolve, 0));

            // No second emission, no unhandled rejection
            expect(onUpdate).toHaveBeenCalledTimes(1);
        });

        it("listenById passes correct parameters to ws.listenEntity", () => {
            const unsubFn = jest.fn();
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(() => {}),
                listenEntity: jest.fn().mockReturnValue(unsubFn)
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            const onUpdate = jest.fn();

            client.listenById!("abc", onUpdate);

            expect(mockWs.listenEntity).toHaveBeenCalledWith(
                { path: "posts",
entityId: "abc" },
                expect.any(Function),
                undefined
            );
        });

        it("listenById callback passes entity or undefined", () => {
            let capturedCallback: Function;
            const mockWs = {
                listenCollection: jest.fn().mockReturnValue(() => {}),
                listenEntity: jest.fn().mockImplementation((_props, cb: Function) => {
                    capturedCallback = cb;
                    return () => {};
                })
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            const onUpdate = jest.fn();
            client.listenById!("abc", onUpdate);

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
                listenEntity: jest.fn().mockReturnValue(() => {})
            } as unknown as RebaseWebSocketClient;

            const client = createCollectionClient<PostModel>(transport, "posts", mockWs);
            client.listen!(
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
    // Regression: id fields must stay in values
    // -----------------------------------------------------------------------
    describe("id preservation in values (regression)", () => {
        it("find keeps id inside entity values", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ data: [{ id: "abc",
title: "Test" }],
meta: {} });

            const result = await client.find();
            expect(result.data[0].values).toHaveProperty("id", "abc");
            expect(result.data[0].id).toBe("abc");
        });

        it("findById keeps id inside entity values", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 42,
title: "Test" });

            const result = await client.findById(42);
            expect(result!.values).toHaveProperty("id", 42);
            expect(result!.id).toBe(42);
        });

        it("create keeps id inside entity values", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "new-id",
title: "Created" });

            const result = await client.create({ title: "Created" });
            expect(result.values).toHaveProperty("id", "new-id");
            expect(result.id).toBe("new-id");
        });

        it("update keeps id inside entity values", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: "existing",
title: "Updated",
status: "published" });

            const result = await client.update("existing", { title: "Updated" });
            expect(result.values).toHaveProperty("id", "existing");
            expect(result.values).toHaveProperty("title", "Updated");
            expect(result.values).toHaveProperty("status", "published");
            expect(result.id).toBe("existing");
        });

        it("preserves all fields from server response in values", async () => {
            const client = createCollectionClient<PostModel>(transport, "posts");
            mockRequest.mockResolvedValueOnce({ id: 1,
title: "Full",
status: "draft",
tags: ["a", "b"],
extra_field: "kept" });

            const result = await client.findById(1);
            expect(result!.values).toEqual({ id: 1,
title: "Full",
status: "draft",
tags: ["a", "b"],
extra_field: "kept" });
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
            listenEntity: jest.fn().mockReturnValue(() => {})
        } as unknown as RebaseWebSocketClient;
        return { client: createCollectionClient<PostModel>(transport, "posts", mockWs),
mockWs };
    }

    it("passes > operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { count: [">", 5] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.count).toEqual([">", 5]);
    });

    it("passes >= operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { count: [">=", 10] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.count).toEqual([">=", 10]);
    });

    it("passes < operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { count: ["<", 3] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.count).toEqual(["<", 3]);
    });

    it("passes != operator tuple through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { status: ["!=", "draft"] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.status).toEqual(["!=", "draft"]);
    });

    it("passes in operator with array value through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { status: ["in", ["active", "pending"]] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.status).toEqual(["in", ["active", "pending"]]);
    });

    it("passes not-in operator through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { type: ["not-in", ["a", "b"]] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.type).toEqual(["not-in", ["a", "b"]]);
    });

    it("passes array-contains operator through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { tags: ["array-contains", "featured"] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.tags).toEqual(["array-contains", "featured"]);
    });

    it("passes array-contains-any operator through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { tags: ["array-contains-any", ["a", "b", "c"]] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.tags).toEqual(["array-contains-any", ["a", "b", "c"]]);
    });

    it("passes == with boolean true through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { active: ["==", true] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.active).toEqual(["==", true]);
    });

    it("passes == with null through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { deletedAt: ["==", null] } }, jest.fn());
        const filter = (mockWs.listenCollection as jest.Mock).mock.calls[0][0].filter;
        expect(filter.deletedAt).toEqual(["==", null]);
    });

    it("passes == with string value through unchanged", () => {
        const { client, mockWs } = createClientWithWs();
        client.listen!({ where: { status: ["==", "published"] } }, jest.fn());
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
