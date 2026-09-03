import { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isAnonymousUid } from "@rebasepro/types";
import { HonoEnv } from "../api/types";
import { MemoryRateLimitStore, RateLimitStore } from "./rate-limit-store";
import { extractBearerToken } from "./bearer-token";
import { isJwtConfigured, verifyAccessToken } from "./jwt";
import { logger } from "../utils/logger";

/**
 * Sliding-window rate limiting for Hono.
 *
 * The counting lives in a {@link RateLimitStore} — in this process's memory by
 * default, which is a per-replica limit and says so. See `rate-limit-store.ts`.
 */

interface RateLimiterOptions {
    /** Time window in milliseconds (default: 15 minutes) */
    windowMs?: number;
    /** Maximum requests per window (default: 100) */
    limit?: number;
    /**
     * Key generator function. Defaults to IP-based keying.
     *
     * May return a promise: a generator that buckets by the *user* has to
     * verify a token to find one, and verification is asynchronous (see
     * `jwt-crypto.ts`). Returning a plain string is still fine, and is what
     * every IP-keyed generator does.
     */
    keyGenerator?: (c: Parameters<MiddlewareHandler<HonoEnv>>[0]) => string | Promise<string>;
    /** Custom message for rate limit responses */
    message?: string;
    /**
     * Where to keep the counts. Defaults to a private in-memory store — pass a
     * shared one to have several limiters (or several processes) agree.
     */
    store?: RateLimitStore;
    /**
     * Per-request limit override, for buckets whose allowance is data rather
     * than config (an API key's own `rate_limit`). Returning `undefined` uses
     * `limit`; returning `null` skips the limiter for this request.
     */
    resolveLimit?: (c: Parameters<MiddlewareHandler<HonoEnv>>[0]) =>
        number | null | undefined | Promise<number | null | undefined>;
    /**
     * Number of trusted reverse-proxy hops in front of this server. Each hop
     * appends the address it saw to `X-Forwarded-For`, so the real client IP is
     * the Nth entry from the right. Anything further left is client-supplied and
     * ignored — which is what stops a caller spoofing `X-Forwarded-For` to
     * rotate rate-limit keys.
     *
     * **Defaults to `0`: no proxy is trusted, and `X-Forwarded-For` and
     * `X-Real-IP` are both ignored in favour of the socket address.** A server
     * cannot tell from a request whether a proxy put that header there or the
     * caller did, so the number of hops is a deployment fact that has to be
     * declared. It previously defaulted to `1`, and nothing in the repo ever
     * set it — so on any directly-exposed server (`rebase dev`, a self-hosted
     * `rebase-server`, a passthrough load balancer) one header gave every
     * IP-keyed limiter an effective limit of one request per attacker-chosen
     * value.
     *
     * Set it — via this option or `TRUSTED_PROXY_HOPS` — to the number of
     * proxies you actually run. Behind one ingress or load balancer that is
     * `1`. Leaving it unset behind a proxy makes every client share the
     * proxy's address as one bucket, which the boot-time warning below tells
     * you about the first time it happens.
     */
    trustedProxyHops?: number;
}

/**
 * Resolve the number of trusted proxy hops from an explicit option, the
 * `TRUSTED_PROXY_HOPS` env var, or the fail-safe default of 0.
 *
 * Zero, not one: trusting a hop that is not there hands the rate-limit key to
 * the caller, and a server has no way to detect the difference from a request.
 */
function resolveTrustedProxyHops(optionValue?: number): number {
    if (typeof optionValue === "number" && Number.isFinite(optionValue) && optionValue >= 0) {
        return Math.floor(optionValue);
    }
    const fromEnv = Number(process.env.TRUSTED_PROXY_HOPS);
    if (Number.isFinite(fromEnv) && fromEnv >= 0) {
        return Math.floor(fromEnv);
    }
    return 0;
}

/**
 * Warn once when the deployment looks proxied but has not said so.
 *
 * The safe default is the wrong answer for the other common topology: behind an
 * ingress, every request arrives from the proxy, so ignoring `X-Forwarded-For`
 * collapses every client into one bucket and the limiter starts locking real
 * users out of each other's quota. That is a loud failure in production and a
 * silent one in staging, so it gets a warning rather than a guess — guessing is
 * what made the header trustworthy in the first place.
 */
