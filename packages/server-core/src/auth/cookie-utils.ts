import type { Context } from "hono";
import type { AuthResponsePayload } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import type { CookieAuthConfig } from "./routes";

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
    const isSecure = settings.secure ??
        (settings.sameSite === "None" ? true : c.req.url.startsWith("https"));

    let cookie = `${settings.name}=${encodeURIComponent(refreshToken)}; Path=${settings.path}; HttpOnly; SameSite=${settings.sameSite}`;
    if (isSecure) cookie += "; Secure";
    if (settings.domain) cookie += `; Domain=${settings.domain}`;
    // Match the server's refresh token expiry (30 days default)
    cookie += `; Max-Age=${30 * 24 * 60 * 60}`;
    c.header("Set-Cookie", cookie, { append: true });
}

/**
 * Clear the refresh token cookie.
 */
export function clearRefreshCookie(c: Context<HonoEnv>, config: CookieAuthConfig | undefined): void {
    if (!config) return;

    const settings = getCookieSettings(config);
    let cookie = `${settings.name}=; Path=${settings.path}; HttpOnly; SameSite=${settings.sameSite}; Max-Age=0`;
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
