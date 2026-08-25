/**
 * Bot protection on the auth endpoints that cost something to hit.
 *
 * Rate limiting was the whole defence, and it bounds a single caller rather
 * than a botnet: a thousand addresses each sending one request per minute never
 * touch a per-IP window, and `/auth/register` and `/auth/forgot-password` both
 * send mail. So the bill for an unprotected signup form is paid in reputation on
 * a sending domain, not in CPU.
 *
 * This adds a challenge the caller has to have solved, verified server-side
 * against the provider before the route does any work.
 *
 * ## Fail closed, and why that is the safe direction here
 *
 * If the provider cannot be reached, verification fails and the request is
 * refused. That is the opposite of the choice made for the RLS audit, which
 * logs and continues, and the difference is what failure means: an audit that
 * does not run leaves you where you were, while a challenge that is not checked
 * leaves the door open for exactly as long as the outage lasts. An attacker who
 * can cause the outage would otherwise be able to turn the protection off.
 *
 * The cost is that a provider outage blocks sign-ups. That is visible, loud, and
 * recoverable by unsetting one config key — which is a better failure than a
 * silent one nobody notices until the mail domain is blocklisted.
 *
 * ## Why the verifier is injected
 *
 * Same reason as the RLS scanner: so the whole thing is testable without a
 * network, and so no provider SDK enters this package's dependency graph. The
 * built-in verifier is `fetch` and a form post, which is the entire protocol for
 * both providers this supports.
 */
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import { logger } from "../utils/logger";

/** The two providers whose verify endpoints share this exact shape. */
export type CaptchaProvider = "turnstile" | "hcaptcha";

const VERIFY_ENDPOINT: Record<CaptchaProvider, string> = {
    turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    hcaptcha: "https://api.hcaptcha.com/siteverify"
};

export interface CaptchaVerifyRequest {
    token: string;
    /** The caller's address, which both providers accept as a cross-check. */
    remoteIp?: string;
}

export interface CaptchaVerifyResult {
    success: boolean;
    /** Provider error codes, for the log line. Never returned to the caller. */
    errorCodes?: string[];
}

export type CaptchaVerifier = (request: CaptchaVerifyRequest) => Promise<CaptchaVerifyResult>;

export interface CaptchaConfig {
    /** Off unless set. */
    enabled?: boolean;
    provider?: CaptchaProvider;
    /** The provider's secret. Required when enabled, unless `verify` is given. */
    secret?: string;
    /**
     * Which routes to protect. Defaults to the three that send mail or create
     * accounts: `register`, `forgotPassword`, `magicLink`.
     *
     * `login` is deliberately not on by default. A challenge on every sign-in is
     * a tax on every real user, and credential stuffing is what the rate limiter
     * and account lockout are for.
     */
    routes?: CaptchaRoute[];
    /**
     * Where the token is read from. Defaults to the `captchaToken` field of the
     * JSON body, with the `cf-turnstile-response` / `h-captcha-response` header
     * accepted as a fallback.
     */
    tokenField?: string;
    /** Override the verifier. Supplying it makes `secret` unnecessary. */
    verify?: CaptchaVerifier;
    /** Milliseconds before a verification attempt is abandoned. Default 5000. */
    timeoutMs?: number;
}

export type CaptchaRoute = "register" | "login" | "forgotPassword" | "magicLink" | "emailOtp";

export const DEFAULT_CAPTCHA_ROUTES: CaptchaRoute[] = ["register", "forgotPassword", "magicLink", "emailOtp"];

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TOKEN_FIELD = "captchaToken";

/** Header names the two widgets post by convention. */
const TOKEN_HEADERS = ["cf-turnstile-response", "h-captcha-response"];

/**
 * The built-in verifier: a form post, which is the whole protocol.
 *
 * A non-200, a timeout or a malformed body are all "not verified" rather than
 * exceptions — the caller cannot distinguish them and should not be told which
 * one happened.
 */
export function createHttpCaptchaVerifier(options: {
    provider: CaptchaProvider;
    secret: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}): CaptchaVerifier {
    const endpoint = VERIFY_ENDPOINT[options.provider];
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const doFetch = options.fetchImpl ?? fetch;

    return async ({ token, remoteIp }) => {
        const body = new URLSearchParams({ secret: options.secret, response: token });
        if (remoteIp) body.set("remoteip", remoteIp);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await doFetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
                signal: controller.signal
            });
            if (!response.ok) {
                return { success: false, errorCodes: [`http-${response.status}`] };
            }
            const parsed = await response.json() as { success?: boolean; "error-codes"?: string[] };
            return {
                success: parsed?.success === true,
                errorCodes: parsed?.["error-codes"]
            };
        } catch (err) {
            const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "unreachable";
            return { success: false, errorCodes: [reason] };
        } finally {
            clearTimeout(timer);
        }
    };
}