let warnedAboutUntrustedForwardedFor = false;

function warnIfProxiedButUntrusted(hasForwardedFor: boolean): void {
    if (!hasForwardedFor || warnedAboutUntrustedForwardedFor) return;
    warnedAboutUntrustedForwardedFor = true;
    logger.warn(
        "[RateLimit] Requests carry X-Forwarded-For but TRUSTED_PROXY_HOPS is 0, so it is " +
            "being ignored and every client behind the proxy shares one rate-limit bucket. " +
            "If this server really is behind a reverse proxy, set TRUSTED_PROXY_HOPS to the " +
            "number of proxies in front of it (1 for a single ingress or load balancer). " +
            "If it is exposed directly, this warning means someone is sending the header " +
            "themselves and 0 is the correct setting."
    );
}

/**
 * Create a rate-limiting middleware.
 *
 * Uses a sliding window: only hits within the last `windowMs` are counted.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler<HonoEnv> {
    const trustedProxyHops = resolveTrustedProxyHops(options.trustedProxyHops);
    const {
        windowMs = 15 * 60 * 1000,
        limit = 100,
        keyGenerator = (c: Parameters<MiddlewareHandler<HonoEnv>>[0]) => defaultKeyGenerator(c, trustedProxyHops),
        message = "Too many requests, please try again later.",
        store = new MemoryRateLimitStore(windowMs),
        resolveLimit
    } = options;

    return async (c, next) => {
        const effectiveLimit = resolveLimit ? await resolveLimit(c) : limit;
        // `null` means "not my bucket" — e.g. an API-key limiter looking at a
        // request that carries no API key.
        if (effectiveLimit === null) return next();
        const activeLimit = effectiveLimit ?? limit;

        const decision = await store.hit(await keyGenerator(c), windowMs, activeLimit);

        c.header("X-RateLimit-Limit", String(activeLimit));
        c.header("X-RateLimit-Remaining", String(decision.remaining));

        if (!decision.allowed) {
            const retryAfterSec = Math.ceil(decision.retryAfterMs / 1000);
            c.header("Retry-After", String(retryAfterSec));
            c.header("X-RateLimit-Reset", String(Math.ceil((Date.now() + decision.retryAfterMs) / 1000)));

            return c.json({
                error: {
                    message,
                    code: "RATE_LIMITED"
                }
            }, 429);
        }

        return next();
    };
}

/**
 * The address the socket is actually connected to, or `undefined` on a runtime
 * that cannot say. Unforgeable, unlike every header below.
 *
 * `getConnInfo` is Node-specific and throws elsewhere, so the failure is
 * swallowed: a runtime without connection info falls back to the shared bucket,
 * which is a availability trade the caller cannot exploit.
 */
