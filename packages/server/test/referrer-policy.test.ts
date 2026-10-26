import { describe, it, expect } from "@jest/globals";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { defaultReferrerPolicy, runtimeSecureHeaders } from "../src/boot/security-headers";
import { consentPageHeaders } from "../src/mcp/consent-page";

/**
 * The runtime used to send `secureHeaders()`' default, `Referrer-Policy:
 * no-referrer`, and Google's "Sign in with Google" button refused every
 * Rebase-hosted app for it: with no origin to compare against the OAuth
 * client's authorized JavaScript origins, it answered "The given origin is not
 * allowed for the given client ID" however the client was configured.
 *
 * The default is the browsers' own now, and a route that asks for stricter —
 * the MCP consent page — keeps what it asked for.
 */
describe("Referrer-Policy", () => {
    function appWith(): Hono {
        const app = new Hono();
        app.use("/*", runtimeSecureHeaders({ hstsIncludeSubDomains: false }));
        app.get("/", (c) => c.text("ok"));
        app.get("/api/thing", (c) => c.json({ ok: true }));
        app.get("/consent", (c) => c.html("<p>consent</p>", 200, consentPageHeaders("abc")));
        app.get("/boom", () => {
            throw new Error("boom");
        });
        return app;
    }

    it("sends strict-origin-when-cross-origin by default", async () => {
        const app = appWith();
        for (const url of ["/", "/api/thing", "/nowhere", "/boom"]) {
            expect((await app.request(url)).headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
        }
    });

    it("leaves the consent page's no-referrer alone", async () => {
        // `secureHeaders()` overwrites whatever a route set, so the default
        // cannot simply be its `referrerPolicy` option.
        const res = await appWith().request("/consent");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it("works beside a hand-written secureHeaders(), as an ejected backend uses it", async () => {
        const app = new Hono();
        app.use("/*", secureHeaders({ referrerPolicy: false }));
        app.use("/*", defaultReferrerPolicy());
        app.get("/", (c) => c.text("ok"));
        app.get("/consent", (c) => c.html("<p>consent</p>", 200, consentPageHeaders("abc")));
        expect((await app.request("/")).headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
        expect((await app.request("/consent")).headers.get("referrer-policy")).toBe("no-referrer");
    });
});
