import { jest } from "@jest/globals";
import { Hono } from "hono";
import { encodeCursor } from "@rebasepro/common";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { RestApiGenerator } from "./api-generator";
import { errorHandler } from "../errors";
import { queryDictFromBody } from "./query-body";
import { generateOpenApiSpec } from "../openapi-generator";

/**
 * `POST /<collection>/query` is the `GET` listing with its parameters in the
 * body — the same parser, the same handler — so for any set of parameters the
 * two must ask the driver the same questions and answer the same thing, error
 * or page.
 *
 * The matrix below is that claim, parameter by parameter. Each `GET` query is
 * turned into a body the way a client would spell it (one value a string,
 * a repeated parameter a list) and both requests run against one recording
 * driver; the driver calls and the responses are compared whole. A divergence
 * in either is a parameter the two routes read differently.
 */

const authors = {
    slug: "authors", name: "Authors", table: "authors",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        posts: { type: "relation", relation: { kind: "hasMany", target: () => posts, foreignKeyOnTarget: "author_id" } }
    }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts", name: "Posts", table: "posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        status: { type: "string" },
        views: { type: "number" },
        embedding: { type: "vector", dimensions: 3 },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } }
    }
} as unknown as CollectionConfig;

const ROWS = [
    { id: 3, title: "c", status: "draft", views: 30 },
    { id: 2, title: "b", status: "published", views: 20 },
    { id: 1, title: "a", status: "published", views: 10 }
];

interface Recorded {
    driver: DataDriver;
    calls: { method: string; args: unknown[] }[];
}

/** A driver that answers three rows and a count of 42, and writes down every call. */
function recordingDriver(): Recorded {
    const calls: Recorded["calls"] = [];
    const record = (method: string, answer: unknown) => jest.fn(async (...args: unknown[]) => {
        calls.push({ method, args: JSON.parse(JSON.stringify(args)) });
        return answer;
    });
    const driver = {
        key: "postgres",
        initialised: true,
        restFetchService: {
            fetchCollectionForRest: record("fetchCollectionForRest", ROWS),
            fetchOneForRest: record("fetchOneForRest", undefined),
            cursorFor: (_path: string, row: Record<string, unknown>) => encodeCursor(undefined, row, row.id)
        },
        count: record("count", 42),
        fetchCollection: record("fetchCollection", ROWS),
        fetchOne: record("fetchOne", undefined),
        save: record("save", {}),
        saveMany: record("saveMany", []),
        delete: record("delete", undefined),
        deleteMany: record("deleteMany", undefined)
    } as unknown as DataDriver;
    return { driver, calls };
}

function appFor(driver: DataDriver, scopes?: string[]): Hono {
    const app = new Hono();
    app.onError(errorHandler as never);
    app.use("/*", async (c, next) => {
        c.set("driver" as never, driver as never);
        if (scopes) c.set("scopes" as never, scopes as never);
        await next();
    });
    app.route("/", new RestApiGenerator([authors, posts], driver).generateRoutes() as never);
    return app;
}

/** What a response says, without what varies per request. */
async function answerOf(res: Response): Promise<{ status: number; body: unknown }> {
    const body = await res.json() as Record<string, unknown>;
    const error = body.error as Record<string, unknown> | undefined;
    if (error) delete error.requestId;
    return { status: res.status, body };
}

/** A query string as the body a client would send: one value a string, a repeated one a list. */
function bodyFromQuery(query: string): Record<string, unknown> {
    const params = new URLSearchParams(query);
    const body: Record<string, unknown> = {};
    for (const key of new Set(params.keys())) {
        const values = params.getAll(key);
        body[key] = values.length === 1 ? values[0] : values;
    }
    return body;
}

