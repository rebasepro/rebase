import type { Context } from "hono";
import { AUTH_FLOW_HEADER, type AuthResponsePayload } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import type { CookieAuthConfig } from "./routes";
import { jwtOf, MAX_COOKIE_AGE_MS } from "./jwt";

/**
 * Cookie auth helpers for httpOnly refresh tokens.
 */
export function getCookieSettings(config: CookieAuthConfig | undefined) {
    const COOKIE_NAME = config?.cookieName || "__rb_refresh";
    const COOKIE_PATH = config?.path || "/";
    const COOKIE_SAMESITE = config?.sameSite || "Lax";
    const COOKIE_DOMAIN = config?.domain;
    const COOKIE_SECURE = config?.secure;

    return {
        name: COOKIE_NAME,
        path: COOKIE_PATH,
        sameSite: COOKIE_SAMESITE,
        domain: COOKIE_DOMAIN,
        secure: COOKIE_SECURE
    };
}

/**
 * Whether the request asks for the refresh token in the body
 * (`x-rebase-auth-flow: json`): a client with no cookie jar, or one keeping a
 * sign-in apart from the page's cookie session.
 */
export function requestsJsonFlow(c: Context<HonoEnv>): boolean {
    return c.req.header(AUTH_FLOW_HEADER)?.trim().toLowerCase() === "json";
}

/**
 * The cookie settings that apply to this request: the server's, or none when
 * the request asks for the json flow.
 *
 * A json-flow request is answered exactly as a server without `cookieAuth`
 * answers it. The refresh token is read from the request body and returned in
 * the response body; the cookie is never read, set or cleared. That is what
 * keeps the exemption safe:
 *
 * - The cookie is the only credential a browser attaches by itself, and a
 *   json-flow request never reads it. Nothing it does can be forged across
 *   sites, and a cookie the page's script cannot read is never rotated into a
 *   token handed back in a body it can. The cookie path is unchanged.
 * - Every other credential a token-issuing route takes is in the request
 *   itself — a password, a code, the token in the body, a bearer access
 *   token — so whoever sends it already holds what the body token gives. A
 *   bearer access token already reaches a durable sign-in on its own: it can
 *   link a provider identity its holder controls.
 * - The header is not a CORS-safelisted one, so a cross-site page cannot
 *   send it without a preflight the server's CORS policy answers.
 */
function cookieConfigFor(c: Context<HonoEnv>, config: CookieAuthConfig | undefined): CookieAuthConfig | undefined {
    return config && !requestsJsonFlow(c) ? config : undefined;
}

/**
 * Set the refresh token as an httpOnly cookie on the response.
 */
export function setRefreshCookie(c: Context<HonoEnv>, refreshToken: string, cookieAuth: CookieAuthConfig | undefined): void {
    const config = cookieConfigFor(c, cookieAuth);
    if (!config) return;

    const settings = getCookieSettings(config);
    // Secure unless the deployment explicitly says otherwise.
    //
    // This used to be inferred from `c.req.url`, which `@hono/node-server`
    // derives from `socket.encrypted` — so behind any TLS-terminating proxy,
    // which is the normal production topology, the server saw `http` and
    // omitted the flag. The refresh token is a credential with a lifetime
    // measured in months, and it was travelling in cleartext on every request
    // to a plain-http URL on the same host.
    //
    // Inverted rather than patched: no request header can downgrade this, since
    // `X-Forwarded-Proto` is written by whoever is talking to us. Only
    // `cookieAuth.secure: false` turns it off, which is a deployment saying so
    // deliberately. Local development does not need that escape hatch —
    // browsers treat `http://localhost` as a trustworthy origin and accept
    // Secure cookies there.
    const isSecure = settings.secure ?? true;

    let cookie = `${settings.name}=${encodeURIComponent(refreshToken)}; Path=${settings.path}; HttpOnly; SameSite=${settings.sameSite}`;
    if (isSecure) cookie += "; Secure";
    if (settings.domain) cookie += `; Domain=${settings.domain}`;
    // Match the server's refresh token expiry rather than assuming it. This
    // was hardcoded to 30 days, which quietly capped every deployment's
    // sessions at 30 days no matter what JWT_REFRESH_EXPIRES_IN said: the row
    // in the database stayed valid for as long as it was configured to, and
    // the browser threw away the cookie that pointed at it. Re-set on every
    // rotation, so an active session's cookie slides forward with it.
    const maxAgeSeconds = Math.floor(Math.min(jwtOf(c).getRefreshTokenTtlMs(), MAX_COOKIE_AGE_MS) / 1000);
    cookie += `; Max-Age=${maxAgeSeconds}`;
    c.header("Set-Cookie", cookie, { append: true });
}

