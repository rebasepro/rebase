import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { ApiError } from "../api/errors";
import { HonoEnv } from "../api/types";
import { requireAuth, extractBearerToken } from "./middleware";
import { logger } from "../utils/logger";
import { createRateLimiter, strictAuthLimiter } from "./rate-limiter";
import {
    generateTotpSecret,
    verifyTotpCounter,
    base32Decode,
    generateRecoveryCodes,
    hashRecoveryCode
} from "./mfa";
import { encryptTotpSecret, openTotpSecret } from "./mfa-crypto";
import {
    getAccessTokenExpiry,
    verifyAccessToken,
    verifyMfaPendingToken,
    type AccessTokenPayload
} from "./jwt";
import type { AuthModuleConfig } from "./routes";
import type { AuthRepository } from "./interfaces";
import { redactRefreshToken } from "./cookie-utils";
import { resolveAuthHooks } from "./auth-hooks";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";

/**
 * How many failed verifications one challenge tolerates before it is spent.
 *
 * A 6-digit code with a ±1 step window accepts 3 of 1,000,000 values, so the
 * only thing standing between an attacker and the second factor is how many
 * guesses a challenge will take. Five, and then they must open another one —
 * which the per-user limiter below is counting.
 */
const MAX_CHALLENGE_ATTEMPTS = 5;

/** Verification attempts one *account* may make per window, across all IPs. */
const MFA_VERIFICATION_ATTEMPTS_PER_WINDOW = 10;

interface MfaRoutesConfig {
    router: Hono<HonoEnv>;
    config: AuthModuleConfig;
    ops: ReturnType<typeof resolveAuthHooks>;
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T;
    buildAuthResponse: (
        user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; isAnonymous?: boolean; metadata?: Record<string, unknown> | null },
        roleIds: string[],
        accessToken: string,
        refreshToken: string,
        providerId: string
    ) => unknown;
    createSessionAndTokens: (
        uid: string,
        userAgent: string,
        ipAddress: string,
        options?: { skipMfaGate?: boolean; aal?: "aal1" | "aal2" }
    ) => Promise<{ roleIds: string[]; accessToken: string; refreshToken: string }>;
    applyTransformHook?: (
        response: AuthResponsePayload,
        method: TransformAuthResponseContext["method"],
        request: Request,
        uid: string
    ) => Promise<AuthResponsePayload>;
}

/**
 * Who is asking, on the two routes that may be reached *before* a session
 * exists.
 *
 * `pending` marks the caller as one factor short of a session: they hold the
 * short-lived, purpose-scoped token issued alongside `MFA_REQUIRED`, which is
 * refused as a credential everywhere else in the server.
 */
interface StepUpPrincipal {
    uid: string;
    aal: "aal1" | "aal2";
    pending: boolean;
}

/**
 * Resolve the caller of a challenge route from either a full session or a
 * pre-auth token.
 *
 * Both are parsed here rather than by `requireAuth` because the whole point of
 * the challenge pair is that it runs before the session exists — a login by an
 * MFA-enrolled user never receives an access token until it is finished.
 */
/**
 * Open a factor's stored secret, re-storing it under the current key if it
 * opened with an older one.
 *
 * This is what makes an `MFA_ENCRYPTION_KEY` rotation complete on its own: each
 * factor moves to the new key the next time its owner authenticates, so the
 * previous key can eventually be dropped. See `mfa-crypto.ts` for the sequence.
 *
 * A failed re-wrap must never fail the verification — the code the user typed
 * was already checked against the right secret, and the only cost of not
 * persisting is that this factor is re-wrapped again next time.
 */
async function openAndRewrap(
    authRepo: AuthRepository,
    factorId: string,
    secretEncrypted: string
): Promise<string> {
    const { secret, rewrapped } = openTotpSecret(secretEncrypted);
    if (!rewrapped) return secret;

    // Optional on the interface: a repository that cannot re-store a secret
    // keeps working, it just leaves the factor on its original key.
    if (typeof authRepo.updateMfaFactorSecret !== "function") return secret;

    try {
        await authRepo.updateMfaFactorSecret(factorId, rewrapped);
        logger.info("[MFA-Crypto] Re-wrapped a TOTP secret under the current key", { factorId });
    } catch (error) {
        logger.warn("[MFA-Crypto] Could not re-wrap a TOTP secret; leaving it on its original key", {
            factorId,
            error
        });
    }
    return secret;
}

