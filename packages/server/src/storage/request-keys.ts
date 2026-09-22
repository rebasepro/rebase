/**
 * The checks a caller-supplied key and bucket go through before any storage
 * door acts on them, as HTTP answers.
 *
 * Shared by the REST routes and the resumable (TUS) handler, which parses its
 * own `Upload-Metadata` and so cannot lean on the routes. Each door spelling
 * these on its own is how one of them came to canonicalize a key without
 * refusing the reserved rendition prefix — which made TUS the way to write the
 * bytes a later transform serves. One module both doors import keeps every
 * write path's idea of an acceptable key and bucket the same.
 */

import { ApiError } from "../api/errors";
import { canonicalStorageKey, InvalidStorageKeyError, canonicalStorageBucket, InvalidStorageBucketError } from "./keys";
import { isRenditionKey, RENDITION_PREFIX } from "./rendition-cache";
import type { StorageController } from "./types";

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

/**
 * A bucket this deployment does not serve is a 404, not a missing file.
 *
 * `getSignedUrl("x.txt", "no-such-bucket")` answered `{ url: null,
 * fileNotFound: true }` — byte for byte what a real key that does not exist
 * answers — so there was no way to learn the second argument was wrong.
 * Worse on S3, where an unrecognised bucket name went straight to the
 * provider: the request parameter was a way to address any bucket the
 * deployment's credentials can reach.
 *
 * `UNKNOWN_STORAGE_SOURCE` rather than a code of its own: to a caller,
 * "media" being a bucket and "media" being a storage source are the same
 * mistake with the same fix — look at `GET /api/storage/sources` — and one
 * code they can branch on beats two they have to learn apart.
 *
 * @param sources the storage sources this deployment serves, named in the
 * message because a second store is a second source, not a second bucket.
 */
function refuseUnknownBucket(bucket: string, controller: StorageController, sources: string[]): never {
    const served = controller.knownBuckets?.() ?? [];
    throw new ApiError(
        404,
        "UNKNOWN_STORAGE_SOURCE",
        `Unknown storage bucket "${bucket}". This deployment serves ` +
        `${served.map(b => `"${b}"`).join(", ")} on this source. ` +
        `Storage sources: ${sources.map(k => `"${k}"`).join(", ")} — a second store is a ` +
        "second source (`?storageId=`), not a second bucket.",
        { bucket, knownBuckets: served, storageSources: sources },
        true
    );
}

/**
 * The bucket a read or a listing may use, or a refusal naming what is served.
 *
 * Only checked against a controller that says what it serves
 * ({@link StorageController.knownBuckets}); a custom implementation that does
 * not is handed whatever the caller wrote.
 */
export function servedBucketOrRefuse(
    bucket: string | undefined,
    controller: StorageController,
    sources: string[]
): string | undefined {
    if (bucket === undefined) return undefined;
    const served = controller.knownBuckets?.();
    if (!served || served.includes(bucket)) return bucket;
    return refuseUnknownBucket(bucket, controller, sources);
}

/**
 * The bucket a write may use, or a refusal naming what is served.
 *
 * On local storage a write may bring a bucket into existence:
 * `putObject({ bucket: "media" })` creates `<root>/media`, which is deliberate,
 * so only the *shape* of the name is checked there (by
 * {@link canonicalBucketOrBadRequest}, inside the storage root). That reasoning
 * is local's alone. An object store's bucket is not created by a write — the
 * name goes to the provider as given — so on every other controller a write is
 * held to the same list a read is, or `bucket=prod-db-backups` on an upload
 * writes into any bucket the deployment's credentials reach.
 */
export function writableBucketOrRefuse(
    bucket: string | undefined,
    controller: StorageController,
    sources: string[]
): string | undefined {
    if (bucket === undefined || controller.getType() === "local") return bucket;
    return servedBucketOrRefuse(bucket, controller, sources);
}
