/**
 * The one module in the request path that knows what signs a JWT.
 *
 * `jsonwebtoken` is built on `node:crypto` and is synchronous. Every portable
 * JWT implementation — WebCrypto directly, or `jose` on top of it — is
 * asynchronous, because `crypto.subtle` is. So the shape of the boundary
 * matters more than what is behind it right now: **these functions are async
 * and `jsonwebtoken` is confined to this file.**
 *
 * That is the expensive half of the change, and it is why it was made before
 * anything actually needed it. Swapping the implementation touches one file.
 * Going from synchronous to asynchronous verification touches every caller of
 * every function that verifies a token — which, at the time of writing, is
 * eleven call sites in `src` and about a hundred and eighty in the suite. Doing
 * that as a line item inside a runtime port, on top of everything else moving
 * at once, is how a port stalls.
 *
 * What is **not** here: key parsing. `jwt-keys.ts` turns PEM into
 * `node:crypto` `KeyObject`s, and the portable replacement for that is
 * `jose`'s `importSPKI`/`importPKCS8` — a dependency this package does not
 * carry yet. It stays recorded in `contracts/portable-core.txt` rather than
 * wrapped in something that would imply it had moved.
 *
 * ## Replacing this with jose
 *
 * Add `jose` (a lockfile change, so it happens in the primary checkout), then:
 * `signJwt` becomes `new SignJWT(payload).setProtectedHeader({ alg, kid })
 * .setExpirationTime(...).sign(key)`, `verifyJwt` becomes `jwtVerify(token,
 * key, { algorithms })`, and `decodeProtectedHeader` is already what jose's
 * function of that name does. Nothing outside this file changes — with one
 * exception worth writing down, because nothing would fail loudly:
 * **`jsonwebtoken` stamps `iat` on every token it signs and jose does not**
 * (it wants an explicit `.setIssuedAt()`). `iat` is what the revocation
 * watermark compares against — `logout`, `change-password`, `reset-password`
 * and `DELETE /auth/sessions` all stamp `tokensValidAfter` on the user, and
 * every access token issued before that mark is void. Tokens minted without
 * `iat` would verify perfectly well and simply stop being revocable.
 *
 * @module
 */
import jwt from "jsonwebtoken";

/**
 * Key material, as whatever the current implementation accepts.
 *
 * Deliberately expressed in terms of `jsonwebtoken`'s own parameter types
 * rather than spelled out: naming `KeyObject` here would put `node:crypto` in
 * the signature and leak the thing this module exists to contain.
 */
export type JwtSigningKey = jwt.Secret | jwt.PrivateKey;
export type JwtVerificationKey = jwt.Secret | jwt.PublicKey;

export interface JwtSignOptions {
    algorithm: string;
    /** Seconds, or a duration string such as `"1h"`. */
    expiresIn?: number | string;
    /** The `kid` header, so a verifier can pick the right key out of a JWKS. */
    keyid?: string;
}

/** The claims of a verified token. Callers narrow; nothing here interprets. */
export type JwtClaims = Record<string, unknown>;

/** Sign a set of claims. Rejects if the key and algorithm disagree. */
export async function signJwt(
    payload: JwtClaims,
    key: JwtSigningKey,
    options: JwtSignOptions
): Promise<string> {
    return jwt.sign(payload, key, {
        algorithm: options.algorithm as jwt.SignOptions["algorithm"],
        ...(options.expiresIn === undefined
            ? {}
            : { expiresIn: options.expiresIn as jwt.SignOptions["expiresIn"] }),
        ...(options.keyid === undefined ? {} : { keyid: options.keyid })
    });
}

/**
 * Verify a token against one key and an explicit algorithm list, and return its
 * claims. Rejects — never returns null — when the token is not valid.
 *
 * `algorithms` has no default and must not acquire one. Letting the verifier
 * read `alg` out of the token's own header is the canonical JWT vulnerability:
 * an attacker takes a published RSA public key, HMACs a payload of their
 * choosing with it, sets `alg: HS256`, and a verifier holding that same public
 * key as "the secret" agrees. The caller decides the algorithm from the key it
 * chose, and {@link decodeProtectedHeader} exists so it can choose that key
 * without trusting anything the token asserts.
 */
export async function verifyJwt(
    token: string,
    key: JwtVerificationKey,
    options: { algorithms: string[] }
): Promise<JwtClaims> {
    return jwt.verify(token, key, {
        algorithms: options.algorithms as jwt.VerifyOptions["algorithms"]
    }) as unknown as JwtClaims;
}

/**
 * The token's unverified header — `kid` and `alg` — or an empty object.
 *
 * Unverified is the point: this is read *in order to* pick the key that will
 * verify it, so it cannot itself be verified first. Nothing but key selection
 * may depend on it, and key selection then pins the algorithm.
 *
 * Implemented here rather than via the JWT library because it is plain
 * base64url and JSON, needs no cryptography, and there is no reason for the
 * portable half of this module to wait on the non-portable half.
 */
export function decodeProtectedHeader(token: string): { kid?: string; alg?: string } {
    const encoded = token.split(".")[0];
    if (!encoded) return {};
    try {
        const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
        const header: unknown = JSON.parse(atob(padded));
        if (typeof header !== "object" || header === null) return {};
        const { kid, alg } = header as { kid?: unknown; alg?: unknown };
        return {
            ...(typeof kid === "string" ? { kid } : {}),
            ...(typeof alg === "string" ? { alg } : {})
        };
    } catch {
        // A token whose header is not base64url JSON is not a token. The
        // caller falls through to the symmetric key and fails there, which is
        // the same answer by a slower route.
        return {};
    }
}
