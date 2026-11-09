import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import type { CreateUserData, UserData } from "../src/auth/interfaces";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { fakeAuthRepository, fakeUser } from "./helpers/server-a-g1-fakes";

const SECRET = "test-secret-for-auth-hook-reachability-0123456789";

/**
 * The hooks the documentation sends people to had to actually fire.
 *
 * The boot warning and `authentication.md` both say: registration, admin user
 * management and OAuth bypass your collection callbacks — use
 * `beforeUserCreate` / `afterUserCreate` / `afterUserDelete` instead. But
 * `beforeUserCreate` fired only on self-service registration, and
 * `beforeUserDelete` / `afterUserDelete` had one call site,
 * `UserManagementAdapter.deleteUser`, which no route invokes: the admin route
 * calls `authRepo.deleteUser` directly.
 *
 * So a developer who followed the advice had a veto that vetoed nothing and a
 * cleanup that never ran — on the very path the advice was about.
 */
describe("auth hooks fire on the admin paths the docs name", () => {
    beforeAll(() => configureJwt({ secret: SECRET, accessExpiresIn: "1h" }));

    const admin = (id = "admin-1"): UserData =>
        fakeUser({ id, email: `${id}@test.com`, createdAt: new Date(), updatedAt: new Date() });

    async function harness(authHooks: AuthHooks) {
        const deleted: string[] = [];
        const created: Record<string, unknown>[] = [];
        const repo = fakeAuthRepository({
            listUsers: async () => [admin(), admin("victim")],
            listUsersPaginated: async () => ({ users: [admin(), admin("other")], total: 2, limit: 2, offset: 0 }),
            getUserRoleIds: async () => ["admin"],
            getUserById: async (id: string) => admin(id),
            getUserByEmail: async () => null,
            deleteUser: async (id: string) => { deleted.push(id); },
            deleteAllRefreshTokensForUser: async () => undefined,
            createUser: async (data: CreateUserData) => { created.push({ ...data }); return { ...admin("new"), ...data }; },
            setUserRoles: async () => undefined
        });

        const app = createAdminUsersRoute({ authRepo: repo, authHooks });
        const auth = { authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}` };
        return { app, auth, deleted, created };
    }

    it("fires beforeUserDelete, and lets it veto the deletion", async () => {
        const beforeUserDelete = jest.fn(async (_uid: string) => { throw new Error("not this one"); });
        const { app, auth, deleted } = await harness({ beforeUserDelete });

        const res = await app.request("/users/victim", { method: "DELETE", headers: auth });

        expect(beforeUserDelete).toHaveBeenCalledWith("victim");
        // A veto has to actually stop the write, or it is decoration.
        expect(deleted).toEqual([]);
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("fires afterUserDelete once the row is gone", async () => {
        const afterUserDelete = jest.fn(async (_uid: string) => undefined);
        const { app, auth, deleted } = await harness({ afterUserDelete });

        await app.request("/users/victim", { method: "DELETE", headers: auth });

        expect(deleted).toEqual(["victim"]);
        expect(afterUserDelete).toHaveBeenCalledWith("victim");
    });

    it("fires beforeUserCreate on the admin create path, and honours what it returns", async () => {
        const beforeUserCreate = jest.fn(async (data: CreateUserData) =>
            ({ ...data, displayName: "set by hook" }));
        const { app, auth, created } = await harness({ beforeUserCreate });

        await app.request("/users", {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({ email: "new@test.com", password: "S3cure!passw0rd" })
        });

        expect(beforeUserCreate).toHaveBeenCalled();
        // Returning a modified object is the hook's contract; ignoring the
        // return value would make it observable but useless.
        expect(created[0]?.displayName).toBe("set by hook");
    });
});
