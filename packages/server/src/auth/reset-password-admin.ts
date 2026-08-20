/**
 * Standalone admin endpoint for resetting a user's password.
 *
 * Hook resolution order:
 * 1. Collection-level hook (`auth.onResetPassword` on the collection)
 * 2. Backend-level hook (`AuthHooks.onAdminResetPassword`)
 * 3. Built-in default (send reset email, or generate temp password)
 */

import { Hono } from "hono";
import { ApiError, errorHandler } from "../api/errors";
import type { AuthRepository } from "./interfaces";
import { createRequireAuth, requireAdmin } from "./middleware";
import type { AuthHooks } from "./auth-hooks";
import { resolveAuthHooks } from "./auth-hooks";
import { generateSecurePassword, generateSecureToken, hashToken } from "./admin-user-ops";
import { getPasswordResetTemplate, resolveEmailBranding } from "../email/templates";
import type { EmailService, EmailConfig } from "../email";
import type { HonoEnv } from "../api/types";
import type { AuthCollectionConfig } from "@rebasepro/types";
import { logger } from "../utils/logger";

export interface ResetPasswordRouteConfig {
    authRepo: AuthRepository;
    emailService?: EmailService;
    emailConfig?: EmailConfig;
    serviceKey?: string;
    authHooks?: AuthHooks;
    /** The parsed auth config from the collection, if available. */
    collectionAuthConfig?: AuthCollectionConfig;
}

/**
 * Create a standalone admin route for resetting user passwords.
 *
 * Mounts: POST /users/:uid/reset-password
 */
export function createResetPasswordRoute(config: ResetPasswordRouteConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    const authRepo = config.authRepo;
    const { emailService, emailConfig, collectionAuthConfig } = config;
    const ops = resolveAuthHooks(config.authHooks);

    router.onError(errorHandler);
    router.use("/*", createRequireAuth({
        serviceKey: config.serviceKey,
        // A demoted admin must not still be able to reset anyone's password.
        resolveRoles: uid => authRepo.getUserRoleIds(uid),
        revocationRepo: authRepo
    }));

    router.post("/users/:uid/reset-password", requireAdmin, async (c) => {
        const uid = c.req.param("uid");
        const existing = await authRepo.getUserById(uid);
        if (!existing) {
            throw ApiError.notFound("User not found");
        }

        let invitationSent = false;
        let temporaryPassword: string | undefined;
        // Distinguishes "email was never configured" from "email is configured but
        // the send failed" — both fall back to a temporary password.
        let emailDeliveryFailed = false;

        // Parse optional body — if a password is provided, set it directly
        const body = await c.req.json().catch(() => ({}));

        if (body.password) {
            const password = body.password as string;
            const validation = ops.validatePasswordStrength(password);
            if (!validation.valid) {
                throw ApiError.badRequest(
                    `Password too weak: ${validation.errors.join(", ")}`
                );
            }
            const passwordHash = await ops.hashPassword(password);
            await authRepo.updatePassword(existing.id, passwordHash);
            temporaryPassword = undefined;
            invitationSent = false;
        }
        // 1. Collection-level hook (closest to the data)
        else if (collectionAuthConfig?.onResetPassword) {
            const isEmailConfigured = !!(emailService && emailService.isConfigured());
            const hookResult = await collectionAuthConfig.onResetPassword(existing.id, {
                hashPassword: (password: string) => ops.hashPassword(password),
                sendEmail: isEmailConfigured
                    ? (options) => emailService!.send(options)
                    : undefined,
                emailConfigured: isEmailConfigured,
                appName: emailConfig?.appName || "Rebase",
                resetPasswordUrl: emailConfig?.resetPasswordUrl || ""
            });
            temporaryPassword = hookResult.temporaryPassword;
            invitationSent = hookResult.invitationSent ?? false;
        }
        // 2. Backend-level hook (global override)
        else if (ops.onAdminResetPassword) {
            const hookResult = await ops.onAdminResetPassword(existing.id, {
                authRepo,
                emailService,
                emailConfig
            });
            temporaryPassword = hookResult.temporaryPassword;
            invitationSent = hookResult.invitationSent ?? false;
        }
        // 3. Built-in default
        else {
            const isEmailConfigured = !!(emailService && emailService.isConfigured());

            if (isEmailConfigured) {
                try {
                    const token = generateSecureToken();
                    const tokenHash = hashToken(token);
                    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

                    await authRepo.createPasswordResetToken(existing.id, tokenHash, expiresAt);

                    const baseUrl = emailConfig?.resetPasswordUrl || "";
                    const setPasswordUrl = `${baseUrl}/reset-password?token=${token}`;

                    const { appName, logoUrl } = resolveEmailBranding(emailConfig);
                    const templateFn = emailConfig?.templates?.passwordReset;
                    const emailContent = templateFn
                        ? templateFn(setPasswordUrl, { email: existing.email,
displayName: existing.displayName })
                        : getPasswordResetTemplate(setPasswordUrl, { email: existing.email,
displayName: existing.displayName }, appName, logoUrl);

                    await emailService!.send({
                        to: existing.email,
                        subject: emailContent.subject,
                        html: emailContent.html,
                        text: emailContent.text
                    });
                    invitationSent = true;
                } catch (emailError: unknown) {
                    logger.error("Failed to send reset email", { error: emailError instanceof Error ? emailError.message : emailError });
                    // Fall back to returning the temporary password
                    const clearPassword = generateSecurePassword();
                    const passwordHash = await ops.hashPassword(clearPassword);
                    await authRepo.updatePassword(existing.id, passwordHash);
                    temporaryPassword = clearPassword;
                    emailDeliveryFailed = true;
                }
            } else {
                // No email service — generate password, set it, and return one-time
                const clearPassword = generateSecurePassword();
                const passwordHash = await ops.hashPassword(clearPassword);
                await authRepo.updatePassword(existing.id, passwordHash);
                temporaryPassword = clearPassword;
            }
        }

        const userRoles = await authRepo.getUserRoleIds(existing.id);

        return c.json({
            user: {
                uid: existing.id,
                email: existing.email,
                displayName: existing.displayName,
                roles: userRoles
            },
            invitationSent,
            ...(temporaryPassword ? { temporaryPassword } : {}),
            ...(emailDeliveryFailed ? { emailDeliveryFailed } : {})
        }, 200);
    });

    return router;
}
