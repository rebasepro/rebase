import type { Context } from "hono";
import type { AuthResponsePayload } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import type { CookieAuthConfig } from "./routes";
import { getRefreshTokenTtlMs, MAX_COOKIE_AGE_MS } from "./jwt";

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
 * Set the refresh token as an httpOnly cookie on the response.
 */
export function setRefreshCookie(c: Context<HonoEnv>, refreshToken: string, config: CookieAuthConfig | undefined): void {
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
    const maxAgeSeconds = Math.floor(Math.min(getRefreshTokenTtlMs(), MAX_COOKIE_AGE_MS) / 1000);
    cookie += `; Max-Age=${maxAgeSeconds}`;
    c.header("Set-Cookie", cookie, { append: true });
}

/**
 * Clear the refresh token cookie.
 */
export function clearRefreshCookie(c: Context<HonoEnv>, config: CookieAuthConfig | undefined): void {
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
 */
export function readRefreshToken(c: Context<HonoEnv>, body: { refreshToken?: string }, config: CookieAuthConfig | undefined): string | undefined {
    if (config) {
        const settings = getCookieSettings(config);
        const cookieHeader = c.req.header("cookie") || "";
        const prefix = `${settings.name}=`;
        const cookies = cookieHeader.split(";");
        for (const part of cookies) {
            const trimmed = part.trim();
            if (trimmed.startsWith(prefix)) {
                return decodeURIComponent(trimmed.slice(prefix.length));
            }
        }
    }
    return body.refreshToken;
}

/**
 * Redact the refresh token from the response body when cookie mode is active.
 */
export function redactRefreshToken(
    response: AuthResponsePayload,
    c: Context<HonoEnv>,
    refreshToken: string,
    config: CookieAuthConfig | undefined
): AuthResponsePayload {
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
