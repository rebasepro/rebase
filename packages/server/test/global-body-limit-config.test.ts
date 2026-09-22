/**
 * The global body limit is off only when someone says so.
 *
 * `maxBodySize: 0` is the documented way to turn it off, and the middleware
 * applies a limit only when the size is positive — so any value that is not a
 * positive number read as "off". `NaN` is not a positive number: an embedder's
 * `maxBodySize: Number(process.env.MAX_BODY)` with the variable unset, or set
 * to `"10MB"`, removed the limit from every route under the base path, the
 * unauthenticated auth routes included, and said nothing.
 */
import { Hono } from "hono";
import { configureMiddlewares } from "../src/init/middlewares";
import { RUNTIME_DEFAULT_MAX_BODY_SIZE } from "../src/deploy/pod-contract";
import type { HonoEnv } from "../src/api/types";

function buildApp(maxBodySize: number | undefined) {
    const app = new Hono<HonoEnv>();
    configureMiddlewares(app, "/api", false, { maxBodySize, compression: false });
    app.post("/api/echo", async (c) => c.json({ bytes: (await c.req.text()).length }));
    return app;
}

const post = (app: Hono<HonoEnv>, bytes: number) =>
    app.request("/api/echo", { method: "POST", body: "x".repeat(bytes) });

describe("configureMiddlewares body limit", () => {
    it.each([NaN, Infinity])("refuses a maxBodySize of %s rather than serving with no limit", (size) => {
        expect(() => buildApp(size)).toThrow(/maxBodySize must be a number of bytes/);
    });

    it("applies the default when none is configured", async () => {
        const res = await post(buildApp(undefined), RUNTIME_DEFAULT_MAX_BODY_SIZE + 1);
        expect(res.status).toBe(413);
    });

    it("still turns the limit off for an explicit 0", async () => {
        const res = await post(buildApp(0), 1024 * 1024);
        expect(res.status).toBe(200);
    });
});
