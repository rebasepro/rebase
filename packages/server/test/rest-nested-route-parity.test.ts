import { Hono } from "hono";
import { CollectionRegistry } from "@rebasepro/common";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * A nested route is the root route reached by another address.
 *
 * `POST /blog_posts/1/comments` writes a row of `comments`, exactly as
 * `POST /comments` does, so every rule the root route applies to that row has
 * to hold here too. The nested routes kept a second, thinner pipeline: it
 * found the parent by its exact slug only, while the driver behind it also
 * answers the slug in kebab case and the table name — so the spellings the
 * driver accepted and the checks did not recognise wrote fields the caller
 * may not write, and read fields it may not read.
 */

const comments = {
    slug: "comments",
    name: "Comments",
    singularName: "Comment",
    table: "comments",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        body: { name: "Body", type: "string" },
        views: { name: "Views", type: "number" },
        featured: { name: "Featured", type: "boolean", access: { write: ["editor"] } },
        score: { name: "Score", type: "number", access: { read: ["moderator"] } },
        internalToken: { name: "Internal token", type: "string", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

/** Its table is not its slug, so the driver's three spellings are all distinct. */
const blogPosts = {
    slug: "blog_posts",
    name: "Blog posts",
    singularName: "Blog post",
    table: "entries",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        comments: {
            name: "Comments",
            type: "relation",
            relation: { kind: "hasMany", target: () => comments, foreignKeyOnTarget: "post_id" }
        }
    }
} as unknown as CollectionConfig;

type Call = [method: string, props: Record<string, unknown>];

function createHarness() {
    const calls: Call[] = [];
    const record = (method: string, result: (props: Record<string, unknown>) => unknown) =>
        async (props: Record<string, unknown>) => {
            calls.push([method, props]);
            return result(props);
        };
    const stored = { id: 7, body: "hello", views: 1 };

    const driver = {
        key: "postgres",
        initialised: true,
        fetchOne: record("fetchOne", () => ({ ...stored })),
        fetchCollection: record("fetchCollection", () => []),
        count: record("count", () => 0),
        save: record("save", (props) => ({ ...stored, ...(props.values as object) })),
        delete: record("delete", () => undefined)
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "u1", roles: ["viewer"] });
        await next();
    });
    app.route("/", new RestApiGenerator([blogPosts, comments], driver).generateRoutes());
    return { app, calls, writes: () => calls.filter(([method]) => method === "save" || method === "delete") };
}

const send = (app: Hono, method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    app.request(path, {
        method,
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

const errorCode = async (res: Response) => (await res.json() as { error: { code: string } }).error.code;

/** Every way the driver's registry answers for `blog_posts`. */
const SPELLINGS = ["blog_posts", "blog-posts", "entries"];

describe("the parent's spelling", () => {
    it("is every spelling the driver's registry resolves", () => {
        // The guard on the list below: these are exactly the names
        // `CollectionRegistry.get` — the lookup the driver walks a nested path
        // with — answers for this collection. A spelling it accepts that the
        // route did not was a path with no checks on it at all.
        const registry = new CollectionRegistry([blogPosts, comments]);
        for (const spelling of SPELLINGS) {
            expect(registry.get(spelling)?.slug).toBe("blog_posts");
        }
    });

    it.each(SPELLINGS)("refuses a field the caller may not write, through /%s", async (spelling) => {
        const { app, writes } = createHarness();

        const res = await send(app, "POST", `/${spelling}/1/comments`, { body: "x", featured: true });

        expect(res.status).toBe(400);
        expect(await errorCode(res)).toBe("FIELD_NOT_WRITABLE");
        expect(writes()).toHaveLength(0);
    });

    it.each(SPELLINGS)("refuses a field excluded from the API, through /%s", async (spelling) => {
        const { app, writes } = createHarness();

        const res = await send(app, "POST", `/${spelling}/1/comments`, { body: "x", internalToken: "t" });

        expect(res.status).toBe(400);
        expect(await errorCode(res)).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(writes()).toHaveLength(0);
    });

    it.each(SPELLINGS)("refuses the same field on an update, through /%s", async (spelling) => {
        const { app, writes } = createHarness();

        const res = await send(app, "PATCH", `/${spelling}/1/comments/7`, { featured: true });

        expect(res.status).toBe(400);
        expect(await errorCode(res)).toBe("FIELD_NOT_WRITABLE");
        expect(writes()).toHaveLength(0);
    });

    it.each(SPELLINGS)("refuses a filter on a field the caller may not read, through /%s", async (spelling) => {
        // Answering it is an oracle: one `gt.` at a time bisects the value.
        const { app, calls } = createHarness();

        const res = await app.request(`/${spelling}/1/comments?score=gt.10`);

        expect(res.status).toBe(400);
        expect(calls).toHaveLength(0);
    });

    it.each(SPELLINGS)("hands the driver the collection's own slug, from /%s", async (spelling) => {
        // Whatever the spelling, the row is checked against one collection and
        // written through the path that names that same collection — so the
        // two can never be answered about different ones.
        const { app, calls } = createHarness();

        const res = await send(app, "POST", `/${spelling}/1/comments`, { body: "x" });

        expect(res.status).toBe(201);
        expect(calls).toEqual([["save", expect.objectContaining({ path: "blog_posts/1/comments" })]]);
    });
});

describe("a nested path that names nothing", () => {
    it("is a 404 for an unknown parent, not a write nobody checked", async () => {
        const { app, calls } = createHarness();

        const res = await send(app, "POST", "/blogposts/1/comments", { featured: true });

        expect(res.status).toBe(404);
        expect(await errorCode(res)).toBe("NOT_FOUND");
        expect(calls).toHaveLength(0);
    });

    it("is a 404 for a relation the parent does not declare", async () => {
        const { app, calls } = createHarness();

        const res = await send(app, "PATCH", "/blog_posts/1/replies/7", { featured: true });

        expect(res.status).toBe(404);
        expect(await errorCode(res)).toBe("UNKNOWN_RELATION");
        expect(calls).toHaveLength(0);
    });

    it("is a 404 on a read too", async () => {
        const { app, calls } = createHarness();

        const res = await app.request("/blog_posts/1/replies?score=gt.10");

        expect(res.status).toBe(404);
        expect(calls).toHaveLength(0);
    });
});
