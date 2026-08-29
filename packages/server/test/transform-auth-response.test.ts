/**
 * transformAuthResponse Hook — Integration Tests
 *
 * Tests the `transformAuthResponse` hook across login, register, refresh,
 * and error handling scenarios. Services are mocked following the same
 * pattern as auth-routes.test.ts.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, AuthModuleConfig } from "../src/auth/routes";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, hashRefreshToken } from "../src/auth/jwt";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("../src/auth/password");

jest.mock("../src/utils/logger", () => {
    return {
        logger: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            child: jest.fn().mockReturnThis()
        }
    };
});

// Bypass rate limiters — they share state across tests and cause 429s
jest.mock("../src/auth/rate-limiter", () => {
    const passthrough = async (_c: unknown, next: () => Promise<void>) => next();
    return {
        createRateLimiter: () => passthrough,
        defaultAuthLimiter: passthrough,
        strictAuthLimiter: passthrough
    };
});

import { validatePasswordStrength, hashPassword, verifyPassword } from "../src/auth/password";
import { logger } from "../src/utils/logger";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEST_SECRET = "integration-test-secret-key-that-is-definitely-32-chars-long!!";

function mockUser(overrides: Partial<{ id: string; email: string; passwordHash: string | null; displayName: string | null; photoUrl: string | null; provider: string; emailVerified: boolean; emailVerificationToken: string | null }> = {}) {
    return {
        id: overrides.id ?? "user-1",
        email: overrides.email ?? "test@example.com",
        passwordHash: "passwordHash" in overrides ? overrides.passwordHash : "salt:hash",
        displayName: overrides.displayName ?? "Test User",
        photoUrl: overrides.photoUrl ?? null,
        emailVerified: overrides.emailVerified ?? false,
        emailVerificationToken: overrides.emailVerificationToken ?? null,
        emailVerificationSentAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

function mockRole(id: string, isAdmin = false) {
    return { id,
name: id.charAt(0).toUpperCase() + id.slice(1),
isAdmin,
defaultPermissions: null,
collectionPermissions: null };
}

let mockAuthRepo: jest.Mocked<AuthRepository>;

function createApp(opts: { authHooks?: AuthHooks } = {}) {
    mockAuthRepo = {
        getUserByEmail: jest.fn().mockResolvedValue(null),
        getUserByIdentity: jest.fn().mockResolvedValue(null),
        linkUserIdentity: jest.fn().mockResolvedValue(undefined),
        getUserIdentities: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn().mockResolvedValue(null),
        createUser: jest.fn().mockImplementation((data) =>
            Promise.resolve(mockUser({ email: data.email,
displayName: data.displayName,
passwordHash: data.passwordHash }))
        ),
        listUsers: jest.fn().mockResolvedValue([]),
        getUserRoles: jest.fn().mockResolvedValue([mockRole("editor")]),
        getUserRoleIds: jest.fn().mockResolvedValue(["editor"]),
        assignDefaultRole: jest.fn().mockResolvedValue(undefined),
        setUserRoles: jest.fn().mockResolvedValue(undefined),
        updateUser: jest.fn().mockImplementation((id, data) =>
            Promise.resolve(mockUser({ id,
...data }))
        ),
        deleteUser: jest.fn().mockResolvedValue(undefined),
        updatePassword: jest.fn().mockResolvedValue(undefined),
        setEmailVerified: jest.fn().mockResolvedValue(undefined),
        setVerificationToken: jest.fn().mockResolvedValue(undefined),
        getUserByVerificationToken: jest.fn().mockResolvedValue(null),
        getUserWithRoles: jest.fn().mockImplementation(async (uid) => {
            const user = mockUser({ id: uid });
            return { user,
roles: [mockRole("editor")] };
        }),
        createRefreshToken: jest.fn().mockResolvedValue(undefined),
        findRefreshTokenByHash: jest.fn().mockResolvedValue(null),
        deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
        deleteAllRefreshTokensForUser: jest.fn().mockResolvedValue(undefined),
        listRefreshTokensForUser: jest.fn().mockResolvedValue([]),
        deleteRefreshTokenById: jest.fn().mockResolvedValue(undefined),
        createPasswordResetToken: jest.fn().mockResolvedValue(undefined),
        findValidPasswordResetToken: jest.fn().mockResolvedValue(null),
        markPasswordResetTokenUsed: jest.fn().mockResolvedValue(undefined),
        deleteExpiredPasswordResetTokens: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<AuthRepository>;

    // Password mocks
    (validatePasswordStrength as jest.Mock).mockReturnValue({ valid: true,
errors: [] });
    (hashPassword as jest.Mock).mockResolvedValue("hashed-pw");
    (verifyPassword as jest.Mock).mockResolvedValue(true);

    const config: AuthModuleConfig = {
        authRepo: mockAuthRepo,
        allowRegistration: true,
        authHooks: opts.authHooks
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes(config));
    return app;
}

function json(body: Record<string, unknown>) {
    return {
        method: "POST" as const,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("transformAuthResponse hook", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── Registration ────────────────────────────────────────────────────

    describe("POST /auth/register", () => {
        it("calls transformAuthResponse with the response and 'register' method", async () => {
            const transformHook = jest.fn(async (response: AuthResponsePayload) => ({
                ...response,
                tokens: { ...response.tokens, firebaseToken: "custom-firebase-token" }
            }));
            const app = createApp({ authHooks: { transformAuthResponse: transformHook } });

            const res = await app.request("/auth/register", json({ email: "new@test.com", password: "StrongPass1" }));
            expect(res.status).toBe(201);
            const body = await res.json() as Record<string, unknown>;
            const tokens = body.tokens as Record<string, unknown>;

            // Verify the hook was called
            expect(transformHook).toHaveBeenCalledTimes(1);

            // Verify context
            const context = transformHook.mock.calls[0][1] as TransformAuthResponseContext;
            expect(context.method).toBe("register");
            expect(context.uid).toBeTruthy();
            expect(context.request).toBeInstanceOf(Request);

            // Verify the custom field was injected
            expect(tokens.firebaseToken).toBe("custom-firebase-token");
            // Original fields still present
            expect(tokens.accessToken).toBeTruthy();
            expect(tokens.refreshToken).toBeTruthy();
        });
    });

    // ── Login ────────────────────────────────────────────────────────────

    describe("POST /auth/login", () => {
        it("calls transformAuthResponse with 'login' method", async () => {
            const transformHook = jest.fn(async (response: AuthResponsePayload) => ({
                ...response,
                tokens: { ...response.tokens, externalToken: "ext-123" }
            }));
            const app = createApp({ authHooks: { transformAuthResponse: transformHook } });

            // Setup: user exists
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());

            const res = await app.request("/auth/login", json({ email: "test@example.com", password: "StrongPass1" }));
            expect(res.status).toBe(200);
            const body = await res.json() as Record<string, unknown>;
            const tokens = body.tokens as Record<string, unknown>;

            expect(transformHook).toHaveBeenCalledTimes(1);
            const context = transformHook.mock.calls[0][1] as TransformAuthResponseContext;
            expect(context.method).toBe("login");
            expect(tokens.externalToken).toBe("ext-123");
        });
    });

    // ── Refresh ──────────────────────────────────────────────────────────

    describe("POST /auth/refresh", () => {
        it("calls transformAuthResponse with 'refresh' method (tokens-only response)", async () => {
            const transformHook = jest.fn(async (response: AuthResponsePayload) => ({
                ...response,
                tokens: { ...response.tokens, refreshedExternalToken: "refreshed-ext" }
            }));
            const app = createApp({ authHooks: { transformAuthResponse: transformHook } });

            // Setup: valid refresh token exists
            const rawRefreshToken = "a".repeat(80);
            const hashedToken = await hashRefreshToken(rawRefreshToken);
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce({
                id: "rt-1",
                uid: "user-1",
                tokenHash: hashedToken,
                expiresAt: new Date(Date.now() + 86400000), // 1 day from now
                createdAt: new Date(),
                userAgent: "test",
                ipAddress: "127.0.0.1"
            });
            mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["editor"]);

            const res = await app.request("/auth/refresh", json({ refreshToken: rawRefreshToken }));
            expect(res.status).toBe(200);
            const body = await res.json() as Record<string, unknown>;
            const tokens = body.tokens as Record<string, unknown>;

            expect(transformHook).toHaveBeenCalledTimes(1);

            // Verify refresh context
            const hookResponse = transformHook.mock.calls[0][0] as AuthResponsePayload;
            const context = transformHook.mock.calls[0][1] as TransformAuthResponseContext;
            expect(context.method).toBe("refresh");
            expect(hookResponse.user).toBeUndefined(); // refresh has no user
            expect(tokens.refreshedExternalToken).toBe("refreshed-ext");
        });
    });

    // ── Error handling ───────────────────────────────────────────────────

    describe("error handling", () => {
        it("returns untransformed response when hook throws", async () => {
            const transformHook = jest.fn(async () => {
                throw new Error("External service down");
            });
            const app = createApp({ authHooks: { transformAuthResponse: transformHook } });

            const res = await app.request("/auth/register", json({ email: "new@test.com", password: "StrongPass1" }));
            expect(res.status).toBe(201);
            const body = await res.json() as Record<string, unknown>;
            const tokens = body.tokens as Record<string, unknown>;
            const user = body.user as Record<string, unknown>;

            // Response is still valid (untransformed fallback)
            expect(tokens.accessToken).toBeTruthy();
            expect(tokens.refreshToken).toBeTruthy();
            expect(user.email).toBe("new@test.com");

            // Error was logged
            expect(logger.error).toHaveBeenCalledWith(
                "[AuthHooks] transformAuthResponse error",
                expect.objectContaining({ error: "External service down" })
            );
        });
    });

    // ── Opt-in behavior ──────────────────────────────────────────────────

    describe("opt-in behavior", () => {
        it("does not alter response when hook is not provided", async () => {
            const app = createApp(); // no hooks

            const res = await app.request("/auth/register", json({ email: "new@test.com", password: "StrongPass1" }));
            expect(res.status).toBe(201);
            const body = await res.json() as Record<string, unknown>;
            const tokens = body.tokens as Record<string, unknown>;
            const user = body.user as Record<string, unknown>;

            // Standard response, no extra fields
            expect(tokens.accessToken).toBeTruthy();
            expect(tokens.refreshToken).toBeTruthy();
            expect(user.email).toBe("new@test.com");
            expect(Object.keys(tokens as object)).toEqual(
                expect.arrayContaining(["accessToken", "refreshToken", "accessTokenExpiresAt"])
            );
        });
    });
});
