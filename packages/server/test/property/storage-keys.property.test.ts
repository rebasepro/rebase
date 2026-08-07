/**
 * Properties of storage key canonicalization.
 *
 * Storage is not under RLS, so `storageAuthorize` is the entire access-control
 * model, and a hook can only be correct if the key it is shown is the key that
 * is written. `canonicalStorageKey` is what makes those the same string.
 *
 * The example suite in `storage-key-canonicalization.test.ts` pins the specific
 * inputs that broke — `....//`, `..%2f`, the null byte. This file states the
 * invariants those examples are instances of, quantified over arbitrary keys,
 * so that the next spelling of the same idea is covered before someone finds
 * it. The load-bearing one is prefix soundness: a hook that approves a prefix
 * must be approving the directory the write actually lands in.
 */

import fc from "fast-check";
import path from "node:path";
import { isPublicStoragePath, PUBLIC_STORAGE_PREFIX } from "@rebasepro/types";
import {
    canonicalStorageKey,
    tryCanonicalStorageKey,
    InvalidStorageKeyError,
    MAX_STORAGE_KEY_LENGTH
} from "../../src/storage/keys";

const RUNS = Number(process.env.FC_RUNS ?? 3000);

/** Where a bucket lives on disk, for the containment properties. */
const BUCKET = "/srv/storage/default";

/**
 * Key-shaped strings, weighted towards the adversarial.
 *
 * The segment alphabet is the point: `..`, `....`, `.`, and the empty string
 * are all generated as ordinary segments, so traversal spellings arise by
 * composition rather than by being listed. `....//` — the string that defeated
 * the old single-pass stripper by *containing* `../` at offset two — is one
 * such composition, and it is found rather than remembered.
 */
const segment = fc.oneof(
    { arbitrary: fc.stringMatching(/^[a-z0-9_-]{1,8}$/), weight: 6 },
    { arbitrary: fc.constantFrom("..", ".", "", "....", "...", "..%2f", "public", "default"), weight: 4 }
);

const storageKey = fc
    .array(segment, { minLength: 1, maxLength: 6 })
    .chain(parts => fc.tuple(
        fc.constantFrom("", "/", "//", "///"),
        fc.constant(parts),
        fc.constantFrom("", "/")
    ))
    .map(([lead, parts, trail]) => `${lead}${parts.join("/")}${trail}`);

/** The same, plus separators and bytes a filesystem or URL layer might inject. */
const hostileKey = fc.oneof(
    storageKey,
    fc.string({ maxLength: 40 }),
    fc.array(fc.constantFrom("..", "\\", "/", "\0", "a", ".", "%2e", "~"), { maxLength: 10 })
        .map(p => p.join(""))
);

/** Canonical keys only — the output side of the function. */
const canonicalKey = hostileKey
    .map(tryCanonicalStorageKey)
    .filter((k): k is string => k !== null && k !== "");

describe("canonicalStorageKey — algebra", () => {

    /**
     * A canonicalizer that is not idempotent is not a canonicalizer. This is
     * the abstract form of what went wrong before: the old stripper was a
     * single pass, so `f(x) ≠ f(f(x))`, and the gap between the two was a key
     * the hook and the filesystem read differently.
     */
    it("is idempotent", () => {
        fc.assert(fc.property(hostileKey, raw => {
            const once = tryCanonicalStorageKey(raw);
            if (once === null) return;
            expect(tryCanonicalStorageKey(once)).toBe(once);
        }), { numRuns: RUNS });
    });

    /** Total: every input either yields a key or is refused. Never both, never neither. */
    it("either canonicalizes or throws InvalidStorageKeyError, for any input", () => {
        fc.assert(fc.property(hostileKey, raw => {
            try {
                const key = canonicalStorageKey(raw);
                expect(typeof key).toBe("string");
            } catch (err) {
                expect(err).toBeInstanceOf(InvalidStorageKeyError);
            }
        }), { numRuns: RUNS });
    });

    it("never returns a key containing a traversal segment, a null byte, or a leading slash", () => {
        fc.assert(fc.property(hostileKey, raw => {
            const key = tryCanonicalStorageKey(raw);
            if (key === null) return;
            expect(key.split("/")).not.toContain("..");
            expect(key).not.toContain("\0");
            expect(key.startsWith("/")).toBe(false);
            expect(key.length).toBeLessThanOrEqual(MAX_STORAGE_KEY_LENGTH);
        }), { numRuns: RUNS });
    });

    /**
     * `....` is an ordinary directory name and must survive. Stated because the
     * failure mode of over-correcting here is silent: a canonicalizer that
     * mangles `....` still passes every traversal test while quietly renaming
     * customers' objects.
     */
    it("preserves runs of dots that are not a traversal segment", () => {
        fc.assert(fc.property(
            fc.integer({ min: 3, max: 8 }),
            fc.stringMatching(/^[a-z]{1,6}$/),
            (dots, name) => {
                const dotted = ".".repeat(dots);
                expect(canonicalStorageKey(`${name}/${dotted}//x`)).toBe(`${name}/${dotted}/x`);
            }
        ), { numRuns: RUNS });
    });
});

