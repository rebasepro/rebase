import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { mockDataDriver } from "./helpers/server-a-fakes";
import { tablesFromCollections } from "./helpers/tables";

/**
 * `?fields=` over HTTP, on every route that returns rows.
 *
 * `response-field-selection.test.ts` calls `projectResponseFields` directly, so
 * it proves the function narrows a row and nothing about whether a request ever
 * reaches it. Two of the four read routes never called it: the subcollection
 * list and the subcollection single-entity read returned every column while the
 * generated OpenAPI advertises the parameter on all of them.
 *
 * That is the same defect the function's own docblock was written about —
 * "parsed into `options.fields` and then read by nothing at all" — surviving on
 * the route family the parameter was not wired into.
 */

const post: LegacyCollectionConfig = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        content: { name: "Content", type: "string" }
    }
};

const author: LegacyCollectionConfig = {
    slug: "authors",
    name: "Authors",
    singularName: "Author",
    table: "authors",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" },
        posts: {
            type: "relation",
            relation: { kind: "hasMany", target: () => post, foreignKeyOnTarget: "author_id" }
        }
    }
};

const ROW = { id: "p1", title: "Hello", content: "…a long body…" };

function createApp() {
    const driver = mockDataDriver();
    driver.fetchCollection.mockResolvedValue([{ ...ROW }]);
    driver.fetchOne.mockResolvedValue({ ...ROW });
    driver.count.mockResolvedValue(1);

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/", new RestApiGenerator(tablesFromCollections([author, post]), driver).generateRoutes());
    return app;
}

describe("?fields= on every route that returns rows", () => {
    it("narrows a top-level list", async () => {
        const res = await createApp().request("/posts?fields=title");
        const body = await res.json() as { data: Record<string, unknown>[] };

        expect(Object.keys(body.data[0]).sort()).toEqual(["id", "title"]);
    });

    it("narrows a top-level single read", async () => {
        const res = await createApp().request("/posts/p1?fields=title");

        expect(Object.keys(await res.json() as object).sort()).toEqual(["id", "title"]);
    });

    it("narrows a subcollection list", async () => {
        const res = await createApp().request("/authors/a1/posts?fields=title");
        const body = await res.json() as { data: Record<string, unknown>[] };

        // Returned `content` in full, on an endpoint whose OpenAPI lists
        // `fields` as its first parameter.
        expect(Object.keys(body.data[0]).sort()).toEqual(["id", "title"]);
    });

    it("narrows a subcollection single read", async () => {
        const res = await createApp().request("/authors/a1/posts/p1?fields=title");

        expect(Object.keys(await res.json() as object).sort()).toEqual(["id", "title"]);
    });

    it("refuses an unknown field on a subcollection route, as it does on the root", async () => {
        const root = await createApp().request("/posts?fields=titel");
        const nested = await createApp().request("/authors/a1/posts?fields=titel");

        expect(root.status).toBe(400);
        expect(nested.status).toBe(400);
    });
});
