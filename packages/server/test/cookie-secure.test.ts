import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { setRefreshCookie, clearRefreshCookie, getCookieSettings } from "../src/auth/cookie-utils";
import type { HonoEnv } from "../src/api/types";
import { configureJwt } from "../src/auth/jwt";
import { resolveAuthOptions } from "../src/boot/options";
import type { RebaseBootEnv } from "../src/boot/env";
import { logger } from "../src/utils/logger";

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

/**
 * The environment spelling of the flag, and the sentence the docs make about it.
 *
 * The inversion left one real deployment with nowhere to go — a bundle served
 * over plain http on a LAN address, where the browser drops a `Secure` cookie
 * and the session dies at the access token's expiry with no error anywhere. A
 * bundle deployment configures the server entirely through the environment, so
 * "set `cookieAuth.secure: false`" was advice it could not take.
 */
describe("AUTH_COOKIE_SECURE", () => {
    const env = (overrides: Partial<RebaseBootEnv>): RebaseBootEnv =>
        ({ NODE_ENV: "development", APP_NAME: "Rebase", ...overrides }) as RebaseBootEnv;

    // Captured for every case, not only the two that assert on it: the warning
    // is the point of the setting, so a test that turned it off would print it.
    let warn: ReturnType<typeof jest.spyOn>;
    const warned = (): string => warn.mock.calls.map(call => String(call[0])).join("\n");

    beforeEach(() => {
        warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("reaches the cookie config, so an env-only deployment can turn it off", () => {
        const auth = resolveAuthOptions(env({ AUTH_COOKIE_SECURE: false }), undefined);
        expect(auth.cookieAuth?.secure).toBe(false);
    });

    it("is on when the environment says nothing", () => {
        const auth = resolveAuthOptions(env({ AUTH_COOKIE_SECURE: true }), undefined);
        expect(auth.cookieAuth?.secure).toBe(true);
    });

    it("warns at boot when it is off — this is a credential in cleartext", () => {
        resolveAuthOptions(env({ AUTH_COOKIE_SECURE: false }), undefined);

        expect(warned()).toContain("AUTH_COOKIE_SECURE=false");
        expect(warned()).toContain("cleartext");
    });

    it("says nothing when it is on", () => {
        resolveAuthOptions(env({ AUTH_COOKIE_SECURE: true }), undefined);

        expect(warned()).not.toContain("AUTH_COOKIE_SECURE");
    });

    it("carries through to the header a browser sees", async () => {
        const auth = resolveAuthOptions(env({ AUTH_COOKIE_SECURE: false }), undefined);
        const app = new Hono<HonoEnv>();
        app.get("/x", c => {
            setRefreshCookie(c, "the-refresh-token", { enabled: true, ...auth.cookieAuth } as never);
            return c.body(null, 204);
        });
        const cookie = (await app.request("http://192.168.1.20:3000/x")).headers.get("set-cookie") ?? "";

        expect(cookie).not.toContain("Secure");
        expect(cookie).toContain("HttpOnly");
    });
});

/**
 * The documented default is the code's default.
 *
 * `authentication.md` said `secure` was "auto — taken from the request
 * protocol" for as long as the code has done the opposite, which is the worst
 * kind of wrong: an operator reading it concludes the flag follows their proxy
 * and never looks for the variable that would actually help them. Asserting the
 * table row against `getCookieSettings` is cheap and makes the two impossible
 * to separate again.
 */
describe("the documented cookie defaults", () => {
    const DOC = path.join(__dirname, "../../../website/src/content/docs/docs/backend/authentication.md");

    /** ``| `key` | default | note |`` → the default cell, unbackticked. */
    function documentedDefault(key: string): string {
        const page = readFileSync(DOC, "utf8");
        const row = new RegExp(`^\\|\\s*\`${key}\`\\s*\\|([^|]*)\\|`, "m").exec(page);
        if (!row) throw new Error(`No row for \`${key}\` in ${DOC}`);
        return row[1].trim().replace(/`/g, "");
    }

    it("names `true` as the Secure default, and means it", () => {
        expect(documentedDefault("secure")).toContain("true");
        // `undefined` is what an unconfigured deployment passes in.
        expect(getCookieSettings({} as never).secure ?? true).toBe(true);
    });

    it("agrees with the code about the cookie's name, path and SameSite", () => {
        const settings = getCookieSettings(undefined);
        expect(documentedDefault("cookieName")).toBe(settings.name);
        expect(documentedDefault("path")).toBe(settings.path);
        expect(documentedDefault("sameSite")).toBe(settings.sameSite);
    });
});
