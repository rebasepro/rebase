/**
 * Admin Routes — Integration Tests (Hono)
 *
 * Tests the full Hono request → admin route handler → JSON response cycle.
 * Replaces the previous Express-based mock tests that only tested service calls.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAdminRoutes } from "../src/auth/admin-routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import type { AuthModuleConfig } from "../src/auth/routes";

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("../src/auth/password");

import { UserService, RoleService } from "../src/auth/services";
import { hashPassword, validatePasswordStrength } from "../src/auth/password";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEST_SECRET = "admin-test-secret-key-that-is-definitely-32-chars-long!!!!!";

function mockUser(overrides: Partial<{ id: string; email: string; displayName: string | null; photoUrl: string | null; provider: string }> = {}) {
    return {
        id: overrides.id ?? "user-1",
        email: overrides.email ?? "test@example.com",
        passwordHash: "salt:hash",
        displayName: overrides.displayName ?? "Test User",
        photoUrl: overrides.photoUrl ?? null,
        emailVerified: false,
        emailVerificationToken: null,
        emailVerificationSentAt: null,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01")
    };
}

function mockRole(id: string, isAdmin = false) {
    return { id,
name: id.charAt(0).toUpperCase() + id.slice(1),
isAdmin,
defaultPermissions: null,
collectionPermissions: null };
}


let mockAuthRepo: jest.Mocked<any>;

function createApp(opts: { defaultRole?: string } = {}) {
    mockAuthRepo = {
        getUserByEmail: jest.fn().mockResolvedValue(null),
        getUserByIdentity: jest.fn().mockResolvedValue(null),
        linkUserIdentity: jest.fn().mockResolvedValue(undefined),
        getUserIdentities: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn().mockImplementation((id) => Promise.resolve(mockUser({ id }))),
        createUser: jest.fn().mockImplementation((data) =>
            Promise.resolve(mockUser({ email: data.email,
displayName: data.displayName,
passwordHash: data.passwordHash }))
        ),
        listUsers: jest.fn().mockResolvedValue([]),
        listUsersPaginated: jest.fn().mockResolvedValue({ users: [], total: 0, limit: 25, offset: 0 }),
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
        getUserWithRoles: jest.fn().mockImplementation(async (userId) => {
            const user = mockUser({ id: userId });
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
        deleteExpiredPasswordResetTokens: jest.fn().mockResolvedValue(undefined),
        listRoles: jest.fn().mockResolvedValue([]),
        getRoleById: jest.fn().mockResolvedValue(null),
        createRole: jest.fn().mockImplementation(r => Promise.resolve({ id: r.id,
name: r.name,
isAdmin: r.isAdmin || false,
defaultPermissions: null,
collectionPermissions: null })),
        updateRole: jest.fn().mockImplementation((id, r) => Promise.resolve({ id,
name: r.name,
isAdmin: r.isAdmin || false,
defaultPermissions: null,
collectionPermissions: null })),
        deleteRole: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<AuthRepository>;


    // Password mocks
    (validatePasswordStrength as jest.Mock).mockReturnValue({ valid: true,
errors: [] });
    (hashPassword as jest.Mock).mockResolvedValue("hashed-pw");

    const config: AuthModuleConfig = {
        authRepo: mockAuthRepo,
        defaultRole: opts.defaultRole
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/admin", createAdminRoutes(config));
    return app;
}

function adminAuth(userId = "admin-1") {
    return { Authorization: `Bearer ${generateAccessToken(userId, ["admin"])}` };
}

function editorAuth(userId = "editor-1") {
    return { Authorization: `Bearer ${generateAccessToken(userId, ["editor"])}` };
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

describe("Admin Routes (Integration)", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── Auth barriers ───────────────────────────────────────────────────
    describe("Authorization", () => {
        it("returns 401 for unauthenticated requests", async () => {
            const app = createApp();
            const res = await app.request("/admin/users");
            expect(res.status).toBe(401);
        });

        it("returns 403 for non-admin users on admin-only endpoints", async () => {
            const app = createApp();
            const res = await app.request("/admin/users", {
                headers: { ...editorAuth() }
            });
            expect(res.status).toBe(403);
        });

        it("allows admin users through", async () => {
            const app = createApp();
            const res = await app.request("/admin/users", {
                headers: { ...adminAuth() }
            });
            expect(res.status).toBe(200);
        });

        it("allows schema-admin users through", async () => {
            const app = createApp();
            const res = await app.request("/admin/users", {
                headers: { Authorization: `Bearer ${generateAccessToken("sa-1", ["schema-admin"])}` }
            });
            expect(res.status).toBe(200);
        });
    });

    // ── Bootstrap ───────────────────────────────────────────────────────
    describe("POST /admin/bootstrap", () => {
        it("promotes current user to admin when no admins exist", async () => {
            const app = createApp();
            mockAuthRepo.listUsers.mockResolvedValueOnce([mockUser({ id: "user-1" })]);
            mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["editor"]); // no admin

            const res = await app.request("/admin/bootstrap", {
                method: "POST",
                headers: { ...adminAuth("user-1") }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.roles).toContain("admin");
            expect(mockAuthRepo.setUserRoles).toHaveBeenCalledWith("user-1", ["admin"]);
        });

        it("returns 403 when admin already exists", async () => {
            const app = createApp();
            const adminUser = mockUser({ id: "existing-admin" });
            mockAuthRepo.listUsers.mockResolvedValueOnce([adminUser]);
            mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["admin"]); // admin exists

            const res = await app.request("/admin/bootstrap", {
                method: "POST",
                headers: { ...adminAuth("user-1") }
            });
            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.message).toContain("Admin users already exist");
        });
    });

    // ── User CRUD ───────────────────────────────────────────────────────
    describe("User Management", () => {
        describe("GET /admin/users", () => {
            it("returns list of users with roles", async () => {
                const app = createApp();
                mockAuthRepo.listUsersPaginated.mockResolvedValueOnce({
                    users: [
                        mockUser({ id: "u1",
email: "a@test.com" }),
                        mockUser({ id: "u2",
email: "b@test.com" })
                    ],
                    total: 2,
                    limit: 25,
                    offset: 0
                });
                mockAuthRepo.getUserRoleIds
                    .mockResolvedValueOnce(["admin"])
                    .mockResolvedValueOnce(["editor"]);

                const res = await app.request("/admin/users", { headers: { ...adminAuth() } });
                expect(res.status).toBe(200);
                const body = await res.json() as any;
                expect(body.users).toHaveLength(2);
                expect(body.users[0].roles).toContain("admin");
                expect(body.users[1].roles).toContain("editor");
            });
        });

        describe("GET /admin/users/:userId", () => {
            it("returns user with roles", async () => {
                const app = createApp();
                mockAuthRepo.getUserWithRoles.mockResolvedValueOnce({
                    user: mockUser({ id: "u1" }),
                    roles: [mockRole("editor"), mockRole("viewer")]
                });

                const res = await app.request("/admin/users/u1", { headers: { ...adminAuth() } });
                expect(res.status).toBe(200);
                const body = await res.json() as any;
                expect(body.user.uid).toBe("u1");
                expect(body.user.roles).toEqual(["editor", "viewer"]);
            });

            it("returns 404 for non-existent user", async () => {
                const app = createApp();
                mockAuthRepo.getUserWithRoles.mockResolvedValueOnce(null);

                const res = await app.request("/admin/users/missing", { headers: { ...adminAuth() } });
                expect(res.status).toBe(404);
            });
        });

        describe("POST /admin/users", () => {
            it("creates a new user", async () => {
                const app = createApp();

                const res = await app.request("/admin/users", {
                    ...json({ email: "new@test.com",
displayName: "New",
password: "StrongPass1",
roles: ["editor"] }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(res.status).toBe(201);
                const body = await res.json() as any;
                expect(body.user.email).toBe("new@test.com");
                expect(mockAuthRepo.createUser).toHaveBeenCalledWith(expect.objectContaining({
                    email: "new@test.com"
                }));
            });

            it("hashes password when provided", async () => {
                const app = createApp();

                await app.request("/admin/users", {
                    ...json({ email: "pw@test.com",
password: "StrongPass1" }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(hashPassword).toHaveBeenCalledWith("StrongPass1");
            });

            it("returns 400 for missing email", async () => {
                const app = createApp();

                const res = await app.request("/admin/users", {
                    ...json({ displayName: "No Email" }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(res.status).toBe(400);
            });

            it("returns 409 when email already exists", async () => {
                const app = createApp();
                mockAuthRepo.getUserByEmail.mockResolvedValueOnce(mockUser());

                const res = await app.request("/admin/users", {
                    ...json({ email: "existing@test.com" }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(res.status).toBe(409);
                const body = await res.json() as any;
                expect(body.error.code).toBe("EMAIL_EXISTS");
            });

            it("returns 400 for weak password", async () => {
                const app = createApp();
                (validatePasswordStrength as jest.Mock).mockReturnValueOnce({ valid: false,
errors: ["Too short"] });

                const res = await app.request("/admin/users", {
                    ...json({ email: "weak@test.com",
password: "weak" }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(res.status).toBe(400);
                const body = await res.json() as any;
                expect(body.error.code).toBe("WEAK_PASSWORD");
            });

            it("assigns configured default role when no roles specified", async () => {
                const app = createApp({ defaultRole: "editor" });

                await app.request("/admin/users", {
                    ...json({ email: "norole@test.com" }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(mockAuthRepo.assignDefaultRole).toHaveBeenCalledWith(expect.any(String), "editor");
            });

            it("does not assign a default role when not configured", async () => {
                const app = createApp();

                await app.request("/admin/users", {
                    ...json({ email: "nodefault@test.com" }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(mockAuthRepo.assignDefaultRole).not.toHaveBeenCalled();
            });

            it("assigns specified roles", async () => {
                const app = createApp();

                await app.request("/admin/users", {
                    ...json({ email: "withroles@test.com",
roles: ["admin", "editor"] }),
                    headers: { ...json({}).headers,
...adminAuth() }
                });
                expect(mockAuthRepo.setUserRoles).toHaveBeenCalledWith(expect.any(String), ["admin", "editor"]);
            });
        });

        describe("PUT /admin/users/:userId", () => {
            it("updates user profile", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u1" }));
                mockAuthRepo.getUserWithRoles.mockResolvedValueOnce({
                    user: mockUser({ id: "u1",
displayName: "Updated" }),
                    roles: [mockRole("editor")]
                });

                const res = await app.request("/admin/users/u1", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json",
...adminAuth() },
                    body: JSON.stringify({ displayName: "Updated" })
                });
                expect(res.status).toBe(200);
                const body = await res.json() as any;
                expect(body.user.displayName).toBe("Updated");
            });

            it("updates roles when specified", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u1" }));
                mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["admin"]);
                mockAuthRepo.listUsersPaginated.mockResolvedValueOnce({ total: 2 });
                mockAuthRepo.getUserWithRoles.mockResolvedValueOnce({
                    user: mockUser({ id: "u1" }),
                    roles: [mockRole("admin")]
                });

                await app.request("/admin/users/u1", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json",
...adminAuth() },
                    body: JSON.stringify({ roles: ["admin"] })
                });
                expect(mockAuthRepo.setUserRoles).toHaveBeenCalledWith("u1", ["admin"]);
            });

            it("prevents demoting the last admin", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u1" }));
                mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["admin"]);
                mockAuthRepo.listUsersPaginated.mockResolvedValueOnce({ total: 1 });

                const res = await app.request("/admin/users/u1", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json",
...adminAuth() },
                    body: JSON.stringify({ roles: ["editor"] })
                });
                expect(res.status).toBe(403);
                const body = await res.json() as any;
                expect(body.error.code).toBe("LAST_ADMIN");
                expect(mockAuthRepo.setUserRoles).not.toHaveBeenCalled();
            });

            it("allows demoting an admin if there are other admins", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u1" }));
                mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["admin"]);
                mockAuthRepo.listUsersPaginated.mockResolvedValueOnce({ total: 2 });
                mockAuthRepo.getUserWithRoles.mockResolvedValueOnce({
                    user: mockUser({ id: "u1" }),
                    roles: [mockRole("editor")]
                });

                const res = await app.request("/admin/users/u1", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json",
...adminAuth() },
                    body: JSON.stringify({ roles: ["editor"] })
                });
                expect(res.status).toBe(200);
                expect(mockAuthRepo.setUserRoles).toHaveBeenCalledWith("u1", ["editor"]);
            });

            it("returns 404 for non-existent user", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(null);

                const res = await app.request("/admin/users/missing", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json",
...adminAuth() },
                    body: JSON.stringify({ displayName: "Updated" })
                });
                expect(res.status).toBe(404);
            });
        });

        describe("DELETE /admin/users/:userId", () => {
            it("deletes a user", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u1" }));

                const res = await app.request("/admin/users/u1", {
                    method: "DELETE",
                    headers: { ...adminAuth("admin-1") }
                });
                expect(res.status).toBe(200);
                expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith("u1");
            });

            it("prevents self-deletion", async () => {
                const app = createApp();

                const res = await app.request("/admin/users/admin-1", {
                    method: "DELETE",
                    headers: { ...adminAuth("admin-1") }
                });
                expect(res.status).toBe(400);
                const body = await res.json() as any;
                expect(body.error.code).toBe("SELF_DELETE");
            });

            it("prevents last-admin deletion", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u2" }));
                mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["admin"]);
                mockAuthRepo.listUsersPaginated.mockResolvedValueOnce({ total: 1 });

                const res = await app.request("/admin/users/u2", {
                    method: "DELETE",
                    headers: { ...adminAuth("admin-1") }
                });
                expect(res.status).toBe(403);
                const body = await res.json() as any;
                expect(body.error.code).toBe("LAST_ADMIN");
                expect(mockAuthRepo.deleteUser).not.toHaveBeenCalled();
            });

            it("allows deleting an admin if there are other admins", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u2" }));
                mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["admin"]);
                mockAuthRepo.listUsersPaginated.mockResolvedValueOnce({ total: 2 });

                const res = await app.request("/admin/users/u2", {
                    method: "DELETE",
                    headers: { ...adminAuth("admin-1") }
                });
                expect(res.status).toBe(200);
                expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith("u2");
            });

            it("returns 404 for non-existent user", async () => {
                const app = createApp();
                mockAuthRepo.getUserById.mockResolvedValueOnce(null);

                const res = await app.request("/admin/users/missing", {
                    method: "DELETE",
                    headers: { ...adminAuth() }
                });
                expect(res.status).toBe(404);
            });
        });
    });


});
