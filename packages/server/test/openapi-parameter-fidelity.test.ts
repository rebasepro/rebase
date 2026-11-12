import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, type CollectionConfig } from "@rebasepro/types";
import { Hono } from "hono";

import { generateOpenApiSpec } from "../src/api/openapi-generator";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-b-fakes";
import { openApiDocument, operationOf, schemaOf, type OpenApiDocument } from "./helpers/server-b-g1-openapi";
import { tablesFromCollections } from "./helpers/tables";

/**
 * What the spec claims a request may contain, against what the routes read.
 *
 * The spec is not documentation people merely read: it drives the API Explorer,
 * and it is what a generated client is built from. So a parameter it omits is a
 * capability nobody can reach through a generated client, and a bound it states
 * wrongly is a request a generated client refuses to make.
 *
 * Both were wrong. `limit` was declared `default: 20, maximum: 100` while the
 * REST layer defaults to `DEFAULT_LIST_LIMIT` (50) and refuses anything above
 * `MAX_LIST_LIMIT` (1000) — off by 10× at the ceiling. And the subcollection
 * endpoint documented five parameters while honouring nine.
 *
 * The ceiling being a *refusal* rather than a clamp is why `maximum` has to be
 * right: a generated client that trims to the documented maximum still gets a
 * 200, but one built against the wrong number now gets a 400 instead of a
 * quietly shortened page.
 */
const tags: CollectionConfig = {
    slug: "tags", name: "Tags", singularName: "Tag", table: "tags",
    properties: { id: { name: "ID", type: "string", isId: true }, name: { name: "Name", type: "string" } }
};

const posts: CollectionConfig = {
    slug: "posts", name: "Posts", singularName: "Post", table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
};

function pathMatching(spec: OpenApiDocument, pathMatch: (p: string) => boolean): string {
    const path = Object.keys(spec.paths).find(pathMatch);
    if (!path) throw new Error(`no path matching, have: ${Object.keys(spec.paths).join(", ")}`);
    return path;
}

function paramsOf(spec: OpenApiDocument, pathMatch: (p: string) => boolean): string[] {
    return (spec.paths[pathMatching(spec, pathMatch)].get?.parameters ?? []).map(p => p.name);
}

function parameter(spec: OpenApiDocument, path: string, name: string) {
    const found = operationOf(spec, path, "get").parameters?.find(p => p.name === name);
    if (!found) throw new Error(`GET ${path} documents no ${name}`);
    return found;
}

describe("OpenAPI query parameters", () => {
    const spec = openApiDocument(generateOpenApiSpec(tablesFromCollections([posts, tags]).descriptors));

    it("states the page size the server actually applies", () => {
        const limit = parameter(spec, "/data/posts", "limit");

        expect(limit.schema?.default).toBe(DEFAULT_LIST_LIMIT);
        expect(limit.schema?.maximum).toBe(MAX_LIST_LIMIT);
    });

    it("says a distinct read carries no total, which is what the listing answers", () => {
        // The listing leaves `meta.total` off a `distinct` read — the driver
        // has no `COUNT(DISTINCT …)`, and a count of the undeduplicated rows
        // describes a different set — while the spec said it counted distinct
        // rows, so a generated client read `undefined` where it expected one.
        const distinct = parameter(spec, "/data/posts", "distinct");
        const total = schemaOf(spec, "PaginationMeta").properties?.total;

        expect(distinct.description).not.toContain("counts distinct rows");
        expect(distinct.description).toContain("no `meta.total`");
        expect(total?.description).toContain("Absent on a `distinct` read");
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
        const nested = pathMatching(spec, p => p.includes("/data/posts/{parentId}/tags"));
        const limit = parameter(spec, nested, "limit");

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
        const driver = fakeDataDriver({ count: async () => 0 });
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("driver", driver); await next(); });
        app.route("/", new RestApiGenerator(tablesFromCollections([posts, tags]), driver).generateRoutes());

        const deep = "or(".repeat(200) + "a.eq.1" + ")".repeat(200);
        const res = await app.request(`/posts?or=${encodeURIComponent(deep)}`);

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: expect.objectContaining({ code: "INVALID_LOGICAL_GROUP" }) });
    });
});
