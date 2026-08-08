/**
 * HTML escaping in transactional email.
 *
 * `displayName` arrives from `POST /auth/register` — an open, unauthenticated
 * endpoint — and the welcome email built from it is mailed immediately to the
 * address that same request chose, signed by the sending domain. Interpolated
 * raw, that is a way to deliver an attacker's heading and an attacker's anchor
 * from a domain whose SPF and DKIM pass. These tests pin that every default
 * template escapes it, and that the machinery they share escapes by default.
 */

import { escapeHtml, html, raw } from "../src/email/html";
import {
    getPasswordResetTemplate,
    getEmailVerificationTemplate,
    getUserInvitationTemplate,
    getWelcomeEmailTemplate,
    getMagicLinkTemplate
} from "../src/email/templates";

/** The payload from the audit: close the paragraph, add a heading and a link. */
const PAYLOAD = "there</p><h1>Your account is locked</h1><p><a href=\"https://evil.tld/x\">Restore access</a>";

const hostileUser = { email: "victim@bigcorp.com",
displayName: PAYLOAD };

describe("escapeHtml", () => {
    it("escapes the five characters that can change HTML meaning", () => {
        expect(escapeHtml("<a href=\"x\" title='y'>&</a>"))
            .toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    });

    it("escapes & first, so entities are not double-escaped", () => {
        expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });
});

describe("html tag", () => {
    it("escapes interpolated values by default", () => {
        expect(html`<p>${"<script>alert(1)</script>"}</p>`.toString())
            .toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    });

    it("passes RawHtml through unescaped", () => {
        expect(html`<p>${raw("<b>bold</b>")}</p>`.toString()).toBe("<p><b>bold</b></p>");
    });

    it("nests fragments without escaping them twice", () => {
        const fragment = html`<a href="${"https://x.test/?a=1&b=2"}">go</a>`;
        expect(html`<div>${fragment}</div>`.toString())
            .toBe("<div><a href=\"https://x.test/?a=1&amp;b=2\">go</a></div>");
    });

    it("renders nullish interpolations as empty", () => {
        expect(html`<p>${undefined}${null}</p>`.toString()).toBe("<p></p>");
    });
});

describe("default templates escape user-controlled input", () => {
    const url = "https://app.test/x?token=abc";

    const cases: [string, () => { subject: string; html: string; text: string }][] = [
        ["passwordReset", () => getPasswordResetTemplate(url, hostileUser)],
        ["emailVerification", () => getEmailVerificationTemplate(url, hostileUser)],
        ["userInvitation", () => getUserInvitationTemplate(url, hostileUser)],
        ["welcome", () => getWelcomeEmailTemplate(hostileUser, "Rebase", url)],
        ["magicLink", () => getMagicLinkTemplate(url, hostileUser)]
    ];

    it.each(cases)("%s does not emit the injected markup", (_name, build) => {
        const { html: body } = build();

        // The payload's own tags must never reach the recipient as markup.
        expect(body).not.toContain("<h1>Your account is locked</h1>");
        expect(body).not.toContain("<a href=\"https://evil.tld/x\">");
        expect(body).not.toContain(PAYLOAD);

        // …and the name must still be there, escaped.
        expect(body).toContain("&lt;h1&gt;Your account is locked&lt;/h1&gt;");
    });

    it("escapes a hostile appName too", () => {
        const { html: body, subject } = getPasswordResetTemplate(
            "https://app.test/x",
            { email: "a@b.test", displayName: "Ann" },
            "</title><script>x</script>"
        );
        expect(body).not.toContain("<script>x</script>");
        // The subject itself is plain text — it is the *interpolation* into the
        // <title> element that has to be escaped.
        expect(subject).toContain("</title><script>x</script>");
    });

    it("escapes a link base that tries to break out of the href attribute", () => {
        const { html: body } = getPasswordResetTemplate(
            "https://app.test/\" onmouseover=\"alert(1)",
            { email: "a@b.test", displayName: "Ann" }
        );
        expect(body).not.toContain("onmouseover=\"alert(1)\"");
        expect(body).toContain("&quot; onmouseover=&quot;alert(1)");
    });

    it("keeps benign names and URLs readable", () => {
        const { html: body, text } = getPasswordResetTemplate(
            "https://app.test/reset?token=abc123",
            { email: "john@example.com", displayName: "John Doe" }
        );
        expect(body).toContain("John Doe");
        expect(body).toContain("https://app.test/reset?token=abc123");
        expect(text).toContain("John Doe");
    });
});
