/**
 * The checks a caller-supplied key and bucket go through before any storage
 * door acts on them, as HTTP answers.
 *
 * Shared by the REST routes and the resumable (TUS) handler, which parses its
 * own `Upload-Metadata` and so cannot lean on the routes. Each door spelling
 * these on its own is how one of them came to canonicalize a key without
 * refusing the reserved rendition prefix — which made TUS the way to write the
 * bytes a later transform serves. One module both doors import keeps every
 * write path's idea of an acceptable key the same.
 */

import { ApiError } from "../api/errors";
import { canonicalStorageKey, InvalidStorageKeyError, canonicalStorageBucket, InvalidStorageBucketError } from "./keys";
import { isRenditionKey, RENDITION_PREFIX } from "./rendition-cache";

/**
 * Canonicalize a caller-supplied storage key, answering 400 when it names
 * something other than what it says.
 *
 * The single place a request's key becomes canonical. Every door runs its key
 * through this before anything else touches it, so the authorize hook, the
 * storage controller and the minted download token are all looking at the same
 * string — which is the only thing that makes the hook's answer meaningful.
 * See `keys.ts` for why an unacceptable key is refused rather than repaired.
 */
export function canonicalKeyOrBadRequest(key: string): string {
    try {
        const canonical = canonicalStorageKey(key);
        // The rendition space is not addressable by callers, in either
        // direction. Reading one would serve a derivative of a source object
        // without the source's key ever reaching `storageAuthorize` or the
        // declarative policies — both of which reason about that key — and
        // writing one would let a caller choose what a later transform serves.
        if (isRenditionKey(canonical)) {
            throw new InvalidStorageKeyError(
                `"${RENDITION_PREFIX}" is reserved for derived image renditions and cannot be ` +
                "read or written directly."
            );
        }
        return canonical;
    } catch (err) {
        throw new ApiError(
            400,
            "INVALID_STORAGE_KEY",
            err instanceof InvalidStorageKeyError ? err.message : "Invalid storage key"
        );
    }
}

/**
 * Canonicalize a caller-supplied bucket name, answering 400 when it is not one.
 *
 * The bucket's counterpart to {@link canonicalKeyOrBadRequest}, and it exists
 * for the same reason: the value routes a write, so it has to be checked where
 * it enters rather than where it is used. Applied at every entry point a bucket
 * has — the upload route's multipart body, the folder route's JSON body, the
 * `?bucket=` query, and the TUS `Upload-Metadata` header.
 */
export function canonicalBucketOrBadRequest(bucket: string | undefined | null): string | undefined {
    try {
        return canonicalStorageBucket(bucket);
    } catch (err) {
        throw new ApiError(
            400,
            "INVALID_STORAGE_BUCKET",
            err instanceof InvalidStorageBucketError ? err.message : "Invalid storage bucket"
        );
    }
}
