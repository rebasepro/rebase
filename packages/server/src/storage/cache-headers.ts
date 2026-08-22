/**
 * Cache and revalidation headers for served objects.
 *
 * ## Why every byte still goes through the process
 *
 * `routes.ts` deliberately proxies rather than redirecting to a signed URL —
 * mixed content and unreachable VPC endpoints, both documented there. That
 * decision stands. What it cost was caching: a proxied response only caches as
 * well as its headers say, and the local path sent none at all, so every load
 * of every image re-read the file and re-sent the body.
 *
 * This module is the headers. It does not change where bytes come from; it
 * lets the client stop asking for them.
 *
 * ## Why `immutable` is wrong here, and was
 *
 * The remote path sent `public, max-age=3600, immutable`, and the transform
 * paths sent it with `max-age=31536000`. `immutable` is a promise that the body
 * at this URL will never change. A storage key can be overwritten — `putObject`
 * on an existing key is an ordinary operation — so the promise is false for
 * every object this server serves, and the symptom is an upload that replaces a
 * file which then does not visibly change for an hour, or a year.
 *
 * Revalidation replaces it. With a validator the client asks "still this one?"
 * and gets a 304 with no body, which costs a round trip instead of a transfer.
 *
 * ## Why `public` was a leak
 *
 * The same header said `public` for every object, including one that required
 * authentication to fetch. `public` is explicit permission for a *shared* cache
 * — a CDN, a corporate proxy — to store the response and serve it to somebody
 * else. Private objects are now `private`, which is the directive that says a
 * browser may keep it but a shared cache may not.
 */
import type { Context } from "hono";

/**
 * A weak validator built from size and modification time.
 *
 * Weak (`W/`) because it is not a digest of the body: two different bodies of
 * the same length written in the same millisecond would collide. That is the
 * same trade nginx makes for static files, and the alternative — hashing every
 * object on every request — costs more than it saves for content this server is
 * already streaming from somewhere else.
 */
export function buildEntityTag(size: number, lastModifiedMs: number): string {
    return `W/"${size.toString(16)}-${Math.floor(lastModifiedMs).toString(16)}"`;
}

export interface ObjectValidators {
    etag: string;
    /** RFC 9110 date, second-resolution. */
    lastModified: string;
    lastModifiedMs: number;
}

export function objectValidators(size: number, lastModifiedMs: number): ObjectValidators {
    // Floored to whole seconds: `Last-Modified` has second resolution, so a
    // sub-second mtime would make `If-Modified-Since` compare a truncated value
    // against an untruncated one and never match.
    const seconds = Math.floor(lastModifiedMs / 1000) * 1000;
    return {
        etag: buildEntityTag(size, lastModifiedMs),
        lastModified: new Date(seconds).toUTCString(),
        lastModifiedMs: seconds
    };
}

export interface CacheControlOptions {
    /**
     * Whether a *shared* cache may store this. True only for objects that need
     * no credentials to fetch.
     */
    isPublic: boolean;
    /**
     * How long a client may reuse the response without asking. Short by
     * default, because the object behind it is mutable.
     */
    maxAgeSeconds: number;
    /**
     * Public responses only: how long a stale copy may be served while a
     * revalidation happens in the background. Shared caches honour it; it turns
     * the revalidation round trip into something the user does not wait for.
     */
    staleWhileRevalidateSeconds?: number;
}

export function cacheControl(options: CacheControlOptions): string {
    const parts = [options.isPublic ? "public" : "private", `max-age=${options.maxAgeSeconds}`];
    if (options.isPublic && options.staleWhileRevalidateSeconds) {
        parts.push(`stale-while-revalidate=${options.staleWhileRevalidateSeconds}`);
    }
    // `must-revalidate` forbids serving stale on error, which is what makes a
    // deleted or replaced object stop being served once max-age lapses.
    parts.push("must-revalidate");
    return parts.join(", ");
}

/** Every `ETag` in an `If-None-Match` header, unquoted comparison-ready. */
function parseIfNoneMatch(header: string): string[] {
    return header.split(",").map(part => part.trim()).filter(Boolean);
}

/**
 * Weak comparison, which is the only comparison `If-None-Match` on a GET is
 * allowed to use (RFC 9110 §8.8.3.2). `W/"x"` and `"x"` are the same entity for
 * this purpose, so the prefix is stripped from both sides before comparing.
 */
function weakMatch(a: string, b: string): boolean {
    const strip = (v: string) => (v.startsWith("W/") ? v.slice(2) : v);
    return strip(a) === strip(b);
}

/**
 * Whether the request already holds this exact representation.
 *
 * `If-None-Match` wins outright when present: it is an exact validator, whereas
 * `If-Modified-Since` has second resolution and is only consulted in its
 * absence — again the order RFC 9110 requires.
 */
export function isNotModified(
    c: Context,
    validators: ObjectValidators
): boolean {
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch) {
        const tags = parseIfNoneMatch(ifNoneMatch);
        return tags.includes("*") || tags.some(tag => weakMatch(tag, validators.etag));
    }

    const ifModifiedSince = c.req.header("if-modified-since");
    if (ifModifiedSince) {
        const since = Date.parse(ifModifiedSince);
        if (!Number.isNaN(since)) {
            return validators.lastModifiedMs <= since;
        }
    }

    return false;
}

/**
 * Put the validators and the cache policy on a response.
 *
 * Applied to the 304 as well as the 200: a 304 that omits them tells the client
 * nothing about how long the answer holds, so the next load revalidates again
 * immediately and the round trip repeats forever.
 */
export function applyCacheHeaders(
    c: Context,
    validators: ObjectValidators,
    options: CacheControlOptions
): void {
    c.header("ETag", validators.etag);
    c.header("Last-Modified", validators.lastModified);
    c.header("Cache-Control", cacheControl(options));
    // Two callers with different credentials may get different answers for the
    // same URL, so a shared cache has to key on it or it will serve one user's
    // object to another.
    c.header("Vary", "Authorization");
}
