/**
 * Which object a storage request's URL path names.
 *
 * Three parties read the path of a `GET /file/*`, `GET /metadata/*` or
 * `DELETE /file/*`: the route, which serves or deletes an object;
 * `publicObjectAuth`, which lets an anonymous caller through when that object
 * is public; and `fileTokenAuth`, which compares it with the path a download
 * token grants. A decision is only about the object acted on if it is made on
 * the same key, so all three derive it here — the wildcard, the decoding, the
 * bucket segment and the canonical key — and none of them spells a step of its
 * own.
 *
 * They used to. `publicObjectAuth` judged the raw path with a check that strips
 * everything up to a `://`, while the route canonicalized it, folding `//` to
 * `/`: `GET /file/notes://public/secret.txt` was public to the one and served
 * the private key `notes:/public/secret.txt` from the other, with the authorize
 * hook never asked.
 *
 * Nothing here parses a scheme. A request path is a key, optionally behind the
 * one bucket segment the routes recognise; a `://` in it is a `:` followed by
 * an empty segment, and canonicalization folds the empty segment away.
 */

import { canonicalStorageKey, InvalidStorageKeyError } from "./keys";

/** The object a request path names. */
export interface RequestedStorageObject {
    /** The bucket. Always `"default"`: the only bucket a request path can name. */
    bucket: string;
    /** The canonical key — the one the hook is asked about and the controller acts on. */
    key: string;
}

/**
 * The wildcard part of a storage route's path, still percent-encoded.
 *
 * Hono's `c.req.param('*')` does not work reliably in sub-routers mounted
 * via `app.route(prefix, subRouter)`. Instead it is derived from the
 * fully-resolved `c.req.path` and `c.req.routePath`.
 *
 * For a route `/metadata/*` mounted at `/api/storage`, a request to
 * `/api/storage/metadata/default/file.jpg` yields routePath
 * `/api/storage/metadata/*`. The prefix (everything before `/*`) is stripped,
 * plus one character for the trailing `/`, to obtain `default/file.jpg`.
 */
export function storageRequestWildcard(c: { req: { path: string; routePath: string } }): string {
    const prefix = c.req.routePath.replace("/*", "");
    const fullPath = c.req.path;
    const idx = fullPath.indexOf(prefix);
    if (idx < 0) return "";
    // +1 to skip the '/' after the prefix
    return fullPath.substring(idx + prefix.length + 1);
}

/**
 * The object a decoded path names: a key, behind an optional `default/` bucket
 * segment (matched case-insensitively). Throws {@link InvalidStorageKeyError}
 * when the key cannot be canonicalized.
 *
 * For a path that is already text — the folder route's JSON body. A URL path
 * goes through {@link requestedStorageObject}, which decodes it first.
 */
export function storageObjectOfPath(decodedPath: string): RequestedStorageObject {
    const parts = decodedPath.split("/");
    const rawKey = parts.length > 1 && parts[0].toLowerCase() === "default"
        ? parts.slice(1).join("/")
        : decodedPath;
    return { bucket: "default", key: canonicalStorageKey(rawKey) };
}

/**
 * The object a request's wildcard path names, or {@link InvalidStorageKeyError}.
 *
 * The wildcard arrives as Hono leaves it — `decodeURI`d, with the reserved
 * characters (`/`, `:`, `%25` among them) still escaped — so one
 * `decodeURIComponent` yields the path the client encoded. A `%` that does not
 * begin an escape names no key, and is refused like any other key that cannot be
 * canonicalized rather than thrown as a `URIError`.
 */
export function requestedStorageObject(wildcard: string): RequestedStorageObject {
    let decoded: string;
    try {
        decoded = decodeURIComponent(wildcard);
    } catch {
        throw new InvalidStorageKeyError(
            "Storage path is not valid percent-encoding: a '%' must begin an escape such as '%25' (a literal '%')."
        );
    }
    return storageObjectOfPath(decoded);
}

/**
 * {@link requestedStorageObject}, or `null` when the path names no object.
 *
 * For the middleware, which must fail closed without an exception: a path that
 * names no object is neither public nor covered by any download token, and the
 * route answers it with a 400 of its own.
 */
export function tryRequestedStorageObject(wildcard: string): RequestedStorageObject | null {
    try {
        return requestedStorageObject(wildcard);
    } catch (err) {
        if (err instanceof InvalidStorageKeyError) return null;
        throw err;
    }
}
