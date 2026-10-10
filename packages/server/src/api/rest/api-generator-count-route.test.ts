import { jest } from "@jest/globals";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { RestApiGenerator } from "./api-generator";
import { errorHandler } from "../errors";
import { generateOpenApiSpec } from "../openapi-generator";

/**
 * `POST /<collection>/count` is `GET /<collection>/count` with its parameters
 * in the body, as `POST …/query` is the listing's: the same parser, the same
 * handler. A count is asked with the same filters a `find()` was, so a vector
 * search's embedding or a long `in` list makes its URL as long as the
 * listing's — and `GET /count` answered those 431 (Node) or 414 (a proxy)
 * after the listing itself had moved to the body.
 *
 * For any set of parameters the two must ask the driver the same question and
 * answer the same thing, a count or an error.
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

interface Recorded {
    driver: DataDriver;
    calls: { method: string; args: unknown[] }[];
}

/** A driver that counts 42, and writes down every call. */
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
            fetchCollectionForRest: record("fetchCollectionForRest", []),
            fetchOneForRest: record("fetchOneForRest", undefined)
        },
        count: record("count", 42),
        fetchCollection: record("fetchCollection", []),
        fetchOne: record("fetchOne", undefined),
        save: record("save", {}),
        delete: record("delete", undefined)
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

async function both(path: string, query: string, body: Record<string, unknown> = bodyFromQuery(query), scopes?: string[]) {
    const get = recordingDriver();
    const post = recordingDriver();
    const getAnswer = await answerOf(await appFor(get.driver, scopes).request(
        `${path}${query ? `?${new URLSearchParams(query).toString()}` : ""}`
    ));
    const postAnswer = await answerOf(await appFor(post.driver, scopes).request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
    return { get: { ...getAnswer, calls: get.calls }, post: { ...postAnswer, calls: post.calls } };
}

const longIn = `id=in.(${Array.from({ length: 1500 }, (_, i) => i + 1).join(",")})`;

/** `[name, GET query]` — every parameter a count reads, and the ways each is refused. */
const MATRIX: [string, string][] = [
    ["no parameters", ""],
    ["per-field filters, one repeated", "status=eq.published&views=gte.10&views=lte.99"],
    ["where JSON", "where={\"status\":[\"==\",\"draft\"]}"],
    ["or", "or=(status.eq.draft,views.gte.25)"],
    ["not", "not=(status.eq.draft)"],
    ["search", "searchString=hello"],
    ["vector search", "vector_search=embedding&vector=[0.1,0.2,0.3]&vector_distance=l2"],
    ["vector search with a threshold", "vector_search=embedding&vector=[0.1,0.2,0.3]&vector_threshold=0.5"],
    ["deleted", "deleted=include"],
    ["a long in list", longIn],
    ["refused: where", "where=not-json"],
    ["refused: vector", "vector_search=embedding&vector=not-json"],
    ["refused: vector threshold", "vector_search=embedding&vector=[1,2,3]&vector_threshold=far"],
    ["refused: unknown filter operator", "views=zz.3"],
    ["refused: deleted", "deleted=yes"]
];

describe("POST /<collection>/count answers exactly what GET /<collection>/count answers", () => {
    it.each(MATRIX)("%s", async (_name, query) => {
        const { get, post } = await both("/posts/count", query);
        expect(post.status).toBe(get.status);
        expect(post.body).toEqual(get.body);
        expect(post.calls).toEqual(get.calls);
    });

    it("covers counts and refusals alike, and counts through the driver's count", async () => {
        const statuses = new Set<number>();
        for (const [, query] of MATRIX) {
            const { get } = await both("/posts/count", query);
            statuses.add(get.status);
            if (get.status === 200) {
                expect(get.body).toEqual({ count: 42 });
                expect(get.calls.map(call => call.method)).toEqual(["count"]);
            }
        }
        expect(statuses).toEqual(new Set([200, 400]));
    });

    it("takes a vector as a JSON array, as the GET's URL spells it", async () => {
        const { get, post } = await both(
            "/posts/count",
            "vector_search=embedding&vector=[0.1,0.2,0.3]&vector_threshold=0.5",
            { vector_search: "embedding", vector: [0.1, 0.2, 0.3], vector_threshold: 0.5 }
        );
        expect(get.status).toBe(200);
        expect(post.status).toBe(200);
        expect(post.calls).toEqual(get.calls);
    });

    it("counts a nested path the same way", async () => {
        for (const query of ["", "status=eq.draft", "vector_search=embedding&vector=[1,2,3]", "views=zz.3"]) {
            const { get, post } = await both("/authors/1/posts/count", query);
            expect(post.status).toBe(get.status);
            expect(post.body).toEqual(get.body);
            expect(post.calls).toEqual(get.calls);
        }
    });

    it("refuses a parameter on the URL as well", async () => {
        const recorded = recordingDriver();
        const answer = await answerOf(await appFor(recorded.driver).request("/posts/count?status=eq.draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "eq.published" })
        }));
        expect(answer.status).toBe(400);
        expect((answer.body as { error: { code: string } }).error.code).toBe("INVALID_QUERY_BODY");
        expect(recorded.calls).toEqual([]);
    });
});

describe("what a credential needs for POST /<collection>/count", () => {
    it("is data:read, as the GET", async () => {
        const { get, post } = await both("/posts/count", "status=eq.draft", undefined, ["data:read:posts"]);
        expect(get.status).toBe(200);
        expect(post.status).toBe(200);
    });

    it("and data:write is not it", async () => {
        const { get, post } = await both("/posts/count", "", undefined, ["data:write"]);
        expect(get.status).toBe(403);
        expect(post.status).toBe(403);
        expect(post.body).toEqual(get.body);
        expect(post.calls).toEqual([]);
    });

    it("is read on every collection a nested path passes through", async () => {
        const { get, post } = await both("/authors/1/posts/count", "", undefined, ["data:read:posts"]);
        expect(get.status).toBe(403);
        expect(post.status).toBe(403);
        expect(post.body).toEqual(get.body);
    });
});

describe("the OpenAPI document", () => {
    const spec = generateOpenApiSpec([authors, posts]);
    const at = (node: unknown, ...keys: string[]): unknown =>
        keys.reduce<unknown>((n, key) => (typeof n === "object" && n !== null ? (n as Record<string, unknown>)[key] : undefined), node);
    const queryNames = (parameters: unknown) => (parameters as { name: string; in: string }[])
        .filter(p => p.in === "query").map(p => p.name).sort();

    it("documents POST /count beside the GET, its body every query parameter the GET takes", () => {
        const get = at(spec, "paths", "/data/posts/count", "get");
        const post = at(spec, "paths", "/data/posts/count", "post");
        const bodyProperties = at(post, "requestBody", "content", "application/json", "schema", "properties");
        expect(Object.keys(bodyProperties as object).sort()).toEqual(queryNames(at(get, "parameters")));
        expect(at(post, "responses", "200")).toEqual(at(get, "responses", "200"));
    });

    it("documents the parameters a count actually reads, the vector search among them", () => {
        const names = queryNames(at(spec, "paths", "/data/posts/count", "get", "parameters"));
        for (const name of ["searchString", "where", "or", "and", "not", "vector_search", "vector", "vector_distance", "vector_threshold"]) {
            expect(names).toContain(name);
        }
        for (const name of ["limit", "offset", "page", "after", "orderBy", "include", "fields", "count"]) {
            expect(names).not.toContain(name);
        }
    });
});
