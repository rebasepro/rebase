import { createUnconfiguredEmailService } from "../src/email/unconfigured";

/**
 * `rebase.email` is declared non-optional and has to be there.
 *
 * `RebaseServerClient` says `email: EmailService`, and the property was simply
 * absent whenever the backend booted without `auth.email` — no SMTP, and outside
 * the narrow window where the dev sink is wired. So a cron or a custom function
 * written against the type compiled, deployed, and died on "Cannot read
 * properties of undefined (reading 'send')": a stack trace about a language
 * feature rather than about the thing nobody configured.
 *
 * The stand-in makes the property real and the failure legible. What it is NOT
 * is a no-op sender — which is what the type's docstring claimed for a long
 * time. A no-op would swallow the password-reset mail a user is waiting on and
 * report success, and nothing downstream could tell that from delivery.
 */
describe("the unconfigured email service", () => {
    it("throws a message that names what to set", async () => {
        const service = createUnconfiguredEmailService();

        await expect(service.send({
            to: "ada@example.com",
            subject: "Hi",
            html: "<p>Hi</p>"
        })).rejects.toThrow(/SMTP_HOST/);
    });

    it("does not pretend the message was sent", async () => {
        const service = createUnconfiguredEmailService();

        const outcome = await service.send({ to: "a@b.c", subject: "s", html: "<p>h</p>" })
            .then(() => "resolved", () => "rejected");

        expect(outcome).toBe("rejected");
    });

    it("reports itself unconfigured, so the 503 routes never reach it", () => {
        // `auth/routes.ts` and the magic-link / OTP routes gate on
        // `isConfigured()` and answer 503 EMAIL_NOT_CONFIGURED. That must keep
        // working: a caller asking for a password reset should get the status,
        // not an exception from three frames deeper.
        expect(createUnconfiguredEmailService().isConfigured()).toBe(false);
    });

    it("fails connection verification rather than claiming a healthy transport", async () => {
        expect(await createUnconfiguredEmailService().verifyConnection?.()).toBe(false);
    });
});
