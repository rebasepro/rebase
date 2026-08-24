import type { Transporter } from "nodemailer";
import { EmailConfig, EmailSendOptions, EmailSendResult, EmailService } from "./types";
import { assertEmailLinkBases } from "./link-base";
import { logger } from "../utils/logger";

let _nodemailer: typeof import("nodemailer") | undefined;

async function loadNodemailer() {
    if (!_nodemailer) {
        try {
            _nodemailer = await import("nodemailer");
        } catch {
            throw new Error(
                "nodemailer is required for SMTP email. " +
                "Install it: pnpm add nodemailer"
            );
        }
    }
    return _nodemailer;
}

/**
 * Safely parse a hostname from a URL string
 */
function getHostname(urlStr: string): string | undefined {
    try {
        const url = new URL(urlStr.includes("://") ? urlStr : `https://${urlStr}`);
        return url.hostname;
    } catch {
        return undefined;
    }
}

/**
 * Reject a header value that would end its own header.
 *
 * A CR or LF inside a value terminates the header and starts a new one, so any
 * field assembled from data the sender did not write — a subject echoed back, a
 * name from a form — is an injection point for `Bcc:`, a replaced body, or a
 * second message entirely.
 *
 * It throws rather than stripping the newline, because stripping produces a
 * message the caller did not write and tells nobody, and because a caller
 * reaching this line has a bug worth seeing. The name is checked too: RFC 5322
 * limits it to printable ASCII other than colon, and nodemailer will happily
 * pass through whatever it is given.
 */
function assertSafeHeaders(headers: Record<string, string> | undefined): void {
    if (!headers) return;
    for (const [name, value] of Object.entries(headers)) {
        if (!/^[!-9;-~]+$/.test(name)) {
            throw new Error(`Invalid email header name ${JSON.stringify(name)}: expected printable ASCII without a colon.`);
        }
        if (/[\r\n]/.test(value)) {
            throw new Error(
                `Invalid value for email header "${name}": header values cannot contain CR or LF. `
                + "A newline here would end the header and begin another one."
            );
        }
    }
}

/** `<abc@host>` → `abc@host`. See EmailSendResult.messageId for why. */
function normalizeMessageId(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim().replace(/^<|>$/g, "").trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * SMTP Email Service implementation using Nodemailer
 */
export class SMTPEmailService implements EmailService {
    private transporter: Transporter | null = null;
    private config: EmailConfig;
    private _initialized = false;

    constructor(config: EmailConfig) {
        this.config = config;
    }

    /**
     * Lazily initialize the SMTP transporter on first use
     */
    private async ensureTransporter(): Promise<void> {
        if (this._initialized) return;
        this._initialized = true;

        if (this.config.smtp) {
            const nodemailer = await loadNodemailer();

            let smtpName = this.config.smtp.name;
            if (!smtpName) {
                const urlsToTry = [
                    process.env.FRONTEND_URL,
                    this.config.resetPasswordUrl,
                    this.config.verifyEmailUrl
                ];
                for (const urlStr of urlsToTry) {
                    if (urlStr) {
                        const hostname = getHostname(urlStr);
                        if (hostname) {
                            smtpName = hostname;
                            break;
                        }
                    }
                }
            }

            this.transporter = nodemailer.createTransport({
                name: smtpName,
                host: this.config.smtp.host,
                port: this.config.smtp.port,
                secure: this.config.smtp.secure ?? (this.config.smtp.port === 465),
                auth: this.config.smtp.auth ? {
                    user: this.config.smtp.auth.user,
                    pass: this.config.smtp.auth.pass
                } : undefined
            });
        }
    }

    /**
     * Check if the email service is properly configured
     */
    isConfigured(): boolean {
        return !!(this.config.smtp || this.config.sendEmail);
    }

    /**
     * Send an email using SMTP or custom send function
     */
    async send(options: EmailSendOptions): Promise<EmailSendResult> {
        // Validated before either path, so a custom `sendEmail` provider cannot
        // be handed a header its own client will splice into the message.
        assertSafeHeaders(options.headers);

        // Use custom send function if provided
        if (this.config.sendEmail) {
            // A custom provider may report nothing — it is typed to allow
            // `void` so that an existing `async () => {}` still satisfies it —
            // and "did not report an id" is a normal outcome, not a failure.
            const result = await this.config.sendEmail(options);
            return result ?? {};
        }

        // Use SMTP transporter
        await this.ensureTransporter();

        if (!this.transporter) {
            throw new Error("Email service not configured. Provide SMTP config or sendEmail function.");
        }

        const to = Array.isArray(options.to) ? options.to.join(", ") : options.to;

        try {
            const info = await this.transporter.sendMail({
                from: this.config.from,
                to,
                subject: options.subject,
                html: options.html,
                text: options.text,
                replyTo: options.replyTo,
                headers: options.headers
            });

            return {
                messageId: normalizeMessageId(info?.messageId),
                // Present on SMTP, absent on some transports. Passed through
                // as-is: a rejected recipient is the provider's report, not an
                // error, and the caller is the one who knows what to do with it.
                accepted: Array.isArray(info?.accepted) ? info.accepted.map(String) : undefined,
                rejected: Array.isArray(info?.rejected) ? info.rejected.map(String) : undefined
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error("Failed to send email", { detail: message });
            throw new Error(`Failed to send email: ${message}`);
        }
    }

    /**
     * Verify SMTP connection (useful for startup checks)
     */
    async verifyConnection(): Promise<boolean> {
        await this.ensureTransporter();

        if (!this.transporter) {
            return !!this.config.sendEmail;
        }

        try {
            await this.transporter.verify();
            return true;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error("SMTP connection verification failed", { detail: message });
            return false;
        }
    }
}

/**
 * Create an email service from configuration.
 *
 * This is the choke point every boot path goes through — the managed runtime,
 * both driver bootstrappers, and any app that passes `auth.email` — so it is
 * where the link bases are checked. A config that can send mail but cannot build
 * an absolute link fails the start rather than delivering dead `href="/…"` links
 * and reporting success; see `assertEmailLinkBases`.
 */
export function createEmailService(config: EmailConfig): EmailService {
    assertEmailLinkBases(config);
    return new SMTPEmailService(config);
}
