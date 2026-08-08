/**
 * Base URLs for emailed links.
 *
 * `verifyEmailUrl` is set by no boot path and had no fallback, so every
 * verification email on the managed runtime shipped `href="/verify-email?…"` —
 * a relative URL, inert in a mail client — while the route answered
 * `{ success: true }` and the token was really minted. These tests pin the
 * fallback chain and the boot-time refusal that replaces the silent failure.
 */

import { resolveEmailLinkBase, assertEmailLinkBases } from "../src/email/link-base";
import { createEmailService } from "../src/email/smtp-email-service";
import type { EmailConfig } from "../src/email/types";

const base: EmailConfig = { from: "noreply@app.test",
smtp: { host: "smtp.test",
port: 587 } };

describe("resolveEmailLinkBase", () => {
    it("falls back to resetPasswordUrl when verifyEmailUrl is unset", () => {
        const config = { ...base,
resetPasswordUrl: "https://app.test" };
        expect(resolveEmailLinkBase(config, "verifyEmail")).toBe("https://app.test");
    });

    it("prefers verifyEmailUrl when it is set", () => {
        const config = { ...base,
resetPasswordUrl: "https://app.test",
verifyEmailUrl: "https://verify.app.test" };
        expect(resolveEmailLinkBase(config, "verifyEmail")).toBe("https://verify.app.test");
    });

    it("falls back to resetPasswordUrl for magic links", () => {
        const config = { ...base,
resetPasswordUrl: "https://app.test" };
        expect(resolveEmailLinkBase(config, "magicLink")).toBe("https://app.test");
    });

    it("strips a trailing slash so callers can append a path", () => {
        const config = { ...base,
resetPasswordUrl: "https://app.test/" };
        expect(resolveEmailLinkBase(config, "resetPassword")).toBe("https://app.test");
    });

    it("ignores a relative base — it is not a URL a mail client can follow", () => {
        const config = { ...base,
verifyEmailUrl: "/app",
resetPasswordUrl: "https://app.test" };
        expect(resolveEmailLinkBase(config, "verifyEmail")).toBe("https://app.test");
    });

    it("returns empty string for an absent config", () => {
        expect(resolveEmailLinkBase(undefined, "verifyEmail")).toBe("");
    });
});

describe("assertEmailLinkBases", () => {
    it("accepts a config with only resetPasswordUrl (what every boot path sets)", () => {
        expect(() => assertEmailLinkBases({ ...base,
resetPasswordUrl: "https://app.test" })).not.toThrow();
    });

    it("throws when no base URL is set at all", () => {
        expect(() => assertEmailLinkBases(base)).toThrow(/no base URL for emailed links/i);
    });

    it("throws when a base URL is set but relative", () => {
        expect(() => assertEmailLinkBases({ ...base,
resetPasswordUrl: "app.test" })).toThrow(/relative link base/i);
    });

    it("names the offending field", () => {
        expect(() => assertEmailLinkBases({ ...base,
resetPasswordUrl: "https://app.test",
magicLinkUrl: "/auth" })).toThrow(/email\.magicLinkUrl/);
    });
});

describe("createEmailService", () => {
    it("refuses to build a service that can only produce dead links", () => {
        expect(() => createEmailService(base)).toThrow(/no base URL for emailed links/i);
    });

    it("builds normally once a base URL is configured", () => {
        expect(createEmailService({ ...base,
resetPasswordUrl: "https://app.test" }).isConfigured()).toBe(true);
    });
});
