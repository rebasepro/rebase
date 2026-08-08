import jwt from "jsonwebtoken";
import { createPublicKey, type KeyObject } from "crypto";
import { logger } from "../utils/logger";

/**
 * Minimal JWKS-backed id_token verification, shared by the OIDC providers.
 *
 * Apple's id_token used to be `split(".")` + `JSON.parse`, justified by the
 * comment "we only need the payload". That skips `aud` — nothing confirmed the
 * token was minted for *this* Services ID rather than another one under the
 * same Apple team — along with `iss`, `exp` and the signature. Microsoft did
 * not request an id_token at all and inferred verification from a directory
 * attribute instead.
 *
 * Deliberately hand-rolled rather than pulling in a JWKS client: the only
 * cryptography here is `jsonwebtoken`'s (already a dependency) and Node's own
 * JWK→KeyObject import. What this file adds is key discovery and a cache.
 */

export interface OidcIdTokenClaims {
    sub: string;
    iss: string;
    aud: string | string[];
    exp: number;
    email?: string;
    email_verified?: boolean | string;
    nonce?: string;
    [claim: string]: unknown;
}

export interface VerifyOidcIdTokenOptions {
    /** The compact JWS to verify. */
    idToken: string;
    /** JWKS endpoint of the issuer. */
    jwksUri: string;
    /**
     * Expected `iss`. A `RegExp` is for multi-tenant issuers whose tenant id is
     * part of the issuer URL (Entra ID with `tenantId: "common"`); everything
     * else passes the exact string.
     */
    issuer: string | RegExp;
    /** Expected `aud` — the client/services id this backend is configured with. */
    audience: string;
    /** Permitted signing algorithms. Defaults to RS256, which is what Apple and Entra use. */
    algorithms?: jwt.Algorithm[];
    /** Seconds of clock skew tolerated on `exp`/`iat`. Defaults to 60. */
    clockToleranceSec?: number;
    /** Expected `nonce`, when the client bound one to the authorization request. */
    nonce?: string;
    /** Injection point for tests; defaults to global `fetch`. */
    fetchImpl?: typeof fetch;
}

interface Jwk {
    kid?: string;
    kty?: string;
    alg?: string;
    use?: string;
    [param: string]: unknown;
}

interface CachedJwks {
    keys: Jwk[];
    fetchedAt: number;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, CachedJwks>();

/** Drops the JWKS cache. Exported for tests; nothing in the runtime calls it. */
export function resetJwksCache(): void {
    jwksCache.clear();
}

async function loadJwks(jwksUri: string, fetchImpl: typeof fetch, forceRefresh: boolean): Promise<Jwk[]> {
    const cached = jwksCache.get(jwksUri);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
        return cached.keys;
    }
    const response = await fetchImpl(jwksUri);
    if (!response.ok) {
        throw new Error(`JWKS fetch failed (${response.status})`);
    }
    const body = await response.json() as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
    return keys;
}

function toKeyObject(jwk: Jwk): KeyObject {
    // `format: "jwk"` is Node's own importer — no third-party JWK parsing.
    return createPublicKey({ key: jwk as Record<string, unknown>, format: "jwk" } as Parameters<typeof createPublicKey>[0]);
}

function decodeKid(idToken: string): string | undefined {
    const decoded = jwt.decode(idToken, { complete: true });
    return decoded?.header?.kid;
}

/**
 * Verify an id_token's signature, `aud`, `iss` and `exp`, and return its claims.
 *
 * Throws on any failure — callers treat a throw as "reject this sign-in",
 * never as "continue without the claims".
 */
export async function verifyOidcIdToken(options: VerifyOidcIdTokenOptions): Promise<OidcIdTokenClaims> {
    const {
        idToken,
        jwksUri,
        issuer,
        audience,
        algorithms = ["RS256"],
        clockToleranceSec = 60,
        nonce,
        fetchImpl = fetch
    } = options;

    if (!idToken || typeof idToken !== "string") {
        throw new Error("id_token missing");
    }

    const kid = decodeKid(idToken);

    // An unknown `kid` is the normal signal that the issuer rotated its keys,
    // so miss the cache once before giving up.
    let keys = await loadJwks(jwksUri, fetchImpl, false);
    let jwk = keys.find((k) => !kid || k.kid === kid);
    if (!jwk) {
        keys = await loadJwks(jwksUri, fetchImpl, true);
        jwk = keys.find((k) => !kid || k.kid === kid);
    }
    if (!jwk) {
        throw new Error(`No JWKS key matches kid "${kid ?? "<none>"}"`);
    }

    const claims = jwt.verify(idToken, toKeyObject(jwk), {
        algorithms,
        audience,
        clockTolerance: clockToleranceSec
    }) as OidcIdTokenClaims;

    // `jsonwebtoken` only compares `iss` against a string or a list, so the
    // multi-tenant case is checked here rather than passed through.
    const issuerOk = typeof issuer === "string" ? claims.iss === issuer : issuer.test(String(claims.iss ?? ""));
    if (!issuerOk) {
        throw new Error(`Unexpected id_token issuer "${claims.iss}"`);
    }

    if (nonce !== undefined && claims.nonce !== nonce) {
        throw new Error("id_token nonce mismatch");
    }

    return claims;
}

/**
 * `verifyOidcIdToken` that reports failure as `null` and logs it, for the one
 * call site that has to decide between "reject" and "degrade".
 */
export async function tryVerifyOidcIdToken(
    providerId: string,
    options: VerifyOidcIdTokenOptions
): Promise<OidcIdTokenClaims | null> {
    try {
        return await verifyOidcIdToken(options);
    } catch (error) {
        logger.error(`[${providerId}] id_token verification failed`, {
            error: error instanceof Error ? error.message : error
        });
        return null;
    }
}