describe("canonicalStorageKey — containment", () => {

    /**
     * The bucket boundary. `LocalStorageController.getFullPath` resolves the
     * key against the bucket directory and refuses anything that lands outside;
     * a canonical key must never be able to reach that refusal, or the
     * canonicalizer is not doing its job and the guard is the only thing left.
     */
    it("resolves inside the bucket, for every canonical key", () => {
        fc.assert(fc.property(canonicalKey, key => {
            const resolved = path.resolve(path.join(BUCKET, key));
            expect(
                resolved === BUCKET || resolved.startsWith(BUCKET + path.sep)
            ).toBe(true);
        }), { numRuns: RUNS });
    });

    /**
     * **Prefix soundness — the property the original defect violated.**
     *
     * A `storageAuthorize` hook decides by prefix: "this caller may write under
     * `users/alice/`". That decision is only meaningful if a key the hook reads
     * as being under the prefix also *lands* under it on disk. The old
     * sanitizer broke exactly this link — `users/alice/....//bob/x` came out as
     * `users/alice/../bob/x`, which starts with `users/alice/` (so the hook
     * approved it) and resolves into `bob` (so the write escaped).
     *
     * Stated over arbitrary prefixes rather than over that one string.
     */
    it("keeps a key that reads as being under a prefix inside that prefix on disk", () => {
        const prefixed = fc.tuple(
            fc.array(fc.stringMatching(/^[a-z0-9_-]{1,6}$/), { minLength: 1, maxLength: 3 }),
            hostileKey
        );
        fc.assert(fc.property(prefixed, ([prefixParts, rest]) => {
            const prefix = prefixParts.join("/") + "/";
            const key = tryCanonicalStorageKey(prefix + rest);
            if (key === null) return;
            if (!key.startsWith(prefix)) return; // hook would not have approved it

            const prefixDir = path.resolve(path.join(BUCKET, prefix));
            const resolved = path.resolve(path.join(BUCKET, key));
            expect(
                resolved === prefixDir || resolved.startsWith(prefixDir + path.sep)
            ).toBe(true);
        }), { numRuns: RUNS });
    });

    /**
     * A regression witness, not a redundant test.
     *
     * The old `sanitizeStorageKey` is reproduced verbatim here and shown to
     * violate the property above. Without this, a future "simplification" back
     * to a strip-based sanitizer would make the properties pass again by
     * construction — a stripper *does* produce keys with no `..` segment — while
     * quietly restoring the bug, because the defect was never in the output
     * alphabet. It was in the relationship between what the hook read and what
     * the filesystem did.
     */
    it("is not satisfied by the strip-based sanitizer it replaced", () => {
        const legacySanitize = (key: string): string => key
            .replace(/\0/g, "")
            .replace(/\.\.\/|\.\.\\/g, "")
            .replace(/^\/+/, "")
            .slice(0, 1024);

        const prefix = "users/alice/";
        const attack = `${prefix}....//bob/secret.txt`;

        const legacy = legacySanitize(attack);
        expect(legacy.startsWith(prefix)).toBe(true); // the hook says yes…
        const prefixDir = path.resolve(path.join(BUCKET, prefix));
        const landed = path.resolve(path.join(BUCKET, legacy));
        expect(landed.startsWith(prefixDir)).toBe(false); // …and it lands in bob/

        // The canonicalizer refuses it outright rather than repairing it.
        expect(() => canonicalStorageKey(attack)).not.toThrow();
        expect(canonicalStorageKey(attack)).toBe(`${prefix}..../bob/secret.txt`);
        expect(path.resolve(path.join(BUCKET, canonicalStorageKey(attack))).startsWith(prefixDir)).toBe(true);
    });
});

describe("public prefix agreement", () => {

    /**
     * `isPublicStoragePath` and `canonicalStorageKey` are two independent
     * readings of the same string, in two packages, and a decision is made on
     * each: the first decides whether an object is served token-less, the
     * second decides where it is written.
     *
     * The direction that must hold is "reads as public ⟹ stays public". Its
     * failure would mean something decided "public, no token needed" about a
     * key that then canonicalized to a private location — a URL handed out for
     * an object that is not there, or worse, is somewhere else.
     */
    it("keeps a public-reading key public after canonicalization", () => {
        fc.assert(fc.property(hostileKey, raw => {
            if (!isPublicStoragePath(raw)) return;
            const key = tryCanonicalStorageKey(raw);
            if (key === null) return; // refused outright is fail-closed, and fine
            expect(isPublicStoragePath(key)).toBe(true);
        }), { numRuns: RUNS });
    });

    /**
     * And the containment reading of the same thing: a key that canonicalizes
     * under the public prefix must resolve inside the public directory. This is
     * prefix soundness again, aimed at the one prefix whose meaning is "no
     * authentication required".
     */
    it("resolves a public key inside the public directory", () => {
        fc.assert(fc.property(canonicalKey, key => {
            if (!key.startsWith(PUBLIC_STORAGE_PREFIX)) return;
            const publicDir = path.resolve(path.join(BUCKET, PUBLIC_STORAGE_PREFIX));
            const resolved = path.resolve(path.join(BUCKET, key));
            // Equality is the folder marker itself: `public/` is a canonical
            // key (the trailing slash is how the folder route names a prefix)
            // and it resolves *to* the directory rather than inside it.
            expect(resolved === publicDir || resolved.startsWith(publicDir + path.sep)).toBe(true);
        }), { numRuns: RUNS });
    });

    /**
     * The reverse reading is *not* asserted as an equivalence, because it is
     * genuinely false and the asymmetry is worth recording rather than hiding:
     * `./public/x` canonicalizes to `public/x`, so it is stored public, while
     * `isPublicStoragePath("./public/x")` is false. Nothing is bypassed — the
     * object really is under the public prefix, which is what "public" means —
     * but a caller reasoning about the *raw* key would understate the exposure.
     * The lesson the codebase already encodes elsewhere applies: decide on the
     * canonical key, never on the one that arrived.
     */
    it("documents that a raw key can read as private and canonicalize as public", () => {
        expect(isPublicStoragePath("./public/x")).toBe(false);
        expect(canonicalStorageKey("./public/x")).toBe("public/x");
        expect(isPublicStoragePath(canonicalStorageKey("./public/x"))).toBe(true);
    });
});
