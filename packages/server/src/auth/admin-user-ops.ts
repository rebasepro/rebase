/**
 * Admin User Operations
 *
 * Shared utilities and orchestration for admin-initiated user management
 * (user creation via REST API, password reset via admin panel), and the rules
 * user administration holds to whichever door it arrives by — the admin user
 * routes, or the auth collection through the data API.
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
import type {
    AuthAdapter,
    AuthCollectionConfig,
    AuthCollectionContext,
    UserCreationFinalizeResult,
    UserCreationPrepareResult
} from "@rebasepro/types";
import { ApiError } from "../api/errors";
import { getUserInvitationTemplate, resolveEmailBranding, USER_INVITATION_LINK_TTL_MS } from "../email/templates";
import { resolveEmailLinkBase } from "../email/link-base";
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
            // The TTL the invitation email states, from the same constant.
            const expiresAt = new Date(Date.now() + USER_INVITATION_LINK_TTL_MS);

            await ctx.authRepo.createPasswordResetToken(entity.id, tokenHash, expiresAt);

            // The resolver every other emailed link uses: it drops a trailing
            // slash, which the raw config value kept — `…example.com/` linked
            // to `//reset-password`, a path a router does not match.
            const baseUrl = resolveEmailLinkBase(ctx.emailConfig, "resetPassword");
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

/**
 * The step after a new user's row is written: who delivers the credentials,
 * and what the create response says about it.
 *
 * A create hook that ran owns delivery. What it reported is the answer: the
 * invitation it says it sent, and the temporary password it chose, which the
 * admin has to see because it is the one the user will be told. The framework
 * sends nothing of its own. Without a hook, `finalize` runs: the built-in
 * invitation, or the generated password when email is not configured or fails.
 *
 * Both doors that create a user call this, the auth collection's REST route
 * and `POST /admin/users`. The second used to call `finalizeAdminUserCreation`
 * directly and read neither `hookHandledEmail` nor `invitationSent`, so it
 * handled a hook's password as if the framework had generated it. With email
 * configured it sent its own invitation, a second one when the hook had sent
 * its own, and left the password out of the response. The decision lives here
 * so that the two doors cannot disagree about it again.
 *
 * The result has exactly the fields a create response carries, with absent
 * ones left out.
 */
export async function completeUserCreation(
    prepared: UserCreationPrepareResult,
    finalize?: (clearPassword: string | undefined) => Promise<UserCreationFinalizeResult>
): Promise<UserCreationFinalizeResult> {
    const result: UserCreationFinalizeResult = prepared.hookHandledEmail
        ? { temporaryPassword: prepared.clearPassword,
invitationSent: prepared.invitationSent }
        : finalize
            ? await finalize(prepared.clearPassword)
            : { invitationSent: false };

    return {
        invitationSent: result.invitationSent,
        ...(result.temporaryPassword ? { temporaryPassword: result.temporaryPassword } : {}),
        ...(result.emailDeliveryFailed ? { emailDeliveryFailed: true } : {})
    };
}

// ─── User Administration Rules ──────────────────────────────────────────────
//
// What `PUT` and `DELETE /admin/users/:uid` refuse, as functions, so the other
// door into the same rows — the auth collection through the data API — refuses
// it too. That door was the admin panel's own Users view, and it deleted the
// last administrator, skipped `beforeUserDelete`, and stored emails as typed.

/**
 * Refuse a change that leaves no administrator: `leaving` are users losing the
 * role (demoted, or deleted), and the project must keep at least one.
 *
 * Judged over the whole set, so a bulk write that takes every admin at once is
 * refused even though each of its rows alone would leave one behind.
 */
async function assertAdministratorsRemain(
    authRepo: AuthRepository,
    leaving: readonly string[],
    message: string
): Promise<void> {
    const admins: string[] = [];
    for (const uid of new Set(leaving)) {
        if ((await authRepo.getUserRoleIds(uid)).includes("admin")) admins.push(uid);
    }
    if (admins.length === 0) return;
    const { total } = await authRepo.listUsersPaginated({ roleId: "admin", limit: 1 });
    if (total <= admins.length) {
        throw ApiError.forbidden(message, "LAST_ADMIN");
    }
}

