/**
 * AuthHooks
 *
 * Customize specific behaviors of the built-in Rebase auth system.
 *
 * Each method replaces one piece of the default implementation.
 * Unset methods fall through to the built-in defaults (scrypt passwords,
 * standard validation rules, etc.).
 *
 * This interface is intentionally open for extension — new hooks
 * can be added as optional methods without breaking existing configurations.
 *
 * @example bcrypt password support
 * ```ts
 * import bcrypt from "bcrypt";
 *
 * const hooks: AuthHooks = {
 *     hashPassword: (pw) => bcrypt.hash(pw, 12),
 *     verifyPassword: (pw, hash) => bcrypt.compare(pw, hash),
 *     validatePasswordStrength: (pw) => ({
 *         valid: pw.length >= 6,
 *         errors: pw.length < 6 ? ["Password must be at least 6 characters"] : []
 *     })
 * };
 * ```
 *
 * @example Override the entire login credential check
 * ```ts
 * const hooks: AuthHooks = {
 *     verifyCredentials: async (email, password, repo) => {
 *         const user = await repo.getUserByEmail(email);
 *         if (!user || !user.passwordHash) return null;
 *         const valid = await myCustomVerify(password, user.passwordHash);
 *         return valid ? user : null;
 *     }
 * };
 * ```
 */

import {
    hashPassword as defaultHashPassword,
    verifyPassword as defaultVerifyPassword,
    validatePasswordStrength as defaultValidatePasswordStrength
} from "./password";
import type { PasswordValidationResult } from "./password";
import { ApiError } from "../api/errors";
import type { AuthRepository, UserData, CreateUserData } from "./interfaces";
import type { EmailService, EmailConfig } from "../email";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";

/**
 * Authentication method identifier for lifecycle hooks.
 */
export type AuthMethod = "login" | "register" | "oauth" | "refresh" | "password-reset" | "anonymous" | "magic-link" | "otp" | "mfa";

/**
 * Hook specific parts of the built-in Rebase auth implementation.
 *
 * Every method is optional. The built-in defaults apply for any method
 * that is not provided.
 */
export interface AuthHooks {
    // ─── Password Operations ──────────────────────────────────────────────

    /**
     * Hash a cleartext password for storage.
     *
     * Default: scrypt (Node.js crypto, 64-byte key, random 32-byte salt).
     *
     * @param password - The cleartext password.
     * @returns The hashed password string (format is implementation-defined).
     */
    hashPassword?(password: string): Promise<string>;

    /**
     * Verify a cleartext password against a stored hash.
     *
     * Default: scrypt verification with timing-safe comparison.
     *
     * @param password - The cleartext password to check.
     * @param storedHash - The hash string retrieved from the database.
     * @returns `true` if the password matches the hash.
     */
    verifyPassword?(password: string, storedHash: string): Promise<boolean>;

    /**
     * Validate password strength before hashing.
     *
     * Default: minimum 8 characters, at least one uppercase, one lowercase, one digit.
     *
     * @param password - The cleartext password to validate.
     * @returns Validation result with `valid` flag and error messages.
     */
    validatePasswordStrength?(password: string): PasswordValidationResult;

    // ─── Credential Resolution ────────────────────────────────────────────

    /**
     * Override the complete credential verification during email/password login.
     *
     * When set, this replaces the default flow:
     *   1. Look up user by email
     *   2. Verify password hash
     *
     * The auth repository is provided for database access. Return the user
     * data if credentials are valid, or `null` to reject the login.
     *
     * Default: `getUserByEmail(email)` + `verifyPassword(password, user.passwordHash)`.
     */
    verifyCredentials?(email: string, password: string, repo: AuthRepository): Promise<UserData | null>;

    // ─── Lifecycle Hooks ──────────────────────────────────────────────────

    /**
     * Called after any successful authentication event: password login
     * (`login`), registration (`register`), an OAuth sign-in (`oauth`), a
     * token refresh (`refresh`), a password reset (`password-reset`), a
     * guest session (`anonymous`), a magic link (`magic-link`), an email code
     * (`otp`) and a second factor (`mfa`). Every value of {@link AuthMethod}
     * is passed by some route.
     *
     * Use for audit logging, syncing external state, updating
     * last-login timestamps, etc.
     *
     * This is fire-and-forget — errors are logged but do not fail the request.
     */
    onAuthenticated?(user: UserData, method: AuthMethod): Promise<void>;

