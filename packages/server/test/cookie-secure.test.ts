import { describe, it, expect } from "@jest/globals";
import { Hono } from "hono";
import { setRefreshCookie, clearRefreshCookie } from "../src/auth/cookie-utils";
import type { HonoEnv } from "../src/api/types";
import { configureJwt } from "../src/auth/jwt";

/**
 * The refresh cookie must carry `Secure` by default.
 *
 * It used to be inferred from `c.req.url`, which `@hono/node-server` derives
 * from `socket.encrypted`. Behind a TLS-terminating proxy — an ingress, a load
 * balancer, the normal production topology — the server sees `http`, so the
 * flag was omitted and a credential with a lifetime measured in months
 * travelled in cleartext to any plain-http URL on the same host.
 *
 * The tests below pin the inversion: nothing about the request can turn the
 * flag off, and only an explicit `secure: false` in the deployment's own config
 * does. That direction matters — a request header must never be able to
 * downgrade a cookie, and `X-Forwarded-Proto` is written by whoever is talking
 * to us.
 */
describe("refresh cookie Secure flag", () => {
    configureJwt({ secret: "test-secret-for-cookie-secure-checks-0123456789", accessExpiresIn: "1h" });

    /** Issue a cookie for a request made over `url`, with `headers`. */
    async function cookieFor(
        url: string,
        config: Parameters<typeof setRefreshCookie>[2],
        headers: Record<string, string> = {}
    ): Promise<string> {
        const app = new Hono<HonoEnv>();
        app.get("/x", c => {
            setRefreshCookie(c, "the-refresh-token", config);
            return c.body(null, 204);
        });
        const res = await app.request(url, { headers });
        return res.headers.get("set-cookie") ?? "";
    }

    it("sets Secure on a plain-http request — the proxy case", async () => {
        // The exact shape of the bug: TLS terminated upstream, so this server
        // sees http and used to omit the flag.
        const cookie = await cookieFor("http://api.example.com/x", { enabled: true } as never);
        expect(cookie).toContain("Secure");
        expect(cookie).toContain("HttpOnly");
    });

    it("cannot be turned off by a request header", async () => {
        // `X-Forwarded-Proto` is caller-written. It may not downgrade a cookie.
        const cookie = await cookieFor(
            "http://api.example.com/x",
            { enabled: true } as never,
            { "x-forwarded-proto": "http" }
        );
        expect(cookie).toContain("Secure");
    });

    it("sets Secure over https too", async () => {
        const cookie = await cookieFor("https://api.example.com/x", { enabled: true } as never);
        expect(cookie).toContain("Secure");
    });

    it("omits Secure only when the deployment says so explicitly", async () => {
        // The control: an opt-out has to exist, or this is a config that lies.
        const cookie = await cookieFor("http://localhost:3000/x", { enabled: true, secure: false } as never);
        expect(cookie).not.toContain("Secure");
    });

    it("clears the cookie with the attributes it was set with", async () => {
        const app = new Hono<HonoEnv>();
        app.get("/x", c => {
            clearRefreshCookie(c, { enabled: true } as never);
            return c.body(null, 204);
        });
        const res = await app.request("http://api.example.com/x");
        const cookie = res.headers.get("set-cookie") ?? "";

        expect(cookie).toContain("Secure");
        expect(cookie).toContain("Max-Age=0");
    });
});
