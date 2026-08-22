import { describe, it, expect, jest } from "@jest/globals";
/**
 * Bot protection on the auth routes.
 *
 * Three properties are worth more than the feature itself:
 *
 *  - **it fails closed.** A provider that cannot be reached refuses the
 *    request. Otherwise an attacker who can cause the outage can turn the
 *    protection off, which is the one thing a challenge must not allow.
 *  - **a misconfiguration fails the boot**, not the request. A challenge that is
 *    silently absent is worse than no challenge, because the config claims it is
 *    there.
 *  - **the caller learns nothing.** Absent, malformed, expired and
 *    provider-unreachable are one message, because telling a script which one it
 *    hit tells it how to get closer.
 */
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { resolveCaptchaOptions } from "../src/boot/options";
import type { RebaseBootEnv } from "../src/boot/env";
import {
    resolveCaptchaVerifier,
    buildCaptchaMiddlewares,
    createCaptchaMiddleware,
    createHttpCaptchaVerifier,
    DEFAULT_CAPTCHA_ROUTES,
    type CaptchaVerifier
} from "../src/auth/captcha";

const ok: CaptchaVerifier = async () => ({ success: true });
const no: CaptchaVerifier = async () => ({ success: false, errorCodes: ["invalid-input-response"] });

/** A route protected by the middleware, for end-to-end assertions. */
const appWith = (verify: CaptchaVerifier, tokenField?: string) => {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.post(
        "/guarded",
        createCaptchaMiddleware({ verify, tokenField, route: "register" }),
        (c) => c.json({ reached: true })
    );
    return app;
};

const post = (app: Hono<HonoEnv>, body: unknown, headers: Record<string, string> = {}) =>
    app.fetch(new Request("http://localhost/guarded", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
    }));

describe("resolveCaptchaVerifier", () => {
    it("is undefined when the feature is off", () => {
        expect(resolveCaptchaVerifier(undefined)).toBeUndefined();
        expect(resolveCaptchaVerifier({ enabled: false, provider: "turnstile", secret: "s" })).toBeUndefined();
    });

    it("uses an injected verifier without needing a secret", () => {
        expect(resolveCaptchaVerifier({ enabled: true, verify: ok })).toBe(ok);
    });

    it("refuses to boot when enabled without a provider", () => {
        expect(() => resolveCaptchaVerifier({ enabled: true, secret: "s" }))
            .toThrow(/no `provider` is set/);
    });

    it("refuses to boot on an unknown provider", () => {
        expect(() => resolveCaptchaVerifier({ enabled: true, provider: "recaptcha" as never, secret: "s" }))
            .toThrow(/not supported/);
    });

    it("refuses to boot when enabled without a secret — a widget alone protects nothing", () => {
        expect(() => resolveCaptchaVerifier({ enabled: true, provider: "hcaptcha" }))
            .toThrow(/protects nothing/);
    });
});

describe("buildCaptchaMiddlewares", () => {
    it("builds nothing when the feature is off", () => {
        expect(buildCaptchaMiddlewares(undefined)).toEqual({});
    });

    it("protects the mail-sending routes by default, and not login", () => {
        const built = buildCaptchaMiddlewares({ enabled: true, verify: ok });
        expect(Object.keys(built).sort()).toEqual([...DEFAULT_CAPTCHA_ROUTES].sort());
        expect(built.login).toBeUndefined();
    });

    it("honours an explicit route list", () => {
        const built = buildCaptchaMiddlewares({ enabled: true, verify: ok, routes: ["login"] });
        expect(Object.keys(built)).toEqual(["login"]);
    });

    it("gives an unnamed route nothing, rather than a pass-through", () => {
        const built = buildCaptchaMiddlewares({ enabled: true, verify: ok, routes: ["register"] });
        expect(built.forgotPassword).toBeUndefined();
    });
});

describe("the middleware", () => {
    it("lets a verified request through", async () => {
        const res = await post(appWith(ok), { captchaToken: "t" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ reached: true });
    });

    it("refuses a request with no token", async () => {
        const res = await post(appWith(ok), { email: "a@b.c" });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "CAPTCHA_REQUIRED" } });
    });

    it("refuses a token the provider rejects", async () => {
        const res = await post(appWith(no), { captchaToken: "t" });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "CAPTCHA_FAILED" } });
    });

    it("fails closed when the verifier throws", async () => {
        const boom: CaptchaVerifier = async () => { throw new Error("network down"); };
        const res = await post(appWith(boom), { captchaToken: "t" });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await res.text()).not.toContain("reached");
    });

    it("never tells the caller which failure it was", async () => {
        const rejected = await (await post(appWith(no), { captchaToken: "t" })).json() as { error: { message: string } };
        expect(rejected.error.message).not.toMatch(/invalid-input-response/);
        expect(rejected.error.message).not.toMatch(/provider|network|unreachable/i);
    });

    it("accepts the token from the widget's header", async () => {
        const res = await post(appWith(ok), {}, { "cf-turnstile-response": "t" });
        expect(res.status).toBe(200);
    });

    it("accepts the hCaptcha header too", async () => {
        const res = await post(appWith(ok), {}, { "h-captcha-response": "t" });
        expect(res.status).toBe(200);
    });

    it("honours a custom token field", async () => {
        const res = await post(appWith(ok, "challenge"), { challenge: "t" });
        expect(res.status).toBe(200);
    });

    it("leaves the body readable by the route behind it", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.post(
            "/guarded",
            createCaptchaMiddleware({ verify: ok, route: "register" }),
            async (c) => c.json({ body: await c.req.json() })
        );

        const res = await post(app, { captchaToken: "t", email: "a@b.c" });
        // The middleware reads the body to find the token; the handler must
        // still get it.
        expect(await res.json()).toEqual({ body: { captchaToken: "t", email: "a@b.c" } });
    });

    it("passes the caller's address to the provider as a cross-check", async () => {
        const verify = jest.fn(async () => ({ success: true })) as unknown as CaptchaVerifier;
        await post(appWith(verify), { captchaToken: "t" }, { "cf-connecting-ip": "203.0.113.7" });
        expect(verify).toHaveBeenCalledWith({ token: "t", remoteIp: "203.0.113.7" });
    });
});

