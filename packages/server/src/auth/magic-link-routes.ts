import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AuthModuleConfig } from "./routes";
import type { ResolvedAuthHooks } from "./auth-hooks";
import type { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import { generateSecureToken, hashToken } from "./admin-user-ops";
import { getMagicLinkTemplate, resolveEmailBranding } from "../email/templates";
import { resolveEmailLinkBase } from "../email/link-base";
import { strictAuthLimiter } from "./rate-limiter";
import { z } from "zod";
import { logger } from "../utils/logger";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";

/**
 * Magic link token expiry (15 minutes from now)
 */
function getMagicLinkExpiry(): Date {
    return new Date(Date.now() + 15 * 60 * 1000);
}

/**
 * Mount magic link routes onto the auth router.
 *
 * Follows the same delegation pattern as `mountMfaRoutes()` and `mountSessionRoutes()`.
 */
export function mountMagicLinkRoutes(deps: {
    router: Hono<HonoEnv>;
    config: AuthModuleConfig;
    ops: ResolvedAuthHooks;
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T;
    buildAuthResponse: (
        user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; isAnonymous?: boolean; metadata?: Record<string, unknown> | null },
        roleIds: string[],
        accessToken: string,
        refreshToken: string,
        providerId: string
    ) => unknown;
    createSessionAndTokens: (uid: string, userAgent: string, ipAddress: string) => Promise<{ roleIds: string[]; accessToken: string; refreshToken: string }>;
    applyTransformHook: (
        response: AuthResponsePayload,
        method: TransformAuthResponseContext["method"],
        request: Request,
        uid: string
    ) => Promise<AuthResponsePayload>;
    /**
     * Built by the caller so a misconfiguration fails the boot once, rather
     * than being resolved again here. Absent when captcha is off, or when
     * `magicLink` is not among the protected routes.
     */
    captchaMiddleware?: MiddlewareHandler<HonoEnv>;
}) {
    const { router, config, ops, parseBody, buildAuthResponse, createSessionAndTokens, applyTransformHook, captchaMiddleware } = deps;
    const { authRepo, emailService, emailConfig } = config;

    const magicLinkSchema = z.object({
        email: z.string().email("Invalid email address").max(255)
    });

    const verifyMagicLinkSchema = z.object({
        token: z.string().min(1, "Token is required")
    });

    function isEmailConfigured(): boolean {
        return !!(emailService && emailService.isConfigured());
    }

    /**
     * POST /auth/magic-link
     * Request a magic link email
     */
    router.post("/magic-link", strictAuthLimiter, ...(captchaMiddleware ? [captchaMiddleware] : []), async (c) => {
        const { email } = parseBody(magicLinkSchema, await c.req.json());

        // Require email service
        if (!isEmailConfigured()) {
            throw ApiError.serviceUnavailable("Email service not configured. Magic link login is not available.", "EMAIL_NOT_CONFIGURED");
        }

        // Always return success (security: don't reveal if email exists)
        const user = await authRepo.getUserByEmail(email);

        if (user) {
            // Call beforeLogin hook if provided (throw to reject)
            if (ops.beforeLogin) {
                await ops.beforeLogin(email, "magic-link");
            }

            // Generate magic link token
            const token = generateSecureToken();
            const tokenHash = hashToken(token);
            const expiresAt = getMagicLinkExpiry();

            await authRepo.createMagicLinkToken(user.id, tokenHash, expiresAt);

            // Build magic link URL
            const baseUrl = resolveEmailLinkBase(emailConfig, "magicLink");
            const magicLinkUrl = `${baseUrl}/auth/magic-link?token=${token}`;

            // Get email template
            const { appName, logoUrl } = resolveEmailBranding(emailConfig);
            const templateFn = emailConfig?.templates?.magicLink;
            const emailContent = templateFn
                ? templateFn(magicLinkUrl, { email: user.email, displayName: user.displayName })
                : getMagicLinkTemplate(magicLinkUrl, { email: user.email, displayName: user.displayName }, appName, logoUrl);

            // Send email
            try {
                await emailService!.send({
                    to: user.email,
                    subject: emailContent.subject,
                    html: emailContent.html,
                    text: emailContent.text
                });
            } catch (emailError: unknown) {
                logger.error("Failed to send magic link email", { error: emailError instanceof Error ? emailError.message : emailError });
                // Don't reveal email sending failure to client
            }
        }

        // Always return success
        return c.json({
            success: true,
            message: "If an account with that email exists, a magic link has been sent."
        });
    });

    /**
     * POST /auth/magic-link/verify
     * Verify magic link token and create session
     */
    router.post("/magic-link/verify", strictAuthLimiter, async (c) => {
        const { token } = parseBody(verifyMagicLinkSchema, await c.req.json());

        // Find valid token
        const tokenHash = hashToken(token);
        const storedToken = await authRepo.findValidMagicLinkToken(tokenHash);

        if (!storedToken) {
            throw ApiError.badRequest("Invalid or expired magic link", "INVALID_TOKEN");
        }

        // Mark token as used (one-time use)
        await authRepo.markMagicLinkTokenUsed(tokenHash);

        // Get user
        const user = await authRepo.getUserById(storedToken.uid);
        if (!user) {
            throw ApiError.badRequest("Invalid or expired magic link", "INVALID_TOKEN");
        }

        // Clicking a magic link proves email ownership — auto-verify
        if (!user.emailVerified) {
            await authRepo.setEmailVerified(user.id, true);
            user.emailVerified = true;
        }

        // Create session
        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        // Fire onAuthenticated hook (fire-and-forget)
        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "magic-link").catch(err => {
                logger.error("[AuthHooks] onAuthenticated error", { error: err instanceof Error ? err.message : err });
            });
        }

        const authResponse = buildAuthResponse(user, roleIds, accessToken, refreshToken, "magic-link") as AuthResponsePayload;
        const finalResponse = await applyTransformHook(authResponse, "magic-link", c.req.raw, user.id);
        return c.json(finalResponse);
    });
}