/**
 * Resolve a config into a verifier, or explain why it cannot be used.
 *
 * Returns `undefined` when the feature is off. Throws when it is on but
 * unusable — a misconfigured challenge must not boot as an absent one, because
 * the whole point is that it is there.
 */
export function resolveCaptchaVerifier(config: CaptchaConfig | undefined): CaptchaVerifier | undefined {
    if (!config?.enabled) return undefined;
    if (config.verify) return config.verify;

    if (!config.provider) {
        throw new Error(
            "Captcha is enabled but no `provider` is set. Use \"turnstile\" or \"hcaptcha\", " +
            "or supply your own `verify` function."
        );
    }
    if (!(config.provider in VERIFY_ENDPOINT)) {
        throw new Error(
            `Captcha \`provider\` is "${config.provider}", which is not supported. ` +
            "Use \"turnstile\" or \"hcaptcha\", or supply your own `verify` function."
        );
    }
    if (!config.secret) {
        throw new Error(
            `Captcha is enabled for ${config.provider} but no \`secret\` is set. ` +
            "The token has to be verified server-side; a widget on its own protects nothing."
        );
    }

    return createHttpCaptchaVerifier({
        provider: config.provider,
        secret: config.secret,
        timeoutMs: config.timeoutMs
    });
}

/** Read the challenge token out of a request, body field first, then headers. */
export async function extractCaptchaToken(
    c: Parameters<MiddlewareHandler<HonoEnv>>[0],
    field: string
): Promise<string | undefined> {
    for (const header of TOKEN_HEADERS) {
        const value = c.req.header(header);
        if (value) return value;
    }

    try {
        // Cached by Hono, so the route handler's own `c.req.json()` still works
        // — reading the body here must not consume it.
        const body = await c.req.json() as Record<string, unknown> | undefined;
        const value = body?.[field];
        return typeof value === "string" && value.length > 0 ? value : undefined;
    } catch {
        // Not JSON, or empty. Treated as "no token", which the middleware
        // refuses — the same as a wrong one.
        return undefined;
    }
}

/**
 * Middleware refusing a request whose challenge is missing or unverified.
 *
 * The response says only that the challenge failed. Which of "absent",
 * "malformed", "already used" or "provider unreachable" it was is a log line,
 * because telling a script which one it hit is telling it how to get closer.
 */
export function createCaptchaMiddleware(options: {
    verify: CaptchaVerifier;
    tokenField?: string;
    /** Named in the log so a failure says which route refused. */
    route: CaptchaRoute;
}): MiddlewareHandler<HonoEnv> {
    const field = options.tokenField ?? DEFAULT_TOKEN_FIELD;

    return createMiddleware<HonoEnv>(async (c, next) => {
        const token = await extractCaptchaToken(c, field);

        if (!token) {
            logger.debug(`[captcha] ${options.route}: no token on the request`);
            throw ApiError.badRequest(
                "A captcha challenge is required for this request.",
                "CAPTCHA_REQUIRED"
            );
        }

        const result = await options.verify({
            token,
            remoteIp: c.req.header("cf-connecting-ip") ?? undefined
        });

        if (!result.success) {
            logger.warn(
                `[captcha] ${options.route}: verification failed` +
                (result.errorCodes?.length ? ` (${result.errorCodes.join(", ")})` : "")
            );
            throw ApiError.badRequest(
                "The captcha challenge could not be verified.",
                "CAPTCHA_FAILED"
            );
        }

        await next();
    });
}

/**
 * A middleware per protected route, or an empty map when the feature is off.
 *
 * Routes not named get nothing at all rather than a pass-through, so an unnamed
 * route costs exactly what it did before.
 */
export function buildCaptchaMiddlewares(
    config: CaptchaConfig | undefined
): Partial<Record<CaptchaRoute, MiddlewareHandler<HonoEnv>>> {
    const verify = resolveCaptchaVerifier(config);
    if (!verify) return {};

    const routes = config?.routes ?? DEFAULT_CAPTCHA_ROUTES;
    const middlewares: Partial<Record<CaptchaRoute, MiddlewareHandler<HonoEnv>>> = {};
    for (const route of routes) {
        middlewares[route] = createCaptchaMiddleware({
            verify,
            tokenField: config?.tokenField,
            route
        });
    }
    return middlewares;
}
