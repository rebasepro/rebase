import type { EmailConfig } from "./types";

/**
 * Resolution — and boot-time validation — of the base URL every emailed link is
 * built from.
 *
 * Each link kind used to read one config field and fall back to `""`, which
 * produces `href="/verify-email?token=…"`. A mail client has no base document to
 * resolve that against, so the link is inert: the route still answers
 * `{ success: true }`, the token is still minted and stored, and nothing in the
 * logs says anything is wrong. `verifyEmailUrl` in particular is set by no boot
 * path, so that was the *default* behaviour of email verification.
 *
 * Two changes: the fallback chains live here rather than being re-spelled at
 * each call site (only the magic-link route had one), and
 * {@link assertEmailLinkBases} refuses at boot when any link kind has no
 * absolute base. A configuration error that only ever shows up as "the link in
 * the email does nothing" is worth a failed start.
 */

/** Which link a base URL is being resolved for. */
export type EmailLinkKind = "resetPassword" | "verifyEmail" | "magicLink";

/**
 * The config fields consulted for each link kind, most specific first.
 *
 * `resetPasswordUrl` is the general fallback because it is the only one any boot
 * path sets, and in every real deployment all three point at the same frontend.
 */
const LINK_BASE_FIELDS: Record<EmailLinkKind, (keyof EmailConfig)[]> = {
    resetPassword: ["resetPasswordUrl"],
    verifyEmail: ["verifyEmailUrl", "resetPasswordUrl"],
    magicLink: ["magicLinkUrl", "resetPasswordUrl"]
};

/**
 * True when `value` is an absolute `http(s)` URL — the only kind a mail client
 * can follow. A protocol-relative or path-only base is treated as missing.
 */
function isAbsoluteHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/** Drop a trailing slash so callers can append `/verify-email?token=…`. */
function normalizeBase(value: string): string {
    return value.replace(/\/+$/, "");
}

/**
 * The absolute base URL for a link kind, or `""` when the config has none.
 *
 * Callers append their path to the result. `""` is only reachable on a config
 * that never went through {@link assertEmailLinkBases} — a hand-constructed
 * `SMTPEmailService` in a test, say — and is kept rather than thrown so that a
 * misconfiguration cannot turn a password-reset request into a 500 that
 * distinguishes existing accounts from missing ones.
 */
export function resolveEmailLinkBase(
    config: EmailConfig | undefined,
    kind: EmailLinkKind
): string {
    if (!config) return "";
    for (const field of LINK_BASE_FIELDS[kind]) {
        const value = config[field];
        if (typeof value === "string" && isAbsoluteHttpUrl(value)) {
            return normalizeBase(value);
        }
    }
    return "";
}

/**
 * Throw when an email configuration cannot produce a followable link of every
 * kind it sends.
 *
 * Called from `createEmailService`, i.e. from every boot path that wires email
 * up (the managed runtime, both driver bootstrappers, and any app that passes
 * `auth.email`). A base that is set but relative is reported separately from one
 * that is missing, because the two have different fixes.
 */
export function assertEmailLinkBases(config: EmailConfig): void {
    const relative = (["resetPasswordUrl", "verifyEmailUrl", "magicLinkUrl"] as const)
        .filter(field => typeof config[field] === "string" && config[field] !== "" && !isAbsoluteHttpUrl(config[field]!));

    if (relative.length > 0) {
        throw new Error(
            `Email is configured with a relative link base: ${relative.map(f => `email.${f}`).join(", ")}. ` +
            "Emailed links must be absolute (e.g. \"https://app.example.com\") — a mail client has no " +
            "base document to resolve a relative href against, so the link is dead."
        );
    }

    // Every kind, not any: the fallbacks run one way. Verification and magic
    // links fall back to `resetPasswordUrl`, and nothing falls back to them, so
    // a config with only `verifyEmailUrl` built good verification links and a
    // dead link in every password-reset and magic-link email.
    const unresolved = (Object.keys(LINK_BASE_FIELDS) as EmailLinkKind[])
        .filter(kind => !resolveEmailLinkBase(config, kind));

    if (unresolved.length === Object.keys(LINK_BASE_FIELDS).length) {
        throw new Error(
            "Email is configured but no base URL for emailed links is set. Password-reset, verification " +
            "and magic-link emails would carry relative hrefs, which are dead links in every mail client. " +
            "Set FRONTEND_URL (or `auth.email.resetPasswordUrl`) to an absolute URL such as " +
            "\"https://app.example.com\"."
        );
    }

    if (unresolved.length > 0) {
        throw new Error(
            `Email is configured without a base URL for ${unresolved.map(kind => LINK_KIND_LABELS[kind]).join(" and ")} ` +
            "emails, so their links would be relative hrefs — dead in every mail client. Those links fall back " +
            "to `auth.email.resetPasswordUrl` only: set FRONTEND_URL (or `auth.email.resetPasswordUrl`) to an " +
            "absolute URL such as \"https://app.example.com\"."
        );
    }
}

/** How each link kind is named in a boot error. */
const LINK_KIND_LABELS: Record<EmailLinkKind, string> = {
    resetPassword: "password-reset",
    verifyEmail: "verification",
    magicLink: "magic-link"
};
