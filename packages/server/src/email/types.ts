/**
 * Email service types and interfaces.
 *
 * The canonical `EmailService` and `EmailSendOptions` live in `@rebasepro/types`
 * so they can be used on the `RebaseClient` interface without pulling in nodemailer.
 * This file re-exports them for backward compatibility and adds server-specific
 * config types (SMTP, template functions, etc.).
 */

import type { EmailService, EmailSendOptions } from "@rebasepro/types";

export type { EmailService, EmailSendOptions };

/**
 * SMTP server configuration
 */
export interface SMTPConfig {
    host: string;
    port: number;
    secure?: boolean;
    auth?: {
        user: string;
        pass: string;
    };
    name?: string;
}

/**
 * Template function for password reset emails
 */
export type PasswordResetTemplateFunction = (
    resetUrl: string,
    user: { email: string; displayName?: string | null }
) => { subject: string; html: string; text?: string };

/**
 * Template function for email verification emails
 */
export type EmailVerificationTemplateFunction = (
    verifyUrl: string,
    user: { email: string; displayName?: string | null }
) => { subject: string; html: string; text?: string };

/**
 * Template function for user invitation emails
 */
export type UserInvitationTemplateFunction = (
    setPasswordUrl: string,
    user: { email: string; displayName?: string | null }
) => { subject: string; html: string; text?: string };

/**
 * Template function for welcome emails sent after registration
 */
export type WelcomeEmailTemplateFunction = (
    user: { email: string; displayName?: string | null },
    appName: string
) => { subject: string; html: string; text?: string };

/**
 * Template function for magic link emails
 */
export type MagicLinkTemplateFunction = (
    magicLinkUrl: string,
    user: { email: string; displayName?: string | null }
) => { subject: string; html: string; text?: string };

/**
 * Complete email configuration
 */
export interface EmailConfig {
    /**
     * From address for all emails (e.g., "noreply@example.com" or "MyApp <noreply@example.com>")
     */
    from: string;

    /**
     * SMTP configuration for sending emails via SMTP server
     */
    smtp?: SMTPConfig;

    /**
     * Alternative: custom function to send emails
     * Use this for custom email providers (AWS SES SDK, Resend, etc.)
     */
    sendEmail?: (options: EmailSendOptions) => Promise<void>;

    /**
     * Base URL for password reset links (e.g., "https://myapp.com")
     * The reset link will be: {baseUrl}/reset-password?token={token}
     *
     * Must be absolute: mail clients have no base document to resolve a relative
     * href against. `createEmailService` refuses to start when email is
     * configured and no absolute base URL can be resolved.
     */
    resetPasswordUrl?: string;

    /**
     * Base URL for email verification links (e.g., "https://myapp.com")
     * The verification link will be: {baseUrl}/verify-email?token={token}
     * Falls back to `resetPasswordUrl` if not set.
     */
    verifyEmailUrl?: string;

    /**
     * Base URL for magic link login (e.g., "https://myapp.com")
     * The magic link will be: {baseUrl}/auth/magic-link?token={token}
     * Falls back to `resetPasswordUrl` if not set.
     */
    magicLinkUrl?: string;

    /**
     * Application name to use in email templates
     */
    appName?: string;

    /**
     * Custom email templates (optional - defaults are provided).
     *
     * A template receives `user.displayName` exactly as the account was
     * registered with it — user input, markup and all. Build the HTML with the
     * `html` tagged template exported from `@rebasepro/server`, which escapes
     * every interpolation, rather than a plain template literal.
     */
    templates?: {
        passwordReset?: PasswordResetTemplateFunction;
        emailVerification?: EmailVerificationTemplateFunction;
        userInvitation?: UserInvitationTemplateFunction;
        welcomeEmail?: WelcomeEmailTemplateFunction;
        magicLink?: MagicLinkTemplateFunction;
    };
}