/** Refuse deleting these users when that would leave the project with no administrator. */
export async function assertUserDeletionsAllowed(
    authRepo: AuthRepository,
    uids: readonly string[]
): Promise<void> {
    await assertAdministratorsRemain(
        authRepo,
        uids,
        uids.length > 1 ? "Cannot delete every administrator" : "Cannot delete the last administrator"
    );
}

/** Refuse setting these users' roles when that would leave the project with no administrator. */
export async function assertRoleChangesAllowed(
    authRepo: AuthRepository,
    changes: ReadonlyArray<{ uid: string; roles: readonly unknown[] }>
): Promise<void> {
    await assertAdministratorsRemain(
        authRepo,
        changes.filter(change => !change.roles.includes("admin")).map(change => change.uid),
        changes.length > 1 ? "Cannot demote every administrator" : "Cannot demote the last administrator"
    );
}

/**
 * A user's new email, in the form sign-in looks it up by — or a 409 when
 * another account holds it.
 *
 * Sign-in, password reset and magic links all find the account by
 * `normalizeEmail(input)`. An address stored as typed is one those lookups
 * never match: its owner is locked out, and registering the address again hits
 * the case-insensitive unique index.
 */
export async function normalizeUserEmailChange(
    authRepo: AuthRepository,
    uid: string,
    email: string
): Promise<string> {
    const normalized = normalizeEmail(email);
    // The same 409 `POST /users` and registration give. Both engines also map
    // the unique index behind it, which covers the race; the check is what
    // answers for a custom repository that does not — unchecked, a plain
    // collision was a 500.
    const holder = await authRepo.getUserByEmail(normalized);
    if (holder && holder.id !== uid) {
        throw ApiError.conflict("Email already registered", "EMAIL_EXISTS");
    }
    return normalized;
}

/**
 * Run `afterUserDelete` without letting it fail the deletion it follows: the
 * user is already gone, so a failing listener is logged, not answered.
 */
export function runAfterUserDelete(resolvedHooks: ResolvedAuthHooks, uid: string): void {
    if (!resolvedHooks.afterUserDelete) return;
    resolvedHooks.afterUserDelete(uid).catch(err => {
        logger.error("[AuthHooks] afterUserDelete error", {
            error: err instanceof Error ? err.message : err
        });
    });
}

/**
 * The auth adapter's side of user administration through the auth collection
 * (`AuthAdapter.prepareUserUpdates` and the deletion pair): the admin user
 * routes' rules and hooks, for the data API's writes to the same rows.
 */
export function authCollectionUserAdmin(ctx: {
    authRepo: AuthRepository;
    resolvedHooks: ResolvedAuthHooks;
}): Required<Pick<AuthAdapter, "prepareUserUpdates" | "prepareUserDeletions" | "finalizeUserDeletions">> {
    const { authRepo, resolvedHooks } = ctx;
    return {
        async prepareUserUpdates(updates) {
            await assertRoleChangesAllowed(
                authRepo,
                updates.flatMap(({ uid, values }) => Array.isArray(values.roles) ? [{ uid, roles: values.roles }] : [])
            );
            const prepared: Record<string, unknown>[] = [];
            for (const { uid, values } of updates) {
                prepared.push(typeof values.email === "string"
                    ? { ...values, email: await normalizeUserEmailChange(authRepo, uid, values.email) }
                    : values);
            }
            return prepared;
        },

        async prepareUserDeletions(uids) {
            await assertUserDeletionsAllowed(authRepo, uids);
            // Throws to prevent the deletion — before any row goes.
            if (resolvedHooks.beforeUserDelete) {
                for (const uid of uids) await resolvedHooks.beforeUserDelete(uid);
            }
        },

        async finalizeUserDeletions(uids) {
            for (const uid of uids) {
                // The sessions end with the account on every engine, not only
                // where the refresh tokens cascade with the row.
                await authRepo.deleteAllRefreshTokensForUser(uid);
                runAfterUserDelete(resolvedHooks, uid);
            }
        }
    };
}