/**
 * Clear the refresh token cookie.
 */
export function clearRefreshCookie(c: Context<HonoEnv>, cookieAuth: CookieAuthConfig | undefined): void {
    const config = cookieConfigFor(c, cookieAuth);
    if (!config) return;

    const settings = getCookieSettings(config);
    let cookie = `${settings.name}=; Path=${settings.path}; HttpOnly; SameSite=${settings.sameSite}; Max-Age=0`;
    // Mirror the attributes the cookie was set with, so the clear matches it.
    if (settings.secure ?? true) cookie += "; Secure";
    if (settings.domain) cookie += `; Domain=${settings.domain}`;
    c.header("Set-Cookie", cookie, { append: true });
}

/**
 * Read the refresh token from the request — cookie first, then body fallback.
 * A json-flow request is read from the body alone (see `cookieConfigFor`).
 *
 * An empty string is no token, wherever it comes from. In cookie mode every
 * response this server sends carries `refreshToken: ""` (see
 * `redactRefreshToken`), and a client that echoes it back — `@rebasepro/client`
 * did, on every refresh from a live tab — is presenting nothing. Taking the
 * body's `""` as the token, or refusing it at the schema, kept the cookie
 * beside it from ever being read.
 */
export function readRefreshToken(c: Context<HonoEnv>, body: { refreshToken?: string }, cookieAuth: CookieAuthConfig | undefined): string | undefined {
    const config = cookieConfigFor(c, cookieAuth);
    if (config) {
        const settings = getCookieSettings(config);
        const cookieHeader = c.req.header("cookie") || "";
        const prefix = `${settings.name}=`;
        const cookies = cookieHeader.split(";");
        for (const part of cookies) {
            const trimmed = part.trim();
            if (trimmed.startsWith(prefix)) {
                const fromCookie = decodeCookieValue(trimmed.slice(prefix.length));
                if (fromCookie) return fromCookie;
            }
        }
    }
    return body.refreshToken || undefined;
}

/**
 * A cookie value as this server wrote it, or `undefined` when it is not valid
 * percent-encoding.
 *
 * `setRefreshCookie` encodes, so such a value is never one of ours: it is a
 * cookie of the same name set by somebody else — a sibling subdomain can set
 * one on the parent domain. It is no token, and the next cookie of the name
 * may be. A throw here would answer 500 on `/refresh` and on `/logout`, and
 * `/logout` would never reach the line that clears the cookie.
 */
function decodeCookieValue(value: string): string | undefined {
    try {
        return decodeURIComponent(value);
    } catch {
        return undefined;
    }
}

/**
 * Redact the refresh token from the response body when cookie mode is active
 * for this request (not for a json-flow one: see `cookieConfigFor`).
 */
export function redactRefreshToken(
    response: AuthResponsePayload,
    c: Context<HonoEnv>,
    refreshToken: string,
    cookieAuth: CookieAuthConfig | undefined
): AuthResponsePayload {
    const config = cookieConfigFor(c, cookieAuth);
    if (!config) return response;

    setRefreshCookie(c, refreshToken, config);
    return {
        ...response,
        tokens: {
            ...response.tokens,
            refreshToken: "" // Omit from JSON body — the cookie carries it
        }
    };
}