function socketAddress(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string | undefined {
    try {
        return getConnInfo(c).remote.address;
    } catch {
        return undefined;
    }
}

/**
 * Default key generator: the client's address, from the most trustworthy source
 * this deployment has.
 *
 * `X-Forwarded-For` is a client-writable header; only the entries appended by
 * trusted reverse proxies can be believed. With `trustedProxyHops` proxies in
 * front, each appends the address it saw, so the real client IP is the
 * `trustedProxyHops`-th entry from the right — everything further left is
 * client-supplied and must be ignored. This is what prevents a caller from
 * spoofing `X-Forwarded-For` to spread its requests across many rate-limit keys.
 *
 * `X-Real-IP` is the *same* kind of header and needs the same rule, which it
 * did not have: it was read unconditionally, including under
 * `trustedProxyHops === 0` — the mode whose entire meaning is "no proxy is in
 * front of me". With no proxy there, nothing writes `X-Real-IP` except the
 * caller, so the key was theirs to choose: one header per request bought an
 * unlimited number of buckets, and the limiters on login, registration and
 * password reset counted to one. The reasoning had been done carefully for one
 * spelling of a proxy header and not carried to its twin.
 *
 * So `X-Real-IP` is now believed only where a proxy is declared to exist. With
 * none, the connection's own address is used — unforgeable, and available
 * because the server runs on `@hono/node-server`. `"unknown"` is the last
 * resort only, and it is a single shared bucket by design: better that
 * anonymous callers throttle each other than that any of them throttles nobody.
 */
function defaultKeyGenerator(
    c: Parameters<MiddlewareHandler<HonoEnv>>[0],
    trustedProxyHops: number = resolveTrustedProxyHops()
): string {
    if (trustedProxyHops === 0) {
        // Neither header is evidence of anything: both are trivially set by the
        // caller, and no proxy has been declared that would overwrite them.
        warnIfProxiedButUntrusted(!!c.req.header("x-forwarded-for"));
        return socketAddress(c) ?? "unknown";
    }

    {
        const forwardedFor = c.req.header("x-forwarded-for");
        if (forwardedFor) {
            const ips = forwardedFor.split(",").map(s => s.trim()).filter(Boolean);
            if (ips.length > 0) {
                const idx = Math.max(0, ips.length - trustedProxyHops);
                return ips[idx];
            }
        }
        // A trusted proxy is declared to be in front, so this header is its to
        // set — and a proxy that sets only `X-Real-IP` (the stock nginx recipe)
        // is a normal deployment.
        const realIp = c.req.header("x-real-ip");
        if (realIp) return realIp;
    }
    return socketAddress(c) ?? "unknown";
}

/**
 * Pre-configured rate limiter for general auth endpoints (login, register).
 * 200 requests per 15 minutes per IP.
 */
export const defaultAuthLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    message: "Too many authentication attempts, please try again later."
});

/**
 * Pre-configured strict rate limiter for sensitive endpoints (password reset, verification).
 * 50 requests per 15 minutes per IP.
 */
export const strictAuthLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    message: "Too many requests to this sensitive endpoint, please try again later."
});

/**
 * Limiter for `POST /auth/send-verification`, keyed by the authenticated user.
 *
 * That route had no limiter at all while every one of its email-sending
 * siblings had one, and being authenticated is not the protection it looks
 * like: registration does not verify the address it is given, so an attacker
 * registers a victim's address, signs in to the account they just made, and
 * loops the route. Each call mints a token and mails the victim.
 *
 * An IP limiter cannot express what is wanted here — the recipient is the
 * quantity being protected, not the caller — so this one keys on the uid, which
 * on this route is one-to-one with the recipient address (emails are unique per
 * account). `strictAuthLimiter` still runs in front of it to bound the caller by
 * IP; this bounds what any single address can be sent.
 *
 * Five per 15 minutes is generous for "I didn't get the email, resend it" and
 * useless as a mail bomb. Unauthenticated requests fall back to the IP bucket so
 * the limiter is never a no-op if it is ever mounted before the auth middleware.
 */
/**
 * Read the recipient address out of the body, so a limiter can key on it.
 *
 * A limiter runs before the handler, and Hono caches a parsed body — so this
 * reads a clone, stashes the address, and lets the handler read the same
 * request normally. Without it the limiters below have no account to key on
 * and collapse into one global bucket, which is a limiter in name only.
 *
 * A malformed body is left to the handler, which reports it with the message
 * that names the field; failing here would answer 429 to bad JSON.
 */
export const captureRecipientEmail: MiddlewareHandler<HonoEnv> = async (c, next) => {
    try {
        // `c.req.json()`, NOT `c.req.raw.clone().json()`. Hono caches the parsed
        // body on the request, so reading it here is what lets the handler read
        // it again; cloning the raw Request instead marks the original stream
        // distributed, and the handler's own parse then fails — which surfaces
        // as a 500 on a route that was about to answer 503.
        const body = await c.req.json() as { email?: unknown };
        if (typeof body?.email === "string") {
            c.set("recipientEmail", body.email.trim().toLowerCase());
        }
    } catch {
        // A malformed body is the handler's error to report, with the message
        // that names the field. Failing here would answer 429 to bad JSON.
    }
    await next();
};

