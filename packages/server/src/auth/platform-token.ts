/**
 * Platform tokens: a short-lived credential the platform hosting this server
 * mints for one person, for one project, for a few read-only scopes.
 *
 * ## Why this exists
 *
 * On Rebase Cloud the owner of a project is signed in to the *control plane*,
 * not to their own app. Their app's admin surfaces — the cron job list and its
 * run history first — accept an admin user of the app, an `rk_` key, or the
 * service key, and an owner may hold none of them: a fresh deploy has no admin
 * account, and the service key is admin on the whole API, which is the wrong
 * thing to hand someone who wants to read why last night's job failed.
 *
 * So the control plane signs a token instead. It checks the caller's project
 * membership, then signs `{ aud: <project>, sub: <who>, scope: "cron:read" }`
 * with a key only it holds, valid for minutes. This server verifies it against
 * the public half — `REBASE_PLATFORM_TOKEN_KEY` — which the platform sets at
 * deploy. Nothing secret lives in the tenant: the env holds a public key, and
 * leaking it lets nobody mint anything.
 *
 * ## What a platform token can never do
 *
 * - **Exceed {@link PLATFORM_TOKEN_SCOPES}.** The token names scopes; this
 *   server grants only the ones on that list, whatever the platform signed. The
 *   ceiling lives here, in the tenant's code, so a compromised or buggy control
 *   plane cannot widen it.
 * - **Outlive {@link PLATFORM_TOKEN_MAX_LIFETIME_SECONDS}.** A token whose
 *   `exp - iat` is longer is refused, not clamped: a long-lived platform token
 *   is a static secret by another name.
 * - **Reach another project.** One platform key signs for every tenant, so the
 *   audience is what binds a token to this one: `aud` must equal
 *   `REBASE_PLATFORM_TOKEN_AUDIENCE`.
 * - **Act as a person of this app.** The caller is `platform:<sub>` with no
 *   roles: row-level security sees nobody it knows, and every surface that
 *   checks a scope other than the granted ones refuses it.
 *
 * ## Wire format
 *
 * `rpt_` followed by a compact ES256 JWS. The prefix keeps the credential
 * classes apart the way `rk_` does: a platform token is never tried as a user
 * session, and a user session is never tried as a platform token.
 *
 * @module
 */
import type { MiddlewareHandler } from "hono";
import type { AdminScope } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { extractBearerToken } from "./bearer-token";
import { verifyJwt, type JwtClaims } from "./jwt-crypto";
import { logger } from "../utils/logger";

/** Marks a bearer token as a platform token. */
export const PLATFORM_TOKEN_PREFIX = "rpt_";

/** The `iss` every platform token carries. */
export const PLATFORM_TOKEN_ISSUER = "rebase-cloud";

/**
 * Everything a platform token can be granted on this server.
 *
 * Read-only on purpose. Adding a scope here is a decision about what the
 * platform may do inside a customer's app on a person's behalf, and belongs in
 * its own change.
 */
export const PLATFORM_TOKEN_SCOPES: readonly AdminScope[] = ["cron:read"];

/** The longest `exp - iat` a platform token may declare. */
export const PLATFORM_TOKEN_MAX_LIFETIME_SECONDS = 600;

/** How far ahead of this server's clock an `iat` may sit. */
const CLOCK_SKEW_SECONDS = 60;

/** The environment variables a platform sets to turn platform tokens on. */
export const PLATFORM_TOKEN_KEY_ENV = "REBASE_PLATFORM_TOKEN_KEY";
export const PLATFORM_TOKEN_AUDIENCE_ENV = "REBASE_PLATFORM_TOKEN_AUDIENCE";

/** What this server verifies platform tokens against. */
export interface PlatformTokenConfig {
    /**
     * PEM-encoded SPKI public keys, EC P-256. More than one during a key
     * rotation: a token verifies against any of them.
     */
    publicKeys: string[];
    /** This project, as the platform names it in `aud`. */
    audience: string;
}

