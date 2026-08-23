import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";
import { logger } from "../utils/logger";
// A leaf module (node:path and `@rebasepro/types` only), so this does not close
// an import cycle. Same reason the key canonicalizer lives there: the value a
// token is minted with and the value a request is checked against must come
// from one function, not from two copies of one rule.
import { canonicalStorageId } from "../storage/keys";
import {
    resolveSigningKeys,
    resolveVerificationKey,
    toJwks,
    type JwtSigningKeyConfig,
    type PublicJwk,
    type ResolvedJwtKey
} from "./jwt-keys";

export interface JwtConfig {
    secret: string;
    accessExpiresIn?: string;
    refreshExpiresIn?: string;
    /**
     * Asymmetric keys for signing **access tokens**, newest first.
     *
     * Optional and additive: with none configured everything below behaves
     * exactly as it did, signing HS256 with {@link JwtConfig.secret}. With one
     * configured, access tokens are signed by {@link JwtConfig.activeKid} (or
     * the first entry) and carry its `kid`, and every key in the list keeps
     * verifying — which is what makes rotation a deploy rather than a mass
     * sign-out. Tokens minted before any key existed carry no `kid` and are
     * still verified against the secret until they expire.
     *
     * The secret stays required regardless: purpose-scoped tokens (download,
     * MFA-pending, password reset) are read only by this server, and are
     * shorter and cheaper symmetric. See `jwt-keys.ts`.
     */
    signingKeys?: JwtSigningKeyConfig[];
    /** Which key signs. Defaults to the first entry of {@link JwtConfig.signingKeys}. */
    activeKid?: string;
}

export interface AccessTokenPayload {
    /**
     * The user's id — the same spelling the domain model, the auth adapters and
     * the RLS layer (`rebase.uid()`) all use. Tokens minted before this rename
     * carry `uid` instead, and older external IdPs may send `sub`;
     * {@link verifyAccessToken} accepts all three and normalises to this.
     */
    uid: string;
    roles: string[];
    /** Authentication Assurance Level: aal1 = password/oauth, aal2 = MFA verified */
    aal?: "aal1" | "aal2";
    /**
     * When the token was issued, in seconds since the epoch — the standard JWT
     * `iat` claim, which `jsonwebtoken` sets on every token it signs.
     *
     * Carried through verification because revocation needs it: `logout`,
     * `change-password`, `reset-password` and `DELETE /auth/sessions` all stamp
     * a `tokensValidAfter` watermark on the user, and a token is void if it was
     * issued before that mark. `verifyAccessToken` used to rebuild the payload
     * from three claims and drop this one, so nothing downstream could make the
     * comparison and the watermark was read on exactly one path — refresh.
     */
    iat?: number;
    /** Email claim from the JWT, if present */
    email?: string;
    /** Display name claim from the JWT, if present */
    displayName?: string;
    /** Photo URL claim from the JWT, if present */
    photoURL?: string;
    /** Whether MFA has been verified for this session */
    mfa_verified?: boolean;
    /** Authentication Methods Reference — list of methods used (e.g. 'pwd', 'otp') */
    amr?: string[];
}

let jwtConfig: JwtConfig = {
    secret: "",
    accessExpiresIn: "1h",
    // 400 days, sliding — see getRefreshTokenTtlMs. A 30-day default meant a
    // user who took a summer off came back signed out, which nobody asked for
    // and which neither of the auth services people compare us to does.
    refreshExpiresIn: "400d"
};

/**
 * The parsed signing keys, and which one mints new access tokens.
 *
 * Both are module state beside `jwtConfig` for the same reason it is: every
 * signing and verifying path in the server reads them through this file, and
 * there is exactly one JWT configuration per process.
 */
let signingKeys: ResolvedJwtKey[] = [];
let activeSigningKey: ResolvedJwtKey | null = null;

/**
 * Configure JWT settings - call this during initialization.
 * Validates the secret strength to prevent deployment with default/weak secrets.
 */
