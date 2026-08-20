import {
    getPasswordResetTemplate,
    getEmailVerificationTemplate,
    getUserInvitationTemplate,
    getWelcomeEmailTemplate,
    getMagicLinkTemplate,
    resolveEmailBranding
} from "../src/email/templates";

describe("getPasswordResetTemplate", () => {
    const user = { email: "john@example.com",
displayName: "John Doe" };
    const resetUrl = "https://example.com/reset?token=abc123";

    it("returns subject, html, and text", () => {
        const result = getPasswordResetTemplate(resetUrl, user);
        expect(result.subject).toBeTruthy();
        expect(result.html).toBeTruthy();
        expect(result.text).toBeTruthy();
    });

    it("subject includes default app name", () => {
        const result = getPasswordResetTemplate(resetUrl, user);
        expect(result.subject).toContain("Rebase");
    });

    it("subject includes custom app name", () => {
        const result = getPasswordResetTemplate(resetUrl, user, "MyApp");
        expect(result.subject).toContain("MyApp");
    });

    it("html contains the reset URL", () => {
        const result = getPasswordResetTemplate(resetUrl, user);
        expect(result.html).toContain(resetUrl);
    });

    it("text contains the reset URL", () => {
        const result = getPasswordResetTemplate(resetUrl, user);
        expect(result.text).toContain(resetUrl);
    });

    it("uses displayName for greeting", () => {
        const result = getPasswordResetTemplate(resetUrl, user);
        expect(result.html).toContain("John Doe");
        expect(result.text).toContain("John Doe");
    });

    it("falls back to email prefix when displayName is null", () => {
        const userNoName = { email: "jane@example.com",
displayName: null };
        const result = getPasswordResetTemplate(resetUrl, userNoName);
        expect(result.html).toContain("jane");
        expect(result.text).toContain("jane");
    });

    it("html contains DOCTYPE and body tags", () => {
        const result = getPasswordResetTemplate(resetUrl, user);
        expect(result.html).toContain("<!DOCTYPE html>");
        expect(result.html).toContain("<body");
        expect(result.html).toContain("</body>");
    });
});

describe("getEmailVerificationTemplate", () => {
    const user = { email: "alice@example.com",
displayName: "Alice" };
    const verifyUrl = "https://example.com/verify?token=xyz789";

    it("returns subject, html, and text", () => {
        const result = getEmailVerificationTemplate(verifyUrl, user);
        expect(result.subject).toBeTruthy();
        expect(result.html).toBeTruthy();
        expect(result.text).toBeTruthy();
    });

    it("subject mentions email verification", () => {
        const result = getEmailVerificationTemplate(verifyUrl, user);
        expect(result.subject.toLowerCase()).toContain("verify");
    });

    it("html contains the verification URL", () => {
        const result = getEmailVerificationTemplate(verifyUrl, user);
        expect(result.html).toContain(verifyUrl);
    });

    it("text contains the verification URL", () => {
        const result = getEmailVerificationTemplate(verifyUrl, user);
        expect(result.text).toContain(verifyUrl);
    });

    it("uses displayName when available", () => {
        const result = getEmailVerificationTemplate(verifyUrl, user);
        expect(result.html).toContain("Alice");
    });

    it("uses custom app name", () => {
        const result = getEmailVerificationTemplate(verifyUrl, user, "CustomApp");
        expect(result.subject).toContain("CustomApp");
        expect(result.html).toContain("CustomApp");
    });
});

describe("getUserInvitationTemplate", () => {
    const user = { email: "bob@example.com",
displayName: "Bob" };
    const setPasswordUrl = "https://example.com/set-password?token=def456";

    it("returns subject, html, and text", () => {
        const result = getUserInvitationTemplate(setPasswordUrl, user);
        expect(result.subject).toBeTruthy();
        expect(result.html).toBeTruthy();
        expect(result.text).toBeTruthy();
    });

    it("subject mentions invitation", () => {
        const result = getUserInvitationTemplate(setPasswordUrl, user);
        expect(result.subject.toLowerCase()).toContain("invited");
    });

    it("html contains the set password URL", () => {
        const result = getUserInvitationTemplate(setPasswordUrl, user);
        expect(result.html).toContain(setPasswordUrl);
    });

    it("text contains the set password URL", () => {
        const result = getUserInvitationTemplate(setPasswordUrl, user);
        expect(result.text).toContain(setPasswordUrl);
    });

    it("falls back to email prefix when no displayName", () => {
        const userNoName = { email: "charlie@example.com" };
        const result = getUserInvitationTemplate(setPasswordUrl, userNoName);
        expect(result.html).toContain("charlie");
    });
});

describe("getWelcomeEmailTemplate", () => {
    const user = { email: "dave@example.com",
displayName: "Dave" };

    it("returns subject, html, and text", () => {
        const result = getWelcomeEmailTemplate(user);
        expect(result.subject).toBeTruthy();
        expect(result.html).toBeTruthy();
        expect(result.text).toBeTruthy();
    });

    it("includes the app name in subject", () => {
        const result = getWelcomeEmailTemplate(user, "SuperApp");
        expect(result.subject).toContain("SuperApp");
    });

    it("uses displayName for greeting", () => {
        const result = getWelcomeEmailTemplate(user);
        expect(result.html).toContain("Dave");
    });

    it("includes login URL when provided", () => {
        const loginUrl = "https://example.com/login";
        const result = getWelcomeEmailTemplate(user, "Rebase", loginUrl);
        expect(result.html).toContain(loginUrl);
        expect(result.text).toContain(loginUrl);
    });

    it("handles missing login URL gracefully", () => {
        const result = getWelcomeEmailTemplate(user);
        expect(result.html).toBeTruthy();
        expect(result.text).toBeTruthy();
    });

    it("html contains proper structure", () => {
        const result = getWelcomeEmailTemplate(user);
        expect(result.html).toContain("<!DOCTYPE html>");
        expect(result.html).toContain("<body");
    });
});