describe("createHttpCaptchaVerifier", () => {
    const verifierWith = (fetchImpl: unknown) => createHttpCaptchaVerifier({
        provider: "turnstile",
        secret: "sekrit",
        timeoutMs: 50,
        fetchImpl: fetchImpl as typeof fetch
    });

    it("posts the secret and the token, and reads success", async () => {
        let seen: { url: string; body: string } | undefined;
        const verify = verifierWith(async (url: string, init: { body: URLSearchParams }) => {
            seen = { url, body: init.body.toString() };
            return { ok: true, json: async () => ({ success: true }) };
        });

        expect(await verify({ token: "abc", remoteIp: "1.2.3.4" })).toEqual({
            success: true, errorCodes: undefined
        });
        expect(seen!.url).toContain("challenges.cloudflare.com");
        expect(seen!.body).toContain("secret=sekrit");
        expect(seen!.body).toContain("response=abc");
        expect(seen!.body).toContain("remoteip=1.2.3.4");
    });

    it("carries the provider's error codes back for the log", async () => {
        const verify = verifierWith(async () => ({
            ok: true, json: async () => ({ success: false, "error-codes": ["timeout-or-duplicate"] })
        }));
        expect(await verify({ token: "abc" })).toEqual({
            success: false, errorCodes: ["timeout-or-duplicate"]
        });
    });

    it("treats a non-200 from the provider as unverified", async () => {
        const verify = verifierWith(async () => ({ ok: false, status: 503, json: async () => ({}) }));
        expect(await verify({ token: "abc" })).toEqual({ success: false, errorCodes: ["http-503"] });
    });

    it("treats an unreachable provider as unverified, not as an exception", async () => {
        const verify = verifierWith(async () => { throw new Error("ECONNREFUSED"); });
        await expect(verify({ token: "abc" })).resolves.toEqual({
            success: false, errorCodes: ["unreachable"]
        });
    });

    it("treats a malformed provider response as unverified", async () => {
        const verify = verifierWith(async () => ({ ok: true, json: async () => { throw new Error("not json"); } }));
        expect((await verify({ token: "abc" })).success).toBe(false);
    });

    it("omits remoteip when there is none", async () => {
        let body = "";
        const verify = verifierWith(async (_url: string, init: { body: URLSearchParams }) => {
            body = init.body.toString();
            return { ok: true, json: async () => ({ success: true }) };
        });
        await verify({ token: "abc" });
        expect(body).not.toContain("remoteip");
    });

    it("points hCaptcha at its own endpoint", async () => {
        let url = "";
        const verify = createHttpCaptchaVerifier({
            provider: "hcaptcha",
            secret: "s",
            fetchImpl: (async (u: string) => {
                url = u;
                return { ok: true, json: async () => ({ success: true }) };
            }) as unknown as typeof fetch
        });
        await verify({ token: "abc" });
        expect(url).toContain("hcaptcha.com");
    });
});

describe("resolveCaptchaOptions — from the environment", () => {
    const env = (over: Record<string, unknown>) => over as unknown as RebaseBootEnv;

    it("is undefined when neither half is set", () => {
        expect(resolveCaptchaOptions(env({}))).toBeUndefined();
    });

    it("is undefined with a provider but no secret — it could not verify anything", () => {
        expect(resolveCaptchaOptions(env({ CAPTCHA_PROVIDER: "turnstile" }))).toBeUndefined();
    });

    it("is undefined with a secret but no provider", () => {
        expect(resolveCaptchaOptions(env({ CAPTCHA_SECRET: "s" }))).toBeUndefined();
    });

    it("enables it when both halves are present", () => {
        expect(resolveCaptchaOptions(env({ CAPTCHA_PROVIDER: "hcaptcha", CAPTCHA_SECRET: "s" })))
            .toEqual({ enabled: true, provider: "hcaptcha", secret: "s" });
    });

    it("reads a comma-separated route list, trimming it", () => {
        expect(resolveCaptchaOptions(env({
            CAPTCHA_PROVIDER: "turnstile",
            CAPTCHA_SECRET: "s",
            CAPTCHA_ROUTES: " register , login "
        }))).toMatchObject({ routes: ["register", "login"] });
    });

    it("falls back to the defaults on an empty route list", () => {
        expect(resolveCaptchaOptions(env({
            CAPTCHA_PROVIDER: "turnstile", CAPTCHA_SECRET: "s", CAPTCHA_ROUTES: " , "
        }))).not.toHaveProperty("routes");
    });

    it("produces a config the resolver accepts", () => {
        const config = resolveCaptchaOptions(env({ CAPTCHA_PROVIDER: "turnstile", CAPTCHA_SECRET: "s" }));
        expect(() => resolveCaptchaVerifier(config)).not.toThrow();
    });
});
