/**
 * Base URLs for emailed links.
 *
 * `verifyEmailUrl` is set by no boot path and had no fallback, so every
 * verification email on the managed runtime shipped `href="/verify-email?…"` —
 * a relative URL, inert in a mail client — while the route answered
 * `{ success: true }` and the token was really minted. These tests pin the
 * fallback chain and the boot-time refusal that replaces the silent failure.
 */

import { resolveEmailLinkBase, assertEmailLinkBases, magicLinkHref, magicLinkUrlProblem } from "../src/email/link-base";
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

    it("throws when only the verification base is set — reset and magic links have no fallback to it", () => {
        // `verifyEmailUrl` and `magicLinkUrl` fall back to `resetPasswordUrl`;
        // nothing falls back to them. A config with only `verifyEmailUrl`
        // passed, and every password-reset and magic-link email went out
        // with `href="/reset-password?token=…"`.
        expect(() => assertEmailLinkBases({ ...base,
verifyEmailUrl: "https://app.test" })).toThrow(/password-reset and magic-link/);
        expect(() => assertEmailLinkBases({ ...base,
verifyEmailUrl: "https://app.test" })).toThrow(/resetPasswordUrl/);
    });

    it("throws when the verification and magic-link bases are set but the reset base is not", () => {
        expect(() => assertEmailLinkBases({ ...base,
verifyEmailUrl: "https://app.test",
magicLinkUrl: "https://app.test" })).toThrow(/password-reset/);
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

/**
 * A frontend that is not the CMS had to discover and serve
 * `/auth/magic-link?token=`. `magicLinkUrl` (`MAGIC_LINK_URL`) with `{token}`
 * in it is the whole link instead.
 */
describe("magicLinkHref", () => {
    it("puts the token where a template's placeholder is, encoded", () => {
        expect(magicLinkHref({ from: "x@y.z", magicLinkUrl: "https://app.example.com/app.html#ml={token}" }, "a/b+c"))
            .toBe("https://app.example.com/app.html#ml=a%2Fb%2Bc");
    });

    it("appends the path to a base, as before", () => {
        expect(magicLinkHref({ from: "x@y.z", resetPasswordUrl: "https://app.example.com/" }, "t1"))
            .toBe("https://app.example.com/auth/magic-link?token=t1");
        expect(magicLinkHref({ from: "x@y.z", magicLinkUrl: "https://login.example.com", resetPasswordUrl: "https://app.example.com" }, "t1"))
            .toBe("https://login.example.com/auth/magic-link?token=t1");
    });
});

describe("magicLinkUrlProblem", () => {
    it("flags a template dotenv cut at its #, and a file path with no {token}", () => {
        expect(magicLinkUrlProblem("https://app.example.com/app.html")).toContain("quote it");
        expect(magicLinkUrlProblem("https://app.example.com/#ml=x")).toContain("{token}");
    });

    it("says nothing of a template or a plain base", () => {
        expect(magicLinkUrlProblem("https://app.example.com/app.html#ml={token}")).toBeUndefined();
        expect(magicLinkUrlProblem("https://app.example.com")).toBeUndefined();
        expect(magicLinkUrlProblem("https://app.example.com/admin/")).toBeUndefined();
        expect(magicLinkUrlProblem(undefined)).toBeUndefined();
    });
});
