/**
 * The development mail sink: what happens to auth email when no SMTP is set.
 *
 * ## Why this exists
 *
 * Three routes refused to work without a mail server — `POST /auth/magic-link`,
 * `POST /auth/forgot-password` and the verification resend — each answering
 * `503 EMAIL_NOT_CONFIGURED`. So the first thing a new project could not do was
 * log in, and the fix was to go and find an SMTP host. The token was never the
 * problem: it is minted, stored and valid. Only the delivery was missing.
 *
 * With this, delivery is the terminal. The message is captured and its links
 * are printed, so a developer follows the link from the log and the flow
 * completes end to end on minute one, with no account anywhere.
 *
 * ## Why it cannot reach production
 *
 * A captured password-reset mail contains a working reset token. Anything that
 * writes those to a log or holds them in memory is a credential store, so the
 * sink is wired only by {@link resolveEmailOptions}, only when `NODE_ENV` is not
 * `production`, and it says loudly what it is on first use. There is no
 * configuration that turns it on in production, deliberately: an operator who
 * wants mail in production wants a mail server, not a ring buffer.
 *
 * The buffer is also capped and in-process. It is a development convenience, not
 * a mailbox — a restart empties it, and nothing persists it.
 */
import type { EmailSendOptions, EmailSendResult } from "./types";
import { logger } from "../utils/logger";

/** How many messages the ring buffer keeps before dropping the oldest. */
const DEFAULT_CAPACITY = 50;

export interface CapturedEmail {
    /** Monotonic within a process. Not stable across restarts. */
    id: number;
    /**
     * The synthetic Message-ID this sink reported to the caller.
     *
     * Real, in the sense that it is what `send()` returned and what an
     * application will have stored — so a flow that threads a reply against it
     * behaves the same here as against a mail server, which is the entire point
     * of the sink.
     */
    messageId: string;
    at: string;
    to: string;
    subject: string;
    html?: string;
    text?: string;
    /**
     * The absolute links found in the message, in document order.
     *
     * Extracted because this is the only part anyone needs: every auth mail
     * exists to carry one URL, and reading it out of an HTML body in a terminal
     * is miserable.
     */
    links: string[];
}

export interface DevEmailSink {
    /** Drop-in for `EmailConfig.sendEmail`. */
    sendEmail: (options: EmailSendOptions) => Promise<EmailSendResult>;
    /** Most recent first. */
    list: () => CapturedEmail[];
    clear: () => void;
}

/**
 * Absolute http(s) URLs in a message body.
 *
 * Deliberately simple: it reads `href="…"` first, because that is where a real
 * link lives, and falls back to bare URLs in the text part. Trailing markup and
 * punctuation are trimmed so the result can be pasted straight into a browser.
 */
export function extractLinks(html: string | undefined, text: string | undefined): string[] {
    const found: string[] = [];
    const push = (url: string) => {
        const cleaned = url.replace(/[)\]}>.,;'"]+$/, "");
        if (cleaned && !found.includes(cleaned)) found.push(cleaned);
    };

    if (html) {
        for (const match of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
            push(match[1]);
        }
    }
    if (text) {
        for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
            push(match[0]);
        }
    }
    return found;
}

/** Whatever `to` was given as, rendered for a log line. */
const formatRecipient = (to: EmailSendOptions["to"]): string =>
    Array.isArray(to) ? to.join(", ") : to;

/**
 * Create a sink. Each call is independent, which is what lets a test hold one
 * without touching whatever the process is using.
 */
export function createDevEmailSink(options: { capacity?: number } = {}): DevEmailSink {
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    const messages: CapturedEmail[] = [];
    let nextId = 1;
    let announced = false;

    const sendEmail = async (mail: EmailSendOptions): Promise<EmailSendResult> => {
        const id = nextId++;
        const captured: CapturedEmail = {
            id,
            // Shaped like a real one and unique per process, so code that
            // stores it and later matches a reply against it exercises the same
            // path in development as in production.
            messageId: `${id}.${Date.now()}.dev-sink@rebase.local`,
            at: new Date().toISOString(),
            to: formatRecipient(mail.to),
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            links: extractLinks(mail.html, mail.text)
        };

        messages.unshift(captured);
        if (messages.length > capacity) messages.length = capacity;

        // Said once, not per message: the first mail is where someone learns
        // that nothing was delivered, and repeating it every time would bury
        // the links this exists to show.
        if (!announced) {
            announced = true;
            logger.warn(
                "No SMTP is configured, so auth email is being captured here instead of sent. " +
                "Follow the link below to complete the flow. Set SMTP_HOST to deliver mail for real; " +
                "this sink is unavailable when NODE_ENV=production."
            );
        }

        // One line per link rather than the body: the body is an HTML email.
        logger.info(
            `[email] ${captured.subject} → ${captured.to}` +
            (captured.links.length
                ? `\n         ${captured.links.join("\n         ")}`
                : "\n         (no links in this message)")
        );

        return { messageId: captured.messageId, accepted: [captured.to] };
    };

    return {
        sendEmail,
        list: () => [...messages],
        clear: () => {
            messages.length = 0;
        }
    };
}
