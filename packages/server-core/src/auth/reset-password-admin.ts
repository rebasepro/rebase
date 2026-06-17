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
import { getPasswordResetTemplate } from "../email/templates";
import type { EmailService, EmailConfig } from "../email";
import type { HonoEnv } from "../api/types";
import type { AuthCollectionConfig } from "@rebasepro/types";

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
 * Mounts: POST /users/:userId/reset-password
 */
export function createResetPasswordRoute(config: ResetPasswordRouteConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    const authRepo = config.authRepo;
    const { emailService, emailConfig, collectionAuthConfig } = config;
    const ops = resolveAuthHooks(config.authHooks);

    router.onError(errorHandler);
    router.use("/*", createRequireAuth({ serviceKey: config.serviceKey }));

    router.post("/users/:userId/reset-password", requireAdmin, async (c) => {
        const userId = c.req.param("userId");
        const existing = await authRepo.getUserById(userId);
        if (!existing) {
            throw ApiError.notFound("User not found");
        }

        let invitationSent = false;
        let temporaryPassword: string | undefined;

        // 1. Collection-level hook (closest to the data)
        if (collectionAuthConfig?.onResetPassword) {
            const isEmailConfigured = !!(emailService && emailService.isConfigured());
            const hookResult = await collectionAuthConfig.onResetPassword(existing.id, {
                hashPassword: (password: string) => ops.hashPassword(password),
                sendEmail: isEmailConfigured
                    ? (options) => emailService!.send(options)
                    : undefined,
                emailConfigured: isEmailConfigured,
                appName: emailConfig?.appName || "Rebase",
                resetPasswordUrl: emailConfig?.resetPasswordUrl || "",
            });
            temporaryPassword = hookResult.temporaryPassword;
            invitationSent = hookResult.invitationSent ?? false;
        }
        // 2. Backend-level hook (global override)
        else if (ops.onAdminResetPassword) {
            const hookResult = await ops.onAdminResetPassword(existing.id, {
                authRepo,
                emailService,
                emailConfig,
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

                    const appName = emailConfig?.appName || "Rebase";
                    const templateFn = emailConfig?.templates?.passwordReset;
                    const emailContent = templateFn
                        ? templateFn(setPasswordUrl, { email: existing.email, displayName: existing.displayName })
                        : getPasswordResetTemplate(setPasswordUrl, { email: existing.email, displayName: existing.displayName }, appName);

                    await emailService!.send({
                        to: existing.email,
                        subject: emailContent.subject,
                        html: emailContent.html,
                        text: emailContent.text
                    });
                    invitationSent = true;
                } catch (emailError: unknown) {
                    console.error("Failed to send reset email:", emailError instanceof Error ? emailError.message : emailError);
                    // Fall back to returning the temporary password
                    const clearPassword = generateSecurePassword();
                    const passwordHash = await ops.hashPassword(clearPassword);
                    await authRepo.updatePassword(existing.id, passwordHash);
                    temporaryPassword = clearPassword;
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
            ...(temporaryPassword ? { temporaryPassword } : {})
        }, 200);
    });

    return router;
}