/** A verified platform token, as the request will act. */
export interface PlatformCaller {
    /** Who the platform minted it for — a control-plane account. */
    subject: string;
    /** The granted scopes: what the token asked for, within the ceiling. */
    scopes: string[];
    /** `jti`, when the platform set one — what an audit line quotes. */
    tokenId?: string;
}

/** Why a presented platform token does not authenticate. */
export interface PlatformTokenRefusal {
    refusal: string;
}

export function isPlatformToken(token: string): boolean {
    return token.startsWith(PLATFORM_TOKEN_PREFIX);
}

const PEM_BLOCK = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g;

/**
 * The PEM blocks in an env value: real newlines, `\n`-escaped ones (what a
 * one-line `.env` holds), or the whole thing base64-encoded.
 */
export function parsePublicKeys(value: string): string[] {
    let text = value.trim();
    if (!text.includes("-----BEGIN")) {
        try {
            text = atob(text);
        } catch {
            return [];
        }
    }
    text = text.replace(/\\n/g, "\n");
    return [...text.matchAll(PEM_BLOCK)].map(match => match[0]);
}

/** Whether a PEM block is an EC P-256 public key WebCrypto can verify with. */
async function isP256PublicKey(pem: string): Promise<boolean> {
    const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
    try {
        const der = Uint8Array.from(atob(body), char => char.charCodeAt(0));
        await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read the platform-token configuration from the environment.
 *
 * `undefined` when platform tokens are off — neither variable set, which is
 * every self-hosted server — or misconfigured. A misconfiguration is logged and
 * leaves them off rather than failing the boot: the platform set these values,
 * the app's owner cannot fix them, and the app serving traffic matters more
 * than its cron history being readable from the CLI.
 */
export async function platformTokensFromEnv(
    env: Record<string, string | undefined>
): Promise<PlatformTokenConfig | undefined> {
    const rawKey = env[PLATFORM_TOKEN_KEY_ENV]?.trim();
    const audience = env[PLATFORM_TOKEN_AUDIENCE_ENV]?.trim();
    if (!rawKey && !audience) return undefined;

    if (!rawKey || !audience) {
        logger.warn(
            `[Auth] Platform tokens are OFF: ${rawKey ? PLATFORM_TOKEN_AUDIENCE_ENV : PLATFORM_TOKEN_KEY_ENV} is not set. ` +
            "Both are needed — the key to verify a token with, the audience to bind it to this project."
        );
        return undefined;
    }

    const candidates = parsePublicKeys(rawKey);
    const publicKeys: string[] = [];
    for (const pem of candidates) {
        if (await isP256PublicKey(pem)) publicKeys.push(pem);
    }
    if (publicKeys.length === 0 || publicKeys.length !== candidates.length) {
        logger.warn(
            `[Auth] Platform tokens are OFF: ${PLATFORM_TOKEN_KEY_ENV} must hold one or more PEM-encoded ` +
            `EC P-256 public keys ("-----BEGIN PUBLIC KEY-----"); ${candidates.length === 0
                ? "it holds none"
                : `${candidates.length - publicKeys.length} of its ${candidates.length} is not one`}.`
        );
        return undefined;
    }

    logger.info("Platform tokens accepted on admin surfaces", {
        audience,
        keys: publicKeys.length,
        scopes: PLATFORM_TOKEN_SCOPES
    });
    return { publicKeys, audience };
}

/** Narrow a claim to a non-empty string. */
function stringClaim(claims: JwtClaims, name: string): string | undefined {
    const value = claims[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Verify a presented platform token: signature, issuer, audience, lifetime, and
 * the scopes it may be granted here.
 */
export async function verifyPlatformToken(
    token: string,
    config: PlatformTokenConfig,
    nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<PlatformCaller | PlatformTokenRefusal> {
    if (!isPlatformToken(token)) return { refusal: "Not a platform token" };
    const jws = token.slice(PLATFORM_TOKEN_PREFIX.length);

    let claims: JwtClaims | undefined;
    for (const key of config.publicKeys) {
        try {
            // ES256 only, pinned here: the algorithm comes from the key this
            // server holds, never from the token's own header.
            claims = await verifyJwt(jws, key, { algorithms: ["ES256"] });
            break;
        } catch {
            // The next key, during a rotation; a refusal after the last.
        }
    }
    if (!claims) return { refusal: "Invalid or expired platform token" };

    if (claims.iss !== PLATFORM_TOKEN_ISSUER) {
        return { refusal: "This platform token was not issued by the platform" };
    }

    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(config.audience)) {
        return { refusal: "This platform token was issued for a different project" };
    }

    // The JWT library accepts a token with no `exp` as one that never expires,
    // so its absence is checked here rather than trusted to the verifier.
    const iat = claims.iat;
    const exp = claims.exp;
    if (typeof iat !== "number" || typeof exp !== "number") {
        return { refusal: "A platform token must carry iat and exp" };
    }
    if (exp - iat > PLATFORM_TOKEN_MAX_LIFETIME_SECONDS) {
        return { refusal: `A platform token may live at most ${PLATFORM_TOKEN_MAX_LIFETIME_SECONDS} seconds` };
    }
    if (iat > nowSeconds + CLOCK_SKEW_SECONDS) {
        return { refusal: "This platform token was issued in the future" };
    }

    const subject = stringClaim(claims, "sub");
    if (!subject) return { refusal: "A platform token must name who it acts for (sub)" };

    const requested = (stringClaim(claims, "scope") ?? "").split(/\s+/).filter(Boolean);
    const scopes = requested.filter(scope => (PLATFORM_TOKEN_SCOPES as readonly string[]).includes(scope));
    if (scopes.length === 0) {
        return {
            refusal: `This platform token carries no scope this server grants to the platform ` +
                `(${PLATFORM_TOKEN_SCOPES.join(", ")})`
        };
    }

    const tokenId = stringClaim(claims, "jti");
    return { subject, scopes, ...(tokenId ? { tokenId } : {}) };
}

/**
 * Authenticate an `rpt_` bearer token ahead of an admin gate.
 *
 * Mounted where the `rk_` pre-auth is, and shaped like it: a request it does not
 * recognise passes through untouched, a recognised one either becomes a caller
 * with narrowed `scopes` or is refused here. The gate's scope check then decides
 * — so a token holding `cron:read` reads cron, and is a 403 on every other
 * surface.
 *
 * With `config` undefined, platform tokens are off on this server; an `rpt_`
 * token is still recognised, so its holder learns that rather than the generic
 * "invalid token" a JWT parser would answer.
 */
export function createPlatformTokenPreAuth(config: PlatformTokenConfig | undefined): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        if (c.get("user")) return next();
        const token = extractBearerToken(c.req.header("authorization"));
        if (token === undefined || !isPlatformToken(token)) return next();

        if (!config) {
            return errorHandler(new ApiError(401, "PLATFORM_TOKENS_OFF",
                `This server does not accept platform tokens: ${PLATFORM_TOKEN_KEY_ENV} and ` +
                `${PLATFORM_TOKEN_AUDIENCE_ENV} are not set. The platform hosting it sets them when it deploys.`,
                undefined, true), c) as Response;
        }

        const verified = await verifyPlatformToken(token, config);
        if ("refusal" in verified) {
            return errorHandler(new ApiError(401, "INVALID_PLATFORM_TOKEN", verified.refusal, undefined, true), c) as Response;
        }

        // No roles: RLS knows nobody by this uid, and `callerScopes` reads the
        // narrowed list below rather than deriving one from roles.
        c.set("user", { uid: `platform:${verified.subject}`, roles: [] });
        c.set("scopes", verified.scopes);
        // An access to an app's admin surface on someone's behalf — the line an
        // owner looks for when asking who read what. `jti`, not `tokenId`: the
        // logger redacts any key that names a token, and the id is no secret.
        logger.info("[Auth] Platform token accepted", {
            subject: verified.subject,
            jti: verified.tokenId,
            scopes: verified.scopes,
            method: c.req.method,
            path: c.req.path
        });
        return next();
    };
}
