/**
 * Admin User Operations
 *
 * Shared utilities and orchestration for admin-initiated user management
 * (user creation via REST API, password reset via admin panel).
 *
 * Hook resolution order:
 * 1. Collection-level hook (`auth.onCreateUser` on the collection) — closest to the data
 * 2. Backend-level hook (`AuthHooks.onAdminCreateUser`) — global override
 * 3. Built-in default — framework fallback
 */

import { randomBytes, createHash, randomInt } from "node:crypto";
import { normalizeEmail } from "@rebasepro/common";
import type { AuthRepository } from "./interfaces";
import type { EmailService, EmailConfig } from "../email";
import type { ResolvedAuthHooks } from "./auth-hooks";
import type { AuthCollectionConfig, AuthCollectionContext } from "@rebasepro/types";
import { getUserInvitationTemplate, resolveEmailBranding } from "../email/templates";
import { logger } from "../utils/logger";

// ─── Shared Crypto Utilities ────────────────────────────────────────────────

/**
 * Generate a cryptographically secure random password that meets strength requirements.
 *
 * 16 characters, guaranteed at least one uppercase, one lowercase, one digit.
 * Ambiguous characters (0, O, 1, l, I) are excluded.
 */
export function generateSecurePassword(): string {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const all = upper + lower + digits;

    const pick = (chars: string) => chars[randomInt(chars.length)];
    const parts = [pick(upper), pick(lower), pick(digits)];

    for (let i = parts.length; i < 16; i++) {
        parts.push(pick(all));
    }

    // Shuffle
    for (let i = parts.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    return parts.join("");
}

/**
 * Generate a cryptographically secure random token (80 hex characters).
 */
export function generateSecureToken(): string {
    return randomBytes(40).toString("hex");
}

/**
 * Hash a token for database storage using SHA-256.
 */
export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

// ─── Admin User Creation ────────────────────────────────────────────────────

/**
 * Context needed by admin user creation / password reset operations.
 */
export interface AdminUserContext {
    authRepo: AuthRepository;
    emailService?: EmailService;
    emailConfig?: EmailConfig;
    resolvedHooks: ResolvedAuthHooks;
    /** The parsed auth config from the collection (if `auth` is an object, not just `true`). */
    collectionAuthConfig?: AuthCollectionConfig;
}

/**
 * Result of preparing user values for admin-initiated creation.
 */
export interface AdminUserPrepareResult {
    /** Values ready for `driver.save()`. */
    values: Record<string, unknown>;
    /** The cleartext password (for returning to admin or sending via email). */
    clearPassword?: string;
    /** Whether the hook already handled the invitation email. */
    hookHandledEmail: boolean;
    /** Whether an invitation was sent (only relevant when hookHandledEmail is true). */
    invitationSent: boolean;
}

/**
 * Build the `AuthCollectionContext` facade from server internals.
 *
 * This is the simplified context exposed to collection-level auth hooks,
 * keeping them decoupled from internal interfaces like `AuthRepository`.
 */
function buildCollectionContext(ctx: AdminUserContext): AuthCollectionContext {
    const isEmailConfigured = !!(ctx.emailService && ctx.emailService.isConfigured());

    return {
        hashPassword: (password: string) => ctx.resolvedHooks.hashPassword(password),
        sendEmail: isEmailConfigured
            ? (options) => ctx.emailService!.send(options)
            : undefined,
        emailConfigured: isEmailConfigured,
        appName: ctx.emailConfig?.appName || "Rebase",
        resetPasswordUrl: ctx.emailConfig?.resetPasswordUrl || ""
    };
}

/**
 * Prepare user values for an admin-initiated user creation.
 *
 * Resolution order:
 * 1. Collection-level `auth.onCreateUser` — closest to the data
 * 2. Backend-level `AuthHooks.onAdminCreateUser` — global override
 * 3. Built-in default — generate password → hash → normalize email
 *
 * The caller is responsible for persisting (via `driver.save()`).
 */
export async function prepareAdminUserValues(
    body: Record<string, unknown>,
    ctx: AdminUserContext
): Promise<AdminUserPrepareResult> {
    const { resolvedHooks, collectionAuthConfig } = ctx;

    // 1. Collection-level hook (closest to the data)
    if (collectionAuthConfig?.onCreateUser) {
        const collectionCtx = buildCollectionContext(ctx);
        const hookResult = await collectionAuthConfig.onCreateUser(body, collectionCtx);
        return {
            values: hookResult.values,
            clearPassword: hookResult.temporaryPassword,
            hookHandledEmail: true,
            invitationSent: hookResult.invitationSent ?? false
        };
    }

    // 2. Backend-level hook (global override)
    if (resolvedHooks.onAdminCreateUser) {
        const hookResult = await resolvedHooks.onAdminCreateUser(body, {
            authRepo: ctx.authRepo,
            emailService: ctx.emailService,
            emailConfig: ctx.emailConfig,
            hashPassword: (password: string) => resolvedHooks.hashPassword(password)
        });
        return {
            values: hookResult.values,
            clearPassword: hookResult.temporaryPassword,
            hookHandledEmail: true,
            invitationSent: hookResult.invitationSent ?? false
        };
    }

    // 3. Built-in default
    const password = body.password as string | undefined;
    const clearPassword = password || generateSecurePassword();
    const passwordHash = await resolvedHooks.hashPassword(clearPassword);

    const values = { ...body };
    values.passwordHash = passwordHash;
    if (values.email) {
        values.email = normalizeEmail(values.email as string);
    }
    values.emailVerified = true;
    delete values.password;

    return {
        values,
        clearPassword: password ? undefined : clearPassword,
        hookHandledEmail: false,
        invitationSent: false
    };
}

/**
 * Handle post-creation work for admin-created users.
 *
 * Sends an invitation email (password-reset link) if email is configured
 * and no explicit password was provided. Falls back to returning the
 * temporary password if email fails or is not configured.
 */
export async function finalizeAdminUserCreation(
    entity: { id: string; values: Record<string, unknown> },
    clearPassword: string | undefined,
    ctx: AdminUserContext
): Promise<{
    temporaryPassword?: string;
    invitationSent: boolean;
    emailDeliveryFailed?: boolean;
}> {
    // If an explicit password was provided (clearPassword is undefined), nothing to do
    if (!clearPassword) {
        return { invitationSent: false };
    }

    const isEmailConfigured = !!(ctx.emailService && ctx.emailService.isConfigured());

    if (isEmailConfigured) {
        try {
            const token = generateSecureToken();
            const tokenHash = hashToken(token);
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            await ctx.authRepo.createPasswordResetToken(entity.id, tokenHash, expiresAt);

            const baseUrl = ctx.emailConfig?.resetPasswordUrl || "";
            const setPasswordUrl = `${baseUrl}/reset-password?token=${token}`;

            // The invitation template, not the password-reset one.
            //
            // This is the *creation* path: the recipient has never had an
            // account, let alone a password to reset. It sent
            // "Reset your <App> password" anyway, because
            // `templates.userInvitation` — declared in `EmailConfig`, typed as
            // `UserInvitationTemplateFunction`, and backed by a written default
            // that `email/index.ts` exports — was read by nothing at all. The
            // one flow named for it reached past it to its neighbour.
            //
            // `getUserInvitationTemplate` says what actually happened: "An
            // account has been created for you … set your password and get
            // started". `reset-password-admin.ts` keeps the reset template,
            // because there the account really does already exist.
            const { appName, logoUrl } = resolveEmailBranding(ctx.emailConfig);
            const templateFn = ctx.emailConfig?.templates?.userInvitation;
            const emailContent = templateFn
                ? templateFn(setPasswordUrl, { email: entity.values.email as string,
displayName: entity.values.displayName as string })
                : getUserInvitationTemplate(setPasswordUrl, { email: entity.values.email as string,
displayName: entity.values.displayName as string }, appName, logoUrl);

            await ctx.emailService!.send({
                to: entity.values.email as string,
                subject: emailContent.subject,
                html: emailContent.html,
                text: emailContent.text
            });
            return { invitationSent: true };
        } catch (emailError: unknown) {
            logger.error("Failed to send reset email", { error: emailError instanceof Error ? emailError.message : emailError });
            // Fall back to returning the temporary password
            return { temporaryPassword: clearPassword,
invitationSent: false,
emailDeliveryFailed: true };
        }
    }

    // No email service — return the temporary password
    return { temporaryPassword: clearPassword,
invitationSent: false };
}