describe("email logo", () => {
    const user = { email: "john@example.com",
displayName: "John Doe" };
    const resetUrl = "https://example.com/reset?token=abc123";
    const REBASE_LOGO = "https://rebase.pro/img/logo_small.png";

    describe("resolveEmailBranding", () => {
        it("an unconfigured app is Rebase's own mail: default name and default mark", () => {
            expect(resolveEmailBranding(undefined)).toEqual({
                appName: "Rebase",
                logoUrl: REBASE_LOGO
            });
        });

        it('an explicit appName of "Rebase" still gets the mark', () => {
            // This, not the undefined case, is what actually reaches production:
            // APP_NAME is z.string().default("Rebase") in the cloud, the demo app
            // and the eject template, so appName is never undefined there. Keying
            // the fallback on undefined would ship a logo nobody ever sees.
            expect(resolveEmailBranding({ appName: "Rebase" }).logoUrl).toBe(REBASE_LOGO);
        });

        it("an app that named itself but set no logo gets NO logo, not Rebase's", () => {
            // The whole point of the asymmetry: Acme's users must never receive a
            // Rebase mark in mail signed by Acme's domain.
            expect(resolveEmailBranding({ appName: "Acme" })).toEqual({
                appName: "Acme",
                logoUrl: undefined
            });
        });

        it("uses a configured logo alongside a configured name", () => {
            const logoUrl = "https://acme.example/logo.png";
            expect(resolveEmailBranding({ appName: "Acme", logoUrl })).toEqual({ appName: "Acme",
logoUrl });
        });

        it("a configured logo survives an unset app name", () => {
            const logoUrl = "https://acme.example/logo.png";
            expect(resolveEmailBranding({ logoUrl }).logoUrl).toBe(logoUrl);
        });

        it.each([
            ["a relative path", "/img/logo.png"],
            ["a data URI", "data:image/png;base64,iVBORw0KGgo="],
            ["a file URL", "file:///tmp/logo.png"],
            ["nonsense", "not a url"],
            ["an empty string", ""]
        ])("renders no logo for %s — a broken image is worse than none", (_label, logoUrl) => {
            expect(resolveEmailBranding({ logoUrl }).logoUrl).toBeUndefined();
        });

        it("an explicit empty logoUrl opts out rather than falling back to Rebase's", () => {
            expect(resolveEmailBranding({ logoUrl: "" }).logoUrl).toBeUndefined();
        });
    });

    describe("rendering", () => {
        it("templates render no logo unless one is passed", () => {
            // The template functions stay pure: only resolveEmailBranding decides
            // that an unconfigured install is Rebase's.
            expect(getPasswordResetTemplate(resetUrl, user, "Rebase")).toEqual(
                expect.objectContaining({ html: expect.not.stringContaining("<img") })
            );
        });

        it.each([
            ["password reset", () => getPasswordResetTemplate(resetUrl, user, "Rebase", REBASE_LOGO)],
            ["email verification", () => getEmailVerificationTemplate(resetUrl, user, "Rebase", REBASE_LOGO)],
            ["user invitation", () => getUserInvitationTemplate(resetUrl, user, "Rebase", REBASE_LOGO)],
            ["welcome", () => getWelcomeEmailTemplate(user, "Rebase", undefined, REBASE_LOGO)],
            ["magic link", () => getMagicLinkTemplate(resetUrl, user, "Rebase", REBASE_LOGO)]
        ])("the %s template renders the logo above the card", (_label, build) => {
            const { html } = build();
            expect(html).toContain(`src="${REBASE_LOGO}"`);
            // Sized by attribute as well as CSS, for Outlook's Word renderer.
            expect(html).toContain(`width="48" height="48"`);
            // Above the card, not inside it.
            expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<h1"));
        });

        it("sizes the alt fallback so a blocked image still reads the whole name", () => {
            // At the body's inherited 16px, "Rebase" overflows the 48px box and a
            // client that blocks remote images renders "Rebas". Verified in a
            // browser: 12px plus an auto height lets the name through intact.
            const { html } = getPasswordResetTemplate(resetUrl, user, "Rebase", REBASE_LOGO);
            const img = html.slice(html.indexOf("<img"), html.indexOf(">", html.indexOf("<img")));
            expect(img).toContain("height: auto");
            expect(img).toContain("font-size: 12px");
            expect(img).not.toContain("height: 48px");
        });

        it("names the app in alt text so a client with images off still reads it", () => {
            const { html } = getPasswordResetTemplate(resetUrl, user, "Acme", "https://acme.example/l.png");
            expect(html).toContain(`alt="Acme"`);
        });

        it("escapes an app name that would otherwise break out of the alt attribute", () => {
            const { html } = getPasswordResetTemplate(
                resetUrl, user, `Acme" onerror="alert(1)`, "https://acme.example/l.png"
            );
            expect(html).not.toContain(`onerror="alert(1)"`);
            expect(html).toContain("&quot;");
        });

        it("leaves the plain-text body untouched", () => {
            const withLogo = getPasswordResetTemplate(resetUrl, user, "Rebase", REBASE_LOGO);
            const without = getPasswordResetTemplate(resetUrl, user, "Rebase");
            expect(withLogo.text).toBe(without.text);
        });
    });
});
