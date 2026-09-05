import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";

import { hasOwnErrorHandler, installRootErrorHandler } from "../src/api/root-error-handler";
import type { HonoEnv } from "../src/api/types";

/**
 * Anything that throws answers the JSON envelope, not `text/plain`.
 *
 * `errorHandler` was installed on the data router and the functions router and
 * nowhere else. A throw anywhere else — an app-level middleware, an auth route,
 * a storage route, a route a project mounted itself — fell through to Hono's
 * default: status `500` with the body `Internal Server Error`, sent as
 * `text/plain`. Every client in this repo reads `error.code` off the body, so
 * what they actually got was a JSON parse failure: the one shape no caller
 * handles, for the one case where knowing what happened matters most.
 */
describe("installRootErrorHandler", () => {
    it("answers the envelope for a throw in an app-level middleware", async () => {
        const app = new Hono<HonoEnv>();
        installRootErrorHandler(app);
        app.use("/*", () => { throw new Error("middleware exploded"); });
        app.get("/anything", (c) => c.text("never reached"));

        const res = await app.request("/anything");

        expect(res.status).toBe(500);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect((await res.json() as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
    });

    it("carries an ApiError's own status and code through", async () => {
        const app = new Hono<HonoEnv>();
        installRootErrorHandler(app);
        app.get("/nope", () => {
            throw Object.assign(new Error("no such thing"), {
                name: "ApiError", statusCode: 404, code: "NOT_FOUND"
            });
        });

        const res = await app.request("/nope");

        expect(res.status).toBe(404);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    });

    it("does not overwrite an application's own handler", async () => {
        // An app passed in as `config.app` may already define its error
        // contract. Replacing it would look like the framework working while
        // silently changing what every one of that project's clients receives.
        const app = new Hono<HonoEnv>();
        app.onError((_err, c) => c.text("the project's own answer", 418));
        app.get("/boom", () => { throw new Error("x"); });

        expect(installRootErrorHandler(app)).toBe(false);

        const res = await app.request("/boom");
        expect(res.status).toBe(418);
        expect(await res.text()).toBe("the project's own answer");
    });

    it("recognises a fresh app as having no handler of its own", () => {
        // The detection reads a private Hono field, so this is the canary: if
        // Hono ever stops sharing one default across instances, or moves it,
        // every app looks like it has its own handler and the envelope silently
        // stops being installed.
        expect(hasOwnErrorHandler(new Hono())).toBe(false);

        const configured = new Hono();
        configured.onError((_e, c) => c.text("mine", 500));
        expect(hasOwnErrorHandler(configured)).toBe(true);
    });
});