export function configureJwt(config: JwtConfig): void {
    // Reject obviously weak/default secrets
    const weakSecrets = new Set([
        "secret",
        "jwt-secret",
        "jwt_secret",
        "your-secret",
        "your-super-secret-jwt-key-change-in-production",
        "super-secret-jwt-key-change-in-production",
        "change-me",
        "changeme",
        "password",
        "test",
        "mysecret",
        "my-secret",
        "my_secret",
        "example-secret",
        "please-change-me",
        "replace-this-with-a-real-secret",
        "default-secret",
        "rebase_saas_jwt_secret_must_be_long_long_long_long",
        "rebase_saas_service_key_must_be_long_long_long_long"
    ]);

    if (!config.secret || config.secret.length < 32) {
        throw new Error(
            "JWT secret is too short. Must be at least 32 characters. " +
            "Generate one with: node -e \"logger.info(require('crypto').randomBytes(48).toString('base64'))\""
        );
    }

    if (weakSecrets.has(config.secret.toLowerCase())) {
        throw new Error(
            "JWT secret is a known default/weak value. Please use a strong, randomly generated secret. " +
            "Generate one with: node -e \"logger.info(require('crypto').randomBytes(48).toString('base64'))\""
        );
    }

    // Resolved before `jwtConfig` is replaced, so a malformed key leaves the
    // previous configuration standing rather than half-applying a new one.
    const resolved = config.signingKeys ? resolveSigningKeys(config.signingKeys) : [];
    let active: ResolvedJwtKey | null = null;
    if (resolved.length > 0) {
        if (config.activeKid) {
            active = resolved.find((key) => key.kid === config.activeKid) ?? null;
            if (!active) {
                throw new Error(
                    `auth.activeKid is "${config.activeKid}", which is not among the configured signing keys ` +
                    `(${resolved.map((k) => `"${k.kid}"`).join(", ")}). Signing with a key nobody published ` +
                    "produces tokens no verifier can check."
                );
            }
        } else {
            active = resolved[0];
        }
    }

    jwtConfig = {
        ...jwtConfig,
        ...config
    };
    signingKeys = resolved;
    activeSigningKey = active;
}

/**
 * The public keys, in JWKS form, for `/.well-known/jwks.json`.
 *
 * An empty `keys` array on a backend with no asymmetric keys configured is the
 * correct answer rather than a 404: it says "this issuer publishes none",
 * which a verifier can act on, where a 404 is indistinguishable from a
 * misconfigured URL.
 */
export function getJwks(): { keys: PublicJwk[] } {
    return toJwks(signingKeys);
}

/** Is this backend signing access tokens asymmetrically? */
export function hasAsymmetricSigningKey(): boolean {
    return activeSigningKey !== null;
}

/**
 * Has this server been given a JWT secret?
 *
 * False on every backend that authenticates through an adapter — Firebase,
 * Clerk, anything with its own tokens — because nothing calls
 * {@link configureJwt} there. Signing paths still throw when it is false, since
 * asking for a token from a server that cannot mint one is a mistake worth
 * hearing about. Paths whose contract is *"tolerate the absence of auth"* must
 * ask first: `optionalAuth` crashing a request because this backend does not do
 * JWT is a 500 on a route that had already decided anonymous was acceptable.
 */
export function isJwtConfigured(): boolean {
    return Boolean(jwtConfig.secret);
}

/**
 * Generate an access token (short-lived, 1 hour by default)
 */
export function generateAccessToken(
    uid: string,
    roles: string[],
    aal: "aal1" | "aal2" = "aal1",
    customClaims?: Record<string, unknown>
): string {
    if (!jwtConfig.secret) {
        throw new Error("JWT secret not configured. Call configureJwt() first.");
    }

    // `aal` is written AFTER the custom claims, not before. The hook is handed a
    // `defaultClaims` object that already contains `aal`, and the obvious hook
    // — spread the input, add a field — echoes it straight back; one that
    // merged a user-controlled profile object could echo back `aal: "aal2"`.
    // Spreading last made the assurance level of a session something its own
    // holder could assert, which is the one claim that must be decided here.
    const payload: Record<string, unknown> = {
        uid,
        roles,
        ...customClaims,
        aal
    };

    // The `kid` is what lets a verifier pick the right public key out of the
    // JWKS, and what lets the previous key keep working while tokens signed by
    // it are still in circulation.
    if (activeSigningKey) {
        return jwt.sign(payload, activeSigningKey.privateKey, {
            expiresIn: jwtConfig.accessExpiresIn as jwt.SignOptions["expiresIn"],
            algorithm: activeSigningKey.algorithm,
            keyid: activeSigningKey.kid
        });
    }

    return jwt.sign(payload, jwtConfig.secret, {
        expiresIn: jwtConfig.accessExpiresIn as jwt.SignOptions["expiresIn"],
        algorithm: "HS256"
    });
}

/**
 * Get the expiration time of an access token in milliseconds from now
 */
export function getAccessTokenExpiryMs(): number {
    const duration = jwtConfig.accessExpiresIn || "1h";
    const match = duration.match(/^(\d+)([dhms])$/);

    if (!match) {
        // Default to 1 hour
        return 60 * 60 * 1000;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case "d": return value * 24 * 60 * 60 * 1000;
        case "h": return value * 60 * 60 * 1000;
        case "m": return value * 60 * 1000;
        case "s": return value * 1000;
        default: return 60 * 60 * 1000;
    }
}

/**
 * Get the expiration timestamp for an access token
 */
