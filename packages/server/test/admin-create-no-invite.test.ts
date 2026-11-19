/**
 * `POST /admin/users` with `invite: false`: an account with no password and no
 * email, for an app that signs in by magic link, a code or a provider.
 *
 * `rebase users create` always sent a set-password invitation, which is the
 * wrong mail for a magic-link-only app.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono } from "hono";
import type { EmailSendOptions, EmailService } from "@rebasepro/types";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import type { UserData } from "../src/auth/interfaces";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { fakeAuthRepository, fakeUser } from "./helpers/server-a-g1-fakes";

const SECRET = "test-secret-for-admin-create-no-invite-0123456789";

function harness() {
    const sent: EmailSendOptions[] = [];
    const created: Array<{ email: string; passwordHash?: string }> = [];
    const resetTokens: string[] = [];
    const emailService: EmailService = {
        isConfigured: () => true,
        send: async (options) => { sent.push(options); return { messageId: `m-${sent.length}` }; }
    };
    const user = (id: string): UserData => fakeUser({ id, email: `${id}@test.com`, createdAt: new Date(), updatedAt: new Date() });
    const repo = fakeAuthRepository({
        getUserByEmail: async () => null,
        getUserById: async (id: string) => user(id),
        getUserRoleIds: async () => ["admin"],
        setUserRoles: async () => undefined,
        createUser: async (data: { email: string; passwordHash?: string }) => { created.push(data); return { ...user("new-user"), ...data }; },
        createPasswordResetToken: async (userId: string) => { resetTokens.push(userId); }
    });
    const adapter = createBuiltinAuthAdapter({
        authRepository: repo,
        emailService,
        emailConfig: { from: "noreply@example.com", resetPasswordUrl: "https://app.example.com", appName: "Acme" }
    });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    const adminRoutes = adapter.createAdminRoutes?.();
    if (!adminRoutes) throw new Error("the built-in adapter mounts admin routes");
    app.mount("/api/admin", request => adminRoutes.fetch(request));
    const post = async (body: Record<string, unknown>) => app.request("/api/admin/users", {
        method: "POST",
        headers: { authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    return { post, sent, created, resetTokens };
}

describe("POST /admin/users with invite: false", () => {
    beforeAll(() => configureJwt({ secret: SECRET, accessExpiresIn: "1h" }));

    it("creates the account with no password, sends nothing and mints no reset link", async () => {
        const { post, sent, created, resetTokens } = harness();
        const res = await post({ email: "agency@example.com", invite: false });
        expect(res.status).toBe(201);
        const body = await res.json() as Record<string, unknown>;
        expect(body.invitationSent).toBe(false);
        expect(body.temporaryPassword).toBeUndefined();
        expect(sent).toEqual([]);
        expect(resetTokens).toEqual([]);
        expect(created[0].passwordHash).toBeUndefined();
    });

    it("still invites by default", async () => {
        const { post, sent } = harness();
        const res = await post({ email: "agency@example.com" });
        expect(((await res.json()) as Record<string, unknown>).invitationSent).toBe(true);
        expect(sent).toHaveLength(1);
    });

    it("refuses an invite that is not a boolean", async () => {
        const { post } = harness();
        expect((await post({ email: "agency@example.com", invite: "no" })).status).toBe(400);
    });
});