function resolveStepUpPrincipal(c: Context<HonoEnv>): StepUpPrincipal | null {
    // Respect a principal an upstream middleware already resolved, exactly as
    // `requireAuth` does.
    const existing = c.get("user") as AccessTokenPayload | undefined;
    if (existing?.uid) {
        return { uid: existing.uid,
aal: existing.aal === "aal2" ? "aal2" : "aal1",
pending: false };
    }

    const token = extractBearerToken(c.req.header("authorization"));
    if (token === undefined) return null;

    const session = verifyAccessToken(token);
    if (session) {
        return { uid: session.uid,
aal: session.aal === "aal2" ? "aal2" : "aal1",
pending: false };
    }

    const pending = verifyMfaPendingToken(token);
    if (pending) {
        return { uid: pending.uid,
aal: "aal1",
pending: true };
    }

    return null;
}

/**
 * Per-account throttle on code verification.
 *
 * Keyed on the uid rather than the IP because an IP is the attacker's to
 * rotate and the account under attack is not: a distributed run against one
 * account passes an IP-keyed limiter untouched. The IP limiter still runs in
 * front of this one — they bound different things.
 */
const mfaVerificationLimiter: MiddlewareHandler<HonoEnv> = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: MFA_VERIFICATION_ATTEMPTS_PER_WINDOW,
    keyGenerator: (c) => `mfa-verify:${resolveStepUpPrincipal(c as Context<HonoEnv>)?.uid ?? "unidentified"}`,
    message: "Too many verification attempts for this account, please try again later."
});