async function both(
    getPath: string,
    postPath: string,
    query: string,
    body: Record<string, unknown> = bodyFromQuery(query),
    scopes?: string[]
) {
    const get = recordingDriver();
    const post = recordingDriver();
    const getAnswer = await answerOf(await appFor(get.driver, scopes).request(
        `${getPath}${query ? `?${new URLSearchParams(query).toString()}` : ""}`
    ));
    const postAnswer = await answerOf(await appFor(post.driver, scopes).request(postPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
    return { get: { ...getAnswer, calls: get.calls }, post: { ...postAnswer, calls: post.calls } };
}

const cursor = encodeCursor(undefined, { id: 2 }, 2)!;

/** `[name, GET query]` — every parameter the listing reads, and the ways each is refused. */
const MATRIX: [string, string][] = [
    ["no parameters", ""],
    ["limit and offset", "limit=2&offset=1"],
    ["page", "page=2&limit=2"],
    ["orderBy shorthand", "orderBy=title:desc:last"],
    ["orderBy JSON", "orderBy=[{\"field\":\"views\",\"direction\":\"desc\"},{\"field\":\"title\"}]"],
    ["per-field filters, one repeated", "status=eq.published&views=gte.10&views=lte.99"],
    ["where JSON", "where={\"status\":[\"==\",\"draft\"]}"],
    ["where beside a per-field filter", "where={\"status\":[\"==\",\"draft\"]}&status=eq.published"],
    ["or", "or=(status.eq.draft,views.gte.25)"],
    ["and", "and=(status.eq.draft,views.gte.25)"],
    ["not", "not=(status.eq.draft)"],
    ["include names", "include=author"],
    ["include JSON", "include={\"author\":{\"fields\":\"id,name\"}}"],
    ["fields and distinct", "fields=id,status&distinct=true"],
    ["count=none", "count=none&limit=2"],
    ["cursor", `after=${cursor}&limit=2`],
    ["search", "searchString=hello&searchExplain=true"],
    ["vector search", "vector_search=embedding&vector=[0.1,0.2,0.3]&vector_distance=l2&limit=2"],
    ["vector search with a threshold", "vector_search=embedding&vector=[0.1,0.2,0.3]&vector_threshold=0.5&limit=2"],
    ["deleted", "deleted=include"],
    ["refused: limit 0", "limit=0"],
    ["refused: limit past the ceiling", "limit=100000"],
    ["refused: offset", "offset=-1"],
    ["refused: count", "count=nnone"],
    ["refused: orderBy direction", "orderBy=title:sideways"],
    ["refused: where", "where=not-json"],
    ["refused: logical group", `or=${"(".repeat(200)}`],
    ["refused: include", "include=a.b.c.d.e"],
    ["refused: distinct", "distinct=ture"],
    ["refused: cursor", "after=garbage"],
    ["refused: cursor with offset", `after=${cursor}&offset=2`],
    ["refused: vector", "vector_search=embedding&vector=not-json"],
    ["refused: vector distance", "vector_search=embedding&vector=[1,2,3]&vector_distance=manhattan"],
    ["refused: vector threshold", "vector_search=embedding&vector=[1,2,3]&vector_threshold=far"],
    ["refused: unknown filter operator", "views=zz.3"],
    ["refused: unknown field", "orderBy=nope"]
];

describe("POST /<collection>/query answers exactly what GET /<collection> answers", () => {
    it.each(MATRIX)("%s", async (_name, query) => {
        const { get, post } = await both("/posts", "/posts/query", query);
        expect(post.status).toBe(get.status);
        expect(post.body).toEqual(get.body);
        expect(post.calls).toEqual(get.calls);
    });

    it("covers pages, counts and refusals alike — the matrix is not all one kind", async () => {
        const statuses = new Set<number>();
        for (const [, query] of MATRIX) {
            const { get } = await both("/posts", "/posts/query", query);
            statuses.add(get.status);
            if (get.status === 200) expect(get.calls.length).toBeGreaterThan(0);
        }
        expect(statuses).toEqual(new Set([200, 400]));
    });

    it.each([
        ["a vector as a JSON array", "vector_search=embedding&vector=[0.1,0.2,0.3]&vector_threshold=0.5&limit=4",
            { vector_search: "embedding", vector: [0.1, 0.2, 0.3], vector_threshold: 0.5, limit: 4 }],
        ["where as an object", "where={\"status\":[\"==\",\"draft\"]}", { where: { status: ["==", "draft"] } }],
        ["include as an object", "include={\"author\":{\"fields\":\"id\"}}", { include: { author: { fields: "id" } } }],
        ["orderBy as a list", "orderBy=[{\"field\":\"views\",\"direction\":\"desc\"}]",
            { orderBy: [{ field: "views", direction: "desc" }] }],
        ["numbers and booleans", "limit=2&offset=1&distinct=true&fields=id,status", { limit: 2, offset: 1, distinct: true, fields: "id,status" }]
    ])("takes %s, as the GET's URL spells it", async (_name, query, body) => {
        const { get, post } = await both("/posts", "/posts/query", query, body);
        expect(get.status).toBe(200);
        expect(post.status).toBe(200);
        expect(post.body).toEqual(get.body);
        expect(post.calls).toEqual(get.calls);
    });

    it("lists a nested path the same way", async () => {
        for (const query of ["", "limit=1&orderBy=title:desc", "status=eq.draft&count=none", "limit=0"]) {
            const { get, post } = await both("/authors/1/posts", "/authors/1/posts/query", query);
            expect(post.status).toBe(get.status);
            expect(post.body).toEqual(get.body);
            expect(post.calls).toEqual(get.calls);
        }
    });

    it("never writes", async () => {
        const { post } = await both("/posts", "/posts/query", "limit=2&status=eq.draft");
        expect(new Set(post.calls.map(call => call.method))).toEqual(new Set(["fetchCollectionForRest", "count"]));
    });
});

describe("what a credential needs for POST /<collection>/query", () => {
    it("is data:read, as the GET — a read-only key can search", async () => {
        const { get, post } = await both("/posts", "/posts/query", "limit=2", undefined, ["data:read:posts"]);
        expect(get.status).toBe(200);
        expect(post.status).toBe(200);
    });

    it("and data:write is not it: a write-only key reads nothing through the POST", async () => {
        const { get, post } = await both("/posts", "/posts/query", "limit=2", undefined, ["data:write"]);
        expect(get.status).toBe(403);
        expect(post.status).toBe(403);
        expect(post.body).toEqual(get.body);
        expect(post.calls).toEqual([]);
    });

    it("is read on every collection a nested path passes through", async () => {
        const { get, post } = await both("/authors/1/posts", "/authors/1/posts/query", "", undefined, ["data:read:posts"]);
        expect(get.status).toBe(403);
        expect(post.status).toBe(403);
        expect(post.body).toEqual(get.body);
    });
});

describe("a body the GET's URL could not have carried", () => {
    const post = async (path: string, body: string) => {
        const recorded = recordingDriver();
        const res = await appFor(recorded.driver).request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
        });
        return { ...(await answerOf(res)), calls: recorded.calls };
    };

    it.each([
        ["a list for a parameter the URL reads once", JSON.stringify({ fields: ["id", "title"] })],
        ["an object for a filter", JSON.stringify({ status: { eq: "draft" } })],
        ["a list of objects for a filter", JSON.stringify({ status: [{ eq: "draft" }] })]
    ])("refuses %s, rather than reading its last value", async (_name, body) => {
        const answer = await post("/posts/query", body);
        expect(answer.status).toBe(400);
        expect((answer.body as { error: { code: string } }).error.code).toBe("INVALID_QUERY_BODY");
        expect(answer.calls).toEqual([]);
    });

    it("refuses a parameter on the URL as well, which would be two answers to which one applied", async () => {
        const answer = await post("/posts/query?limit=5", JSON.stringify({ limit: 2 }));
        expect(answer.status).toBe(400);
        expect((answer.body as { error: { code: string; message: string } }).error.code).toBe("INVALID_QUERY_BODY");
        expect((answer.body as { error: { message: string } }).error.message).toContain("'limit'");
    });

    it("refuses a body that is not a JSON object", async () => {
        for (const body of ["[1,2]", "not json", "42"]) {
            const answer = await post("/posts/query", body);
            expect(answer.status).toBe(400);
            expect(answer.calls).toEqual([]);
        }
    });

    it("reads an empty body as a listing with no parameters", async () => {
        const answer = await post("/posts/query", "");
        expect(answer.status).toBe(200);
        expect(answer.calls.map(call => call.method)).toEqual(["fetchCollectionForRest", "count"]);
    });
});

