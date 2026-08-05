import { CollectionConfig, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";

/**
 * What the spec claims a request may contain, against what the routes read.
 *
 * The spec is not documentation people merely read: it drives the API Explorer,
 * and it is what a generated client is built from. So a parameter it omits is a
 * capability nobody can reach through a generated client, and a bound it states
 * wrongly is a request a generated client refuses to make.
 *
 * Both were wrong. `limit` was declared `default: 20, maximum: 100` while the
 * REST layer defaults to `DEFAULT_LIST_LIMIT` (50) and clamps at
 * `MAX_LIST_LIMIT` (1000) — off by 10× at the ceiling. And the subcollection
 * endpoint documented five parameters while honouring nine.
 */
const tags = {
    slug: "tags", name: "Tags", singularName: "Tag", table: "tags",
    properties: { id: { type: "string", isId: true }, name: { type: "string" } }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts", name: "Posts", singularName: "Post", table: "posts",
    properties: {
        id: { type: "string", isId: true },
        title: { type: "string" },
        tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
} as unknown as CollectionConfig;

function paramsOf(spec: Record<string, any>, pathMatch: (p: string) => boolean): string[] {
    const path = Object.keys(spec.paths).find(pathMatch);
    if (!path) throw new Error(`no path matching, have: ${Object.keys(spec.paths).join(", ")}`);
    return (spec.paths[path].get?.parameters ?? []).map((p: { name: string }) => p.name);
}

describe("OpenAPI query parameters", () => {
    const spec = generateOpenApiSpec([posts, tags]) as Record<string, any>;

    it("states the page size the server actually applies", () => {
        const limit = (spec.paths["/data/posts"].get.parameters as { name: string; schema: Record<string, number> }[])
            .find(p => p.name === "limit")!;

        expect(limit.schema.default).toBe(DEFAULT_LIST_LIMIT);
        expect(limit.schema.maximum).toBe(MAX_LIST_LIMIT);
    });

    it("documents the logical operators the query parser accepts", () => {
        // `?or=(…)` / `?and=(…)` are parsed into `queryOptions.logical` and
        // applied. Undocumented, they are unreachable from a generated client.
        const names = paramsOf(spec, p => p === "/data/posts");

        expect(names).toEqual(expect.arrayContaining(["or", "and"]));
    });

    it("documents on a subcollection every parameter that route honours", () => {
        // The nested list handler reads where, logical, limit, offset, orderBy,
        // searchString, include and fields. The spec named five of them.
        const names = paramsOf(spec, p => p.includes("/data/posts/{parentId}/tags"));

        expect(names).toEqual(expect.arrayContaining([
            "limit", "offset", "page", "orderBy", "where", "include", "fields", "searchString", "or", "and"
        ]));
    });

    it("bounds the subcollection limit the same way as the root listing", () => {
        const nested = Object.keys(spec.paths).find(p => p.includes("/data/posts/{parentId}/tags"))!;
        const limit = (spec.paths[nested].get.parameters as { name: string; schema?: Record<string, number> }[])
            .find(p => p.name === "limit")!;

        expect(limit.schema?.default).toBe(DEFAULT_LIST_LIMIT);
        expect(limit.schema?.maximum).toBe(MAX_LIST_LIMIT);
    });
});

/**
 * A `?or=` group nested past what the parser accepts is a request problem.
 * Unbounded, it reached `RangeError: Maximum call stack size exceeded` and
 * surfaced as a 500 that said nothing about the filter.
 */
describe("deeply nested logical groups", () => {
    it("is refused as a bad request, naming the filter", async () => {
        const { Hono } = await import("hono");
        const { RestApiGenerator } = await import("../src/api/rest/api-generator");
        const { errorHandler } = await import("../src/api/errors");

        const driver = {
            fetchCollection: async () => [], fetchOne: async () => undefined,
            save: async () => ({}), delete: async () => undefined, count: async () => 0
        } as never;
        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("driver", driver); await next(); });
        app.route("/", new RestApiGenerator([posts, tags], driver).generateRoutes());

        const deep = "or(".repeat(200) + "a.eq.1" + ")".repeat(200);
        const res = await app.request(`/posts?or=${encodeURIComponent(deep)}`);

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: expect.objectContaining({ code: "INVALID_LOGICAL_GROUP" }) });
    });
});
