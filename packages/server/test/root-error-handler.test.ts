import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";

import {
    hasOwnErrorHandler,
    installRootErrorHandler,
    installUnmatchedApiEnvelope
} from "../src/api/root-error-handler";
import type { HonoEnv } from "../src/api/types";
import { requestId, REQUEST_ID_HEADER } from "../src/utils/request-id";

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

/**
 * `onError` was only ever half of it.
 *
 * A request that matches no route is not a thrown error — Hono answers it from
 * `notFoundHandler`, which `onError` never sees — so every unmatched path under
 * `/api` came back `404 Not Found` as `text/plain`, while `backend/errors.md`
 * opens by promising one envelope with a stable `code` for every failure and
 * `troubleshooting.md` says it again. Through the SDK it arrived as
 * `RebaseApiError { code: undefined }`, so no documented branch could match it.
 */
describe("an unmatched route answers the envelope", () => {
    const app = () => {
        const a = new Hono<HonoEnv>();
        installRootErrorHandler(a);
        installUnmatchedApiEnvelope(a, "/api");
        a.use("/api/*", requestId());
        a.get("/api/data/posts", (c) => c.json({ data: [] }));
        // Registered *after* the envelope middleware, exactly as `boot.ts`
        // registers `/api/health` after `initializeRebaseBackend` returns. A
        // catch-all route here would have swallowed it.
        a.get("/api/health", (c) => c.json({ status: "ok" }));
        return a;
    };

    it.each(["/api/nope", "/api/data", "/api/auth/nope", "/api/functions/hello/nope"])(
        "%s is application/json with a code",
        async (path) => {
            const res = await app().request(path);

            expect(res.status).toBe(404);
            expect(res.headers.get("content-type")).toContain("application/json");
            const body = await res.json() as { error: { code: string; message: string; requestId?: string } };
            expect(body.error.code).toBe("NOT_FOUND");
            expect(body.error.message).toContain(path);
            expect(body.error.requestId).toBe(res.headers.get(REQUEST_ID_HEADER));
        }
    );

    it("names the method as well as the path", async () => {
        const res = await app().request("/api/data/posts", { method: "DELETE" });
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toContain("DELETE");
    });

    it("lets every real route win it, whenever it was registered", async () => {
        expect(await (await app().request("/api/data/posts")).json()).toEqual({ data: [] });
        // The one a catch-all route would have broken.
        expect(await (await app().request("/api/health")).json()).toEqual({ status: "ok" });
    });

    it("leaves a 404 a route already wrote as an envelope alone", async () => {
        const a = new Hono<HonoEnv>();
        installRootErrorHandler(a);
        installUnmatchedApiEnvelope(a, "/api");
        a.get("/api/storage/file/*", (c) => c.json({ success: true, data: null, fileNotFound: true }, 404));

        const res = await a.request("/api/storage/file/nope.txt");
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: true, data: null, fileNotFound: true });
    });

    it("leaves a text or HTML 404 a matched handler wrote on purpose", async () => {
        // A custom function serving pages answers its own 404. The envelope
        // is for "nothing handled this", which is Hono's default answer and
        // nothing else; a body a handler wrote is that handler's to keep.
        const a = new Hono<HonoEnv>();
        installRootErrorHandler(a);
        installUnmatchedApiEnvelope(a, "/api");
        a.get("/api/functions/texty", (c) => c.text("this function's own 404", 404));
        a.get("/api/functions/pagey", (c) => c.html("<h1>gone</h1>", 404));

        const text = await a.request("/api/functions/texty");
        expect(text.status).toBe(404);
        expect(await text.text()).toBe("this function's own 404");
        const html = await a.request("/api/functions/pagey");
        expect(await html.text()).toBe("<h1>gone</h1>");

        // And the unmatched path beside them still gets the envelope.
        const missing = await a.request("/api/functions/nope");
        expect(missing.headers.get("content-type")).toContain("application/json");
    });

    it("leaves paths outside basePath to the application's own 404", async () => {
        // An app that mounts a backend at `/api` and serves its own pages at
        // `/` keeps answering its own way for the pages — which is also why
        // this is not `app.notFound`, whose handler Hono keeps private and
        // which we would therefore have replaced without being able to see it.
        const a = new Hono<HonoEnv>();
        a.notFound((c) => c.text("the project's own 404", 404));
        installRootErrorHandler(a);
        installUnmatchedApiEnvelope(a, "/api");

        expect(await (await a.request("/about")).text()).toBe("the project's own 404");
        expect((await a.request("/api/nope")).headers.get("content-type")).toContain("application/json");
    });
});
