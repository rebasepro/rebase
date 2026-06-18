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
                where: { status: "eq.published" }
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
                orderBy: "created_at:desc"
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
                    status: "eq.active",
                    total: [">=", 100]
                }
            });

            const calledUrl = (transport.request as ReturnType<typeof jest.fn>).mock.calls[0][0] as string;
            expect(calledUrl).toContain("status=");
            expect(calledUrl).toContain("total=");
        });
    });

    describe("find()", () => {
        it("should call the list endpoint and return entities", async () => {
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
            expect(result.data[0].id).toBe("1");
            expect(result.data[0].path).toBe("products");
            expect(result.meta.total).toBe(1);
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
