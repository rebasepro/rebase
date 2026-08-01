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

describe("client.data proxy — strict mode (collections dictionary provided)", () => {
    const client = createRebaseClient({
        baseUrl: "http://localhost:3000",
        collections: { ...COLLECTIONS },
    });

    it("resolves a known key to a CollectionClient", () => {
        const accessor = client.data.collection("products");
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
        const fetchMock = jest.fn<typeof fetch>(async () => new Response("{}"));
        const wired = createRebaseClient({
            baseUrl: "http://localhost:3000",
            fetch: fetchMock as typeof fetch,
            collections: { ...COLLECTIONS }
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
            expect((e as RebaseClientError).message).toContain("data.collection");
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

    it("lists all known collections in the error message", () => {
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

    it("collection('anything') never throws — dynamic escape hatch", () => {
        expect(() => client.data.collection("nonexistent")).not.toThrow();
        expect(() => client.data.collection("totally-made-up")).not.toThrow();
        const col = client.data.collection("dynamic-slug");
        expect(col).toBeDefined();
        expect(typeof col.find).toBe("function");
    });
});

describe("client.data proxy — untyped mode (no collections dictionary)", () => {
    const client = createRebaseClient({
        baseUrl: "http://localhost:3000",
    });

    it("falls back to snake_case conversion without a dictionary", () => {
        // Should not throw for any property name
        expect(() => (client.data as Record<string, unknown>)["blogPosts"]).not.toThrow();
        expect(() => (client.data as Record<string, unknown>)["anyRandomProp"]).not.toThrow();
    });

    it("returns a CollectionClient for any camelCase property", () => {
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

    it("collection() still works without a dictionary", () => {
        expect(() => client.data.collection("anything")).not.toThrow();
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
