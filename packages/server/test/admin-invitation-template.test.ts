/**
 * Which email a newly-created user actually receives.
 *
 * `EmailConfig.templates` offers five slots. Four of them are read by the flow
 * they are named for; `userInvitation` was read by nothing, and the one flow
 * that sends an invitation — `finalizeAdminUserCreation`, reached from
 * `POST /admin/users` — used `templates.passwordReset` instead.
 *
 * So an admin creating an account for someone sent them
 * "Reset your <App> password", for an account that person had never seen and a
 * password that had never existed. The correct template was written, typed
 * (`UserInvitationTemplateFunction`), given a config slot, exported from
 * `email/index.ts`, and unit-tested in `email-templates.test.ts` — every part
 * of it except the call.
 *
 * That last gap is the point: testing a template renders correctly says nothing
 * about whether anything sends it. These tests are about the wiring, so they
 * assert on what leaves the mail service.
 */

import { finalizeAdminUserCreation, type AdminUserContext } from "../src/auth/admin-user-ops";
import type { AuthRepository } from "../src/auth/interfaces";
import type { EmailService } from "../src/email";
import type { ResolvedAuthHooks } from "../src/auth/auth-hooks";

type SentEmail = { to: string; subject: string; html: string; text?: string };

function makeContext(templates?: NonNullable<AdminUserContext["emailConfig"]>["templates"]) {
    const sent: SentEmail[] = [];
    const emailService = {
        isConfigured: () => true,
        send: jest.fn(async (email: SentEmail) => { sent.push(email); })
    } as unknown as EmailService;

    const authRepo = {
        createPasswordResetToken: jest.fn(async () => undefined)
    } as unknown as AuthRepository;

    const ctx: AdminUserContext = {
        authRepo,
        emailService,
        emailConfig: {
            resetPasswordUrl: "https://app.example.com",
            appName: "Acme",
            ...(templates ? { templates } : {})
        },
        resolvedHooks: {} as ResolvedAuthHooks
    };

    return { ctx, sent };
}

const newUser = { id: "u1", values: { email: "invitee@example.com", displayName: "Ada" } };

describe("finalizeAdminUserCreation — the invited user's email", () => {
    it("sends the invitation, not a password reset", async () => {
        const { ctx, sent } = makeContext();

        const result = await finalizeAdminUserCreation(newUser, "temp-password", ctx);

        expect(result.invitationSent).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe("invitee@example.com");
        // The whole defect in one assertion: the recipient has no password to
        // reset, so a subject that says so is telling them about an account
        // they never had.
        expect(sent[0].subject).toBe("You've been invited to Acme");
        expect(sent[0].subject).not.toMatch(/reset/i);
    });

    it("says an account was created, and links somewhere to set a password", async () => {
        const { ctx, sent } = makeContext();

        await finalizeAdminUserCreation(newUser, "temp-password", ctx);

        expect(sent[0].html).toContain("An account has been created for you");
        expect(sent[0].html).toContain("https://app.example.com/reset-password?token=");
    });

    it("honours a configured userInvitation template", async () => {
        // The slot existing but being unread is what made this reachable at
        // all: a developer who set it saw no change and no error.
        const userInvitation = jest.fn(() => ({
            subject: "Join us",
            html: "<p>custom invite</p>",
            text: "custom invite"
        }));
        const { ctx, sent } = makeContext({ userInvitation });

        await finalizeAdminUserCreation(newUser, "temp-password", ctx);

        expect(userInvitation).toHaveBeenCalledWith(
            expect.stringContaining("/reset-password?token="),
            { email: "invitee@example.com", displayName: "Ada" }
        );
        expect(sent[0].subject).toBe("Join us");
    });

    it("does not reach for the passwordReset template", async () => {
        // Pinned separately from the subject assertion: a future edit that
        // renames the invitation subject should not be able to quietly restore
        // the wrong slot.
        const passwordReset = jest.fn(() => ({ subject: "Reset your password", html: "", text: "" }));
        const { ctx, sent } = makeContext({ passwordReset });

        await finalizeAdminUserCreation(newUser, "temp-password", ctx);

        expect(passwordReset).not.toHaveBeenCalled();
        expect(sent[0].subject).toBe("You've been invited to Acme");
    });

    it("still returns the temporary password when email is not configured", async () => {
        // Unchanged behaviour, pinned because the fix touches the branch above it.
        const { ctx, sent } = makeContext();
        (ctx.emailService as unknown as { isConfigured: () => boolean }).isConfigured = () => false;

        const result = await finalizeAdminUserCreation(newUser, "temp-password", ctx);

        expect(result).toEqual({ temporaryPassword: "temp-password", invitationSent: false });
        expect(sent).toHaveLength(0);
    });
});
