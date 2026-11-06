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
