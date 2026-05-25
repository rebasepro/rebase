/**
 * AuthOverrides
 *
 * Override specific behaviors of the built-in Rebase auth system.
 *
 * Each method replaces one piece of the default implementation.
 * Unset methods fall through to the built-in defaults (scrypt passwords,
 * standard validation rules, etc.).
 *
 * This interface is intentionally open for extension — new overrides
 * can be added as optional methods without breaking existing configurations.
 *
 * @example bcrypt password support for a legacy database
 * ```ts
 * import bcrypt from "bcrypt";
 *
 * const overrides: AuthOverrides = {
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
 * const overrides: AuthOverrides = {
 *     verifyCredentials: async (email, password, repo) => {
 *         const user = await repo.getUserByEmail(email);
 *         if (!user || !user.passwordHash) return null;
 *         const valid = await myLegacyVerify(password, user.passwordHash);
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
import type { AuthRepository, UserData, CreateUserData } from "./interfaces";

/**
 * Authentication method identifier for lifecycle hooks.
 */
export type AuthMethod = "login" | "register" | "oauth" | "refresh" | "password-reset";

/**
 * Override specific parts of the built-in Rebase auth implementation.
 *
 * Every method is optional. The built-in defaults apply for any method
 * that is not provided.
 */
export interface AuthOverrides {
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
     * Called after any successful authentication event (login, register,
     * OAuth, token refresh, password reset).
     *
     * Use for audit logging, syncing external state, updating
     * last-login timestamps, etc.
     *
     * This is fire-and-forget — errors are logged but do not fail the request.
     */
    onAuthenticated?(user: UserData, method: AuthMethod): Promise<void>;

    /**
     * Called before a new user is created (registration or admin creation).
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
}

/**
 * Resolved auth operations — every method is guaranteed to exist.
 * Created by `resolveAuthOverrides()` which merges user overrides
 * with built-in defaults.
 */
export interface ResolvedAuthOperations {
    hashPassword(password: string): Promise<string>;
    verifyPassword(password: string, storedHash: string): Promise<boolean>;
    validatePasswordStrength(password: string): PasswordValidationResult;
}

/**
 * Merge user-provided overrides with the built-in defaults to produce
 * a complete set of resolved operations.
 *
 * This is the single point where defaults are applied — all consumers
 * call this once and use the resolved operations throughout.
 */
export function resolveAuthOverrides(overrides?: AuthOverrides): ResolvedAuthOperations {
    return {
        hashPassword: overrides?.hashPassword
            ?? defaultHashPassword,

        verifyPassword: overrides?.verifyPassword
            ?? defaultVerifyPassword,

        validatePasswordStrength: overrides?.validatePasswordStrength
            ?? defaultValidatePasswordStrength,
    };
}
