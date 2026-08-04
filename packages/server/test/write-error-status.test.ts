import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { ApiError, errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * What status a failed write reports.
 *
 * The create and update handlers stamped `BAD_REQUEST` onto any thrown error
 * that was not a `TypeError`/`RangeError`/`SyntaxError`/`ReferenceError`, gated
 * on `isRebaseApiError(error)` — a predicate whose whole body is
 * `error instanceof Error`, so it excluded nothing. The comment beside it says
 * the intent was to classify *operational* errors only.
 *
 * A 4xx is a statement to the caller that their request was wrong and retrying
 * it unchanged will not help. Saying that when the database is unreachable
 * points every reader at the wrong side of the problem, and makes an outage
 * count as user error in whatever watches these.
 */
function harness(save: () => Promise<Record<string, unknown>>) {
    const driver = {
        key: "postgres",
        initialised: true,
        async save() { return save(); },
        async fetchOne() { return { id: 1, title: "existing" }; }
    } as unknown as DataDriver;

    const collections = [{
        slug: "posts", name: "Posts", singularName: "Post", properties: {}
    }] as unknown as CollectionConfig[];

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator(collections, driver).generateRoutes());

    return {
        post: () => app.request("/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "hello" })
        }),
        put: () => app.request("/posts/1", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "hello" })
        })
    };
}

describe("status of a failed write", () => {
    it("reports a driver failure as a server error, not a bad request", async () => {
        const { post } = harness(async () => { throw new Error("connection reset by peer"); });

        const response = await post();

        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({
            error: expect.objectContaining({ code: "INTERNAL_ERROR" })
        });
    });

    it("does the same on update", async () => {
        const { put } = harness(async () => { throw new Error("connection reset by peer"); });

        expect((await put()).status).toBe(500);
    });

    it("still lets the driver classify what it knows to be the caller's fault", async () => {
        // The driver is where the SQLSTATE is available, so that is where the
        // decision belongs. An `ApiError` from below is passed through intact.
        const { post } = harness(async () => {
            throw ApiError.conflict("Duplicate value: key (email)=(a@b.com) already exists.", "PG_23505");
        });

        const response = await post();

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
            error: expect.objectContaining({ code: "PG_23505" })
        });
    });

    it("keeps reporting a runtime bug as a server error", async () => {
        const { post } = harness(async () => { throw new TypeError("x is not a function"); });

        expect((await post()).status).toBe(500);
    });
});
