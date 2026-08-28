/**
 * DELETE /users/:uid — the two things an admin must not be able to do.
 *
 * Deleting your own account through the admin API is refused, because the
 * account you are authenticated as is the one holding the session making the
 * request: the row goes, the JWT keeps verifying until it expires, and a
 * half-deleted administrator is a state nothing else in the system expects.
 * (The last-admin guard below it is the separate protection against locking
 * the project out entirely.)
 *
 * Nothing covered either branch: inverting the self-check (`===` → `!==`)
 * — which permits self-deletion and forbids deleting anyone else, i.e. exactly
 * backwards — left the suite green.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const TEST_SECRET = "test-secret-key-for-admin-users-delete-1234567890";

function user(id: string): UserData {
    return {
        id,
        email: `${id}@test.com`,
        displayName: id,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01")
    } as UserData;
}

/** `admins` are the ids holding the admin role; `adminTotal` is how many exist. */
function mockRepo(users: UserData[], admins: string[] = [], adminTotal = admins.length) {
    const deleteUser = jest.fn(async () => undefined);
    const repo = {
        getUserById: async (id: string) => users.find(u => u.id === id) ?? null,
        getUserRoleIds: async (id: string) => (admins.includes(id) ? ["admin"] : ["editor"]),
        listUsersPaginated: async () => ({ users: [],
total: adminTotal,
limit: 1,
offset: 0 }),
        deleteUser
    } as unknown as AuthRepository;
    return { repo,
deleteUser };
}

async function bearer(userId: string): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await generateAccessToken(userId, ["admin"])}` };
}

describe("DELETE /users/:uid", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    it("refuses to delete the caller's own account", async () => {
        const { repo, deleteUser } = mockRepo([user("admin-1"), user("editor-1")], ["admin-1"], 3);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users/admin-1", {
            method: "DELETE",
            headers: await bearer("admin-1")
        });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("SELF_DELETE");
        expect(body.error.message).toBe("Cannot delete your own account");
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("deletes another user", async () => {
        // The other half of the same guard: refusing self-deletion must not turn
        // into refusing every deletion.
        const { repo, deleteUser } = mockRepo([user("admin-1"), user("editor-1")], ["admin-1"], 3);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users/editor-1", {
            method: "DELETE",
            headers: await bearer("admin-1")
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(deleteUser).toHaveBeenCalledWith("editor-1");
    });

    it("404s for a user that does not exist", async () => {
        const { repo, deleteUser } = mockRepo([user("admin-1")], ["admin-1"], 3);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users/ghost", {
            method: "DELETE",
            headers: await bearer("admin-1")
        });

        expect(res.status).toBe(404);
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("refuses to delete the last administrator", async () => {
        // Distinct from the self-delete rule: this is a *different* admin
        // account, and removing it would leave the project with none.
        const { repo, deleteUser } = mockRepo(
            [user("admin-1"), user("admin-2")],
            ["admin-1", "admin-2"],
            1
        );
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users/admin-2", {
            method: "DELETE",
            headers: await bearer("admin-1")
        });

        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("LAST_ADMIN");
        expect(deleteUser).not.toHaveBeenCalled();
    });

    it("rejects a signed-in non-admin with 403", async () => {
        const { repo, deleteUser } = mockRepo([user("admin-1"), user("editor-1")], ["admin-1"], 3);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users/editor-1", {
            method: "DELETE",
            headers: { authorization: `Bearer ${await generateAccessToken("editor-1", ["editor"])}` }
        });

        expect(res.status).toBe(403);
        expect(deleteUser).not.toHaveBeenCalled();
    });
});
