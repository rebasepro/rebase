/**
 * Email service types — portable interface shared by RebaseClient and server-core.
 *
 * The concrete SMTP implementation lives in `@rebasepro/server-core/email`.
 * This file provides only the consumer-facing contract so that it can be
 * referenced from `RebaseClient` without dragging in nodemailer.
 */

/**
 * Options for sending an email via the Rebase email service.
 */
export interface EmailSendOptions {
    /** Recipient email address(es). */
    to: string | string[];
    /** Email subject line. */
    subject: string;
    /** HTML body content. */
    html: string;
    /** Optional plain-text fallback. */
    text?: string;
    /** Optional reply-to address. */
    replyTo?: string;
}

/**
 * Abstraction over an email delivery backend.
 *
 * Implementations may use SMTP, AWS SES, Resend, Postmark, or any other
 * provider — consumers only interact through this interface.
 */
export interface EmailService {
    /** Send a single email. */
    send(options: EmailSendOptions): Promise<void>;
    /** Returns `true` when the service has valid credentials / is ready to send. */
    isConfigured(): boolean;
    /** Verify connection/credentials with the email provider. */
    verifyConnection?(): Promise<boolean>;
}
