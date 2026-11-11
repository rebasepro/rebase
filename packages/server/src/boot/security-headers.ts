import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";
import { parseFrameAncestor } from "@rebasepro/types";

/**
 * How long a browser keeps to HTTPS for this host once told to: 180 days, the
 * value `secureHeaders()` has always sent here.
 */
const HSTS_MAX_AGE_SECONDS = 15_552_000;

/**
 * The `Strict-Transport-Security` value this runtime sends.
 *
 * Without `includeSubDomains` unless the operator asks for it. The default
 * `secureHeaders()` sends it, and on a self-hosted custom domain that tells
 * every browser to refuse plain HTTP on every sibling subdomain for six months —
 * a decision about hosts this process does not serve, and not one it can undo
 * once a browser has cached it.
 */
export function strictTransportSecurity(includeSubDomains: boolean): string {
    return `max-age=${HSTS_MAX_AGE_SECONDS}${includeSubDomains ? "; includeSubDomains" : ""}`;
}

/**
 * The Content-Security-Policy a static app is served with.
 *
 * Conservative on purpose: it says who may frame the app (this origin, plus
 * the origins the app's `frameAncestors` names), forbids plugins, and pins
 * `<base>` to this origin. It restricts no script, style, worker, font or
 * connection source, because an app's own build decides those — the CMS admin
 * runs inline scripts, module workers and third-party sign-in, and a policy
 * that broke any of them would be one every project had to turn off.
 *
 * Every origin is held to `parseFrameAncestor` before it is written, and a
 * value that is not exactly one origin throws: it is about to become part of
 * a header, where a `;` would start a directive of the caller's choosing.
 *
 * `X-Frame-Options: SAMEORIGIN` is still sent beside it. A browser that reads
 * `frame-ancestors` ignores `X-Frame-Options`, as CSP Level 2 requires, so
 * the origins named here can frame the app.
 */
export function staticAppCsp(frameAncestors: readonly string[] = []): string {
    const origins = new Set<string>();
    for (const value of frameAncestors) {
        const result = parseFrameAncestor(value);
        if (!result.ok) throw new Error(`frameAncestors: ${JSON.stringify(value)} ${result.reason}.`);
        origins.add(result.origin);
    }
    return `frame-ancestors ${["'self'", ...origins].join(" ")}; object-src 'none'; base-uri 'self'`;
}

/** {@link staticAppCsp} for an app that names no other origin: `frame-ancestors 'self'`. */
export const STATIC_APP_CSP = staticAppCsp();

/**
 * The `Referrer-Policy` this runtime sends: `strict-origin-when-cross-origin`,
 * the browsers' own default. A cross-origin request carries the page's origin
 * and never its path or query.
 *
 * Not `no-referrer`, the `secureHeaders()` default it used to send: an origin
 * check then sees no origin at all. Google's "Sign in with Google" button is the
 * one that bit — it compares the page's origin with the OAuth client's
 * authorized JavaScript origins, and under `no-referrer` it refused every
 * Rebase-hosted app with "The given origin is not allowed for the given client
 * ID", whatever the client allowed.
 */
export const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";

/**
 * The headers a route may set for itself, and what every other response gets.
 *
 * `secureHeaders()` overwrites whatever the route set, and some routes set a
 * stricter value on purpose — the MCP consent page sends `no-referrer`, so the
 * `client_id` and `state` in its URL go nowhere, and `X-Frame-Options: DENY`,
 * because a consent screen that can be framed is one an attacker can have
 * clicked. So these two are sent here instead, and only when the route did not.
 */
const OVERRIDABLE_DEFAULTS: ReadonlyArray<readonly [name: string, value: string]> = [
    ["Referrer-Policy", DEFAULT_REFERRER_POLICY],
    ["X-Frame-Options", "SAMEORIGIN"]
];

/**
 * Sends `Referrer-Policy: strict-origin-when-cross-origin` and
 * `X-Frame-Options: SAMEORIGIN` on every response that does not set its own.
 *
 * Use it beside `secureHeaders({ referrerPolicy: false, xFrameOptions: false })`;
 * left on, those two options overwrite the route's value. A static app that
 * wants a stricter referrer policy says so with `<meta name="referrer">`.
 */
export function overridableSecurityHeaders(): MiddlewareHandler {
    return async (c, next) => {
        await next();
        for (const [name, value] of OVERRIDABLE_DEFAULTS) {
            if (!c.res.headers.has(name)) c.header(name, value);
        }
    };
}

/** The security headers both boot paths — backend and static-only — install. */
export function runtimeSecureHeaders(options: { hstsIncludeSubDomains: boolean }): MiddlewareHandler {
    const headers = secureHeaders({
        // An API serves assets and tokens to origins other than its own, so the
        // browser defaults are wrong here in two specific ways:
        //
        // - `crossOriginResourcePolicy` defaults to `same-origin`, which blocks a
        //   frontend on another origin from loading anything this server serves.
        // - `crossOriginOpenerPolicy` defaults to `same-origin`, which severs
        //   `window.opener` and breaks the OAuth popup sign-in that
        //   `resolveAuthOptions` configures whenever GOOGLE_CLIENT_ID is set.
        //
        // Cross-origin access is still governed by CORS; these only stop the
        // browser from refusing before CORS is consulted. The static-only path
        // needs the same: its assets load from custom domains and the console.
        crossOriginResourcePolicy: "cross-origin",
        crossOriginOpenerPolicy: "same-origin-allow-popups",
        strictTransportSecurity: strictTransportSecurity(options.hstsIncludeSubDomains),
        // Sent by `overridableSecurityHeaders`, which leaves a route's own alone.
        referrerPolicy: false,
        xFrameOptions: false
    });
    const overridable = overridableSecurityHeaders();
    return (c, next) => headers(c, async () => { await overridable(c, next); });
}
