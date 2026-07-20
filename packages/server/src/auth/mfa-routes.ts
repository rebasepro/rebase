import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../api/errors";
import { HonoEnv } from "../api/types";
import { requireAuth } from "./middleware";
import { logger } from "../utils/logger";
import {
    generateTotpSecret,
    verifyTotp,
    base32Decode,
    generateRecoveryCodes,
    hashRecoveryCode
} from "./mfa";
import { encryptTotpSecret, decryptTotpSecret } from "./mfa-crypto";
import {
    generateAccessToken,
    generateRefreshToken,
    hashRefreshToken,
    getRefreshTokenExpiry,
    getAccessTokenExpiry,
    type AccessTokenPayload
} from "./jwt";
import type { AuthModuleConfig } from "./routes";
import { resolveAuthHooks } from "./auth-hooks";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";

export function mountMfaRoutes(
    router: Hono<HonoEnv>,
    config: AuthModuleConfig,
    ops: ReturnType<typeof resolveAuthHooks>,
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T,
    applyTransformHook?: (
        response: AuthResponsePayload,
        method: TransformAuthResponseContext["method"],
        request: Request,
        userId: string
    ) => Promise<AuthResponsePayload>
): void {
    const authRepo = config.authRepo;
    const emailConfig = config.emailConfig;

    /**
     * POST /auth/mfa/enroll
     * Start MFA enrollment: generate TOTP secret and recovery codes
     */
    router.post("/mfa/enroll", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

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
    router.post("/mfa/verify", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const verifySchema = z.object({
            factorId: z.string().min(1, "Factor ID is required"),
            code: z.string().length(6, "Code must be 6 digits")
        });
        const { factorId, code } = parseBody(verifySchema, await c.req.json());

        // Get the factor
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.userId !== userCtx.uid) {
            throw ApiError.notFound("MFA factor not found");
        }

        if (factor.verified) {
            throw ApiError.badRequest("Factor is already verified", "ALREADY_VERIFIED");
        }

        // Decrypt and verify the TOTP code
        const decryptedSecret = decryptTotpSecret(factor.secretEncrypted);
        const secretBuffer = base32Decode(decryptedSecret);
        const isValid = verifyTotp(secretBuffer, code);

        if (!isValid) {
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
     * Create an MFA challenge during login (user has MFA enrolled)
     */
    router.post("/mfa/challenge", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const challengeSchema = z.object({
            factorId: z.string().min(1, "Factor ID is required")
        });
        const { factorId } = parseBody(challengeSchema, await c.req.json());

        // Verify the factor belongs to this user and is verified
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.userId !== userCtx.uid) {
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
     * Verify a TOTP code for an active challenge, upgrade aal1 → aal2
     */
    router.post("/mfa/challenge/verify", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
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
        if (!factor || factor.userId !== userCtx.uid) {
            throw ApiError.notFound("MFA factor not found");
        }

        // Try TOTP verification first (standard 6-digit codes)
        const decryptedSecret = decryptTotpSecret(factor.secretEncrypted);
        const secretBuffer = base32Decode(decryptedSecret);
        let isValid = verifyTotp(secretBuffer, code);

        // Fall back to recovery code verification if TOTP didn't match
        if (!isValid) {
            const codeHash = hashRecoveryCode(code);
            isValid = await authRepo.useRecoveryCode(userCtx.uid, codeHash);
        }

        if (!isValid) {
            throw ApiError.unauthorized("Invalid verification code", "INVALID_CODE");
        }

        // Mark challenge as verified
        await authRepo.verifyMfaChallenge(challengeId);

        // Generate new access token with aal2
        const roles = await authRepo.getUserRoles(userCtx.uid);
        const roleIds = roles.map((r) => r.id);
        const accessToken = generateAccessToken(userCtx.uid, roleIds, "aal2");
        const refreshToken = generateRefreshToken();

        // Create new refresh token
        await authRepo.createRefreshToken(
            userCtx.uid,
            hashRefreshToken(refreshToken),
            getRefreshTokenExpiry(),
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        // Fire onMfaVerified hook
        if (ops.onMfaVerified) {
            ops.onMfaVerified(userCtx.uid, factor.id).catch((err) => {
                logger.error("[AuthHooks] onMfaVerified error", {
                    error: err instanceof Error ? err.message : err
                });
            });
        }

        let mfaResponse: AuthResponsePayload = {
            tokens: {
                accessToken,
                refreshToken,
                accessTokenExpiresAt: getAccessTokenExpiry()
            }
        };
        if (applyTransformHook) {
            mfaResponse = await applyTransformHook(mfaResponse, "mfa", c.req.raw, userCtx.uid);
        }
        return c.json(mfaResponse);
    });

    /**
     * GET /auth/mfa/factors
     * List enrolled MFA factors for the current user
     */
    router.get("/mfa/factors", requireAuth, async (c) => {
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
    router.delete("/mfa/unenroll", requireAuth, async (c) => {
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
        if (!factor || factor.userId !== userCtx.uid) {
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
