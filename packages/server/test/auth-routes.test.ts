/**
 * Auth Routes — Integration Tests
 *
 * Tests the full Hono request → route handler → JSON response cycle.
 * Services are mocked so we can exercise the HTTP layer in isolation while
 * still verifying business logic (first-user bootstrap, token rotation, etc.).
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, AuthModuleConfig } from "../src/auth/routes";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken, hashRefreshToken } from "../src/auth/jwt";

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
        strictAuthLimiter: passthrough,
        // Exercised for real in `send-verification-rate-limit.test.ts`.
        verificationEmailLimiter: passthrough
    };
});

import { hashPassword, verifyPassword, validatePasswordStrength } from "../src/auth/password";
import { logger } from "../src/utils/logger";
import { z } from "zod";

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
let mockEmailService: { send: jest.Mock; isConfigured: jest.Mock };

function createApp(opts: { allowRegistration?: boolean; disableSelfRegistration?: boolean; withEmail?: boolean; defaultRole?: string; allowUserLookup?: boolean; isBootstrapCompleted?: () => Promise<boolean>; cookieAuth?: { sameSite?: "Lax" | "Strict" | "None" } } = {}) {
    // Re-create mocked service instances each time

    // Wire constructor mocks to return our instances

    // Default returns for mocked services

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
        listUsersPaginated: jest.fn().mockResolvedValue({ users: [],
total: 0,
limit: 1,
offset: 0 }),
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
        markRefreshTokenRotated: jest.fn().mockResolvedValue(undefined),
        revokeRefreshTokenSession: jest.fn().mockResolvedValue(undefined),
        pruneRefreshTokens: jest.fn().mockResolvedValue(undefined),
        getTokensValidAfter: jest.fn().mockResolvedValue(null),
        setTokensValidAfter: jest.fn().mockResolvedValue(undefined),
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

    // Email mock
    mockEmailService = { send: jest.fn().mockResolvedValue(undefined),
isConfigured: jest.fn().mockReturnValue(opts.withEmail ?? false) };

    const config: AuthModuleConfig = {
        authRepo: mockAuthRepo,
        allowRegistration: opts.allowRegistration ?? true,
        disableSelfRegistration: opts.disableSelfRegistration,
        allowUserLookup: opts.allowUserLookup ?? false,
        defaultRole: opts.defaultRole,
        emailService: opts.withEmail ? mockEmailService as any : undefined,
        emailConfig: opts.withEmail ? { from: "test@test.com",
appName: "TestApp",
resetPasswordUrl: "https://app.test",
verifyEmailUrl: "https://app.test" } : undefined,
        oauthProviders: opts.withEmail === false && opts.allowRegistration === false ? [] : [
            {
                id: "google",
                schema: z.object({ idToken: z.string().min(1) }),
                verify: async (payload: any) => {
                    const idToken = payload.idToken;
                    if (idToken === "bad-token") return null;
                    if (idToken === "link-token") return { providerId: "g-456",
email: "existing@test.com",
displayName: "Existing",
photoUrl: null,
emailVerified: true };
                    if (idToken === "returning-token") return { providerId: "g-789",
email: "returning@test.com",
displayName: "Updated Name",
photoUrl: "https://new-photo.url",
emailVerified: true };
                    if (idToken === "valid-token") return { providerId: "g-123",
email: "google@test.com",
displayName: "Google User",
photoUrl: "https://photo.url",
emailVerified: true };
                    // Same email as "link-token", but the provider did NOT
                    // assert the address as verified.
                    if (idToken === "unverified-token") return { providerId: "g-999",
email: "existing@test.com",
displayName: "Unverified",
photoUrl: null,
emailVerified: false };
                    return null;
                }
            }
        ]
    };

    if (opts.isBootstrapCompleted) {
        config.isBootstrapCompleted = opts.isBootstrapCompleted;
    }

    if (opts.cookieAuth) {
        config.cookieAuth = opts.cookieAuth as AuthModuleConfig["cookieAuth"];
    }


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

/** A live, unrotated refresh-token row, unless the test says otherwise. */
function storedToken(overrides: Record<string, unknown> = {}) {
    return {
        id: "rt-1",
        uid: "user-1",
        sessionId: "session-1",
        tokenHash: "old-hash",
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        sessionStartedAt: new Date(),
        rotatedAt: null,
        revoked: false,
        userAgent: "",
        ipAddress: "",
        ...overrides
    } as any;
}

