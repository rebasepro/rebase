import { jest } from "@jest/globals";
import { createRebaseClient, RebaseClientError } from "./index";

// Minimal mock: we only need the proxy behavior, not real HTTP calls.
// The global fetch mock prevents the transport from making real requests.
const originalFetch = globalThis.fetch;
beforeAll(() => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}")) as typeof fetch;
});
afterAll(() => {
    globalThis.fetch = originalFetch;
});

const COLLECTIONS = {
    products: "products",
    orders: "orders",
    blogPosts: "blog-posts",
    companyMembers: "company_members",
} as const;

describe("client.data proxy — strict mode (tables dictionary provided)", () => {
    const client = createRebaseClient({
        baseUrl: "http://localhost:3000",
        tables: { ...COLLECTIONS },
    });

    it("resolves a known key to a TableClient", () => {
        const accessor = client.data.table("products");
        expect(accessor).toBeDefined();
        expect(typeof accessor.find).toBe("function");
        expect(typeof accessor.findById).toBe("function");
        expect(typeof accessor.create).toBe("function");
    });

    it("resolves a known camelCase key (blogPosts) to the dictionary's slug", async () => {
        // The accessor is always "defined"; the whole job of the dictionary is
        // that `blogPosts` addresses `blog-posts` on the wire — and NOT the
        // `blog_posts` that the untyped snake_case fallback would produce.
        // A client of its own: the shared one above captured `globalThis.fetch`
        // when this file was collected, which is before `beforeAll` swaps it.
        const fetchMock = jest.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [] })));
        const wired = createRebaseClient({
            baseUrl: "http://localhost:3000",
            fetch: fetchMock as typeof fetch,
            tables: { ...COLLECTIONS }
        });

        const products = (wired.data as Record<string, any>)["products"];
        await products.find();
        expect(String(fetchMock.mock.calls[0][0])).toContain("/data/products");

        const blogPosts = (wired.data as Record<string, any>)["blogPosts"];
        await blogPosts.find();
        const url = String(fetchMock.mock.calls[1][0]);
        expect(url).toContain("/data/blog-posts");
        expect(url).not.toContain("blog_posts");
    });

    it("throws RebaseClientError on unknown key with suggestion", () => {
        const access = () => (client.data as Record<string, unknown>)["prodcuts"];
        expect(access).toThrow(RebaseClientError);

        try {
            access();
        } catch (e) {
            expect(e).toBeInstanceOf(RebaseClientError);
            expect((e as RebaseClientError).message).toContain("prodcuts");
            expect((e as RebaseClientError).message).toContain("products");
            expect((e as RebaseClientError).message).toContain("Did you mean");
            expect((e as RebaseClientError).message).toContain("data.table");
        }
    });

    it("throws RebaseClientError on unknown key without a close match", () => {
        const access = () => (client.data as Record<string, unknown>)["zzz"];
        expect(access).toThrow(RebaseClientError);

        try {
            access();
        } catch (e) {
            expect(e).toBeInstanceOf(RebaseClientError);
            expect((e as RebaseClientError).message).toContain("zzz");
            expect((e as RebaseClientError).message).not.toContain("Did you mean");
        }
    });

    it("lists all known tables in the error message", () => {
        const access = () => (client.data as Record<string, unknown>)["nonexistent"];
        try {
            access();
        } catch (e) {
            const msg = (e as RebaseClientError).message;
            expect(msg).toContain("products");
            expect(msg).toContain("orders");
            expect(msg).toContain("blogPosts");
            expect(msg).toContain("companyMembers");
        }
    });

    it("returns undefined for symbol access", () => {
        expect((client.data as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined();
        expect((client.data as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
    });

    it("returns undefined for 'then' (Promise resolution safe)", () => {
        expect((client.data as Record<string, unknown>)["then"]).toBeUndefined();
    });

    it("returns undefined for 'toJSON'", () => {
        expect((client.data as Record<string, unknown>)["toJSON"]).toBeUndefined();
    });

    it("returns undefined for '$$typeof' (React introspection safe)", () => {
        expect((client.data as Record<string, unknown>)["$$typeof"]).toBeUndefined();
    });

    it("does not throw when awaited in a Promise.resolve context", async () => {
        // `await obj` checks obj.then — which must return undefined, not throw.
        const result = await Promise.resolve(client.data as Record<string, unknown>);
        expect(result).toBeDefined();
    });

    it("table('anything') never throws — dynamic escape hatch", () => {
        expect(() => client.data.table("nonexistent")).not.toThrow();
        expect(() => client.data.table("totally-made-up")).not.toThrow();
        const col = client.data.table("dynamic-slug");
        expect(col).toBeDefined();
        expect(typeof col.find).toBe("function");
    });
});

describe("client.data proxy — untyped mode (no tables dictionary)", () => {
    const client = createRebaseClient({
        baseUrl: "http://localhost:3000",
    });

    it("falls back to snake_case conversion without a dictionary", () => {
        // Should not throw for any property name
        expect(() => (client.data as Record<string, unknown>)["blogPosts"]).not.toThrow();
        expect(() => (client.data as Record<string, unknown>)["anyRandomProp"]).not.toThrow();
    });

    it("returns a TableClient for any camelCase property", () => {
        const accessor = (client.data as Record<string, unknown>)["blogPosts"];
        expect(accessor).toBeDefined();
        expect(typeof (accessor as Record<string, unknown>).find).toBe("function");
    });

    it("returns undefined for symbols, then, toJSON, $$typeof", () => {
        expect((client.data as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined();
        expect((client.data as Record<string, unknown>)["then"]).toBeUndefined();
        expect((client.data as Record<string, unknown>)["toJSON"]).toBeUndefined();
        expect((client.data as Record<string, unknown>)["$$typeof"]).toBeUndefined();
    });

    it("table() still works without a dictionary", () => {
        expect(() => client.data.table("anything")).not.toThrow();
    });

    it("emits a one-shot console.warn on first untyped access", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            // Create a fresh client so the warning flag is reset
            const freshClient = createRebaseClient({
                baseUrl: "http://localhost:3000",
            });
            const readFirst = () => (freshClient.data as Record<string, unknown>)["firstAccess"];
            readFirst();
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("[Rebase] Untyped data access detected")
            );
            // It names the accessor, where it went, and the fix.
            const message = String(warnSpy.mock.calls[0][0]);
            expect(message).toContain("client.data.firstAccess");
            expect(message).toContain("/data/first_access");
            expect(message).toContain("tables: tablesDictionary");
            expect(message).toContain("generated/sdk/database.types");
            expect(message).toContain('client.data.table("<slug>")');

            // Second access should NOT warn again
            warnSpy.mockClear();
            const readSecond = () => (freshClient.data as Record<string, unknown>)["secondAccess"];
            readSecond();
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });
});

describe("client.data — a table whose slug the proxy reserves", () => {
    // Codegen names the accessor `<name>Table` for a slug whose accessor
    // would be `table`, `then`, `toJSON` or `$$typeof`, and maps it back
    // in `tablesDictionary`. This is the client half of that contract.
    type Database = {
        tableTable: { Row: { id: string; title: string }; Slug: "table" };
        thenTable: { Row: { id: string }; Slug: "then" };
    };
    const tablesDictionary = { tableTable: "table", thenTable: "then" } as const;

    it("reaches `/data/table` and `/data/then` through the renamed accessors", async () => {
        const fetchMock = jest.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [] })));
        const client = createRebaseClient<Database>({
            baseUrl: "http://localhost:3000",
            fetch: fetchMock as typeof fetch,
            anonymous: true,
            tables: tablesDictionary
        });

        await client.data.tableTable.find();
        expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/api/data/table");

        await client.data.thenTable.find();
        expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe("/api/data/then");

        // The dynamic form keeps working for the same slug.
        await client.data.table("table").find();
        expect(new URL(String(fetchMock.mock.calls[2][0])).pathname).toBe("/api/data/table");
    });
});

