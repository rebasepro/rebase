import {
    getPasswordResetTemplate,
    getEmailVerificationTemplate,
    getUserInvitationTemplate,
    getWelcomeEmailTemplate
} from "../src/email/templates";

describe("getPasswordResetTemplate", () => {
    const user = { email: "john@example.com", displayName: "John Doe" };
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
        const userNoName = { email: "jane@example.com", displayName: null };
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
    const user = { email: "alice@example.com", displayName: "Alice" };
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
    const user = { email: "bob@example.com", displayName: "Bob" };
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
    const user = { email: "dave@example.com", displayName: "Dave" };

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