export function getAccessTokenExpiry(): number {
    return Date.now() + getAccessTokenExpiryMs();
}

/**
 * Verify and decode an access token.
 *
 * Every token this server issues is signed with the same secret, so what a
 * token *is* comes from its claims, not from its signature. A download token
 * ({@link generateDownloadToken}) is therefore a validly-signed string that
 * must never authenticate anybody: it is scoped to one file path and handed out
 * in URLs, which is a far weaker thing to hold than a session.
 *
 * Today it is rejected below for want of an id — but only by luck, since
 * nothing stops a future download token from carrying one. So the purpose is
 * checked explicitly: a token minted for reading a file is not a token for
 * being a user.
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
    if (!jwtConfig.secret) {
        throw new Error("JWT secret not configured. Call configureJwt() first.");
    }

    try {
        // Which key, and therefore which algorithm, is decided here — by the
        // `kid` and by nothing else in the token.
        //
        // The alternative, passing every algorithm we support and letting
        // `jsonwebtoken` read `alg` from the header, is the canonical JWT
        // vulnerability: an attacker takes the RSA public key we publish at
        // `/.well-known/jwks.json`, HMACs a payload of their choosing with it,
        // sets `alg: HS256`, and the verifier — holding that same public key as
        // "the secret" — agrees. Any uid, any roles. So a token naming a key we
        // hold is verified with that key's algorithm alone, and a token naming
        // none never reaches the asymmetric path at all.
        const header = jwt.decode(token, { complete: true })?.header;
        const namedKey = resolveVerificationKey(signingKeys, header?.kid);

        // A token with a `kid` we do not recognise falls through to the secret
        // and fails there, which is what a retired key should do.
        const decoded = (namedKey
            ? jwt.verify(token, namedKey.publicKey, { algorithms: [namedKey.algorithm] })
            : jwt.verify(token, jwtConfig.secret, { algorithms: ["HS256"] })
        ) as { uid?: string; sub?: string; roles?: string[]; aal?: string; purpose?: string; iat?: number };
        if (decoded.purpose) {
            logger.error("[JWT] Verification failed: a purpose-scoped token is not an access token", { purpose: decoded.purpose });
            return null;
        }
        const id = decoded.uid || decoded.sub;
        if (!id) {
            logger.error("[JWT] Verification failed: missing id in payload", { detail: decoded });
            return null;
        }

        const aal = (decoded.aal === "aal1" || decoded.aal === "aal2") ? decoded.aal : "aal1";

        return {
            uid: id,
            roles: decoded.roles || [],
            aal,
            iat: decoded.iat
        };
    } catch (error) {
        logger.error("[JWT] Verification failed", { error: error, detail: token.substring(0, 15) });
        return null;
    }
}

/**
 * Generate a random refresh token (long-lived, 30 days by default)
 */
export function generateRefreshToken(): string {
    return randomBytes(40).toString("hex");
}

/**
 * Hash a refresh token for database storage (don't store raw tokens)
 */
export function hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/**
 * The longest a cookie can live. Chrome (since 104) and RFC 6265bis silently
 * rewrite any `Max-Age` beyond 400 days down to 400 days, so promising a
 * browser more is not a stricter policy — it is a policy that differs from
 * what is actually enforced, which is worse than knowing the ceiling.
 */
export const MAX_COOKIE_AGE_MS = 400 * 24 * 60 * 60 * 1000;

/** Fallback when `refreshExpiresIn` is unset or unparseable. */
const DEFAULT_REFRESH_TTL_MS = MAX_COOKIE_AGE_MS;

/**
 * How long a refresh token is valid for, in milliseconds.
 *
 * Every rotation issues a token with a fresh TTL, so this is a sliding window:
 * a user who visits at all keeps their session indefinitely, and one who
 * disappears loses it this long after their last visit. That is what both
 * Firebase and Supabase do by default, and it is the behaviour people mean
 * when they say they expect to still be signed in.
 */
export function getRefreshTokenTtlMs(): number {
    const duration = jwtConfig.refreshExpiresIn;
    const match = duration?.match(/^(\d+)([dhms])$/);
    if (!match) return DEFAULT_REFRESH_TTL_MS;

    const value = parseInt(match[1], 10);
    switch (match[2]) {
        case "d": return value * 24 * 60 * 60 * 1000;
        case "h": return value * 60 * 60 * 1000;
        case "m": return value * 60 * 1000;
        case "s": return value * 1000;
        default: return DEFAULT_REFRESH_TTL_MS;
    }
}

/**
 * Calculate refresh token expiration date
 */
export function getRefreshTokenExpiry(): Date {
    return new Date(Date.now() + getRefreshTokenTtlMs());
}