    /**
     * Called before a new user is created: registration, an OAuth sign-in
     * that creates the account, a guest, and admin creation.
     *
     * Throw to refuse: the caller gets 400 `HOOK_REJECTED` with your message,
     * or the status your error carries (`ApiError`, or a 4xx `status`).
     *
     * Also called when a guest becomes an account through
     * `POST /auth/anonymous/link`, with the email and password hash it is
     * getting; the guest itself was created with `isAnonymous: true`.
     *
     * Return modified data to alter what gets stored, or throw an error
     * to reject the creation entirely.
     *
     * Default: passthrough (returns data unchanged).
     */
    beforeUserCreate?(data: CreateUserData): Promise<CreateUserData>;

    /**
     * Called after a new user is created.
     *
     * Use for provisioning external resources, sending notifications
     * to third-party systems, etc.
     *
     * This is fire-and-forget — errors are logged but do not fail the request.
     */
    afterUserCreate?(user: UserData): Promise<void>;

    // ─── Extended Lifecycle Hooks ─────────────────────────────────────────

    /**
     * Pre-login validation. Called before credential verification on every
     * sign-in: password (`login`), OAuth (`oauth`, with the provider's
     * address), and the requests for a magic link (`magic-link`) or an email
     * code (`otp`). Not on a token refresh, which is not a sign-in.
     *
     * Throw to refuse: 400 `HOOK_REJECTED` with your message, or the status
     * your error carries.
     */
    beforeLogin?(email: string, method: AuthMethod): Promise<void>;

    /**
     * Post-logout cleanup.
     *
     * Called after a user's session has been invalidated.
     * Use for audit logging, cleanup of temporary resources, etc.
     *
     * This is fire-and-forget — errors are logged but do not fail the request.
     */
    afterLogout?(uid: string): Promise<void>;

    /**
     * Called after successful MFA verification.
     *
     * Use for audit logging, notifying external systems, etc.
     *
     * This is fire-and-forget — errors are logged but do not fail the request.
     */
    onMfaVerified?(uid: string, factorId: string): Promise<void>;

    /**
     * Customize JWT access token claims before signing.
     *
     * Return the modified claims object. The returned claims are merged into
     * the JWT payload BESIDE the identity claims, never over them: `uid`,
     * `roles` and `aal` are written last and a value returned for any of them
     * is discarded.
     *
     * That is not a limitation of the hook, it is what keeps it safe to have.
     * `uid` is who the whole request is — down to the identity the database
     * evaluates its policies against — `roles` is what the admin gate reads,
     * and `aal` is whether a second factor was actually passed. The obvious
     * implementation of this hook spreads the claims it was handed and adds a
     * field, and one that merges a user-controlled profile object returns
     * whatever that object happened to contain. Add facts about a session
     * here; the session's subject is decided by the server.
     *
     * @param claims - The default claims that would be included.
     * @param user - The authenticated user data.
     * @returns Modified claims to include in the JWT.
     */
    customizeAccessToken?(claims: Record<string, unknown>, user: UserData): Promise<Record<string, unknown>>;

    /**
     * Transform the auth response before sending it to the client.
     *
     * Called after successful login, register, refresh, OAuth, anonymous,
     * magic-link, and MFA flows. The hook receives the fully-formed
     * response and returns a (potentially enriched) response.
     *
     * Use cases:
     * - Inject tokens from external auth systems (custom provider tokens, etc.)
     * - Add project-specific metadata to the response
     * - Enrich the user object with data from external sources
     *
     * The hook runs in the request path — keep it fast.
     * Heavy work should be offloaded to `onAuthenticated` (fire-and-forget).
     */
    transformAuthResponse?(
        response: AuthResponsePayload,
        context: TransformAuthResponseContext
    ): Promise<AuthResponsePayload>;

    /**
     * Called after a successful password reset.
     *
     * Use for audit logging, sending confirmation notifications, etc.
     *
     * This is fire-and-forget — errors are logged but do not fail the request.
     */
    onPasswordReset?(uid: string): Promise<void>;

    /**
     * Called before a user is deleted.
     *
     * Throw an error to prevent deletion (e.g. for users with active
     * subscriptions, pending transactions, etc.).
     */
    beforeUserDelete?(uid: string): Promise<void>;

    /**
     * Called after a user is deleted.
     *
     * Use for cleaning up external resources, audit logging, etc.
     *
     * This is fire-and-forget — errors are logged but do not fail the request.
     */
    afterUserDelete?(uid: string): Promise<void>;