describe("queryDictFromBody", () => {
    it("spells each value as c.req.queries() does", () => {
        expect(queryDictFromBody({
            limit: 10,
            distinct: false,
            searchString: "x",
            views: ["gte.1", "lte.9"],
            vector: [0.5, -1],
            where: { a: ["==", 1] },
            skipped: null
        })).toEqual({
            limit: ["10"],
            distinct: ["false"],
            searchString: ["x"],
            views: ["gte.1", "lte.9"],
            vector: ["[0.5,-1]"],
            where: ["{\"a\":[\"==\",1]}"]
        });
    });
});

describe("the OpenAPI document", () => {
    const spec = generateOpenApiSpec([authors, posts]);
    /** The node at `keys` under `node`, or undefined. */
    const at = (node: unknown, ...keys: string[]): unknown =>
        keys.reduce<unknown>((n, key) => (typeof n === "object" && n !== null ? (n as Record<string, unknown>)[key] : undefined), node);
    const queryNames = (parameters: unknown) => (parameters as { name: string; in: string }[])
        .filter(p => p.in === "query").map(p => p.name).sort();

    it.each([
        ["/data/posts", "/data/posts/query"],
        ["/data/authors/{parentId}/posts", "/data/authors/{parentId}/posts/query"]
    ])("documents in the body of %s's POST twin every query parameter the GET takes", (getPath, postPath) => {
        const get = at(spec, "paths", getPath, "get");
        const post = at(spec, "paths", postPath, "post");
        const bodyProperties = at(post, "requestBody", "content", "application/json", "schema", "properties");
        expect(Object.keys(bodyProperties as object).sort()).toEqual(queryNames(at(get, "parameters")));
        expect(queryNames(at(post, "parameters"))).toEqual([]);
        expect(at(post, "responses", "200")).toEqual(at(get, "responses", "200"));
    });
});
