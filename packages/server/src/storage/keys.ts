/**
 * Canonical storage keys.
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

    // Whether the key names a *directory* rather than an object: it ends with a
    // separator, or its last segment is the `.` that means "this directory".
    //
    // Recorded before normalizing, because `path.posix.normalize` drops the
    // distinction in one of those two spellings and not the other: `public/.`
    // becomes `public` while `public/./` stays `public/`. That asymmetry breaks
    // the rule this module states — a trailing slash is preserved, because it is
    // how the folder route marks a prefix — and it is not cosmetic on `list`,
    // where a prefix of `public` also matches `publicity/` and hands back keys
    // the caller never asked for.
    const denotesDirectory = /(?:^|\/)\.?$/.test(withoutLeadingSlashes);

    // Safe now: with no `..` segment in the input, `normalize` can only collapse
    // `.` and duplicate slashes — it cannot climb.
    const normalized = path.posix.normalize(withoutLeadingSlashes);

    // `normalize(".")`, and `normalize("./")` → `./`; neither names an object.
    if (normalized === "." || normalized === "./") return "";

    // `normalize` re-introduces a leading `./` for keys like `.//a`.
    const key = normalized.replace(/^\.\//, "").replace(/^\/+/, "");
    if (key === "") return "";
    return denotesDirectory && !key.endsWith("/") ? `${key}/` : key;
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