/**
 * The `purpose` claim carried by a credential that stands between "first factor
 * accepted" and "session issued".
 *
 * A pre-auth token is NOT a session and must never be usable as one:
 * {@link verifyAccessToken} refuses any token carrying a `purpose`, so this
 * value cannot authenticate a request no matter which route it is presented to.
 * The only thing that reads it is the MFA challenge pair, which exchanges it —
 * plus a second factor — for a real session.
 */
export const MFA_PENDING_PURPOSE = "mfa-pending";

/**
 * Mint the short-lived credential handed back with an `MFA_REQUIRED` response.
 *
 * Short-lived on purpose: it is the window in which a caller who has proven the
 * first factor may present the second, not a session to be carried around. Five
 * minutes matches the challenge TTL.
 */
export function generateMfaPendingToken(uid: string, expiresInSeconds = 300): string {
    if (!jwtConfig.secret) {
        throw new Error("JWT secret not configured. Call configureJwt() first.");
    }

    return jwt.sign({ purpose: MFA_PENDING_PURPOSE,
uid }, jwtConfig.secret, {
        expiresIn: expiresInSeconds,
        algorithm: "HS256"
    });
}

/**
 * Verify a pre-auth token and return the user it was minted for.
 *
 * Returns `null` for anything else — including a perfectly valid *access*
 * token, which must not be interchangeable with this one in either direction.
 */
export function verifyMfaPendingToken(token: string): { uid: string } | null {
    if (!jwtConfig.secret) {
        throw new Error("JWT secret not configured. Call configureJwt() first.");
    }

    try {
        const decoded = jwt.verify(token, jwtConfig.secret, { algorithms: ["HS256"] }) as { purpose?: string; uid?: string };
        if (decoded.purpose !== MFA_PENDING_PURPOSE || !decoded.uid) return null;
        return { uid: decoded.uid };
    } catch {
        return null;
    }
}

export interface DownloadTokenPayload {
    purpose: "file-read";
    path: string;
    /**
     * The storage source the grant is good for, canonicalized by
     * {@link canonicalStorageId}. Always present on a decoded payload; see
     * {@link verifyDownloadToken} for how tokens minted before this claim
     * existed are read.
     */
    storageId: string;
}

/**
 * Generate a short-lived download token scoped to a specific file path or prefix
 * *within one storage source*.
 *
 * Both halves of that scope are load-bearing. A key is only unique inside its
 * own bucket, and a project with more than one source routinely holds the same
 * key in several of them — `avatars/u1.png` in `(default)` and in `media` are
 * different objects, quite possibly with different owners. A token that names
 * only the path is therefore a grant on every source at once: authorize a read
 * on the source whose `storageAuthorize` hook says yes, then spend the token
 * against `?storageId=` pointing somewhere else.
 *
 * `storageId` is optional here only because omitting it *is* the default
 * source, which is what the overwhelming majority of deployments have. A mint
 * site that forgets to pass a named source produces a default-scoped token,
 * which fails closed at `/file/*` rather than over-granting.
 */
export function generateDownloadToken(
    path: string,
    expiresInSeconds: number = 300,
    storageId?: string | null
): string {
    if (!jwtConfig.secret) {
        throw new Error("JWT secret not configured. Call configureJwt() first.");
    }

    const payload: DownloadTokenPayload = {
        purpose: "file-read",
        path,
        storageId: canonicalStorageId(storageId)
    };

    return jwt.sign(payload, jwtConfig.secret, {
        expiresIn: expiresInSeconds,
        algorithm: "HS256"
    });
}

/**
 * Verify and decode a download token.
 *
 * A token minted before `storageId` existed carries no such claim. It is read
 * as a grant on the **default source** rather than on all of them: that is the
 * fail-closed reading, and it is what such a token almost always was, since a
 * named source has to be asked for explicitly. The cost is bounded by the
 * five-minute TTL — for at most that long after a deploy, an in-flight token
 * for a *named* source is refused and the client re-fetches `/metadata`.
 */
export function verifyDownloadToken(token: string): DownloadTokenPayload | null {
    if (!jwtConfig.secret) {
        throw new Error("JWT secret not configured. Call configureJwt() first.");
    }

    try {
        const decoded = jwt.verify(token, jwtConfig.secret, { algorithms: ["HS256"] }) as Record<string, unknown> | undefined;
        if (decoded && decoded.purpose === "file-read" && typeof decoded.path === "string") {
            return {
                purpose: "file-read",
                path: decoded.path,
                storageId: canonicalStorageId(
                    typeof decoded.storageId === "string" ? decoded.storageId : null
                )
            };
        }
        return null;
    } catch (error) {
        logger.error("[JWT] Download token verification failed", { error: error });
        return null;
    }
}