/**
 * Per-ADDRESS throttle for a route that mails an address the caller named.
 *
 * `strictAuthLimiter` bounds a machine, and a machine is the attacker's to
 * multiply. The mailbox being filled belongs to somebody who cannot rotate
 * anything, and the domain the messages come from is this deployment's
 * reputation — so a distributed run against one address passed the IP limiter
 * untouched and cost the operator their sender score.
 *
 * Five per fifteen minutes: generous for "I didn't get it, send it again",
 * useless as a mail bomb. The same numbers as `verificationEmailLimiter`,
 * which bounds the same act for a signed-in caller.
 *
 * Falls back to the IP bucket for a request whose body named no address, so
 * the limiter is never silently a no-op.
 */
export const recipientEmailLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    keyGenerator: (c) => {
        const email = c.get("recipientEmail") as string | undefined;
        return email ? `recipient-email:${email}` : `recipient-email:ip:${defaultKeyGenerator(c)}`;
    },
    message: "Too many emails requested for this address, please try again later."
});

/**
 * How long a route that answers "if an account exists…" takes, whoever asked.
 *
 * These routes deliberately answer the same words for a known and an unknown
 * address. They did not take the same TIME: a known address meant a token
 * insert, a template render and an SMTP round trip, and an unknown one meant
 * returning immediately. That difference is measurable from anywhere, so an
 * endpoint that refuses to say whether an account exists said it anyway, one
 * address at a time.
 *
 * The mail is sent off the response path at each call site, which removes the
 * largest and most variable part; this floor covers the rest without requiring
 * the two branches to be instruction-for-instruction equal, which is not a
 * property anyone can maintain across a refactor.
 *
 * 400ms is chosen to sit above the slow branch rather than to be pleasant: it
 * is a step a person takes once, and the alternative is an enumeration oracle.
 */
export const RECIPIENT_ROUTE_FLOOR_MS = 400;

/** Hold a result until at least `floorMs` has passed since `startedAt`. */
export async function notBefore<T>(startedAt: number, floorMs: number, result: T): Promise<T> {
    const remaining = floorMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    return result;
}

export const verificationEmailLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    keyGenerator: (c) => {
        const user = c.get("user") as { uid?: string } | undefined;
        return user?.uid
            ? `verification-email:user:${user.uid}`
            : `verification-email:ip:${defaultKeyGenerator(c)}`;
    },
    message: "Too many verification emails requested, please try again later."
});

/**
 * Key generator for API-key-based rate limiting.
 *
 * Uses the API key ID (from `c.get("apiKey")`) as the rate limit key.
 * Falls back to IP-based keying when the request is not authenticated
 * via an API key.
 */