export function mountMfaRoutes(opts: MfaRoutesConfig): void {
    const { router, config, ops, parseBody, buildAuthResponse, createSessionAndTokens, applyTransformHook } = opts;
    const authRepo = config.authRepo;
    const emailConfig = config.emailConfig;

    /**
     * Changing which factors an account trusts is itself a privileged act.
     *
     * An account that already has a verified factor may only gain or confirm
     * another one from a session that presented the existing one. Without this
     * the `aal2` gate on unenroll was self-service: an `aal1` session enrolled
     * a factor of its own, verified it with a code it computed from the secret
     * the enrol response had just handed it, stepped up on that, and deleted
     * the victim's real factor — arriving at `aal2` without ever holding the
     * second factor the account was protected by.
     *
     * The first enrolment on an account with no verified factor is deliberately
     * allowed at `aal1`: there is no second factor to demand yet.
     */
    async function requireStepUpForFactorChange(userCtx: AccessTokenPayload): Promise<void> {
        if (userCtx.aal === "aal2") return;
        if (!(await authRepo.hasVerifiedMfaFactors(userCtx.uid))) return;
        throw ApiError.forbidden(
            "This account already has a verified second factor. Re-authenticate with it before changing enrolled factors.",
            "AAL2_REQUIRED"
        );
    }

    /**
     * Spend a TOTP time step, or refuse it as already spent.
     *
     * RFC 6238 §5.2: an accepted OTP must not be accepted again. The window
     * that exists for clock drift is also a 90-second replay window, and a
     * replay here is not momentary — `challenge/verify` mints a refresh token,
     * so one observed code buys a durable session.
     */
    async function claimTotpStep(factorId: string, counter: number): Promise<boolean> {
        if (typeof authRepo.claimMfaFactorCounter !== "function") {
            logger.warn("[MFA] Auth repository cannot record spent TOTP steps; an accepted code stays replayable for its window", {
                factorId
            });
            return true;
        }
        return authRepo.claimMfaFactorCounter(factorId, counter);
    }

    /**
     * POST /auth/mfa/enroll
     * Start MFA enrollment: generate TOTP secret and recovery codes
     */
    router.post("/mfa/enroll", strictAuthLimiter, requireAuth, async (c) => {
        const userCtx = c.get("user") as AccessTokenPayload | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        await requireStepUpForFactorChange(userCtx);

        const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
        const friendlyName = typeof body.friendlyName === "string" ? body.friendlyName : undefined;
        const issuer = typeof body.issuer === "string" ? body.issuer : emailConfig?.appName || "Rebase";

        // Get user for account name
        const user = await authRepo.getUserById(userCtx.uid);
        if (!user) {
            throw ApiError.notFound("User not found");
        }

        // Generate TOTP secret
        const { secret, uri } = generateTotpSecret(issuer, user.email);

        // Encrypt the TOTP secret before storage (AES-256-GCM envelope encryption)
        const encryptedSecret = encryptTotpSecret(secret);
        const factor = await authRepo.createMfaFactor(
            user.id,
            "totp",
            encryptedSecret,
            friendlyName
        );

        // Generate recovery codes
        const codes = generateRecoveryCodes(10);
        const codeHashes = codes.map(hashRecoveryCode);
        await authRepo.createRecoveryCodes(user.id, codeHashes);

        return c.json(
            {
                factor: {
                    id: factor.id,
                    factorType: factor.factorType,
                    friendlyName: factor.friendlyName
                },
                totp: {
                    secret,
                    uri,
                    qrUri: uri
                },
                recoveryCodes: codes
            },
            201
        );
    });

    /**
     * POST /auth/mfa/verify
     * Verify TOTP code to complete MFA enrollment
     */
    router.post("/mfa/verify", strictAuthLimiter, requireAuth, mfaVerificationLimiter, async (c) => {
        const userCtx = c.get("user") as AccessTokenPayload | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        await requireStepUpForFactorChange(userCtx);

        const verifySchema = z.object({
            factorId: z.string().min(1, "Factor ID is required"),
            code: z.string().length(6, "Code must be 6 digits")
        });
        const { factorId, code } = parseBody(verifySchema, await c.req.json());

        // Get the factor
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.uid !== userCtx.uid) {
            throw ApiError.notFound("MFA factor not found");
        }

        if (factor.verified) {
            throw ApiError.badRequest("Factor is already verified", "ALREADY_VERIFIED");
        }

        // Decrypt and verify the TOTP code
        const decryptedSecret = await openAndRewrap(authRepo, factor.id, factor.secretEncrypted);
        const secretBuffer = base32Decode(decryptedSecret);
        const matchedCounter = verifyTotpCounter(secretBuffer, code);

        if (matchedCounter === null || !(await claimTotpStep(factor.id, matchedCounter))) {
            throw ApiError.unauthorized("Invalid TOTP code", "INVALID_CODE");
        }

        // Mark factor as verified
        await authRepo.verifyMfaFactor(factorId);

        return c.json({
            success: true,
            message: "MFA factor verified and enrolled"
        });
    });

    /**
     * POST /auth/mfa/challenge
     * Open a challenge — either to finish a sign-in that answered
     * `MFA_REQUIRED`, or to step an existing session up to `aal2`.
     */
    router.post("/mfa/challenge", strictAuthLimiter, async (c) => {
        const principal = resolveStepUpPrincipal(c);
        if (!principal) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const challengeSchema = z.object({
            factorId: z.string().min(1, "Factor ID is required")
        });
        const { factorId } = parseBody(challengeSchema, await c.req.json());

        // Verify the factor belongs to this user and is verified
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.uid !== principal.uid) {
            throw ApiError.notFound("MFA factor not found");
        }

        if (!factor.verified) {
            throw ApiError.badRequest("MFA factor is not yet verified", "FACTOR_NOT_VERIFIED");
        }

        const ipAddress = c.req.header("x-forwarded-for") || "unknown";
        const challenge = await authRepo.createMfaChallenge(factorId, ipAddress);

        return c.json({
            challengeId: challenge.id,
            factorId: challenge.factorId,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
        });
    });

    /**
     * POST /auth/mfa/challenge/verify
     * Answer a challenge: this is where an MFA-enrolled account's session is
     * minted, at `aal2`.
     */
    router.post("/mfa/challenge/verify", strictAuthLimiter, mfaVerificationLimiter, async (c) => {
        const principal = resolveStepUpPrincipal(c);
        if (!principal) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const challengeVerifySchema = z.object({
            challengeId: z.string().min(1, "Challenge ID is required"),
            code: z.string().min(1, "Code is required")
        });
        const { challengeId, code } = parseBody(challengeVerifySchema, await c.req.json());

        // Find the challenge
        const challenge = await authRepo.getMfaChallengeById(challengeId);
        if (!challenge) {
            throw ApiError.badRequest("Invalid or expired challenge", "INVALID_CHALLENGE");
        }

        // Get the factor and verify ownership
        const factor = await authRepo.getMfaFactorById(challenge.factorId);
        if (!factor || factor.uid !== principal.uid) {
            throw ApiError.notFound("MFA factor not found");
        }

        // A challenge that has already been guessed at its limit is spent, and
        // stays spent for its remaining lifetime — otherwise one open challenge
        // is an unlimited number of guesses at six digits.
        if ((challenge.attempts ?? 0) >= MAX_CHALLENGE_ATTEMPTS) {
            logger.warn("[Security Audit] MFA challenge attempt limit reached", {
                eventType: "auth.mfa.challenge.exhausted",
                uid: principal.uid,
                challengeId
            });
            throw ApiError.unauthorized("Too many failed attempts for this challenge", "CHALLENGE_EXHAUSTED");
        }

        // Try TOTP verification first (standard 6-digit codes)
        const decryptedSecret = await openAndRewrap(authRepo, factor.id, factor.secretEncrypted);
        const secretBuffer = base32Decode(decryptedSecret);
        const matchedCounter = verifyTotpCounter(secretBuffer, code);
        let isValid = matchedCounter !== null && await claimTotpStep(factor.id, matchedCounter);

        // Fall back to recovery code verification if TOTP didn't match
        if (!isValid && matchedCounter === null) {
            const codeHash = hashRecoveryCode(code);
            isValid = await authRepo.useRecoveryCode(principal.uid, codeHash);
        }

        if (!isValid) {
            const attempts = typeof authRepo.recordMfaChallengeAttempt === "function"
                ? await authRepo.recordMfaChallengeAttempt(challengeId)
                : undefined;
            logger.warn("[Security Audit] MFA verification failed", {
                eventType: "auth.mfa.verify.failure",
                uid: principal.uid,
                challengeId,
                attempts
            });
            throw ApiError.unauthorized("Invalid verification code", "INVALID_CODE");
        }

        // Mark challenge as verified
        await authRepo.verifyMfaChallenge(challengeId);

        // A fresh authentication opens a fresh session, dated now — which is
        // what lets a later revocation void it. The gate is skipped because
        // this route IS the gate: the second factor was just presented.
        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            principal.uid,
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown",
            { skipMfaGate: true,
aal: "aal2" }
        );

        // Fire onMfaVerified hook
        if (ops.onMfaVerified) {
            ops.onMfaVerified(principal.uid, factor.id).catch((err) => {
                logger.error("[AuthHooks] onMfaVerified error", {
                    error: err instanceof Error ? err.message : err
                });
            });
        }

        logger.info("[Security Audit] MFA verification success", {
            eventType: "auth.mfa.verify.success",
            uid: principal.uid,
            factorId: factor.id,
            completedSignIn: principal.pending
        });

        // The caller who arrived with a pre-auth token is completing a sign-in
        // and has no user object yet, so return the same payload a login would
        // have returned. Best-effort: a session was minted either way, and
        // failing the response over the enrichment would strand the caller.
        const user = await authRepo.getUserById(principal.uid).catch(() => null);
        let mfaResponse: AuthResponsePayload = user
            ? buildAuthResponse(user, roleIds, accessToken, refreshToken, "mfa") as AuthResponsePayload
            : {
                tokens: {
                    accessToken,
                    refreshToken,
                    accessTokenExpiresAt: getAccessTokenExpiry()
                }
            };
        if (applyTransformHook) {
            mfaResponse = await applyTransformHook(mfaResponse, "mfa", c.req.raw, principal.uid);
        }
        return c.json(redactRefreshToken(mfaResponse, c, refreshToken, config.cookieAuth));
    });

    /**
     * GET /auth/mfa/factors
     * List enrolled MFA factors for the current user
     */
    router.get("/mfa/factors", strictAuthLimiter, requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const factors = await authRepo.getMfaFactors(userCtx.uid);
        return c.json({
            factors: factors.map((f) => ({
                id: f.id,
                factorType: f.factorType,
                friendlyName: f.friendlyName,
                verified: f.verified,
                createdAt: f.createdAt
            }))
        });
    });

    /**
     * DELETE /auth/mfa/unenroll
     * Remove an MFA factor
     */
    router.delete("/mfa/unenroll", strictAuthLimiter, requireAuth, async (c) => {
        const userCtx = c.get("user") as AccessTokenPayload | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        // Require aal2 (MFA-verified session) to unenroll MFA factors
        if (userCtx.aal !== "aal2") {
            throw ApiError.forbidden(
                "MFA verification required to unenroll. Please re-authenticate with your second factor.",
                "AAL2_REQUIRED"
            );
        }

        const unenrollSchema = z.object({
            factorId: z.string().min(1, "Factor ID is required")
        });
        const { factorId } = parseBody(unenrollSchema, await c.req.json());

        // Verify ownership
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.uid !== userCtx.uid) {
            throw ApiError.notFound("MFA factor not found");
        }

        await authRepo.deleteMfaFactor(factorId, userCtx.uid);

        // If no more verified factors, clean up recovery codes
        const hasFactors = await authRepo.hasVerifiedMfaFactors(userCtx.uid);
        if (!hasFactors) {
            await authRepo.deleteAllRecoveryCodes(userCtx.uid);
        }

        return c.json({
            success: true,
            message: "MFA factor removed"
        });
    });
}
