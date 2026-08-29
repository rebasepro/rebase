import { Hono } from "hono";
import { createResetPasswordRoute } from "../src/auth/reset-password-admin";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { errorHandler } from "../src/api/errors";

const TEST_SECRET = "integration-test-secret-key-that-is-definitely-32-chars-long!!";

describe("createResetPasswordRoute & onAdminResetPassword", () => {
    let mockAuthRepo: jest.Mocked<AuthRepository>;
    let mockEmailService: { send: jest.Mock; isConfigured: jest.Mock };

    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    beforeEach(() => {
        mockAuthRepo = {
            getUserById: jest.fn(),
            getUserRoleIds: jest.fn().mockResolvedValue(["admin"]),
            updatePassword: jest.fn().mockResolvedValue(undefined),
            createPasswordResetToken: jest.fn().mockResolvedValue(undefined)
        } as unknown as jest.Mocked<AuthRepository>;

        mockEmailService = {
            send: jest.fn().mockResolvedValue(undefined),
            isConfigured: jest.fn().mockReturnValue(true)
        };
    });

    function createApp(authHooks?: any) {
        const app = new Hono();
        app.onError(errorHandler);
        const adminRoutes = createResetPasswordRoute({
            authRepo: mockAuthRepo,
            emailService: mockEmailService as any,
            emailConfig: {
                from: "test@example.com",
                resetPasswordUrl: "https://reset.com"
            },
            authHooks
        });
        app.route("/api/admin", adminRoutes);
        return app;
    }

    describe("who may call it", () => {
        // Everything else in this file signs in as an admin, so the route's
        // `createRequireAuth` + `requireAdmin` pair could be deleted outright
        // without a single failure. Resetting another account's password is the
        // most complete takeover this API offers; these two are the only tests
        // that notice if the gate goes away.
        beforeEach(() => {
            mockAuthRepo.getUserById.mockResolvedValue({
                id: "user-123",
                email: "user@example.com",
                displayName: "User One"
            } as any);
        });

        it("rejects an anonymous caller with 401", async () => {
            const app = createApp();

            const res = await app.request("/api/admin/users/user-123/reset-password", {
                method: "POST"
            });

            expect(res.status).toBe(401);
            expect(mockAuthRepo.getUserById).not.toHaveBeenCalled();
            expect(mockAuthRepo.updatePassword).not.toHaveBeenCalled();
            expect(mockAuthRepo.createPasswordResetToken).not.toHaveBeenCalled();
            expect(mockEmailService.send).not.toHaveBeenCalled();
        });

        it("rejects a signed-in non-admin with 403", async () => {
            const app = createApp();
            const editorToken = await generateAccessToken("editor-user", ["editor", "viewer"]);

            const res = await app.request("/api/admin/users/user-123/reset-password", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${editorToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ password: "StrongPass123" })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.code).toBe("FORBIDDEN");
            expect(mockAuthRepo.getUserById).not.toHaveBeenCalled();
            expect(mockAuthRepo.updatePassword).not.toHaveBeenCalled();
        });
    });

    it("falls back to default password reset logic when no hook is provided", async () => {
        mockAuthRepo.getUserById.mockResolvedValue({
            id: "user-123",
            email: "user@example.com",
            displayName: "User One"
        } as any);

        const app = createApp();
        const adminToken = await generateAccessToken("admin-user", ["admin"]);

        const res = await app.request("/api/admin/users/user-123/reset-password", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${adminToken}`
            }
        });

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.invitationSent).toBe(true);
        expect(body.user.uid).toBe("user-123");
        expect(mockAuthRepo.createPasswordResetToken).toHaveBeenCalled();
        expect(mockEmailService.send).toHaveBeenCalled();
    });

    it("calls onAdminResetPassword hook when provided", async () => {
        mockAuthRepo.getUserById.mockResolvedValue({
            id: "user-123",
            email: "user@example.com",
            displayName: "User One"
        } as any);

        const onAdminResetPasswordMock = jest.fn().mockResolvedValue({
            temporaryPassword: "hook-temp-password",
            invitationSent: false
        });

        const app = createApp({
            onAdminResetPassword: onAdminResetPasswordMock
        });
        const adminToken = await generateAccessToken("admin-user", ["admin"]);

        const res = await app.request("/api/admin/users/user-123/reset-password", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${adminToken}`
            }
        });

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.invitationSent).toBe(false);
        expect(body.temporaryPassword).toBe("hook-temp-password");
        expect(body.user.uid).toBe("user-123");

        expect(onAdminResetPasswordMock).toHaveBeenCalledWith(
            "user-123",
            expect.objectContaining({
                authRepo: mockAuthRepo,
                emailService: mockEmailService
            })
        );
        expect(mockAuthRepo.createPasswordResetToken).not.toHaveBeenCalled();
        expect(mockEmailService.send).not.toHaveBeenCalled();
    });

    describe("temporary password fallbacks", () => {
        beforeEach(() => {
            mockAuthRepo.getUserById.mockResolvedValue({
                id: "user-123",
                email: "user@example.com",
                displayName: "User One"
            } as any);
        });

        it("flags emailDeliveryFailed when the email service is configured but sending fails", async () => {
            mockEmailService.send.mockRejectedValue(new Error("SMTP 421 try again later"));

            const app = createApp();
            const adminToken = await generateAccessToken("admin-user", ["admin"]);

            const res = await app.request("/api/admin/users/user-123/reset-password", {
                method: "POST",
                headers: { "Authorization": `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.invitationSent).toBe(false);
            expect(body.emailDeliveryFailed).toBe(true);
            expect(typeof body.temporaryPassword).toBe("string");
            expect(mockAuthRepo.updatePassword).toHaveBeenCalled();
        });

        it("omits emailDeliveryFailed when no email service is configured", async () => {
            mockEmailService.isConfigured.mockReturnValue(false);

            const app = createApp();
            const adminToken = await generateAccessToken("admin-user", ["admin"]);

            const res = await app.request("/api/admin/users/user-123/reset-password", {
                method: "POST",
                headers: { "Authorization": `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.invitationSent).toBe(false);
            expect(body.emailDeliveryFailed).toBeUndefined();
            expect(typeof body.temporaryPassword).toBe("string");
            expect(mockEmailService.send).not.toHaveBeenCalled();
        });
    });

    describe("setting a password directly", () => {
        beforeEach(() => {
            mockAuthRepo.getUserById.mockResolvedValue({
                id: "user-123",
                email: "user@example.com",
                displayName: "User One"
            } as any);
        });

        it("updates the password without sending an email or returning a temporary one", async () => {
            const app = createApp();
            const adminToken = await generateAccessToken("admin-user", ["admin"]);

            const res = await app.request("/api/admin/users/user-123/reset-password", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${adminToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ password: "StrongPass123" })
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.invitationSent).toBe(false);
            expect(body.temporaryPassword).toBeUndefined();
            expect(mockEmailService.send).not.toHaveBeenCalled();

            // The stored hash must not be the cleartext password.
            expect(mockAuthRepo.updatePassword).toHaveBeenCalledTimes(1);
            const [userId, passwordHash] = mockAuthRepo.updatePassword.mock.calls[0];
            expect(userId).toBe("user-123");
            expect(passwordHash).not.toBe("StrongPass123");
        });

        it("rejects a weak password without touching the stored one", async () => {
            const app = createApp();
            const adminToken = await generateAccessToken("admin-user", ["admin"]);

            const res = await app.request("/api/admin/users/user-123/reset-password", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${adminToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ password: "weakpass" })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.message).toContain("Password too weak");
            expect(mockAuthRepo.updatePassword).not.toHaveBeenCalled();
        });

        it("takes precedence over a configured onAdminResetPassword hook", async () => {
            const onAdminResetPasswordMock = jest.fn().mockResolvedValue({
                temporaryPassword: "hook-temp-password",
                invitationSent: false
            });

            const app = createApp({ onAdminResetPassword: onAdminResetPasswordMock });
            const adminToken = await generateAccessToken("admin-user", ["admin"]);

            const res = await app.request("/api/admin/users/user-123/reset-password", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${adminToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ password: "StrongPass123" })
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.temporaryPassword).toBeUndefined();
            expect(onAdminResetPasswordMock).not.toHaveBeenCalled();
        });
    });
});
