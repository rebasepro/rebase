/**
 * Email service types — portable interface shared by RebaseClient and server.
 *
 * The concrete SMTP implementation lives in `@rebasepro/server/email`.
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
    /**
     * Additional headers, verbatim.
     *
     * The reason this exists is that several things a real sender must do are
     * only expressible as headers, and without a passthrough an application had
     * to choose between not doing them and not using this interface:
     *
     * - `List-Unsubscribe` and `List-Unsubscribe-Post`, which give a mail client
     *   its own one-click opt-out. The large providers weigh their presence when
     *   deciding whether bulk mail reaches an inbox at all.
     * - `In-Reply-To` and `References`, without which a reply is a new thread.
     *
     * **Values are validated, not escaped.** A value containing CR or LF is
     * rejected rather than sanitised, because a newline in a header value ends
     * the header and starts a new one — so a field built from user input is an
     * injection point for `Bcc:` and anything else. Rejecting is the only safe
     * response: silently stripping the newline would deliver a message the
     * caller did not write, and neither would tell them.
     */
    headers?: Record<string, string>;
}

/**
 * What the provider reported about a message it accepted.
 *
 * Every field is optional because not every backend reports them: a custom
 * `sendEmail` function that posts to an HTTP API may know nothing beyond "no
 * error". An absent `messageId` therefore means "not reported", never "not
 * sent" — the absence of an id is not a delivery failure, which is signalled by
 * a thrown error.
 */
export interface EmailSendResult {
    /**
     * The message's RFC 5322 Message-ID, **without** angle brackets.
     *
     * Stripped because this is an identifier to store and compare — against a
     * reply's `In-Reply-To`, most often — and a value that sometimes carries
     * brackets and sometimes does not is a bug waiting in every comparison.
     * Re-add them when writing it into a header: `<${messageId}>`.
     */
    messageId?: string;
    /** Recipients the provider accepted, when it says. */
    accepted?: string[];
    /** Recipients the provider refused, when it says. A non-empty list is not an error. */
    rejected?: string[];
}

/**
 * Abstraction over an email delivery backend.
 *
 * Implementations may use SMTP, AWS SES, Resend, Postmark, or any other
 * provider — consumers only interact through this interface.
 */
export interface EmailService {
    /**
     * Send a single email.
     *
     * Resolves with what the provider reported (see {@link EmailSendResult});
     * throws on failure. It returned `void` before 0.17: an application that
     * sent a message had no way to learn the id the server assigned it, so
     * threading a reply back to the message that prompted it was impossible
     * through this interface. Callers that do not care may still ignore it.
     */
    send(options: EmailSendOptions): Promise<EmailSendResult>;
    /** Returns `true` when the service has valid credentials / is ready to send. */
    isConfigured(): boolean;
    /** Verify connection/credentials with the email provider. */
    verifyConnection?(): Promise<boolean>;
}
