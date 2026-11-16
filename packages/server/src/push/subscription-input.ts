/**
 * What a browser sends when it subscribes, checked before anything is stored.
 *
 * The endpoint is the part that matters for security. The server posts to
 * whatever address a subscription names, every time it sends, so an endpoint
 * is a URL an attacker chooses and this server fetches — server-side request
 * forgery with a retry loop. Only the push services browsers actually use are
 * accepted: https, on their own hostnames, on the default port.
 */
import { createHash } from "node:crypto";
import { fromBase64Url } from "./web-push-crypto";

/**
 * The push services of Chrome and Android (FCM), Firefox (Mozilla autopush),
 * Safari on iOS, iPadOS and macOS (Apple), and Edge (Windows Push Notification
 * Services).
 */
export const PUSH_SERVICE_HOSTS: readonly RegExp[] = [
    /^fcm\.googleapis\.com$/,
    /^android\.googleapis\.com$/,
    /^updates\.push\.services\.mozilla\.com$/,
    /^web\.push\.apple\.com$/,
    /^[a-z0-9-]+\.push\.apple\.com$/,
    /^[a-z0-9-]+\.notify\.windows\.com$/
];

/** The longest endpoint taken. Real ones run to a few hundred characters. */
const MAX_ENDPOINT_LENGTH = 1024;

/**
 * The endpoint, normalised, when it is on a known push service or one of
 * `extraHosts` (exact hostnames; these may name a port, for a local test push
 * service). `null` otherwise.
 */
export function acceptEndpoint(value: unknown, extraHosts: readonly string[] = []): string | null {
    if (typeof value !== "string" || value.length > MAX_ENDPOINT_LENGTH) return null;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (extraHosts.includes(url.host) || extraHosts.includes(url.hostname)) return url.href;
    if (url.port !== "") return null;
    return PUSH_SERVICE_HOSTS.some(pattern => pattern.test(url.hostname)) ? url.href : null;
}

/** The browser's P-256 public key: base64url of an uncompressed point. */
export function acceptP256dh(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 120 || !/^[A-Za-z0-9_\-+/]+={0,2}$/.test(value)) return null;
    const bytes = fromBase64Url(value);
    return bytes.length === 65 && bytes[0] === 0x04 ? value : null;
}

/** The browser's auth secret: base64url of 16 bytes. */
export function acceptAuthSecret(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 40 || !/^[A-Za-z0-9_\-+/]+={0,2}$/.test(value)) return null;
    return fromBase64Url(value).length === 16 ? value : null;
}

/** A BCP 47-ish language tag (`en`, `es`, `pt-BR`), or `null`. */
export function acceptLang(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 35) return null;
    return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(value) ? value : null;
}

/**
 * A subscription's id: the first 24 characters of the endpoint's SHA-256, in
 * base64url. Endpoints are hundreds of characters, and the id is what an
 * application keys its own per-browser rows by.
 */
export function subscriptionIdOf(endpoint: string): string {
    return createHash("sha256").update(endpoint).digest("base64url").slice(0, 24);
}

/** A topic the push services take: up to 32 URL-safe base64 characters. */
export function isValidTopic(topic: string): boolean {
    return /^[A-Za-z0-9_-]{1,32}$/.test(topic);
}
