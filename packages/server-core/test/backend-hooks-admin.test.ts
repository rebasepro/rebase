/**
 * BackendHooks — Admin Routes Integration Tests
 *
 * Verifies that BackendHooks (users + roles) are correctly applied
 * within the admin route handlers.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAdminRoutes } from "../src/auth/admin-routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import type { AuthModuleConfig } from "../src/auth/routes";
import type { BackendHooks } from "@rebasepro/types";

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("../src/auth/password");

import { hashPassword, validatePasswordStrength } from "../src/auth/password";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEST_SECRET = "backend-hooks-test-secret-that-is-32-chars-long!!!!!";

function mockUser(overrides: Partial<{
    id: string;
    email: string;
    displayName: string | null;
    photoUrl: string | null;
}> = {}) {
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
    return {
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        isAdmin,
        defaultPermissions: null,
        collectionPermissions: null,
        config: null
    };
}

let mockAuthRepo: jest.Mocked<any>;

function createApp(hooks?: BackendHooks) {
    mockAuthRepo = {
        getUserByEmail: jest.fn().mockResolvedValue(null),
        getUserByIdentity: jest.fn().mockResolvedValue(null),
        linkUserIdentity: jest.fn().mockResolvedValue(undefined),
        getUserIdentities: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn().mockResolvedValue(null),
        createUser: jest.fn().mockImplementation((data) =>
            Promise.resolve(mockUser({ email: data.email, displayName: data.displayName }))
        ),
        listUsers: jest.fn().mockResolvedValue([]),
        listUsersPaginated: jest.fn().mockResolvedValue({ users: [], total: 0, limit: 25, offset: 0 }),
        getUserRoles: jest.fn().mockResolvedValue([mockRole("editor")]),
        getUserRoleIds: jest.fn().mockResolvedValue(["editor"]),
        assignDefaultRole: jest.fn().mockResolvedValue(undefined),
        setUserRoles: jest.fn().mockResolvedValue(undefined),
        updateUser: jest.fn().mockImplementation((id, data) =>
            Promise.resolve(mockUser({ id, ...data }))
        ),
        deleteUser: jest.fn().mockResolvedValue(undefined),
        updatePassword: jest.fn().mockResolvedValue(undefined),
        setEmailVerified: jest.fn().mockResolvedValue(undefined),
        setVerificationToken: jest.fn().mockResolvedValue(undefined),
        getUserByVerificationToken: jest.fn().mockResolvedValue(null),
        getUserWithRoles: jest.fn().mockImplementation(async (userId) => {
            const user = mockUser({ id: userId });
            return { user, roles: [mockRole("editor")] };
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
        createRole: jest.fn().mockImplementation(r => Promise.resolve({
            id: r.id, name: r.name, isAdmin: r.isAdmin || false,
            defaultPermissions: null, collectionPermissions: null, config: null
        })),
        updateRole: jest.fn().mockImplementation((id, r) => Promise.resolve({
            id, name: r.name, isAdmin: r.isAdmin || false,
            defaultPermissions: null, collectionPermissions: null, config: null
        })),
        deleteRole: jest.fn().mockResolvedValue(undefined)
    };

    (validatePasswordStrength as jest.Mock).mockReturnValue({ valid: true, errors: [] });
    (hashPassword as jest.Mock).mockResolvedValue("hashed-pw");

    const config: AuthModuleConfig & { hooks?: BackendHooks } = {
        authRepo: mockAuthRepo,
        hooks
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/admin", createAdminRoutes(config));
    return app;
}

function adminAuth(userId = "admin-1") {
    return { Authorization: `Bearer ${generateAccessToken(userId, ["admin"])}` };
}

function json(body: Record<string, unknown>) {
    return {
        method: "POST" as const,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("BackendHooks — Admin Routes", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── users.afterRead ─────────────────────────────────────────────────
    describe("users.afterRead", () => {
        it("filters out users from GET /admin/users list", async () => {
            const hooks: BackendHooks = {
                users: {
                    afterRead(user) {
                        // Hide system users
                        if (user.email.endsWith("@system.internal")) return null;
                        return user;
                    }
                }
            };
            const app = createApp(hooks);
            mockAuthRepo.listUsers.mockResolvedValueOnce([
                mockUser({ id: "u1", email: "alice@test.com" }),
                mockUser({ id: "u2", email: "bot@system.internal" }),
                mockUser({ id: "u3", email: "bob@test.com" })
            ]);
            mockAuthRepo.getUserRoleIds
                .mockResolvedValueOnce(["editor"])
                .mockResolvedValueOnce(["editor"])
                .mockResolvedValueOnce(["editor"]);

            const res = await app.request("/admin/users", { headers: { ...adminAuth() } });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.users).toHaveLength(2);
            expect(body.users.map((u: any) => u.email)).toEqual(["alice@test.com", "bob@test.com"]);
        });

        it("transforms user data in GET /admin/users list", async () => {
            const hooks: BackendHooks = {
                users: {
                    afterRead(user) {
                        // Mask emails
                        return { ...user, email: "***@masked.com" };
                    }
                }
            };
            const app = createApp(hooks);
            mockAuthRepo.listUsers.mockResolvedValueOnce([
                mockUser({ id: "u1", email: "alice@secret.com" })
            ]);
            mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["editor"]);

            const res = await app.request("/admin/users", { headers: { ...adminAuth() } });
            const body = await res.json() as any;
            expect(body.users[0].email).toBe("***@masked.com");
        });

        it("returns 404 when afterRead filters single user GET /admin/users/:id", async () => {
            const hooks: BackendHooks = {
                users: {
                    afterRead(user) {
                        if (user.uid === "hidden-user") return null;
                        return user;
                    }
                }
            };
            const app = createApp(hooks);
            mockAuthRepo.getUserWithRoles.mockResolvedValueOnce({
                user: mockUser({ id: "hidden-user" }),
                roles: [mockRole("editor")]
            });

            const res = await app.request("/admin/users/hidden-user", { headers: { ...adminAuth() } });
            expect(res.status).toBe(404);
        });

        it("passes context with request user info", async () => {
            const afterReadSpy = jest.fn((user, ctx) => user);
            const hooks: BackendHooks = { users: { afterRead: afterReadSpy } };
            const app = createApp(hooks);
            mockAuthRepo.listUsers.mockResolvedValueOnce([mockUser({ id: "u1" })]);
            mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["editor"]);

            await app.request("/admin/users", { headers: { ...adminAuth("admin-42") } });

            expect(afterReadSpy).toHaveBeenCalledTimes(1);
            const ctx = afterReadSpy.mock.calls[0][1];
            expect(ctx.method).toBe("GET");
            expect(ctx.requestUser).toBeDefined();
            expect(ctx.requestUser.userId).toBe("admin-42");
            expect(ctx.requestUser.roles).toContain("admin");
        });
    });

    // ── users.beforeSave ────────────────────────────────────────────────
    describe("users.beforeSave", () => {
        it("transforms data before creating a user (POST)", async () => {
            const hooks: BackendHooks = {
                users: {
                    beforeSave(data) {
                        // Force lowercase display name
                        return { ...data, displayName: data.displayName?.toLowerCase() };
                    }
                }
            };
            const app = createApp(hooks);

            await app.request("/admin/users", {
                ...json({ email: "new@test.com", displayName: "ALICE", password: "StrongPass1" }),
                headers: { ...json({}).headers, ...adminAuth() }
            });

            expect(mockAuthRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({ displayName: "alice" })
            );
        });

        it("transforms data before updating a user (PUT)", async () => {
            const hooks: BackendHooks = {
                users: {
                    beforeSave(data) {
                        return { ...data, displayName: "hook-modified" };
                    }
                }
            };
            const app = createApp(hooks);
            mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u1" }));
            mockAuthRepo.getUserWithRoles.mockResolvedValueOnce({
                user: mockUser({ id: "u1", displayName: "hook-modified" }),
                roles: [mockRole("editor")]
            });

            const res = await app.request("/admin/users/u1", {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...adminAuth() },
                body: JSON.stringify({ displayName: "Original" })
            });

            expect(res.status).toBe(200);
            expect(mockAuthRepo.updateUser).toHaveBeenCalledWith("u1",
                expect.objectContaining({ displayName: "hook-modified" })
            );
        });
    });

    // ── users.afterSave ─────────────────────────────────────────────────
    describe("users.afterSave", () => {
        it("fires afterSave after user creation", async () => {
            const afterSaveSpy = jest.fn();
            const hooks: BackendHooks = { users: { afterSave: afterSaveSpy } };
            const app = createApp(hooks);

            const res = await app.request("/admin/users", {
                ...json({ email: "new@test.com", password: "StrongPass1" }),
                headers: { ...json({}).headers, ...adminAuth() }
            });

            expect(res.status).toBe(201);
            // afterSave is fire-and-forget, give it a tick
            await new Promise(r => setTimeout(r, 50));
            expect(afterSaveSpy).toHaveBeenCalledTimes(1);
            expect(afterSaveSpy.mock.calls[0][0]).toMatchObject({ email: "new@test.com" });
        });
    });

    // ── users.beforeDelete ──────────────────────────────────────────────
    describe("users.beforeDelete", () => {
        it("aborts deletion when beforeDelete throws", async () => {
            const hooks: BackendHooks = {
                users: {
                    beforeDelete(userId) {
                        if (userId === "protected-user") {
                            throw new Error("Cannot delete protected user");
                        }
                    }
                }
            };
            const app = createApp(hooks);
            mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "protected-user" }));

            const res = await app.request("/admin/users/protected-user", {
                method: "DELETE",
                headers: { ...adminAuth("admin-1") }
            });

            expect(res.status).toBe(500);
            expect(mockAuthRepo.deleteUser).not.toHaveBeenCalled();
        });
    });

    // ── users.afterDelete ───────────────────────────────────────────────
    describe("users.afterDelete", () => {
        it("fires afterDelete after user is deleted", async () => {
            const afterDeleteSpy = jest.fn();
            const hooks: BackendHooks = { users: { afterDelete: afterDeleteSpy } };
            const app = createApp(hooks);
            mockAuthRepo.getUserById.mockResolvedValueOnce(mockUser({ id: "u1" }));

            const res = await app.request("/admin/users/u1", {
                method: "DELETE",
                headers: { ...adminAuth("admin-1") }
            });

            expect(res.status).toBe(200);
            await new Promise(r => setTimeout(r, 50));
            expect(afterDeleteSpy).toHaveBeenCalledWith("u1", expect.objectContaining({ method: "DELETE" }));
        });
    });

    // ── roles.afterRead ─────────────────────────────────────────────────
    describe("roles.afterRead", () => {
        it("filters out roles from GET /admin/roles", async () => {
            const hooks: BackendHooks = {
                roles: {
                    afterRead(role) {
                        // Hide internal roles
                        if (role.id === "internal") return null;
                        return role;
                    }
                }
            };
            const app = createApp(hooks);
            mockAuthRepo.listRoles.mockResolvedValueOnce([
                mockRole("admin", true),
                mockRole("internal"),
                mockRole("editor")
            ]);

            const res = await app.request("/admin/roles", { headers: { ...adminAuth() } });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.roles).toHaveLength(2);
            expect(body.roles.map((r: any) => r.id)).toEqual(["admin", "editor"]);
        });
    });

    // ── no hooks (passthrough) ──────────────────────────────────────────
    describe("no hooks configured", () => {
        it("returns data unchanged when no hooks are provided", async () => {
            const app = createApp(); // no hooks
            mockAuthRepo.listUsers.mockResolvedValueOnce([
                mockUser({ id: "u1", email: "alice@test.com" })
            ]);
            mockAuthRepo.getUserRoleIds.mockResolvedValueOnce(["editor"]);

            const res = await app.request("/admin/users", { headers: { ...adminAuth() } });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.users).toHaveLength(1);
            expect(body.users[0].email).toBe("alice@test.com");
        });
    });
});
