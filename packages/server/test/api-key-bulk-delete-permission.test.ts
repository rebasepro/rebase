import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * `POST /:slug/bulk/delete` deletes, whatever its verb says.
 *
 * Deriving the operation from the HTTP method would classify this route — a
 * POST for transport reasons its own docblock explains, since a body on DELETE
 * is dropped by proxies and by several OpenAPI generators — as `write`. A key
 * holding `data:read` and `data:write` with `data:delete` deliberately
 * withheld, which is the shape the docs recommend for an agent, would then
 * delete every row it named and get a 200 back.
 *
 * The route states its operation. These tests pin both directions: the
 * withheld scope refuses, and the granted one works — a guard that refused
 * everything would satisfy the first assertion alone.
 */
describe("API key scopes on bulk delete", () => {
    let deleted: { path: string; ids: (string | number)[] }[] = [];

    function harness(scopes: string[]) {
        deleted = [];
        const driver = {
            key: "postgres",
            initialised: true,
            admin: {} as never,
            async deleteMany(props: never) {
                deleted.push(props as unknown as { path: string; ids: (string | number)[] });
            }
        } as unknown as DataDriver;

        const collections = [{
            slug: "posts", name: "Posts", singularName: "Post",
            properties: { title: { name: "Title", type: "string" } }
        }] as unknown as CollectionConfig[];

        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("user", { uid: "user-1" });
            c.set("apiKey", { id: "key-1", scopes } as never);
            c.set("scopes", scopes);
            await next();
        });
        app.route("/", new RestApiGenerator(collections, driver, undefined, 3).generateRoutes());
        return app;
    }

    const bulkDelete = (app: Hono) =>
        app.request("/posts/bulk/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: ["a", "b"] })
        });

    it("refuses a read+write key — `delete` was withheld on purpose", async () => {
        const app = harness(["data:read:posts", "data:write:posts"]);

        const res = await bulkDelete(app);

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("SCOPE_MISSING");
        // The message must name the scope the caller actually lacked.
        expect(body.error.message).toContain("data:delete");
        // And nothing may have reached the driver.
        expect(deleted).toEqual([]);
    });

    it("allows a key that holds data:delete on the collection", async () => {
        const app = harness(["data:read:posts", "data:delete:posts"]);

        const res = await bulkDelete(app);

        expect(res.status).toBe(200);
        expect(deleted).toHaveLength(1);
        expect(deleted[0].ids).toEqual(["a", "b"]);
    });
});
