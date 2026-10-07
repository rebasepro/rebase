import { describe, expect, it, jest } from "@jest/globals";
import { createCollectionClient } from "./collection";
import { buildQueryBody, buildQueryString, createTransport, RebaseApiError, type FindParams } from "./transport";

/**
 * Which verb a `count()` goes out as — the rule `find()` follows.
 *
 * A count carries the filters of the `find()` it describes, so a vector search
 * or a long `in` list makes its URL as long as the listing's: past Node's
 * 16 KB (431) or a proxy's 8 KB (414). `find()` moved those to the body of
 * `POST …/query`; `count()` kept sending them in the URL of `GET …/count`. It
 * now sends them as `POST …/count`, and anything else stays the `GET` it was.
 * An older server has no such route and answers 404, and the count goes again
 * as the `GET`.
 */

interface Sent { url: string; method: string; body?: string }

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

const COUNTED = { count: 7 };
const ok = (sent: Sent) => sent.url.includes("/count") ? { status: 200, body: COUNTED } : { status: 200, body: { data: [], meta: {} } };
const embedding = (dims: number) => Array.from({ length: dims }, (_, i) => Math.sin(i));
const vector = { vectorSearch: { property: "embedding", vector: [0.1, 0.2], threshold: 0.4 } } satisfies FindParams;

/** The parameters a count sends: the find's, less the ones that cannot change the answer. */
const counted = (params: FindParams): FindParams => ({ ...params, limit: undefined, offset: undefined, include: undefined, count: undefined });

describe("count() over HTTP", () => {
    it("sends a vector search as POST …/count", async () => {
        const { posts, sent } = client(ok);
        expect(await posts.count(vector)).toBe(7);
        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe("POST");
        expect(sent[0].url).toBe("http://api.test/api/data/posts/count");
    });

    it("puts in the body exactly the parameters the GET's URL would carry", async () => {
        const params: FindParams = {
            vectorSearch: { property: "embedding", vector: embedding(1536), distance: "cosine", threshold: 0.4 },
            where: { status: ["==", "published"], views: [[">=", 10], ["<", 99]] },
            searchString: "hello",
            limit: 7,
            include: ["author"]
        };
        const { posts, sent } = client(ok);
        await posts.count(params);

        expect(JSON.parse(sent[0].body!)).toEqual(buildQueryBody(counted(params)));
        const url = new URLSearchParams(buildQueryString(counted(params)).slice(1));
        expect(Object.keys(JSON.parse(sent[0].body!)).sort()).toEqual([...new Set(url.keys())].sort());
        // Nothing a count does not read rides along.
        expect(JSON.parse(sent[0].body!)).not.toHaveProperty("limit");
        expect(JSON.parse(sent[0].body!)).not.toHaveProperty("include");
    });

    it("keeps an ordinary count a GET, URL unchanged", async () => {
        const { posts, sent } = client(ok);
        const params: FindParams = { where: { status: ["==", "draft"] }, limit: 5 };
        await posts.count(params);
        expect(sent[0].method).toBe("GET");
        expect(sent[0].url).toBe(`http://api.test/api/data/posts/count${buildQueryString(counted(params))}`);
    });

    it("sends a count whose URL would pass a proxy's limit as a POST too", async () => {
        const { posts, sent } = client(ok);
        const ids = Array.from({ length: 1200 }, (_, i) => `id-${i}`);
        await posts.count({ where: { id: ["in", ids] } });
        expect(sent[0].method).toBe("POST");
        expect(sent[0].url).toBe("http://api.test/api/data/posts/count");
        expect(JSON.parse(sent[0].body!).id).toContain("id-1199");
    });

    it("falls back to the GET against a server without the route, once per transport", async () => {
        const { posts, sent } = client(request => request.method === "POST"
            ? { status: 404, body: { error: { code: "NOT_FOUND", message: "No POST route on collection 'posts' at this path." } } }
            : ok(request));

        expect(await posts.count(vector)).toBe(7);
        expect(await posts.count(vector)).toBe(7);

        expect(sent.map(s => s.method)).toEqual(["POST", "GET", "GET"]);
        expect(sent[1].url).toBe(`http://api.test/api/data/posts/count${buildQueryString(vector)}`);
    });

    it("falls back on a 405 from something in front of the server", async () => {
        const { posts, sent } = client(request => request.method === "POST" ? { status: 405 } : ok(request));
        expect(await posts.count(vector)).toBe(7);
        expect(sent.map(s => s.method)).toEqual(["POST", "GET"]);
    });

    it("does not conclude the route is missing from a collection that is", async () => {
        const unknown = { status: 404, body: { error: { code: "NOT_FOUND", message: "Unknown collection 'posts'." } } };
        const { posts, sent } = client(() => unknown);

        await expect(posts.count(vector)).rejects.toBeInstanceOf(RebaseApiError);
        await expect(posts.count(vector)).rejects.toMatchObject({ status: 404 });
        expect(sent.map(s => s.method)).toEqual(["POST", "GET", "POST", "GET"]);
    });

    it("does not fall back from a refusal of the query itself", async () => {
        const { posts, sent } = client(() => ({ status: 400, body: { error: { code: "INVALID_VECTOR", message: "no" } } }));
        await expect(posts.count(vector)).rejects.toMatchObject({ status: 400, code: "INVALID_VECTOR" });
        expect(sent.map(s => s.method)).toEqual(["POST"]);
    });

    it("still shares one request between concurrent identical counts", async () => {
        const { posts, sent } = client(ok);
        const [a, b] = await Promise.all([posts.count(vector), posts.count(vector)]);
        expect([a, b]).toEqual([7, 7]);
        expect(sent).toHaveLength(1);
    });
});