describe("client.data.batch — the RebaseSdkData batch, over HTTP", () => {
    type Database = {
        orders: { Row: { id: string; total: number }; Slug: "orders" };
        orderItems: { Row: { id: string; order_id: string }; Slug: "order_items" };
        batch: { Row: { id: string }; Slug: "batch" };
    };
    const tablesDictionary = { orders: "orders", orderItems: "order_items", batch: "batch" } as const;

    function wired(tables?: typeof tablesDictionary) {
        const fetchMock = jest.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [], meta: { operations: 1 } })));
        const client = createRebaseClient<Database>({
            baseUrl: "http://localhost:3000",
            fetch: fetchMock as typeof fetch,
            anonymous: true,
            ...(tables ? { tables } : {})
        });
        return { client, fetchMock };
    }

    it("posts to /data/_batch with the accessors resolved to slugs, as client.batch does", async () => {
        const { client, fetchMock } = wired(tablesDictionary);

        expect(client.data.batch).toBe(client.batch);
        await client.data.batch([
            { op: "create", table: "orders", values: { total: 40 }, ref: "order" },
            { op: "create", table: "orderItems", values: { order_id: { $ref: "order.id" } } }
        ]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(new URL(String(url)).pathname).toBe("/api/data/_batch");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as { operations: { table: string }[] };
        expect(body.operations.map(o => o.table)).toEqual(["orders", "order_items"]);
    });

    it("is served without a dictionary too, rather than as a table named batch", async () => {
        const { client, fetchMock } = wired();

        expect("batch" in client.data).toBe(true);
        await client.data.batch([{ op: "delete", table: "orders", id: "1" }]);
        expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/api/data/_batch");
    });

    it("leaves a table whose slug is batch reachable through data.table", async () => {
        const { client, fetchMock } = wired(tablesDictionary);

        await client.data.table("batch").find();
        expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/api/data/batch");
    });
});
