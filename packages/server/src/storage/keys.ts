/**
 * Canonical storage keys and bucket names.
 *
 * Storage is not under RLS, so a `storageAuthorize` hook is the whole access
 * control model — and a hook can only be correct if the key it is shown is the
 * key that is written. That is the invariant this module exists to hold: one
 * canonical string, computed once per request, handed to the hook, to the
 * controller, and to the download token alike.
 *
 * ## Why rejecting beats stripping
 *
 * The previous `sanitizeStorageKey` *stripped* `../` in a single pass. Two
 * things were wrong with that, and only one of them was the obvious one.
 *
 * The obvious one: a single pass is not a fixed point. `....//` contains `../`
 * at offset 2, so removing it leaves `../` behind — the sanitizer manufactured
 * the traversal it was there to remove. `users/alice/....//bob/x` came out as
 * `users/alice/../bob/x`, which a prefix hook reads as alice's (it starts with
 * `users/alice/`) and the filesystem reads as bob's. The hook approved one
 * object and the controller wrote another.
 *
 * The subtler one, and the reason this is a rewrite rather than a loop: even a
 * correct strip is a silent rewrite. A caller who asks to store at `a/../b` and
 * gets an object at `a/b` was not protected, they were misled — and every later
 * read, ownership row and audit line now refers to a path nobody chose. So a key
 * that means something other than what it says is refused (400), not repaired.
 *
 * Note what is NOT traversal under this rule: `....` is an ordinary directory
 * name, and `users/alice/....//bob/x` canonicalizes to
 * `users/alice/..../bob/x` — still comfortably inside alice's prefix, which is
 * exactly right. Only a real `..` segment is refused.
 */

import path from "node:path";

/** Longest key accepted, in UTF-16 code units. Matches the previous cap. */
export const MAX_STORAGE_KEY_LENGTH = 1024;

/**
 * A key that cannot be canonicalized. Carries no path back to the caller
 * beyond what they sent, so it is safe to surface as a 400 message.
 */
export class InvalidStorageKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidStorageKeyError";
    }
}

/**
 * Canonicalize a caller-supplied storage key, or throw
 * {@link InvalidStorageKeyError}.
 *
 * Normalizations applied (safe, idempotent, and meaning-preserving):
 * - leading slashes removed — `/a/b` and `a/b` name the same object
 * - `.` segments and repeated slashes collapsed
 *
 * Refusals (the key means something other than what it says):
 * - any `..` segment, on either separator, at any depth
 * - null bytes
 * - keys longer than {@link MAX_STORAGE_KEY_LENGTH}
 *
 * A trailing slash is preserved: it is how the folder route marks a prefix.
 */
export function canonicalStorageKey(rawKey: string): string {
    if (rawKey.includes("\0")) {
        throw new InvalidStorageKeyError("Storage key contains a null byte.");
    }
    if (rawKey.length > MAX_STORAGE_KEY_LENGTH) {
        throw new InvalidStorageKeyError(
            `Storage key exceeds the maximum length of ${MAX_STORAGE_KEY_LENGTH} characters.`
        );
    }

    // Split on both separators: `path.join` treats `\` as a separator on
    // Windows, so `..\` is traversal there even though POSIX reads it as a
    // filename. Checked against the RAW key, before any normalization — the
    // whole point is that `a/../b` is refused rather than quietly turned into
    // `b`.
    if (rawKey.split(/[\\/]/).some((segment) => segment === "..")) {
        throw new InvalidStorageKeyError(
            "Storage key contains a '..' path segment. Keys must name an object directly."
        );
    }

    const withoutLeadingSlashes = rawKey.replace(/^\/+/, "");
    if (withoutLeadingSlashes === "") return "";

    // Safe now: with no `..` segment in the input, `normalize` can only collapse
    // `.` and duplicate slashes — it cannot climb.
    const normalized = path.posix.normalize(withoutLeadingSlashes);

    // `normalize(".")`, and `normalize("./")` → `./`; neither names an object.
    if (normalized === "." || normalized === "./") return "";

    // `normalize` re-introduces a leading `./` for keys like `.//a`.
    return normalized.replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Canonicalize, or return `null` when the key is not canonicalizable.
 *
 * For callers that must fail closed without an exception — the download-token
 * middleware compares a request path against a granted path, and a key it
 * cannot canonicalize simply matches nothing.
 */
export function tryCanonicalStorageKey(rawKey: string): string | null {
    try {
        return canonicalStorageKey(rawKey);
    } catch {
        return null;
    }
}

/**
 * Longest bucket name accepted. 63 is the S3/GCS limit, and a local bucket is
 * one directory name, so the tighter of the two bounds everything.
 */
export const MAX_STORAGE_BUCKET_LENGTH = 63;

/** A bucket name that does not name a bucket. See {@link canonicalStorageBucket}. */
export class InvalidStorageBucketError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidStorageBucketError";
    }
}

/**
 * One path segment: letters, digits, `.`, `_`, `-`, first character
 * alphanumeric. Deliberately narrow — it is the intersection of what S3, GCS
 * and a filesystem directory all accept, and it makes `..`, `.tus-uploads`,
 * absolute paths and anything containing a separator unrepresentable.
 */
const STORAGE_BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Canonicalize a caller-supplied bucket name, or throw
 * {@link InvalidStorageBucketError}.
 *
 * The bucket is the *other* caller-controlled routing value in an upload
 * request, and it was the one nobody validated. `LocalStorageController`
 * builds `join(basePath, bucket)` and then checks containment against that
 * result, so a bucket of `../../etc` moved the boundary rather than crossing
 * it — the guard passed because the guard's reference point was the attacker's.
 * The containment check now resolves against the storage root, and this is the
 * check at the route boundary that stops the value before it gets there.
 *
 * A bucket is configuration, not user data: there is no legitimate caller that
 * needs a separator, a leading dot, or a `..` in one. So this refuses rather
 * than repairs, exactly as {@link canonicalStorageKey} does — a rewritten
 * bucket would silently store the object somewhere the caller did not ask for.
 *
 * Returns `undefined` when the caller named no bucket (absent, or an empty
 * form field), which is how every controller spells "use my default". An empty
 * string used to reach `getFullPath` and resolve to the storage *root* rather
 * than the `default` bucket, which is a third place a bare key did not
 * round-trip.
 */
export function canonicalStorageBucket(rawBucket: string | undefined | null): string | undefined {
    if (rawBucket === undefined || rawBucket === null || rawBucket === "") return undefined;
    if (rawBucket.length > MAX_STORAGE_BUCKET_LENGTH) {
        throw new InvalidStorageBucketError(
            `Storage bucket exceeds the maximum length of ${MAX_STORAGE_BUCKET_LENGTH} characters.`
        );
    }
    if (!STORAGE_BUCKET_PATTERN.test(rawBucket)) {
        throw new InvalidStorageBucketError(
            "Storage bucket must be a single name of letters, digits, '.', '_' or '-', " +
            "starting with a letter or digit."
        );
    }
    return rawBucket;
}
