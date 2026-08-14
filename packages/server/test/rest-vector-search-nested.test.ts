import { jest } from "@jest/globals";
import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

/**
 * A vector search must reach the driver from every route that accepts one.
 *
 * `?vector_search=`/`?vector=` were parsed by the shared `parseQuery` on the
 * subcollection route family and then never forwarded: the listing built its
 * options without `vectorSearch`, so `GET /authors/a1/posts?vector_search=…`
 * was served as an ordinary page — no distance ordering, no `_distance`, no
 * threshold. Not an error, a downgrade: the caller gets rows, reads them as the
 * nearest neighbours, and never learns the route ignored half the request.
 *
 * The counts are the other half. Only the `threshold` narrows a count — the
 * ordering does not change how many rows there are — and it was dropped on
 * every count path, root included, so `meta.total` went on counting the distant
 * rows the listing had excluded and `hasMore` promised a page that did not
 * exist. Fetch and count are asserted together here on purpose: fixing either
 * one alone just moves the disagreement.
 */

const post = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        embedding: { name: "Embedding", type: "vector", dimensions: 3 }
    }
} as unknown as CollectionConfig;

const author = {
    slug: "authors",
    name: "Authors",
    singularName: "Author",
    table: "authors",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" },
        posts: {
            type: "relation",
            relation: { kind: "hasMany", target: () => post, foreignKey: "author_id" }
        }
    }
} as unknown as CollectionConfig;

const VECTOR_QUERY = "vector_search=embedding&vector=%5B0.1%2C0.2%2C0.3%5D&vector_threshold=0.2";

const EXPECTED = {
    property: "embedding",
    vector: [0.1, 0.2, 0.3],
    distance: "cosine",
    threshold: 0.2
};

function createApp() {
    const fetchCollection = jest.fn<any>().mockResolvedValue([{ id: "p1", title: "Hello", _distance: 0.1 }]);
    const count = jest.fn<any>().mockResolvedValue(1);

    // No `restFetchService`: this is the fallback every non-Postgres driver
    // takes, and the surface on which "was the parameter forwarded?" is a
    // question with an answer.
    const driver = {
        fetchCollection,
        fetchOne: jest.fn<any>().mockResolvedValue(null),
        save: jest.fn<any>(),
        delete: jest.fn<any>(),
        count
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/", new RestApiGenerator([author, post], driver).generateRoutes());
    return { app, fetchCollection, count };
}

describe("vector search on the subcollection routes", () => {
    it("forwards it to the fetch of a child listing", async () => {
        const { app, fetchCollection } = createApp();

        const res = await app.request(`/authors/a1/posts?${VECTOR_QUERY}`);

        expect(res.status).toBe(200);
        expect(fetchCollection).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "authors/a1/posts",
                vectorSearch: EXPECTED
            })
        );
    });

    it("forwards it to the count behind that listing's `meta.total`", async () => {
        const { app, count } = createApp();

        await app.request(`/authors/a1/posts?${VECTOR_QUERY}`);

        expect(count).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "authors/a1/posts",
                vectorSearch: EXPECTED
            })
        );
    });

    it("forwards it to the nested /count endpoint", async () => {
        const { app, count } = createApp();

        const res = await app.request(`/authors/a1/posts/count?${VECTOR_QUERY}`);

        expect(res.status).toBe(200);
        expect(count).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "authors/a1/posts",
                vectorSearch: EXPECTED
            })
        );
    });

    it("still refuses a malformed vector, rather than downgrading to a plain listing", async () => {
        const { app, fetchCollection } = createApp();

        const res = await app.request("/authors/a1/posts?vector_search=embedding&vector=not-json");

        expect(res.status).toBe(400);
        expect(fetchCollection).not.toHaveBeenCalled();
    });
});

describe("vector search on the root routes", () => {
    it("forwards it to the fetch", async () => {
        const { app, fetchCollection } = createApp();

        await app.request(`/posts?${VECTOR_QUERY}`);

        expect(fetchCollection).toHaveBeenCalledWith(
            expect.objectContaining({ vectorSearch: EXPECTED })
        );
    });

    it("forwards it to the count behind `meta.total`", async () => {
        const { app, count } = createApp();

        await app.request(`/posts?${VECTOR_QUERY}`);

        expect(count).toHaveBeenCalledWith(
            expect.objectContaining({ vectorSearch: EXPECTED })
        );
    });

    it("forwards it to the /count endpoint", async () => {
        const { app, count } = createApp();

        const res = await app.request(`/posts/count?${VECTOR_QUERY}`);

        expect(res.status).toBe(200);
        expect(count).toHaveBeenCalledWith(
            expect.objectContaining({ vectorSearch: EXPECTED })
        );
    });
});
