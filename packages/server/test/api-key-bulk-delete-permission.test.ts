import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * `POST /:slug/bulk/delete` deletes, whatever its verb says.
 *
 * The permission guard derived the operation from the HTTP method, so this
 * route — a POST for transport reasons its own docblock explains, since a body
 * on DELETE is dropped by proxies and by several OpenAPI generators — was
 * classified `write`. A key scoped `["read","write"]` with `delete`
 * deliberately withheld, which is the shape the docs recommend for an agent,
 * therefore deleted every row it named and got a 200 back. The `delete`
 * permission was not a boundary at all.
 *
 * The route states its operation now. These tests pin both directions: the
 * withheld permission refuses, and the granted one still works — a guard that
 * refused everything would satisfy the first assertion alone.
 */
describe("API key permissions on bulk delete", () => {
    let deleted: { path: string; ids: (string | number)[] }[] = [];

    function harness(permissions: unknown) {
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
            c.set("apiKey", { id: "key-1", permissions });
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
        const app = harness([{ collection: "posts", operations: ["read", "write"] }]);

        const res = await bulkDelete(app);

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("API_KEY_FORBIDDEN");
        // The message must name the operation the caller actually lacked.
        expect(body.error.message).toContain("delete");
        // And nothing may have reached the driver.
        expect(deleted).toEqual([]);
    });

    it("allows a key that holds delete", async () => {
        const app = harness([{ collection: "posts", operations: ["read", "write", "delete"] }]);

        const res = await bulkDelete(app);

        expect(res.status).toBe(200);
        expect(deleted).toHaveLength(1);
        expect(deleted[0].ids).toEqual(["a", "b"]);
    });
});