function authHeader(uid = "user-1", roles = ["editor"]) {
    return { Authorization: `Bearer ${generateAccessToken(uid, roles)}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth Routes (Integration)", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("Configuration Security", () => {
        it("throws an error when defaultRole is set to 'admin'", () => {
            expect(() => createApp({ defaultRole: "admin" })).toThrow(/CRITICAL SECURITY ERROR/);
        });
    });

    // ── Registration ────────────────────────────────────────────────────
    describe("POST /auth/register", () => {
        it("registers a new user and returns 201 with tokens", async () => {
            const app = createApp();

            const res = await app.request("/auth/register", json({ email: "new@test.com",
password: "StrongPass1" }));
            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.tokens.accessToken).toBeTruthy();
            expect(body.tokens.refreshToken).toBeTruthy();
            expect(body.user.email).toBe("new@test.com");
        });

        it("first user does NOT get admin role (must use bootstrap)", async () => {
            const app = createApp();

            await app.request("/auth/register", json({ email: "first@test.com",
password: "StrongPass1" }));
            // No admin assignment — users must bootstrap via POST /admin/bootstrap
            expect(mockAuthRepo.assignDefaultRole).not.toHaveBeenCalled();
        });

        it("assigns configured default role to new users", async () => {
            const app = createApp({ defaultRole: "editor" });

            await app.request("/auth/register", json({ email: "second@test.com",
password: "StrongPass1" }));
            expect(mockAuthRepo.assignDefaultRole).toHaveBeenCalledWith(expect.any(String), "editor");
        });

        it("does not assign role when defaultRole is not configured", async () => {
            const app = createApp();

            await app.request("/auth/register", json({ email: "third@test.com",
password: "StrongPass1" }));
            expect(mockAuthRepo.assignDefaultRole).not.toHaveBeenCalled();
        });

        it("returns 409 when email already exists", async () => {
            const app = createApp();
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());

            const res = await app.request("/auth/register", json({ email: "existing@test.com",
password: "StrongPass1" }));
            expect(res.status).toBe(409);
            const body = await res.json() as any;
            expect(body.error.code).toBe("EMAIL_EXISTS");
        });

        it("returns 400 for weak password", async () => {
            const app = createApp();
            (validatePasswordStrength as jest.Mock).mockReturnValueOnce({ valid: false,
errors: ["Too short"] });

            const res = await app.request("/auth/register", json({ email: "new@test.com",
password: "weak" }));
            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe("WEAK_PASSWORD");
        });

        it("returns 400 for invalid email (Zod)", async () => {
            const app = createApp();
            const res = await app.request("/auth/register", json({ email: "not-an-email",
password: "StrongPass1" }));
            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_INPUT");
        });

        it("returns 400 for missing password", async () => {
            const app = createApp();
            const res = await app.request("/auth/register", json({ email: "a@b.com" }));
            expect(res.status).toBe(400);
        });

        it("returns 403 when registration is disabled and users exist", async () => {
            const app = createApp({ allowRegistration: false });
            mockAuthRepo.listUsersPaginated.mockResolvedValue({ users: [mockUser()],
total: 1,
limit: 1,
offset: 0 } as any);

            const res = await app.request("/auth/register", json({ email: "new@test.com",
password: "StrongPass1" }));
            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.code).toBe("REGISTRATION_DISABLED");
            expect(mockAuthRepo.createUser).not.toHaveBeenCalled();
        });

        it("empty database: admits the first registration even when allowRegistration=false and promotes it to admin", async () => {
            // The bootstrap exception. Refusing here is a dead end: /auth/config
            // advertises registration while the table is empty, the login UI
            // shows the first-admin form, and /admin/bootstrap requires an
            // authenticated caller an empty database cannot produce.
            const app = createApp({ allowRegistration: false });
            const bootUser = mockUser({ id: "boot-1",
email: "first@test.com" });
            mockAuthRepo.createUser.mockResolvedValueOnce(bootUser as any);
            // the gate's paginated count sees an empty table (default mock),
            // and the post-create check confirms they really are the first
            mockAuthRepo.listUsers.mockResolvedValueOnce([bootUser] as any);

            const res = await app.request("/auth/register", json({ email: "first@test.com",
password: "StrongPass1" }));
            expect(res.status).toBe(201);
            expect(mockAuthRepo.setUserRoles).toHaveBeenCalledWith("boot-1", ["admin"]);
        });

        it("rolls back the loser of a concurrent bootstrap registration", async () => {
            // Both racers pass the empty-table check; only the genuine first
            // user may ride the exception. The loser must not survive as a
            // regular account created while registration is disabled.
            const app = createApp({ allowRegistration: false });
            const loser = mockUser({ id: "loser-1",
email: "second@test.com" });
            const winner = mockUser({ id: "winner-1",
email: "first@test.com" });
            mockAuthRepo.createUser.mockResolvedValueOnce(loser as any);
            // the gate's paginated count saw an empty table (default mock),
            // but another registration landed before the post-create check
            mockAuthRepo.listUsers.mockResolvedValueOnce([winner, loser] as any);

            const res = await app.request("/auth/register", json({ email: "second@test.com",
password: "StrongPass1" }));
            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.code).toBe("REGISTRATION_DISABLED");
            expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith("loser-1");
            expect(mockAuthRepo.setUserRoles).not.toHaveBeenCalled();
        });

        it("disableSelfRegistration blocks even the empty-database bootstrap", async () => {
            const app = createApp({ allowRegistration: false,
disableSelfRegistration: true });
            mockAuthRepo.listUsers.mockResolvedValue([]);

            const res = await app.request("/auth/register", json({ email: "first@test.com",
password: "StrongPass1" }));
            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.code).toBe("REGISTRATION_DISABLED");
            expect(mockAuthRepo.createUser).not.toHaveBeenCalled();
        });

        it("stores refresh token after registration", async () => {
            const app = createApp();

            await app.request("/auth/register", json({ email: "a@b.com",
password: "StrongPass1" }));
            expect(mockAuthRepo.createRefreshToken).toHaveBeenCalledTimes(1);
        });
    });

    // ── Login ───────────────────────────────────────────────────────────
    describe("POST /auth/login", () => {
        it("returns tokens on successful login", async () => {
            const app = createApp();
            const user = mockUser({ passwordHash: "salt:hash" });
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(user);

            const res = await app.request("/auth/login", json({ email: "test@example.com",
password: "ValidPass1" }));
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.tokens.accessToken).toBeTruthy();
            expect(body.user.uid).toBe("user-1");
        });

        it("returns 401 for non-existent email", async () => {
            const app = createApp();
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(null);

            const res = await app.request("/auth/login", json({ email: "nobody@test.com",
password: "Any1" }));
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_CREDENTIALS");
        });

        it("returns 401 for wrong password", async () => {
            const app = createApp();
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());
            (verifyPassword as jest.Mock).mockResolvedValueOnce(false);

            const res = await app.request("/auth/login", json({ email: "test@example.com",
password: "Wrong1" }));
            expect(res.status).toBe(401);
        });

        it("returns 401 for user without password hash (Google-only)", async () => {
            const app = createApp();
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser({ passwordHash: null }));

            const res = await app.request("/auth/login", json({ email: "google@test.com",
password: "Any1" }));
            expect(res.status).toBe(401);
        });

        it("returns 400 for missing email field", async () => {
            const app = createApp();
            const res = await app.request("/auth/login", json({ password: "Any1" }));
            expect(res.status).toBe(400);
        });

        it("stores refresh token on login", async () => {
            const app = createApp();
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());

            await app.request("/auth/login", json({ email: "test@example.com",
                password: "ValidPass1" }));
            expect(mockAuthRepo.createRefreshToken).toHaveBeenCalledTimes(1);
        });

        it("emits a structured security audit log on successful login", async () => {
            const app = createApp();
            const user = mockUser({ passwordHash: "salt:hash" });
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(user);

            await app.request("/auth/login", json({ email: "test@example.com", password: "ValidPass1" }));
            
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining("[Security Audit] Auth login success"),
                expect.objectContaining({
                    uid: "user-1",
                    email: "test@example.com",
                    eventType: "auth.login.success"
                })
            );
        });

        it("emits a structured security audit log on failed login (wrong password)", async () => {
            const app = createApp();
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());
            (verifyPassword as jest.Mock).mockResolvedValueOnce(false);

            await app.request("/auth/login", json({ email: "test@example.com", password: "WrongPassword" }));
            
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining("[Security Audit] Auth login failure"),
                expect.objectContaining({
                    email: "test@example.com",
                    uid: "user-1",
                    eventType: "auth.login.failure"
                })
            );
        });
    });

    // ── Google OAuth ────────────────────────────────────────────────────
    describe("POST /auth/google", () => {
        it("returns 404 when OAuth provider is not injected", async () => {
            const app = createApp({ allowRegistration: false,
withEmail: false }); // Hack to pass empty list of providers
            const res = await app.request("/auth/google", json({ idToken: "google-token" }));
            expect(res.status).toBe(404);
        });

        it("returns 401 for invalid Google token", async () => {
            const app = createApp();

            const res = await app.request("/auth/google", json({ idToken: "bad-token" }));
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_TOKEN");
        });

        it("creates a new user for new Google sign-in", async () => {
            const app = createApp();
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(null);
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(null);

            const res = await app.request("/auth/google", json({ idToken: "valid-token" }));
            expect(res.status).toBe(200);
            expect(mockAuthRepo.createUser).toHaveBeenCalledWith(expect.objectContaining({
                email: "google@test.com"
            }));
            expect(mockAuthRepo.linkUserIdentity).toHaveBeenCalledWith(expect.any(String), "google", "g-123", expect.any(Object));
            // Verify no admin auto-assignment
            expect(mockAuthRepo.assignDefaultRole).not.toHaveBeenCalled();
        });

        it("links Google to existing account by email", async () => {
            const app = createApp();
            // Verified on the local side too — auto-linking requires both
            // halves to be trustworthy, see the pre-hijack case below.
            const existing = mockUser({ email: "existing@test.com", emailVerified: true });
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(null);
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(existing);

            const res = await app.request("/auth/google", json({ idToken: "link-token" }));
            expect(res.status).toBe(200);
            expect(mockAuthRepo.linkUserIdentity).toHaveBeenCalledWith(existing.id, "google", "g-456", expect.any(Object));
        });

        it("updates profile for returning Google user", async () => {
            const app = createApp();
            const existingUser = mockUser({ id: "g-user-1" });
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(existingUser);

            const res = await app.request("/auth/google", json({ idToken: "returning-token" }));
            expect(res.status).toBe(200);
            expect(mockAuthRepo.updateUser).toHaveBeenCalledWith(existingUser.id, expect.objectContaining({
                displayName: "Updated Name",
                photoUrl: "https://new-photo.url"
            }));
        });
    });

    // ── Account linking across sign-in methods ──────────────────────────
    //
    // Ground truth for: "user signs up with email/password, then signs in
    // with Google using the same address". Rebase links to the EXISTING
    // account when — and only when — the provider asserts the email as
    // verified. It never silently creates a second user for the same
    // address, in either direction.
    describe("password account + Google sign-in with the same email", () => {
        it("links to the existing user (no second account) when the provider verified the email", async () => {
            const app = createApp();
            const passwordUser = mockUser({ id: "pw-user-1", email: "existing@test.com", passwordHash: "salt:hash", emailVerified: true });
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(null);
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(passwordUser);

            const res = await app.request("/auth/google", json({ idToken: "link-token" }));

            expect(res.status).toBe(200);
            // The identity is attached to the pre-existing password account...
            expect(mockAuthRepo.linkUserIdentity).toHaveBeenCalledWith(
                passwordUser.id, "google", "g-456", expect.any(Object)
            );
            // ...and crucially, no duplicate user is created.
            expect(mockAuthRepo.createUser).not.toHaveBeenCalled();
            const body = await res.json() as any;
            expect(body.user.uid).toBe(passwordUser.id);
        });

        it("rejects with EMAIL_NOT_VERIFIED when the provider did not verify the email", async () => {
            const app = createApp();
            const passwordUser = mockUser({ id: "pw-user-1", email: "existing@test.com", passwordHash: "salt:hash" });
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(null);
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(passwordUser);

            const res = await app.request("/auth/google", json({ idToken: "unverified-token" }));

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.code).toBe("EMAIL_NOT_VERIFIED");
            // No takeover, and no duplicate account as a consolation prize.
            expect(mockAuthRepo.linkUserIdentity).not.toHaveBeenCalled();
            expect(mockAuthRepo.createUser).not.toHaveBeenCalled();
        });
    });

    // ── Explicit linking while authenticated ────────────────────────────
    //
    // The escape hatch the EMAIL_NOT_VERIFIED rejection points users at.
    describe("POST /auth/link/google", () => {
        function linkRequest(uid: string, idToken: string) {
            const req = json({ idToken });
            return { ...req, headers: { ...req.headers, ...authHeader(uid) } };
        }

        it("requires authentication", async () => {
            const app = createApp();
            const res = await app.request("/auth/link/google", json({ idToken: "valid-token" }));
            expect(res.status).toBe(401);
            expect(mockAuthRepo.linkUserIdentity).not.toHaveBeenCalled();
        });

        it("links an unverified-email provider identity to the session's account", async () => {
            const app = createApp();
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(null);

            // Same credential the sign-in route refuses with EMAIL_NOT_VERIFIED.
            const res = await app.request("/auth/link/google", linkRequest("pw-user-1", "unverified-token"));

            expect(res.status).toBe(200);
            // Verification status is irrelevant here: the session proves
            // account ownership, so the email is not load-bearing.
            expect(mockAuthRepo.linkUserIdentity).toHaveBeenCalledWith(
                "pw-user-1", "google", "g-999", expect.any(Object)
            );
        });

        it("refuses to steal an identity already linked to another user", async () => {
            const app = createApp();
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(mockUser({ id: "other-user" }));

            const res = await app.request("/auth/link/google", linkRequest("pw-user-1", "valid-token"));

            expect(res.status).toBe(409);
            const body = await res.json() as any;
            expect(body.error.code).toBe("IDENTITY_ALREADY_LINKED");
            expect(mockAuthRepo.linkUserIdentity).not.toHaveBeenCalled();
        });

        it("is idempotent when the identity is already linked to the same user", async () => {
            const app = createApp();
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(mockUser({ id: "pw-user-1" }));

            const res = await app.request("/auth/link/google", linkRequest("pw-user-1", "valid-token"));

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.alreadyLinked).toBe(true);
            expect(mockAuthRepo.linkUserIdentity).not.toHaveBeenCalled();
        });

        it("rejects an invalid provider credential", async () => {
            const app = createApp();
            const res = await app.request("/auth/link/google", linkRequest("pw-user-1", "bad-token"));
            expect(res.status).toBe(401);
            expect(mockAuthRepo.linkUserIdentity).not.toHaveBeenCalled();
        });
    });

    describe("Google account + later email/password signup (reverse direction)", () => {
        it("refuses to register a second account for an address Google already owns", async () => {
            const app = createApp();
            const googleUser = mockUser({ id: "g-user-1", email: "google@test.com", passwordHash: null });
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(googleUser);

            const res = await app.request("/auth/register", json({
                email: "google@test.com",
                password: "SomePassword123!"
            }));

            expect(res.status).toBe(409);
            const body = await res.json() as any;
            expect(body.error.code).toBe("EMAIL_EXISTS");
            expect(mockAuthRepo.createUser).not.toHaveBeenCalled();
        });

        it("cannot add a password via change-password (no existing password to verify)", async () => {
            const app = createApp();
            const googleUser = mockUser({ id: "g-user-1", email: "google@test.com", passwordHash: null });
            mockAuthRepo.getUserById.mockResolvedValue(googleUser);

            const req = json({ oldPassword: "anything", newPassword: "NewPassword123!" });
            const res = await app.request("/auth/change-password", {
                ...req,
                headers: { ...req.headers, ...authHeader(googleUser.id) }
            });

            // The supported route for a provider-only account to gain a
            // password is forgot-password → reset-password, which re-proves
            // ownership of the address via email.
            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_ACCOUNT");
        });
    });

    // ── Token Refresh ───────────────────────────────────────────────────
    describe("POST /auth/refresh", () => {
        // Cookie mode sends NO body — the refresh token is in the httpOnly
        // cookie, which is the point of it. Parsing the body unguarded made
        // every one of these a 500, so sessions never restored and users were
        // signed out on each page load. Every other test here sends a body,
        // which is exactly why that shipped.
        it("refreshes from the cookie alone, with no request body at all", async () => {
            const app = createApp({ cookieAuth: { sameSite: "Lax" } });
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce({
                id: "rt-1",
                uid: "user-1",
                tokenHash: "old-hash",
                expiresAt: new Date(Date.now() + 86400000),
                createdAt: new Date(),
                userAgent: "",
                ipAddress: ""
            });
            mockAuthRepo.getUserRoles.mockResolvedValueOnce([mockRole("editor")]);

            const res = await app.request("/auth/refresh", {
                method: "POST",
                headers: { cookie: "__rb_refresh=valid-refresh-token" }
                // deliberately no body and no Content-Type
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.tokens.accessToken).toBeTruthy();
        });

        it("401s an empty body — no session, not a malformed request", async () => {
            // A visitor with no session is not sending a bad request: clients
            // refresh on page load before they know whether one exists, so this
            // is the single most common way the route is called. It used to
            // answer 400 INVALID_INPUT and log a warning for every anonymous
            // page view; it is a 401 now, alongside the other token failures.
            const app = createApp();
            const res = await app.request("/auth/refresh", { method: "POST" });
            expect(res.status).not.toBe(500);
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("NO_SESSION");
        });

        it("returns new tokens on valid refresh", async () => {
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce({
                id: "rt-1",
                uid: "user-1",
                tokenHash: "old-hash",
                expiresAt: new Date(Date.now() + 86400000),
                createdAt: new Date(),
                userAgent: "",
                ipAddress: ""
            });
            mockAuthRepo.getUserRoles.mockResolvedValueOnce([mockRole("editor")]);

            const res = await app.request("/auth/refresh", json({ refreshToken: "valid-refresh-token" }));
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.tokens.accessToken).toBeTruthy();
            expect(body.tokens.refreshToken).toBeTruthy();
        });

        it("includes the user in the response so a cookie session can be restored", async () => {
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce({
                id: "rt-1",
                uid: "user-1",
                tokenHash: "old-hash",
                expiresAt: new Date(Date.now() + 86400000),
                createdAt: new Date(),
                userAgent: "",
                ipAddress: ""
            });
            mockAuthRepo.getUserRoles.mockResolvedValueOnce([mockRole("editor")]);
            mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "user-1", email: "restore@example.com" }));

            const res = await app.request("/auth/refresh", json({ refreshToken: "valid-refresh-token" }));
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.uid).toBe("user-1");
            expect(body.user.email).toBe("restore@example.com");
            expect(body.user.roles).toEqual(["editor"]);
        });

        it("still returns 200 tokens if user enrichment fails (never 500s)", async () => {
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce({
                id: "rt-1",
                uid: "user-1",
                tokenHash: "old-hash",
                expiresAt: new Date(Date.now() + 86400000),
                createdAt: new Date(),
                userAgent: "",
                ipAddress: ""
            });
            mockAuthRepo.getUserRoles.mockResolvedValueOnce([mockRole("editor")]);
            // The user lookup blows up (the regression that 500'd /refresh on CI).
            mockAuthRepo.getUserById.mockRejectedValueOnce(new Error("db exploded"));

            const res = await app.request("/auth/refresh", json({ refreshToken: "valid-refresh-token" }));
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.tokens.accessToken).toBeTruthy();
            expect(body.user).toBeUndefined();
        });

        it("rotates refresh token — supersedes old, creates new, never deletes", async () => {
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(storedToken());

            await app.request("/auth/refresh", json({ refreshToken: "the-token" }));
            // Superseded, NOT deleted: the row is the only thing that can later
            // tell a client replaying this token apart from a forgery.
            expect(mockAuthRepo.markRefreshTokenRotated).toHaveBeenCalledTimes(1);
            expect(mockAuthRepo.deleteRefreshToken).not.toHaveBeenCalled();
            expect(mockAuthRepo.createRefreshToken).toHaveBeenCalledTimes(1);
        });

        it("keeps the successor in the same session, dated from the sign-in", async () => {
            const app = createApp();
            const startedAt = new Date(Date.now() - 3 * 86400000);
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(
                storedToken({ sessionId: "session-42", sessionStartedAt: startedAt })
            );

            await app.request("/auth/refresh", json({ refreshToken: "the-token" }));

            const session = mockAuthRepo.createRefreshToken.mock.calls[0][5];
            expect(session).toEqual({ id: "session-42", startedAt });
        });

        it("falls back to deleting when the repository predates rotation tracking", async () => {
            const app = createApp();
            // A host application's own TokenRepository, written before these
            // methods existed, must still work — just without the grace.
            (mockAuthRepo as any).markRefreshTokenRotated = undefined;
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(storedToken());

            const res = await app.request("/auth/refresh", json({ refreshToken: "the-token" }));
            expect(res.status).toBe(200);
            expect(mockAuthRepo.deleteRefreshToken).toHaveBeenCalledTimes(1);
        });

        it("returns 401 for unknown refresh token", async () => {
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(null);

            const res = await app.request("/auth/refresh", json({ refreshToken: "unknown" }));
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_TOKEN");
        });

        it("does NOT clear the cookie when the token is unrecognised", async () => {
            // The regression this whole design exists to prevent: one stale
            // request — a duplicate from another tab, a retry after a deploy —
            // used to wipe the cookie and sign out a live session.
            const app = createApp({ cookieAuth: { sameSite: "Lax" } });
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(null);

            const res = await app.request("/auth/refresh", {
                method: "POST",
                headers: { cookie: "__rb_refresh=stale-token" }
            });

            expect(res.status).toBe(401);
            expect(res.headers.get("set-cookie")).toBeNull();
        });

        it("accepts a token replayed inside the reuse window and mints a sibling", async () => {
            // The lost-response case: the client never saw the rotated token,
            // so it presents the old one. It gets a working session, not a 401.
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(
                storedToken({ sessionId: "session-1", rotatedAt: new Date(Date.now() - 2000) })
            );

            const res = await app.request("/auth/refresh", json({ refreshToken: "lost-response-token" }));

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.tokens.accessToken).toBeTruthy();
            // The parent keeps its original rotation stamp — re-marking it
            // would slide the window forward on every replay.
            expect(mockAuthRepo.markRefreshTokenRotated).not.toHaveBeenCalled();
            expect(mockAuthRepo.createRefreshToken.mock.calls[0][5]).toMatchObject({ id: "session-1" });
        });

        it("rejects a replay after the window without touching the live session", async () => {
            const app = createApp({ cookieAuth: { sameSite: "Lax" } });
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(
                storedToken({ sessionId: "session-1", rotatedAt: new Date(Date.now() - 60_000) })
            );

            const res = await app.request("/auth/refresh", {
                method: "POST",
                headers: { cookie: "__rb_refresh=long-stale-token" }
            });

            expect(res.status).toBe(401);
            expect((await res.json() as any).error.code).toBe("TOKEN_ALREADY_USED");
            // The sibling this token was rotated into is still good — the
            // straggler must not take the whole sign-in down with it.
            expect(mockAuthRepo.revokeRefreshTokenSession).not.toHaveBeenCalled();
            expect(mockAuthRepo.createRefreshToken).not.toHaveBeenCalled();
            expect(res.headers.get("set-cookie")).toBeNull();
        });

        it("rejects a hard-revoked token and clears the cookie", async () => {
            const app = createApp({ cookieAuth: { sameSite: "Lax" } });
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(storedToken({ revoked: true }));

            const res = await app.request("/auth/refresh", {
                method: "POST",
                headers: { cookie: "__rb_refresh=revoked-token" }
            });

            expect(res.status).toBe(401);
            expect((await res.json() as any).error.code).toBe("SESSION_REVOKED");
            // This session really is over, so the cookie should go.
            expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
        });

        it("voids a session that began before the user's revocation watermark", async () => {
            // Closes the reset-password race: a refresh already in flight can
            // insert a fresh row just after every row was deleted.
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(
                storedToken({ sessionStartedAt: new Date(Date.now() - 86400000) })
            );
            mockAuthRepo.getTokensValidAfter.mockResolvedValueOnce(new Date(Date.now() - 3600000));

            const res = await app.request("/auth/refresh", json({ refreshToken: "pre-reset-token" }));
            expect(res.status).toBe(401);
            expect((await res.json() as any).error.code).toBe("SESSION_REVOKED");
            expect(mockAuthRepo.createRefreshToken).not.toHaveBeenCalled();
        });

        it("survives a session whose repository reports no watermark support", async () => {
            const app = createApp();
            (mockAuthRepo as any).getTokensValidAfter = undefined;
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce(storedToken());

            const res = await app.request("/auth/refresh", json({ refreshToken: "the-token" }));
            expect(res.status).toBe(200);
        });

        it("returns 401 and deletes expired refresh token", async () => {
            const app = createApp();
            mockAuthRepo.findRefreshTokenByHash.mockResolvedValueOnce({
                id: "rt-1",
                uid: "user-1",
                tokenHash: "expired-hash",
                expiresAt: new Date(Date.now() - 1000), // expired
                createdAt: new Date(),
                userAgent: "",
                ipAddress: ""
            });

            const res = await app.request("/auth/refresh", json({ refreshToken: "expired-token" }));
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("TOKEN_EXPIRED");
            expect(mockAuthRepo.deleteRefreshToken).toHaveBeenCalled();
        });

        it("401s a body with no refreshToken — no session, not a bad request", async () => {
            const app = createApp();
            const res = await app.request("/auth/refresh", json({}));
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("NO_SESSION");
        });

        it("still 400s a malformed refreshToken (wrong type)", async () => {
            // A present-but-invalid value is a genuine client error and stays a
            // 400 — only the *absence* of a token is reclassified as 401.
            const app = createApp();
            const res = await app.request("/auth/refresh", json({ refreshToken: 12345 }));
            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_INPUT");
        });
    });

    // ── Logout ──────────────────────────────────────────────────────────
    describe("POST /auth/logout", () => {
        it("deletes refresh token on logout", async () => {
            const app = createApp();
            const res = await app.request("/auth/logout", json({ refreshToken: "rt-to-delete" }));
            expect(res.status).toBe(200);
            expect(mockAuthRepo.deleteRefreshToken).toHaveBeenCalledTimes(1);
        });

        it("returns 200 even without refresh token", async () => {
            const app = createApp();
            const res = await app.request("/auth/logout", json({}));
            expect(res.status).toBe(200);
            expect(mockAuthRepo.deleteRefreshToken).not.toHaveBeenCalled();
        });
    });

    // ── Forgot Password ─────────────────────────────────────────────────
    describe("POST /auth/forgot-password", () => {
        /*
         * This was named "always returns success (timing-safe)" and checked
         * neither claim: it exercised only the *unknown* address and measured
         * nothing about timing. The property that actually defends against
         * account enumeration is that the two cases are indistinguishable — and
         * a response that differed by so much as a field would have passed,
         * because the existing-user branch was never asked what it returns.
         *
         * "Timing-safe" is dropped from the name rather than pretended at: this
         * handler does real work (token, template, SMTP) only for a user that
         * exists, so it is *not* constant-time, and a unit test asserting
         * otherwise would be the most misleading kind of green.
         */
        it("answers an unknown address and a real one identically", async () => {
            const app = createApp({ withEmail: true });

            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(null);
            const unknown = await app.request("/auth/forgot-password", json({ email: "nobody@test.com" }));
            const unknownBody = await unknown.json();

            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());
            const known = await app.request("/auth/forgot-password", json({ email: "test@example.com" }));
            const knownBody = await known.json();

            // Status, and every byte of the body: anything that differs here is
            // an oracle telling an attacker which addresses have accounts.
            expect(unknown.status).toBe(200);
            expect(known.status).toBe(unknown.status);
            expect(knownBody).toEqual(unknownBody);
            expect((unknownBody as { success: boolean }).success).toBe(true);
        });

        it("says the same thing when sending the email fails", async () => {
            // The catch around `emailService.send` exists so an SMTP outage does
            // not become the same oracle. Nothing covered it.
            const app = createApp({ withEmail: true });

            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(null);
            const unknown = await app.request("/auth/forgot-password", json({ email: "nobody@test.com" }));
            const unknownBody = await unknown.json();

            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());
            mockEmailService.send.mockRejectedValueOnce(new Error("smtp down"));
            const known = await app.request("/auth/forgot-password", json({ email: "test@example.com" }));

            expect(known.status).toBe(unknown.status);
            expect(await known.json()).toEqual(unknownBody);
        });

        it("sends reset email when user exists", async () => {
            const app = createApp({ withEmail: true });
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());

            await app.request("/auth/forgot-password", json({ email: "test@example.com" }));
            expect(mockAuthRepo.createPasswordResetToken).toHaveBeenCalledTimes(1);
            expect(mockEmailService.send).toHaveBeenCalledTimes(1);
        });

        it("does not send email when user does not exist", async () => {
            const app = createApp({ withEmail: true });
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(null);

            await app.request("/auth/forgot-password", json({ email: "nobody@test.com" }));
            expect(mockAuthRepo.createPasswordResetToken).not.toHaveBeenCalled();
            expect(mockEmailService.send).not.toHaveBeenCalled();
        });

        it("returns 503 when email service is not configured", async () => {
            const app = createApp({ withEmail: false });
            const res = await app.request("/auth/forgot-password", json({ email: "test@test.com" }));
            expect(res.status).toBe(503);
            const body = await res.json() as any;
            expect(body.error.code).toBe("EMAIL_NOT_CONFIGURED");
        });
    });

    // ── Reset Password ──────────────────────────────────────────────────
    describe("POST /auth/reset-password", () => {
        it("resets password with valid token", async () => {
            const app = createApp();
            mockAuthRepo.findValidPasswordResetToken.mockResolvedValueOnce({
                uid: "user-1",
                expiresAt: new Date(Date.now() + 3600000)
            });

            const res = await app.request("/auth/reset-password", json({ token: "valid-reset-token",
password: "NewStrong1" }));
            expect(res.status).toBe(200);
            expect(mockAuthRepo.updatePassword).toHaveBeenCalledWith("user-1", "hashed-pw");
            expect(mockAuthRepo.markPasswordResetTokenUsed).toHaveBeenCalled();
        });

        it("invalidates all sessions after password reset", async () => {
            const app = createApp();
            mockAuthRepo.findValidPasswordResetToken.mockResolvedValueOnce({
                uid: "user-1",
                expiresAt: new Date(Date.now() + 3600000)
            });

            await app.request("/auth/reset-password", json({ token: "token",
password: "NewStrong1" }));
            expect(mockAuthRepo.deleteAllRefreshTokensForUser).toHaveBeenCalledWith("user-1");
        });

        it("returns 400 for invalid/expired token", async () => {
            const app = createApp();
            mockAuthRepo.findValidPasswordResetToken.mockResolvedValueOnce(null);

            const res = await app.request("/auth/reset-password", json({ token: "expired",
password: "NewStrong1" }));
            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_TOKEN");
        });

        it("returns 400 for weak new password", async () => {
            const app = createApp();
            (validatePasswordStrength as jest.Mock).mockReturnValueOnce({ valid: false,
errors: ["Too weak"] });

            const res = await app.request("/auth/reset-password", json({ token: "token",
password: "weak" }));
            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe("WEAK_PASSWORD");
        });
    });

    // ── Change Password ─────────────────────────────────────────────────
    describe("POST /auth/change-password", () => {
        it("changes password for authenticated user", async () => {
            const app = createApp();
            mockAuthRepo.getUserById.mockResolvedValue(mockUser());

            const res = await app.request("/auth/change-password", {
                ...json({ oldPassword: "OldPass1",
newPassword: "NewPass1" }),
                headers: { ...json({}).headers,
...authHeader() }
            });
            expect(res.status).toBe(200);
            expect(mockAuthRepo.updatePassword).toHaveBeenCalled();
        });

        it("invalidates all sessions after password change", async () => {
            const app = createApp();
            mockAuthRepo.getUserById.mockResolvedValue(mockUser());

            await app.request("/auth/change-password", {
                ...json({ oldPassword: "Old1",
newPassword: "New1Pass" }),
                headers: { ...json({}).headers,
...authHeader() }
            });
            expect(mockAuthRepo.deleteAllRefreshTokensForUser).toHaveBeenCalledWith("user-1");
        });

        it("returns 401 for wrong old password", async () => {
            const app = createApp();
            mockAuthRepo.getUserById.mockResolvedValue(mockUser());
            (verifyPassword as jest.Mock).mockResolvedValueOnce(false);

            const res = await app.request("/auth/change-password", {
                ...json({ oldPassword: "Wrong1",
newPassword: "New1Pass" }),
                headers: { ...json({}).headers,
...authHeader() }
            });
            expect(res.status).toBe(401);
        });

        it("returns 400 for weak new password", async () => {
            const app = createApp();
            mockAuthRepo.getUserById.mockResolvedValue(mockUser());
            (validatePasswordStrength as jest.Mock).mockReturnValueOnce({ valid: false,
errors: ["Too short"] });

            const res = await app.request("/auth/change-password", {
                ...json({ oldPassword: "Old1",
newPassword: "x" }),
                headers: { ...json({}).headers,
...authHeader() }
            });
            expect(res.status).toBe(400);
        });

        it("returns 401 without auth", async () => {
            const app = createApp();
            const res = await app.request("/auth/change-password", json({ oldPassword: "Old1",
newPassword: "New1Pass" }));
            expect(res.status).toBe(401);
        });

        it("returns 400 for user without password (Google-only account)", async () => {
            const app = createApp();
            mockAuthRepo.getUserById.mockResolvedValue(mockUser({ passwordHash: null }));

            const res = await app.request("/auth/change-password", {
                ...json({ oldPassword: "Old1",
newPassword: "New1Pass" }),
                headers: { ...json({}).headers,
...authHeader() }
            });
            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INVALID_ACCOUNT");
        });
    });

    // ── Email Verification ──────────────────────────────────────────────
    describe("Email verification", () => {
        describe("POST /auth/send-verification", () => {
            it("sends verification email for authenticated user", async () => {
                const app = createApp({ withEmail: true });
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ emailVerified: false }));

                const res = await app.request("/auth/send-verification", {
                    method: "POST",
                    headers: { ...authHeader() }
                });
                expect(res.status).toBe(200);
                expect(mockAuthRepo.setVerificationToken).toHaveBeenCalled();
                expect(mockEmailService.send).toHaveBeenCalled();
            });

            it("returns 400 when email is already verified", async () => {
                const app = createApp({ withEmail: true });
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ emailVerified: true }));

                const res = await app.request("/auth/send-verification", {
                    method: "POST",
                    headers: { ...authHeader() }
                });
                expect(res.status).toBe(400);
                const body = await res.json() as any;
                expect(body.error.code).toBe("ALREADY_VERIFIED");
            });

            it("returns 401 without auth", async () => {
                const app = createApp({ withEmail: true });
                const res = await app.request("/auth/send-verification", { method: "POST" });
                expect(res.status).toBe(401);
            });

            it("returns 503 when email service is not configured", async () => {
                const app = createApp({ withEmail: false });
                const res = await app.request("/auth/send-verification", {
                    method: "POST",
                    headers: { ...authHeader() }
                });
                expect(res.status).toBe(503);
            });
        });

        describe("GET /auth/verify-email", () => {
            it("verifies email with valid token", async () => {
                const app = createApp();
                mockAuthRepo.getUserByVerificationToken.mockResolvedValueOnce(mockUser());

                const res = await app.request("/auth/verify-email?token=valid-token");
                expect(res.status).toBe(200);
                expect(mockAuthRepo.setEmailVerified).toHaveBeenCalledWith("user-1", true);
            });

            it("returns 400 for invalid verification token", async () => {
                const app = createApp();
                mockAuthRepo.getUserByVerificationToken.mockResolvedValueOnce(null);

                const res = await app.request("/auth/verify-email?token=bad-token");
                expect(res.status).toBe(400);
                const body = await res.json() as any;
                expect(body.error.code).toBe("INVALID_TOKEN");
            });

            it("returns 400 when token is missing", async () => {
                const app = createApp();
                const res = await app.request("/auth/verify-email");
                expect(res.status).toBe(400);
            });
        });
    });

    // ── User Profile ────────────────────────────────────────────────────
    describe("GET /auth/me", () => {
        it("returns authenticated user with roles", async () => {
            const app = createApp();
            const res = await app.request("/auth/me", {
                headers: { ...authHeader("user-1", ["admin"]) }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.uid).toBe("user-1");
            expect(body.user.roles).toBeDefined();
        });

        it("returns 401 without auth", async () => {
            const app = createApp();
            const res = await app.request("/auth/me");
            expect(res.status).toBe(401);
        });

        it("returns 404 when user is deleted", async () => {
            const app = createApp();
            mockAuthRepo.getUserWithRoles.mockResolvedValueOnce(null);

            const res = await app.request("/auth/me", {
                headers: { ...authHeader() }
            });
            expect(res.status).toBe(404);
        });
    });

    describe("PATCH /auth/me", () => {
        it("updates user profile", async () => {
            const app = createApp();
            mockAuthRepo.updateUser.mockResolvedValueOnce(mockUser({ displayName: "New Name" }));

            const res = await app.request("/auth/me", {
                method: "PATCH",
                headers: { "Content-Type": "application/json",
...authHeader() },
                body: JSON.stringify({ displayName: "New Name" })
            });
            expect(res.status).toBe(200);
            expect(mockAuthRepo.updateUser).toHaveBeenCalledWith("user-1", expect.objectContaining({
                displayName: "New Name"
            }));
        });

        it("returns 401 without auth", async () => {
            const app = createApp();
            const res = await app.request("/auth/me", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName: "Name" })
            });
            expect(res.status).toBe(401);
        });
    });

    // ── Sessions ────────────────────────────────────────────────────────
    describe("Session management", () => {
        it("GET /auth/sessions lists active sessions", async () => {
            const app = createApp();
            mockAuthRepo.listRefreshTokensForUser.mockResolvedValueOnce([
                { id: "s1",
uid: "user-1",
tokenHash: "h1",
expiresAt: new Date(),
createdAt: new Date(),
userAgent: "Chrome",
ipAddress: "1.2.3.4" }
            ]);

            const res = await app.request("/auth/sessions", { headers: { ...authHeader() } });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.sessions).toHaveLength(1);
            expect(body.sessions[0].id).toBe("s1");
        });

        it("DELETE /auth/sessions revokes all sessions", async () => {
            const app = createApp();
            const res = await app.request("/auth/sessions", {
                method: "DELETE",
                headers: { ...authHeader() }
            });
            expect(res.status).toBe(200);
            expect(mockAuthRepo.deleteAllRefreshTokensForUser).toHaveBeenCalledWith("user-1");
        });

        it("DELETE /auth/sessions/:id revokes specific session", async () => {
            const app = createApp();
            const res = await app.request("/auth/sessions/s123", {
                method: "DELETE",
                headers: { ...authHeader() }
            });
            expect(res.status).toBe(200);
            expect(mockAuthRepo.deleteRefreshTokenById).toHaveBeenCalledWith("s123", "user-1");
        });

        it("sessions endpoints return 401 without auth", async () => {
            const app = createApp();
            const res1 = await app.request("/auth/sessions");
            expect(res1.status).toBe(401);

            const res2 = await app.request("/auth/sessions", { method: "DELETE" });
            expect(res2.status).toBe(401);
        });

        it("DELETE /auth/sessions/:id revokes the family of the token that was named", async () => {
            // The id in the URL names one token row, and the route resolves it
            // to the session family behind it — a device holds several rotated
            // siblings, and killing one leaves the device signed in. Nothing
            // checked *which* row it resolved: with more than one session on
            // file, matching the wrong row signs the user out of the laptop they
            // are sitting at and leaves the phone they were revoking alive.
            const app = createApp();
            mockAuthRepo.listRefreshTokensForUser.mockResolvedValueOnce([
                { id: "tok-laptop",
uid: "user-1",
tokenHash: "h1",
sessionId: "sess-laptop",
expiresAt: new Date(),
createdAt: new Date() },
                { id: "tok-phone",
uid: "user-1",
tokenHash: "h2",
sessionId: "sess-phone",
expiresAt: new Date(),
createdAt: new Date() }
            ] as never);

            const res = await app.request("/auth/sessions/tok-phone", {
                method: "DELETE",
                headers: { ...authHeader() }
            });

            expect(res.status).toBe(200);
            expect(mockAuthRepo.revokeRefreshTokenSession).toHaveBeenCalledTimes(1);
            expect(mockAuthRepo.revokeRefreshTokenSession).toHaveBeenCalledWith("sess-phone");
            // …and the row-level fallback is not also fired.
            expect(mockAuthRepo.deleteRefreshTokenById).not.toHaveBeenCalled();
        });

        it("DELETE /auth/sessions/:id falls back to the single row when the id is not the caller's", async () => {
            // `owned` is already scoped to the caller, so an id that is not in it
            // is either stale or someone else's. The fallback deletes by id *and*
            // uid, which is the layer that keeps it from touching another user.
            const app = createApp();
            mockAuthRepo.listRefreshTokensForUser.mockResolvedValueOnce([
                { id: "tok-laptop",
uid: "user-1",
tokenHash: "h1",
sessionId: "sess-laptop",
expiresAt: new Date(),
createdAt: new Date() }
            ] as never);

            const res = await app.request("/auth/sessions/tok-someone-else", {
                method: "DELETE",
                headers: { ...authHeader() }
            });

            expect(res.status).toBe(200);
            expect(mockAuthRepo.revokeRefreshTokenSession).not.toHaveBeenCalled();
            expect(mockAuthRepo.deleteRefreshTokenById).toHaveBeenCalledWith("tok-someone-else", "user-1");
        });
    });

    // ── MFA challenge ownership ─────────────────────────────────────────
    describe("POST /auth/mfa/challenge", () => {
        /**
         * A challenge is the step between "password accepted" and "session
         * upgraded to aal2". Opening one against a factor belonging to somebody
         * else would let a caller drive another account's second factor — so the
         * route checks that the factor's uid is the caller's. Nothing tested
         * that check: inverting it (`!==` → `===`) left the whole suite green.
         */
        function withFactor(app: ReturnType<typeof createApp>, factor: unknown) {
            (mockAuthRepo as unknown as Record<string, unknown>).getMfaFactorById =
                jest.fn().mockResolvedValue(factor);
            (mockAuthRepo as unknown as Record<string, unknown>).createMfaChallenge =
                jest.fn().mockResolvedValue({ id: "challenge-1",
factorId: "factor-1" });
            return app;
        }

        function challenge(app: ReturnType<typeof createApp>, uid = "user-1") {
            return app.request("/auth/mfa/challenge", {
                ...json({ factorId: "factor-1" }),
                headers: { "Content-Type": "application/json",
...authHeader(uid) }
            });
        }

        it("opens a challenge against the caller's own factor", async () => {
            const app = withFactor(createApp(), { id: "factor-1",
uid: "user-1",
verified: true });

            const res = await challenge(app);

            expect(res.status).toBe(200);
            const body = await res.json() as { challengeId: string; factorId: string };
            expect(body.challengeId).toBe("challenge-1");
            expect(body.factorId).toBe("factor-1");
        });

        it("refuses a factor that belongs to another user", async () => {
            const app = withFactor(createApp(), { id: "factor-1",
uid: "someone-else",
verified: true });

            const res = await challenge(app);

            expect(res.status).toBe(404);
            expect((await res.json() as { error: { message: string } }).error.message)
                .toBe("MFA factor not found");
            // No challenge is minted for a factor the caller does not own — a
            // 404 that still created one would be a leak with a polite status.
            expect((mockAuthRepo as unknown as { createMfaChallenge: jest.Mock }).createMfaChallenge)
                .not.toHaveBeenCalled();
        });

        it("refuses a factor id that does not exist", async () => {
            const app = withFactor(createApp(), null);

            const res = await challenge(app);

            expect(res.status).toBe(404);
            expect((mockAuthRepo as unknown as { createMfaChallenge: jest.Mock }).createMfaChallenge)
                .not.toHaveBeenCalled();
        });
    });

    // ── Auth Config ─────────────────────────────────────────────────────
    describe("GET /auth/config", () => {
        it("returns needsSetup=true when isBootstrapCompleted returns false", async () => {
            const app = createApp({ isBootstrapCompleted: async () => false });

            const res = await app.request("/auth/config");
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.needsSetup).toBe(true);
            expect(body.registrationEnabled).toBe(true); // always true when needsSetup
        });

        it("returns needsSetup=false when isBootstrapCompleted returns true", async () => {
            const app = createApp({ allowRegistration: false,
isBootstrapCompleted: async () => true });

            const res = await app.request("/auth/config");
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.needsSetup).toBe(false);
            expect(body.registrationEnabled).toBe(false);
        });

        it("falls back to user-count check when no isBootstrapCompleted callback", async () => {
            const app = createApp();
            mockAuthRepo.listUsers.mockResolvedValueOnce([]);

            const res = await app.request("/auth/config");
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.needsSetup).toBe(true);
            expect(body.registrationEnabled).toBe(true);
        });

        it("returns correct flags when users exist and no callback", async () => {
            const app = createApp({ allowRegistration: false,
withEmail: false });
            mockAuthRepo.listUsers.mockResolvedValueOnce([mockUser()]);

            const res = await app.request("/auth/config");
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.needsSetup).toBe(false);
            expect(body.registrationEnabled).toBe(false);
            expect(body.enabledProviders).toEqual([]);
        });

        it("reports Google enabled when configured", async () => {
            const app = createApp();
            mockAuthRepo.listUsers.mockResolvedValueOnce([mockUser()]);

            const res = await app.request("/auth/config");
            const body = await res.json() as any;
            expect(body.enabledProviders).toContain("google");
        });

        it("does not advertise registration when disableSelfRegistration is set", async () => {
            // Otherwise the UI is sent to a form whose POST can only 403 —
            // the exact dead end the bootstrap exception exists to prevent.
            const app = createApp({ disableSelfRegistration: true,
isBootstrapCompleted: async () => false });

            const res = await app.request("/auth/config");
            const body = await res.json() as any;
            expect(body.needsSetup).toBe(true);
            expect(body.registrationEnabled).toBe(false);
        });
    });

    // ═════════════════════════════════════════════════════════════════════
    // SECURITY REGRESSION TESTS — CVE: First-User Admin Privilege Escalation
    // These tests directly verify the exploit scenarios from the security audit.
    // ═════════════════════════════════════════════════════════════════════

    /*
     * These were four tests named "CVE-FIX: … NEVER assigns admin role, even
     * for first user", and not one of them could fail.
     *
     * Each asserted `assignDefaultRole` was not called with "admin". But the
     * first user is promoted through a different call entirely —
     * `setUserRoles(id, ["admin"])` (routes.ts, and again on the OAuth path) —
     * and in that branch `assignDefaultRole` is never reached at all. So they
     * watched a function the escalation path does not use, and passed by
     * construction.
     *
     * Their names were also simply wrong about the system: registration *does*
     * make the first user an admin. That is the documented bootstrap, asserted
     * 1,100 lines above in "empty database: admits the first registration …
     * and promotes it to admin". A reader of this block was told the opposite,
     * under a CVE label.
     *
     * The real property is narrower and is what these now assert: the bootstrap
     * is for the *first* user only, and no later registration reaches admin by
     * any mechanism.
     */
    describe("Security: privilege escalation prevention", () => {
        /** Every route by which a caller could end up holding "admin". */
        const grantedAdmin = () =>
            mockAuthRepo.setUserRoles.mock.calls.some(([, roles]: [string, string[]]) =>
                Array.isArray(roles) && roles.includes("admin"))
            || mockAuthRepo.assignDefaultRole.mock.calls.some(([, role]: [string, string]) =>
                role === "admin");

        it("promotes the genuine first user — the documented bootstrap", async () => {
            // Stated positively, so this block starts from what the system does
            // rather than from a claim that contradicts it. Without this, the
            // "never promotes" tests below would also pass on a build where the
            // bootstrap had silently stopped working.
            const app = createApp({ allowRegistration: true });
            const first = mockUser({ id: "boot-1", email: "first@test.com" });
            mockAuthRepo.createUser.mockResolvedValueOnce(first as never);
            mockAuthRepo.listUsers.mockResolvedValueOnce([first] as never);

            const res = await app.request("/auth/register", json({
                email: "first@test.com",
                password: "StrongPass1"
            }));

            expect(res.status).toBe(201);
            expect(mockAuthRepo.setUserRoles).toHaveBeenCalledWith("boot-1", ["admin"]);
        });

        it("never promotes a registration that is not the first user", async () => {
            const app = createApp({ allowRegistration: true });
            // Somebody is already there, so this registrant is not the first.
            mockAuthRepo.listUsers.mockResolvedValue([mockUser(), mockUser()] as never);

            const res = await app.request("/auth/register", json({
                email: "hacker@evil.com",
                password: "HackRebase2026!",
                displayName: "Hacker"
            }));

            expect(res.status).toBe(201);
            expect(grantedAdmin()).toBe(false);
        });

        it("never promotes a non-first OAuth sign-in either", async () => {
            const app = createApp({ allowRegistration: true });
            mockAuthRepo.getUserByIdentity.mockResolvedValueOnce(null);
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(null);
            mockAuthRepo.listUsers.mockResolvedValue([mockUser(), mockUser()] as never);

            // 200, not 404: a 404 here would mean no provider was injected and
            // the escalation path was never reached, which is how a test like
            // this passes without testing anything.
            const res = await app.request("/auth/google", json({ idToken: "valid-token" }));
            expect(res.status).toBe(200);

            expect(grantedAdmin()).toBe(false);
        });

        it("produces at most one admin across concurrent registrations", async () => {
            const app = createApp({ allowRegistration: true });
            // The table is no longer empty by the time these land.
            mockAuthRepo.listUsers.mockResolvedValue([mockUser(), mockUser()] as never);

            const responses = await Promise.all(
                Array.from({ length: 5 }, (_, i) =>
                    app.request("/auth/register", json({
                        email: `concurrent-${i}@evil.com`,
                        password: "StrongPass1",
                        displayName: `Concurrent ${i}`
                    })))
            );

            // The old version computed this and never asserted on it, so the
            // test also passed if every request 500'd.
            expect(responses.filter(r => r.status === 201).length).toBeGreaterThan(0);

            const adminGrants = mockAuthRepo.setUserRoles.mock.calls
                .filter(([, roles]: [string, string[]]) => Array.isArray(roles) && roles.includes("admin"));
            expect(adminGrants).toHaveLength(0);
        });

        it("assigns only the configured default role, never admin alongside it", async () => {
            const app = createApp({ allowRegistration: true, defaultRole: "viewer" });
            mockAuthRepo.listUsers.mockResolvedValue([mockUser(), mockUser()] as never);

            await app.request("/auth/register", json({
                email: "new@test.com",
                password: "StrongPass1"
            }));

            expect(mockAuthRepo.assignDefaultRole).toHaveBeenCalledWith(expect.any(String), "viewer");
            expect(mockAuthRepo.assignDefaultRole).toHaveBeenCalledTimes(1);
            expect(grantedAdmin()).toBe(false);
        });
    });

    describe("POST /auth/find-user (user lookup)", () => {
        it("is not mounted unless allowUserLookup is enabled", async () => {
            const app = createApp(); // allowUserLookup defaults to false
            const res = await app.request("/auth/find-user", {
                ...json({ email: "someone@test.com" }),
                headers: { ...json({}).headers, ...authHeader() }
            });
            expect(res.status).toBe(404);
        });

        it("requires authentication when enabled", async () => {
            const app = createApp({ allowUserLookup: true });
            const res = await app.request("/auth/find-user", json({ email: "someone@test.com" }));
            expect(res.status).toBe(401);
        });

        it("returns only a minimal public profile for a known email", async () => {
            const app = createApp({ allowUserLookup: true });
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(
                mockUser({ id: "user-42", email: "teammate@test.com", displayName: "Teammate", photoUrl: "https://p" })
            );
            const res = await app.request("/auth/find-user", {
                ...json({ email: "teammate@test.com" }),
                headers: { ...json({}).headers, ...authHeader() }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            // Minimal projection only — no email, roles, metadata, or password leaked.
            expect(body.user).toEqual({ uid: "user-42", displayName: "Teammate", photoURL: "https://p" });
            expect(body.user.email).toBeUndefined();
            expect(body.user.roles).toBeUndefined();
        });

        it("returns null when no account matches", async () => {
            const app = createApp({ allowUserLookup: true });
            mockAuthRepo.getUserByEmail.mockResolvedValueOnce(null);
            const res = await app.request("/auth/find-user", {
                ...json({ email: "nobody@test.com" }),
                headers: { ...json({}).headers, ...authHeader() }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user).toBeNull();
        });
    });
});
