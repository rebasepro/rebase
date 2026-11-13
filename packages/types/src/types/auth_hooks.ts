/**
 * What the user store's auth hooks (`defineAuthTable`'s `onCreateUser` /
 * `onResetPassword`) receive and return.
 *
 * @module
 */
import type { EmailSendResult } from "../controllers/email";

/**
 * Context provided to collection-level auth hooks.
 *
 * This is a simplified facade over the server internals —
 * it exposes only what's needed for custom auth flows without
 * coupling collection config to internal interfaces.
 *
 * @group Models
 */
export interface AuthCollectionContext {
    /** Hash a password using the configured algorithm (scrypt by default). */
    hashPassword: (password: string) => Promise<string>;
    /**
     * Send an email. Only available when email service is configured.
     *
     * Resolves with what the provider reported — the assigned Message-ID, most
     * usefully — so a hook that sends a message can store the id and later
     * thread a reply back to it. Callers that do not care may ignore it.
     */
    sendEmail?: (options: { to: string; subject: string; html: string; text?: string }) => Promise<EmailSendResult>;
    /** Whether the email service is configured and available. */
    emailConfigured: boolean;
    /** The app name from email config (for templates). */
    appName: string;
    /** The base URL for password reset links. */
    resetPasswordUrl: string;
}

/**
 * Result of a collection-level `onCreateUser` hook.
 * @group Models
 */
export interface AuthCollectionCreateResult {
    /** Processed values to persist (must include passwordHash, NOT raw password). */
    values: Record<string, unknown>;
    /** If set, shown to the admin in the creation result dialog. */
    temporaryPassword?: string;
    /** Whether an invitation email was sent. */
    invitationSent?: boolean;
}

/**
 * Result of a collection-level `onResetPassword` hook.
 * @group Models
 */
export interface AuthCollectionResetResult {
    /**
     * The account's new password. Rebase hashes and saves it, then shows it to
     * the admin; leave it unset when the account keeps its password for now
     * (for example, because the hook emailed a link).
     */
    temporaryPassword?: string;
    /** Whether a reset email was sent. */
    invitationSent?: boolean;
}
