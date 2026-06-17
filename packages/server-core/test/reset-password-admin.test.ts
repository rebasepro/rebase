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
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
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

    it("falls back to default password reset logic when no hook is provided", async () => {
        mockAuthRepo.getUserById.mockResolvedValue({
            id: "user-123",
            email: "user@example.com",
            displayName: "User One"
        } as any);

        const app = createApp();
        const adminToken = generateAccessToken("admin-user", ["admin"]);

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
        const adminToken = generateAccessToken("admin-user", ["admin"]);

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
                emailService: mockEmailService,
            })
        );
        expect(mockAuthRepo.createPasswordResetToken).not.toHaveBeenCalled();
        expect(mockEmailService.send).not.toHaveBeenCalled();
    });
});
