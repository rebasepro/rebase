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

/** Connections a burst of mail may hold open at once, unless `smtp.maxConnections` says otherwise. */
const DEFAULT_MAX_CONNECTIONS = 5;

/**
 * How long the connection pool may sit unused before it is closed.
 *
 * Long enough that a burst — a team invited at once, a `Promise.all` over
 * `email.send` — reuses its connections; short enough that a quiet server
 * holds no socket open to the provider, and that a script which sends one
 * message and finishes is not kept alive by an idle connection for the ten
 * minutes nodemailer would otherwise wait.
 */
const POOL_IDLE_CLOSE_MS = 5_000;

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
    /**
     * The transporter being built, shared by every send that arrives while it
     * is.
     *
     * A flag set before the `await` said "initialised" while nodemailer was
     * still loading, so a second send in that window found no transporter and
     * threw "Email service not configured" — the first burst of mail after a
     * boot lost every message but one. Every caller awaits this one promise
     * instead. Cleared on failure, so one bad moment is not remembered for the
     * life of the process.
     */
    private transporterReady: Promise<void> | null = null;
    /** Sends between their start and their end — the pool is never closed under one. */
    private sending = 0;
    /** Closes the pool once it has been unused for {@link POOL_IDLE_CLOSE_MS}. */
    private idleTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(config: EmailConfig) {
        this.config = config;
    }

    /**
     * Lazily initialize the SMTP transporter on first use
     */
    private ensureTransporter(): Promise<void> {
        if (!this.transporterReady) {
            this.transporterReady = this.buildTransporter().catch((error: unknown) => {
                this.transporterReady = null;
                throw error;
            });
        }
        return this.transporterReady;
    }

    private async buildTransporter(): Promise<void> {
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

            // Pooled. Without it nodemailer opens a new connection for every
            // message — TCP, greeting, EHLO, STARTTLS and AUTH again each time —
            // and a burst of fifty opens fifty at once, which a provider that
            // caps connections per mailbox answers with 4xx refusals the
            // caller sees as failed sends. The pool queues past
            // `maxConnections` instead, and is closed when idle.
            this.transporter = nodemailer.createTransport({
                pool: true,
                maxConnections: this.config.smtp.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
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

        // Use SMTP transporter. Counted from before the transporter is built,
        // so the idle close can never land between building it and using it.
        this.sending++;
        clearTimeout(this.idleTimer);
        try {
            return await this.sendOverSmtp(options);
        } finally {
            this.sending--;
            this.closeWhenIdle();
        }
    }

    private async sendOverSmtp(options: EmailSendOptions): Promise<EmailSendResult> {
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

    /** Arm the idle close once nothing is sending. */
    private closeWhenIdle(): void {
        if (this.sending > 0 || !this.transporter) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            if (this.sending === 0) this.releaseTransporter();
        }, POOL_IDLE_CLOSE_MS);
        this.idleTimer.unref?.();
    }

    /**
     * Close the pool and forget it; the next send builds a fresh one. A closed
     * nodemailer pool accepts nothing more, so it cannot be kept and reused.
     */
    private releaseTransporter(): void {
        const transporter = this.transporter;
        this.transporter = null;
        this.transporterReady = null;
        transporter?.close?.();
    }

    /**
     * Close the connection pool now, rather than when it next goes idle — for
     * a shutdown. A send after this opens a new pool.
     */
    close(): void {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
        if (this.sending === 0) this.releaseTransporter();
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
