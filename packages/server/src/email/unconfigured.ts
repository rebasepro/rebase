import type { EmailSendOptions, EmailSendResult } from "./types";
import type { EmailService } from "@rebasepro/types";

/**
 * What `rebase.email` is when nothing configured mail.
 *
 * `RebaseServerClient` declares `email: EmailService` — not optional — and until
 * now the property was simply absent whenever the backend booted without
 * `auth.email`. So a cron job or a custom function written against the type
 * compiled, deployed, and died on `Cannot read properties of undefined (reading
 * 'send')`: a stack trace naming a language feature rather than the thing that
 * was not set up. The message below names it.
 *
 * Not a no-op sender, which is what the type's docstring used to claim. A no-op
 * would swallow the reset mail a user is waiting for and report success; nothing
 * downstream could tell that from delivery. Failing is the only honest answer,
 * and the failure is legible.
 *
 * `isConfigured()` is `false`, so the auth routes that already check it keep
 * answering `503 EMAIL_NOT_CONFIGURED` rather than reaching this and throwing.
 */
export function createUnconfiguredEmailService(): EmailService {
    const explain = () =>
        "Email service not configured. Set SMTP_HOST (with SMTP_PORT, SMTP_USER, SMTP_PASS " +
        "as your provider requires), or pass `auth.email` to initializeRebaseBackend. " +
        "Outside production, an absolute FRONTEND_URL alone gets you the development sink, " +
        "which captures mail and prints its links.";

    return {
        async send(_options: EmailSendOptions): Promise<EmailSendResult> {
            throw new Error(explain());
        },
        isConfigured(): boolean {
            return false;
        },
        async verifyConnection(): Promise<boolean> {
            return false;
        }
    };
}