export function apiKeyKeyGenerator(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string {
    const apiKey = c.get("apiKey") as { id: string } | undefined;
    if (apiKey) {
        return `api-key:${apiKey.id}`;
    }
    return defaultKeyGenerator(c);
}

/** How the data API's limits are apportioned. All fields optional. */
export interface DataRateLimitConfig {
    /** Turn the whole thing off — for a deployment whose proxy already does it. */
    enabled?: boolean;
    /**
     * Trusted reverse-proxy hops, for the IP bucket. Same meaning and same
     * fail-safe default of 0 as {@link RateLimiterOptions.trustedProxyHops} —
     * threaded explicitly because this limiter builds its own key generator,
     * and before this existed the option was accepted by the surrounding
     * limiter and then ignored for the one bucket that keys on an address.
     */
    trustedProxyHops?: number;
    windowMs?: number;
    /** Fallback for an API key with no `rate_limit` of its own. Default 1000. */
    apiKey?: number;
    /** Per signed-in user. Default 1000. */
    user?: number;
    /**
     * Per IP, for requests with no principal at all. Default 300.
     * `null` disables the anonymous bucket entirely.
     */
    anonymous?: number | null;
    /**
     * Per IP, for anonymous requests to `/api/functions/*`. Default 3000 —
     * deliberately far looser than {@link anonymous}, because the functions
     * router is public by default for webhook receivers (Stripe, GitHub) whose
     * bursts arrive from a handful of provider IPs and would trip the data
     * API's ceiling.
     *
     * The looseness bounds the *value*, not the existence of the limit: this
     * router is the one that invites anonymous callers, so it is the last one
     * that should have no ceiling at all. `null` disables it — an explicit
     * choice, which is what the hardcoded `anonymous: null` here used to be
     * without any way to say otherwise.
     */
    anonymousFunctions?: number | null;
    /** Share counts across replicas. Defaults to this process's memory. */
    store?: RateLimitStore;
}

/** @see DataRateLimitConfig.anonymousFunctions */
export const DEFAULT_FUNCTIONS_ANONYMOUS_LIMIT = 3000;

/**
 * Rate limiting for the data API.
 *
 * Every request is in exactly one bucket, resolved most-specific first: an API
 * key by its id, a signed-in user by their uid, anyone else by IP. Previously
 * only the first of those was limited at all — the middleware returned early
 * for any request without an API key — so JWT and anonymous traffic to
 * `/api/data/*` was unbounded, which is most of the traffic a BaaS gets.
 *
 * Per bucket, not per route: the point is to bound what one caller costs, and
 * they can spend it wherever they like.
 *
 * The defaults are deliberately loose. This is a floor against a runaway client
 * or a naive scraper, not a quota — a deployment that wants real quotas should
 * set them, and one that already has a proxy doing this should pass
 * `enabled: false` rather than pay for it twice.
 */
export function createDataRateLimiter(config: DataRateLimitConfig = {}): MiddlewareHandler<HonoEnv> {
    const {
        windowMs = 15 * 60 * 1000,
        apiKey: apiKeyLimit = 1000,
        user: userLimit = 1000,
        anonymous: anonLimit = 300,
        // One store for every bucket: the keys are already namespaced, and a
        // shared store is what makes a shared limit possible.
        store = new MemoryRateLimitStore(windowMs)
    } = config;
    const trustedProxyHops = resolveTrustedProxyHops(config.trustedProxyHops);

    /**
     * Who this request is, for bucketing only.
     *
     * `c.get("user")` is the answer whenever an auth middleware has already run.
     * On the storage router it has not: the limiter is registered before
     * `route("/")`, and the JWT middlewares live inside those routes, so a
     * signed-in caller reached here indistinguishable from an anonymous one and
     * was bucketed `ip:` at the anonymous allowance. Everyone behind one NAT
     * shared 300 requests per window, and the admin panel — which mints a
     * download token per file — spent them on a single page of thumbnails.
     *
     * Reading the token here rather than moving the limiter is deliberate. The
     * limiter has to run *before* the routes to guard them, and pre-resolving
     * the user into the context instead would change authorization: the storage
     * adapter path enforces on `c.get("user")` when its own `verifyRequest`
     * finds nobody, so seeding that key would let a Rebase-signed JWT satisfy a
     * deployment that delegates auth to Firebase or Clerk. Nothing here writes
     * to the context; an identity that fails to verify simply buckets by IP,
     * exactly as before.
     */
    const identify = async (c: Parameters<MiddlewareHandler<HonoEnv>>[0]): Promise<string | undefined> => {
        const user = c.get("user") as { uid?: string } | undefined;
        if (user?.uid) return isAnonymousUid(user.uid) ? undefined : user.uid;

        // Only meaningful for Rebase-issued JWTs. A deployment authenticating
        // through an adapter never calls `configureJwt`, and verifying would
        // throw rather than return null.
        if (!isJwtConfigured()) return undefined;
        const token = extractBearerToken(c.req.header("authorization"));
        if (token === undefined) return undefined;
        const payload = await verifyAccessToken(token);
        if (!payload?.uid || isAnonymousUid(payload.uid)) return undefined;
        return payload.uid;
    };

    return createRateLimiter({
        windowMs,
        store,
        message: "Too many requests, please try again later.",
        keyGenerator: async (c) => {
            const key = c.get("apiKey") as { id: string } | undefined;
            if (key) return `api-key:${key.id}`;
            const uid = await identify(c);
            if (uid) return `user:${uid}`;
            return `ip:${defaultKeyGenerator(c, trustedProxyHops)}`;
        },
        resolveLimit: async (c) => {
            const key = c.get("apiKey") as { id: string; rate_limit?: number | null } | undefined;
            if (key) return key.rate_limit ?? apiKeyLimit;
            return (await identify(c)) ? userLimit : anonLimit;
        }
    });
}

