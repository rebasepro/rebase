import { describe, it, expect } from "@jest/globals";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { overridableSecurityHeaders, runtimeSecureHeaders } from "../src/boot/security-headers";
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

/** A hand-written `secureHeaders()`, as an ejected backend installs it. */
function ejectedAppWith(): Hono {
    const app = new Hono();
    app.use("/*", secureHeaders({
        referrerPolicy: false,
        xFrameOptions: false
    }));
    app.use("/*", overridableSecurityHeaders());
    app.get("/", (c) => c.text("ok"));
    app.get("/consent", (c) => c.html("<p>consent</p>", 200, consentPageHeaders("abc")));
    return app;
}

describe("Referrer-Policy", () => {
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
        const app = ejectedAppWith();
        expect((await app.request("/")).headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
        expect((await app.request("/consent")).headers.get("referrer-policy")).toBe("no-referrer");
    });
});

/**
 * The MCP consent page asks for `X-Frame-Options: DENY` — a consent screen that
 * can be framed is one an attacker can have clicked — and `secureHeaders()`,
 * which runs after the route, used to overwrite it with `SAMEORIGIN`. Its CSP
 * `frame-ancestors 'none'` still held in modern browsers; the header did not.
 */
describe("X-Frame-Options", () => {
    it("sends SAMEORIGIN by default", async () => {
        const app = appWith();
        for (const url of ["/", "/api/thing", "/nowhere", "/boom"]) {
            expect((await app.request(url)).headers.get("x-frame-options")).toBe("SAMEORIGIN");
        }
    });

    it("leaves the consent page's DENY alone", async () => {
        const res = await appWith().request("/consent");
        expect(res.headers.get("x-frame-options")).toBe("DENY");
        expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    });

    it("works beside a hand-written secureHeaders(), as an ejected backend uses it", async () => {
        const app = ejectedAppWith();
        expect((await app.request("/")).headers.get("x-frame-options")).toBe("SAMEORIGIN");
        expect((await app.request("/consent")).headers.get("x-frame-options")).toBe("DENY");
    });
});