    /**
     * Optional hook to customize or override the default user creation flow via the admin panel/REST API.
     * When provided, this replaces the built-in password generation, hashing, and invitation email logic.
     */
    onAdminCreateUser?(
        values: Record<string, unknown>,
        ctx: {
            authRepo: AuthRepository;
            emailService?: EmailService;
            emailConfig?: EmailConfig;
            hashPassword: (password: string) => Promise<string>;
        }
    ): Promise<{
        values: Record<string, unknown>;
        temporaryPassword?: string;
        invitationSent?: boolean;
    }>;

    /**
     * Optional hook to customize or override the default password reset flow via the admin panel.
     * When provided, this replaces the built-in password reset token generation, hashing, and email logic.
     *
     * A `temporaryPassword` it returns becomes the account's password: the route hashes and writes
     * it (the same contract as a collection's `auth.onResetPassword`), so the hook need not write it
     * through `authRepo`. The account's existing sessions end whatever the hook returns.
     */
    onAdminResetPassword?(
        uid: string,
        ctx: {
            authRepo: AuthRepository;
            emailService?: EmailService;
            emailConfig?: EmailConfig;
        }
    ): Promise<{
        temporaryPassword?: string;
        invitationSent?: boolean;
    }>;
}

/**
 * Resolved auth hooks — password operations are guaranteed to exist,
 * all other hooks are passed through as-is (optional).
 *
 * Created by `resolveAuthHooks()` which merges user hooks
 * with built-in defaults.
 *
 * Consumers should use the resolved object exclusively —
 * never access the raw `AuthHooks` directly.
 */
export type ResolvedAuthHooks =
    Required<Pick<AuthHooks, "hashPassword" | "verifyPassword" | "validatePasswordStrength">>
    & Omit<AuthHooks, "hashPassword" | "verifyPassword" | "validatePasswordStrength">;

/**
 * Merge user-provided hooks with the built-in defaults to produce
 * a complete set of resolved hooks.
 *
 * This is the single point where defaults are applied — all consumers
 * call this once and use the resolved hooks throughout.
 */
/**
 * What a hook's thrown error answers.
 *
 * The hooks that refuse (`beforeUserCreate`, `beforeLogin`,
 * `beforeUserDelete`) are documented as "throw to reject", and a plain
 * `Error` is what people throw. It reached the error handler as a 500
 * "Internal Server Error", so a deployment that limits sign-ups to its own
 * domain answered an outsider with a server fault. A refusal is the caller's
 * answer: 400 `HOOK_REJECTED` with the hook's message — or the status an
 * error carries, when the hook chose one (`ApiError`, or any error with a 4xx
 * `status`/`statusCode`).
 */
export function hookRefusal(error: unknown, hook: string): ApiError {
    if (error instanceof ApiError) return error;
    const carried = typeof error === "object" && error !== null
        ? ("statusCode" in error && typeof error.statusCode === "number" ? error.statusCode
            : "status" in error && typeof error.status === "number" ? error.status : undefined)
        : undefined;
    const status = carried !== undefined && carried >= 400 && carried < 500 ? carried : 400;
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(error.code)
        ? error.code
        : "HOOK_REJECTED";
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : `${hook} refused the request`;
    return new ApiError(status, code, message, { hook });
}

/** A refusing hook whose throw answers as {@link hookRefusal} says. */
function refusable<A extends unknown[], R>(hook: string, fn: ((...args: A) => Promise<R>) | undefined): ((...args: A) => Promise<R>) | undefined {
    if (!fn) return undefined;
    return async (...args: A) => {
        try {
            return await fn(...args);
        } catch (error) {
            throw hookRefusal(error, hook);
        }
    };
}

export function resolveAuthHooks(hooks?: AuthHooks): ResolvedAuthHooks {
    return {
        ...hooks,

        // Every door calls these through the resolved hooks, so a refusal
        // answers the same on all of them.
        beforeUserCreate: refusable("beforeUserCreate", hooks?.beforeUserCreate?.bind(hooks)),
        beforeLogin: refusable("beforeLogin", hooks?.beforeLogin?.bind(hooks)),
        beforeUserDelete: refusable("beforeUserDelete", hooks?.beforeUserDelete?.bind(hooks)),

        hashPassword: hooks?.hashPassword
            ?? defaultHashPassword,

        verifyPassword: hooks?.verifyPassword
            ?? defaultVerifyPassword,

        validatePasswordStrength: hooks?.validatePasswordStrength
            ?? defaultValidatePasswordStrength
    };
}
