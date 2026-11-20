/**
 * CSRF protection stays on everywhere except OAuth's back channel.
 *
 * Claude's token exchange is a form POST from claude.ai's servers carrying
 * `Origin: https://claude.ai`. With `csrf` configured — the Rebase Cloud
 * control plane configures it in production — the check refused it, the
 * authorization code was never redeemed, and Claude said "Authorization with
 * Rebase failed" on every connect (2026-11-07).
 */
import { Hono } from "hono";
import { configureMiddlewares } from "../src/init/middlewares";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";

function buildApp() {
    const app = new Hono<HonoEnv>();
    configureMiddlewares(app, "/api", true, { compression: false, csrf: { origin: ["https://app.example.com"] } });
    for (const path of ["/api/oauth/token", "/api/oauth/revoke", "/api/oauth/authorize/decision", "/api/functions/waitlist"]) {
        app.post(path, (c) => c.json({ reached: path }));
    }
    return app;
}

const formPost = (app: Hono<HonoEnv>, path: string, origin: string) => app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: "grant_type=authorization_code&code=x"
});

describe("CSRF and OAuth's back channel", () => {
    it("lets a client's server redeem a code and revoke a token from its own origin", async () => {
        for (const path of ["/api/oauth/token", "/api/oauth/revoke"]) {
            const res = await formPost(buildApp(), path, "https://claude.ai");
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ reached: path });
        }
    });

    it("still refuses a cross-origin form post anywhere else, the consent decision included", async () => {
        for (const path of ["/api/oauth/authorize/decision", "/api/functions/waitlist"]) {
            const res = await formPost(buildApp(), path, "https://evil.example");
            expect(res.status).not.toBe(200);
        }
        expect((await formPost(buildApp(), "/api/functions/waitlist", "https://app.example.com")).status).toBe(200);
    });
});

/**
 * CSRF is an attack on ambient (cookie) credentials, and a request carrying
 * its own `Authorization` is not one a page on another origin can forge. Such
 * a request was refused whenever it had no body and no `Origin` — a CLI's
 * `DELETE`: `rebase users delete` through the Rebase Cloud control plane
 * answered 500 (2026-11-18), then 403 — and the refusal itself went out as a
 * 500, because `hono/csrf` throws an `HTTPException` whose status the error
 * handler did not read.
 */
describe("CSRF and requests that carry their own credential", () => {
    function appWithDelete() {
        const app = buildApp();
        app.delete("/api/admin/users/:id", (c) => c.json({ deleted: c.req.param("id") }));
        return app;
    }

    it("lets a body-less DELETE with a bearer through, with no Origin", async () => {
        const res = await appWithDelete().request("/api/admin/users/u1", {
            method: "DELETE",
            headers: { authorization: "Bearer sk_test", accept: "application/json" }
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ deleted: "u1" });
    });

    it("refuses the same request without a credential with a 403 and the API's error envelope, not a 500", async () => {
        const res = await appWithDelete().request("/api/admin/users/u1", { method: "DELETE" });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: { code: "CSRF_REFUSED" } });
    });

    it("still refuses a cross-origin form post that sends only a cookie", async () => {
        const res = await buildApp().request("/api/functions/waitlist", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", cookie: "rebase_session=x" },
            body: "a=1"
        });
        expect(res.status).toBe(403);
    });
});

describe("a Hono HTTPException thrown by a route", () => {
    it("keeps its status instead of becoming a 500", async () => {
        const { HTTPException } = await import("hono/http-exception");
        const app = buildApp();
        app.get("/api/teapot", () => { throw new HTTPException(403, { message: "No." }); });
        app.onError(errorHandler);
        const res = await app.request("/api/teapot");
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN", message: "No." } });
    });
});
