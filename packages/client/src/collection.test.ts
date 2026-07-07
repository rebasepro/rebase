import { jest } from "@jest/globals";
import { createCollectionClient } from "./collection";
import type { Transport } from "./transport";

function createMockTransport(): Transport {
    return {
        request: jest.fn<any>().mockResolvedValue({}),
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        baseUrl: "http://localhost:3000",
        apiPath: "/api",
        fetchFn: globalThis.fetch,
        getHeaders: () => ({}),
        resolveToken: jest.fn<any>().mockResolvedValue(null)
    };
}

describe("createCollectionClient", () => {
    let transport: Transport;

    beforeEach(() => {
        transport = createMockTransport();
    });

    describe("count()", () => {
        it("should call the /count endpoint and return the count", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ count: 42 });

            const client = createCollectionClient(transport, "products");
            const result = await client.count();

            expect(transport.request).toHaveBeenCalledWith(
                "/data/products/count",
                { method: "GET" }
            );
            expect(result).toBe(42);
        });

        it("should forward where filters to the count endpoint", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ count: 7 });

            const client = createCollectionClient(transport, "products");
            const result = await client.count({
                where: { status: ["==", "published"] }
            });

            expect(transport.request).toHaveBeenCalledWith(
                expect.stringContaining("/data/products/count?"),
                { method: "GET" }
            );
            // Verify the query string includes the filter
            const calledUrl = (transport.request as ReturnType<typeof jest.fn>).mock.calls[0][0] as string;
            expect(calledUrl).toContain("status=");
            expect(result).toBe(7);
        });

        it("should forward orderBy to the count endpoint", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ count: 15 });

            const client = createCollectionClient(transport, "items");
            const result = await client.count({
                orderBy: ["created_at", "desc"]
            });

            const calledUrl = (transport.request as ReturnType<typeof jest.fn>).mock.calls[0][0] as string;
            expect(calledUrl).toContain("/data/items/count?");
            expect(calledUrl).toContain("orderBy=");
            expect(result).toBe(15);
        });

        it("should NOT include limit or offset in the count request", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ count: 100 });

            const client = createCollectionClient(transport, "users");
            // Even if the caller passes limit/offset in params, they should be stripped
            await client.count({ limit: 50,
offset: 10 });

            const calledUrl = (transport.request as ReturnType<typeof jest.fn>).mock.calls[0][0] as string;
            expect(calledUrl).not.toContain("limit=");
            expect(calledUrl).not.toContain("offset=");
        });

        it("should return 0 when meta.count is missing", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({});

            const client = createCollectionClient(transport, "empty");
            const result = await client.count();

            expect(result).toBe(0);
        });

        it("should forward searchString to the count endpoint", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ count: 3 });

            const client = createCollectionClient(transport, "articles");
            const result = await client.count({
                searchString: "hello world"
            });

            const calledUrl = (transport.request as ReturnType<typeof jest.fn>).mock.calls[0][0] as string;
            expect(calledUrl).toContain("searchString=");
            expect(calledUrl).toContain("hello");
            expect(result).toBe(3);
        });

        it("should forward multiple where filters correctly", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ count: 5 });

            const client = createCollectionClient(transport, "orders");
            await client.count({
                where: {
                    status: ["==", "active"],
                    total: [">=", 100]
                }
            });

            const calledUrl = (transport.request as ReturnType<typeof jest.fn>).mock.calls[0][0] as string;
            expect(calledUrl).toContain("status=");
            expect(calledUrl).toContain("total=");
        });
    });

    describe("find()", () => {
        it("should call the list endpoint and return flat rows", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({
                data: [{ id: "1",
name: "Product A" }],
                meta: { total: 1,
limit: 20,
offset: 0,
hasMore: false }
            });

            const client = createCollectionClient(transport, "products");
            const result = await client.find();

            expect(transport.request).toHaveBeenCalledWith(
                "/data/products",
                { method: "GET" }
            );
            expect(result.data).toHaveLength(1);
            // Flat row access — no .values wrapper
            expect(result.data[0].id).toBe("1");
            expect((result.data[0] as Record<string, unknown>).name).toBe("Product A");
            // No path field — that's CMS leakage
            expect((result.data[0] as Record<string, unknown>).path).toBeUndefined();
            expect(result.meta.total).toBe(1);
        });
    });

    describe("findById()", () => {
        it("should return a flat row directly", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ id: "42", title: "Hello" });

            const client = createCollectionClient(transport, "posts");
            const result = await client.findById("42");

            expect(transport.request).toHaveBeenCalledWith(
                "/data/posts/42",
                { method: "GET" }
            );
            expect(result).toBeDefined();
            expect(result!.id).toBe("42");
            expect((result as Record<string, unknown>).title).toBe("Hello");
        });

        it("should return undefined for 404", async () => {
            const { RebaseApiError } = await import("./transport");
            (transport.request as ReturnType<typeof jest.fn>).mockRejectedValue(
                new RebaseApiError("Not Found", { status: 404 })
            );

            const client = createCollectionClient(transport, "posts");
            const result = await client.findById("999");
            expect(result).toBeUndefined();
        });
    });

    describe("create()", () => {
        it("should return a flat row", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ id: "new-1", title: "Created" });

            const client = createCollectionClient(transport, "posts");
            const result = await client.create({ title: "Created" } as Record<string, unknown>);

            expect(result.id).toBe("new-1");
            expect((result as Record<string, unknown>).title).toBe("Created");
        });
    });

    describe("update()", () => {
        it("should return a flat row", async () => {
            (transport.request as ReturnType<typeof jest.fn>).mockResolvedValue({ id: "1", title: "Updated" });

            const client = createCollectionClient(transport, "posts");
            const result = await client.update("1", { title: "Updated" } as Record<string, unknown>);

            expect(result.id).toBe("1");
            expect((result as Record<string, unknown>).title).toBe("Updated");
        });

        it("should throw RebaseApiError for 404", async () => {
            const { RebaseApiError } = await import("./transport");
            (transport.request as ReturnType<typeof jest.fn>).mockRejectedValue(
                new RebaseApiError("Not Found", { status: 404 })
            );

            const client = createCollectionClient(transport, "posts");
            await expect(
                client.update("999", { title: "Nope" } as Record<string, unknown>)
            ).rejects.toMatchObject({ status: 404 });
        });
    });

    describe("delete()", () => {
        it("should throw RebaseApiError for 404", async () => {
            const { RebaseApiError } = await import("./transport");
            (transport.request as ReturnType<typeof jest.fn>).mockRejectedValue(
                new RebaseApiError("Not Found", { status: 404 })
            );

            const client = createCollectionClient(transport, "posts");
            await expect(client.delete("999")).rejects.toMatchObject({ status: 404 });
        });

        it("should propagate non-404 errors", async () => {
            const { RebaseApiError } = await import("./transport");
            (transport.request as ReturnType<typeof jest.fn>).mockRejectedValue(
                new RebaseApiError("Internal Server Error", { status: 500 })
            );

            const client = createCollectionClient(transport, "posts");
            await expect(client.delete("1")).rejects.toThrow("Internal Server Error");
        });
    });

    describe("count() is defined", () => {
        it("should have count as a defined function on the accessor", () => {
            const client = createCollectionClient(transport, "products");
            expect(typeof client.count).toBe("function");
            expect(client.count).toBeDefined();
        });

        it("should pass the accessor.count truthiness check (used by EntitiesCount component)", () => {
            const client = createCollectionClient(transport, "products");
            // The EntitiesCount component does `if (accessor.count) { ... }`
            // This verifies that check would pass
            expect(!!client.count).toBe(true);
        });
    });
});
