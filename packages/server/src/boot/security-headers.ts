import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";

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
 * The Content-Security-Policy every static app is served with.
 *
 * Conservative on purpose: it says who may frame the app (this origin only,
 * like the `X-Frame-Options: SAMEORIGIN` already sent), forbids plugins, and
 * pins `<base>` to this origin. It restricts no script, style, worker, font or
 * connection source, because an app's own build decides those — the CMS admin
 * runs inline scripts, module workers and third-party sign-in, and a policy
 * that broke any of them would be one every project had to turn off.
 */
export const STATIC_APP_CSP = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";

/** The security headers both boot paths — backend and static-only — install. */
export function runtimeSecureHeaders(options: { hstsIncludeSubDomains: boolean }): MiddlewareHandler {
    return secureHeaders({
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
        strictTransportSecurity: strictTransportSecurity(options.hstsIncludeSubDomains)
    });
}
