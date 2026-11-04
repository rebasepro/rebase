/**
 * How a data path (`products/café/variants/a#b`) and the URL path that names
 * it (`products/caf%C3%A9/variants/a%23b`) map onto each other.
 *
 * A record id is whatever string the database holds, so it is written into a
 * URL one percent-encoded segment at a time: raw, a `#` or `?` ends the path
 * and the rest reads as the hash or the query, and the browser hands the
 * router a pathname it has percent-encoded itself. Each segment is encoded
 * once where a URL is built and decoded once where a URL is read.
 */

/** One data-path segment (a slug part, a record id, a tab key) as a URL path segment. */
export function encodeUrlPathSegment(segment: string): string {
    return encodeURIComponent(segment);
}

/**
 * One URL path segment as the data-path segment it names.
 *
 * A segment whose escapes are malformed (a bare `%` typed into the address
 * bar) is not an encoded one, so it is kept as it is. An encoded slash stays
 * encoded: a data path is split on `/`, and decoding it would turn the record
 * `a/b` into the record `a` followed by a tab `b`.
 */
export function decodeUrlPathSegment(segment: string): string {
    try {
        return decodeURIComponent(segment).replace(/\//g, "%2F");
    } catch {
        return segment;
    }
}

/** A data path as a URL path: every segment encoded, the separators kept. */
export function encodeUrlPath(path: string): string {
    return path.split("/").map(encodeUrlPathSegment).join("/");
}

/** A URL path as a data path: every segment decoded, the separators kept. */
export function decodeUrlPath(path: string): string {
    return path.split("/").map(decodeUrlPathSegment).join("/");
}

/**
 * What a pathname holds after the record at `recordUrl`, the record's tab or
 * `edit`, as data-path segments joined by `/`. Matched segment by segment on
 * decoded text, so the record is found however the pathname spells its id.
 * Empty when nothing follows the record, `undefined` when the pathname is not
 * at or below it.
 */
export function getPathAfterRecord(pathname: string, recordUrl: string): string | undefined {
    const pathSegments = pathname.split("/");
    const recordSegments = recordUrl.split("/");
    if (pathSegments.length < recordSegments.length)
        return undefined;
    for (let i = 0; i < recordSegments.length; i++) {
        if (decodeUrlPathSegment(pathSegments[i]) !== decodeUrlPathSegment(recordSegments[i]))
            return undefined;
    }
    return pathSegments.slice(recordSegments.length)
        .filter((segment) => segment.length > 0)
        .map(decodeUrlPathSegment)
        .join("/");
}
