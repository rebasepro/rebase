import { describe, expect, it, jest } from "@jest/globals";
import { createCollectionClient } from "./collection";
import { buildQueryBody, buildQueryString, createTransport, RebaseApiError, type FindParams } from "./transport";

/**
 * Which verb a `find()` goes out as.
 *
 * A vector search's embedding is a JSON array, and in the URL 768 dimensions
 * of it are 17 KB — past Node's 16 KB header limit (431) and nginx's 8 KB
 * request line (414). So a vector search, and any other query whose URL would
 * not fit through a proxy, is sent as `POST /data/<collection>/query` with the
 * same parameters in the body; everything else stays the `GET` it was. An
 * older server has no such route and answers 404, and the read goes again as
 * the `GET`.
 */

interface Sent { url: string; method: string; body?: string }

/** A real transport over a fetch that answers from `answer` and writes every request down. */
function client(answer: (sent: Sent) => { status: number; body?: unknown }) {
    const sent: Sent[] = [];
    const fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
        const request: Sent = { url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined };
        sent.push(request);
        const { status, body } = answer(request);
        return new Response(body === undefined ? null : JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" }
        });
    });
    const transport = createTransport({ baseUrl: "http://api.test", token: "t", fetch: fetch as unknown as typeof globalThis.fetch });
    return { posts: createCollectionClient(transport, "posts"), sent };
}

const PAGE = { data: [{ id: 1 }], meta: { total: 1, limit: 10, offset: 0, hasMore: false } };
const ok = () => ({ status: 200, body: PAGE });
const embedding = (dims: number) => Array.from({ length: dims }, (_, i) => Math.sin(i));

describe("find() over HTTP", () => {
    it("sends a vector search as POST …/query, whatever its size", async () => {
        const { posts, sent } = client(ok);
        await posts.find({ vectorSearch: { property: "embedding", vector: [0.1, 0.2] }, limit: 5 });
        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe("POST");
        expect(sent[0].url).toBe("http://api.test/api/data/posts/query");
    });

    it("puts in the body exactly the parameters the GET's URL would carry", async () => {
        const params: FindParams = {
            vectorSearch: { property: "embedding", vector: embedding(1536), distance: "cosine", threshold: 0.4 },
            where: { status: ["==", "published"], views: [[">=", 10], ["<", 99]], page: ["==", 3] },
            orderBy: "title:desc",
            include: ["author"],
            fields: ["id", "title"],
            limit: 7,
            offset: 14,
            count: "none"
        };
        const { posts, sent } = client(ok);
        await posts.find(params);

        const url = new URLSearchParams(buildQueryString(params).slice(1));
        const fromUrl: Record<string, string | string[]> = {};
        for (const name of new Set(url.keys())) {
            const values = url.getAll(name);
            fromUrl[name] = values.length === 1 ? values[0] : values;
        }
        expect(JSON.parse(sent[0].body!)).toEqual(fromUrl);
        expect(JSON.parse(sent[0].body!)).toEqual(buildQueryBody(params));
        // The repeated filter stays repeated, the reserved-name filter rides in `where`.
        expect(fromUrl.views).toHaveLength(2);
        expect(fromUrl.where).toBe(JSON.stringify({ page: "eq.3" }));
    });

    it("keeps an ordinary query a GET, URL unchanged", async () => {
        const { posts, sent } = client(ok);
        const params: FindParams = { where: { status: ["==", "draft"] }, limit: 5 };
        await posts.find(params);
        expect(sent[0].method).toBe("GET");
        expect(sent[0].url).toBe(`http://api.test/api/data/posts${buildQueryString(params)}`);
    });

    it("sends a query whose URL would pass a proxy's limit as a POST too", async () => {
        const { posts, sent } = client(ok);
        const ids = Array.from({ length: 1200 }, (_, i) => `id-${i}`);
        await posts.find({ where: { id: ["in", ids] } });
        expect(sent[0].method).toBe("POST");
        expect(JSON.parse(sent[0].body!).id).toContain("id-1199");
    });

    it("falls back to the GET against a server without the route, once per transport", async () => {
        const { posts, sent } = client(request => request.method === "POST"
            ? { status: 404, body: { error: { code: "NOT_FOUND", message: "No POST route on collection 'posts' at this path." } } }
            : ok());
        const vector = { vectorSearch: { property: "embedding", vector: [0.1, 0.2] } };

        expect((await posts.find(vector)).data).toEqual(PAGE.data);
        await posts.find(vector);

        expect(sent.map(s => s.method)).toEqual(["POST", "GET", "GET"]);
        expect(sent[1].url).toBe(`http://api.test/api/data/posts${buildQueryString(vector)}`);
    });

    it("falls back on a 405 from something in front of the server", async () => {
        const { posts, sent } = client(request => request.method === "POST" ? { status: 405 } : ok());
        await posts.find({ vectorSearch: { property: "embedding", vector: [1] } });
        expect(sent.map(s => s.method)).toEqual(["POST", "GET"]);
    });

    it("surfaces the old server's own refusal of a URL too long for it", async () => {
        const { posts } = client(request => request.method === "POST" ? { status: 404 } : { status: 431 });
        await expect(posts.find({ vectorSearch: { property: "embedding", vector: embedding(1536) } }))
            .rejects.toMatchObject({ status: 431 });
    });

    it("does not conclude the route is missing from a collection that is", async () => {
        const unknown = { status: 404, body: { error: { code: "NOT_FOUND", message: "Unknown collection 'posts'." } } };
        const { posts, sent } = client(() => unknown);
        const vector = { vectorSearch: { property: "embedding", vector: [1] } };

        await expect(posts.find(vector)).rejects.toBeInstanceOf(RebaseApiError);
        await expect(posts.find(vector)).rejects.toMatchObject({ status: 404 });

        // Both reads tried the POST first: one unknown collection is not a server without the route.
        expect(sent.map(s => s.method)).toEqual(["POST", "GET", "POST", "GET"]);
    });

    it("does not fall back from a refusal of the query itself", async () => {
        const { posts, sent } = client(() => ({ status: 400, body: { error: { code: "INVALID_VECTOR", message: "no" } } }));
        await expect(posts.find({ vectorSearch: { property: "embedding", vector: [1] } }))
            .rejects.toMatchObject({ status: 400, code: "INVALID_VECTOR" });
        expect(sent.map(s => s.method)).toEqual(["POST"]);
    });
});
