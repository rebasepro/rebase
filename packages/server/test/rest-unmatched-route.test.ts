/**
 * Everything under `/api/data` answers in the canonical error envelope.
 *
 * `GET /api/data/nonexistent` used to fall through every generated route to
 * Hono's default handler and come back as the plain text `404 Not Found` — the
 * one error on the data API that is not
 * `{"error":{"message","code","requestId"}}`. A client doing `res.json()` on
 * the error path got a parse failure where every other 4xx hands it a code, so
 * a mistyped collection name surfaced as "invalid JSON".
 *
 * The requests here run through the real router and the real `errorHandler`,
 * so what is asserted is the response a client receives, not an internal call.
 */
import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { logger } from "../src/utils/logger";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { CollectionConfig } from "../../types/src/types/collections";

const collections = [
    { slug: "users", name: "Users", singularName: "User", properties: {} },
    { slug: "posts", name: "Posts", singularName: "Post", properties: {} }
] as unknown as CollectionConfig[];

function createApp(): Hono {
    const driver = {
        key: "postgres",
        initialised: true,
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        count: async () => 0,
        save: async () => ({}),
        delete: async () => {},
        admin: {}
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    // Mirrors production routing: the auth middleware puts the request-scoped
    // driver in context before the generated routes run.
    app.use("/api/data/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/api/data", new RestApiGenerator(collections, driver).generateRoutes());
    return app;
}

async function request(path: string, method = "GET"): Promise<{
    status: number;
    contentType: string | null;
    body: string;
}> {
    const res = await createApp().fetch(new Request(`http://localhost${path}`, { method }));
    return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: await res.text()
    };
}

describe("an unmatched path under /api/data", () => {
    it("answers a missing collection with the JSON error envelope", async () => {
        const res = await request("/api/data/nonexistent");

        expect(res.status).toBe(404);
        expect(res.contentType).toContain("application/json");
        // The regression in one line: this used to be the string
        // "404 Not Found", and `JSON.parse` on it threw.
        const parsed = JSON.parse(res.body);
        expect(parsed.error.code).toBe("NOT_FOUND");
        expect(parsed.error.message).toContain("nonexistent");
    });

    it("names the collection rather than describing the shape of the URL", async () => {
        const parsed = JSON.parse((await request("/api/data/pots")).body);
        expect(parsed.error.message).toContain("'pots'");
    });

    it("does not enumerate the other collections", async () => {
        // Unauthenticated, this same URL is answered 401 before routing, on
        // purpose. Echoing every slug back would undo that for any signed-in
        // caller — a different guarantee from UNKNOWN_FILTER_FIELD, which
        // lists the columns of a table the caller already reached.
        const { body } = await request("/api/data/nonexistent");
        expect(body).not.toContain("users");
        expect(body).not.toContain("posts");
    });

    it("distinguishes an unknown collection from an unsupported method on a real one", async () => {
        const unknown = JSON.parse((await request("/api/data/nonexistent")).body);
        expect(unknown.error.message).toContain("Unknown collection");

        const known = JSON.parse((await request("/api/data/users", "PATCH")).body);
        expect(known.error.code).toBe("NOT_FOUND");
        expect(known.error.message).not.toContain("Unknown collection");
        expect(known.error.message).toContain("users");
    });

    it("answers an unparseable nested path with the envelope too", async () => {
        // The subcollection handler calls `next()` on a path it cannot read;
        // that used to land on the plain-text 404 as well.
        const res = await request("/api/data/users/1/undefined/posts");
        expect(res.status).toBe(404);
        expect(res.contentType).toContain("application/json");
        expect(JSON.parse(res.body).error.code).toBe("NOT_FOUND");
    });

    it("leaves the real routes alone", async () => {
        expect((await request("/api/data/users")).status).toBe(200);
        expect((await request("/api/data/posts")).status).toBe(200);
        expect((await request("/api/data/users/count")).status).toBe(200);
    });

    /**
     * This path used to log nothing at all: Hono's default 404 never reaches
     * `errorHandler`. Routing it through the handler is what gives the caller
     * an envelope — but at the handler's default level it would also have
     * written a `⚠️` line per request, so a frontend holding one stale slug
     * would produce a warning per page load, forever. The envelope is the fix;
     * the log volume is not part of it. `ApiError.expected` is the existing
     * mechanism for exactly this, and it is why the assertion is on the
     * *logger* rather than on the error: the level is the thing that regressed.
     */
    it("logs a stale slug at debug, not as an incident", async () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
        const debug = jest.spyOn(logger, "debug").mockImplementation(() => {});
        try {
            await request("/api/data/nonexistent");
            expect(warn).not.toHaveBeenCalled();
            expect(debug).toHaveBeenCalledTimes(1);
            expect(String(debug.mock.calls[0][0])).toContain("NOT_FOUND");
        } finally {
            warn.mockRestore();
            debug.mockRestore();
        }
    });
});
