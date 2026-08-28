/**
 * Batch user lookup — GET /users?ids=a,b,c
 *
 * The admin UI turns the ids stored in `userSelect` columns into names, one
 * request per rendered page rather than one per row.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const TEST_SECRET = "test-secret-key-for-admin-users-ids-lookup-1234567890";

function user(id: string, displayName?: string): UserData {
    return {
        id,
        email: `${id}@test.com`,
        displayName: displayName ?? null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01")
    } as UserData;
}

function mockRepo(users: UserData[]) {
    const getUserWithRoles = jest.fn(async (id: string) => {
        const found = users.find(u => u.id === id);
        return found ? { user: found,
roles: [] } : null;
    });
    const repo = {
        getUserWithRoles,
        getUserRoleIds: async () => ["admin"],
        getUserById: async (id: string) => users.find(u => u.id === id) ?? null,
        listUsersPaginated: async () => ({ users,
total: users.length,
limit: 25,
offset: 0 })
    } as unknown as AuthRepository;
    return { repo,
getUserWithRoles };
}

async function bearer(userId: string, roles: string[] = ["admin"]): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await generateAccessToken(userId, roles)}` };
}

describe("GET /users?ids=", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    it("resolves the requested users in one request", async () => {
        const { repo } = mockRepo([user("u1", "Priscila"), user("u2", "Ada"), user("u3")]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?ids=u1,u3", { headers: await bearer("admin-1") });

        expect(res.status).toBe(200);
        const body = await res.json() as { users: { uid: string; displayName: string | null }[] };
        expect(body.users.map(u => u.uid)).toEqual(["u1", "u3"]);
        expect(body.users[0].displayName).toBe("Priscila");
    });

    it("drops ids that resolve to nothing instead of failing", async () => {
        const { repo } = mockRepo([user("u1")]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?ids=u1,missing", { headers: await bearer("admin-1") });

        expect(res.status).toBe(200);
        const body = await res.json() as { users: { uid: string }[] };
        expect(body.users.map(u => u.uid)).toEqual(["u1"]);
    });

    it("dedupes and caps the number of lookups", async () => {
        const many = Array.from({ length: 150 }, (_, i) => user(`u${i}`));
        const { repo, getUserWithRoles } = mockRepo(many);
        const app = createAdminUsersRoute({ authRepo: repo });

        const ids = [...many.map(u => u.id), "u0", "u1"].join(",");
        const res = await app.request(`/users?ids=${ids}`, { headers: await bearer("admin-1") });

        expect(res.status).toBe(200);
        expect(getUserWithRoles).toHaveBeenCalledTimes(100);
    });

    // This lookup turns an id into an email and a display name, so it is a user
    // directory for anyone who can reach it. `status >= 400` used to be the whole
    // assertion, and only for the anonymous case — which requireAuth answers on
    // its own, leaving requireAdmin unmeasured. Both statuses are pinned exactly,
    // and the non-admin case is the one that fails if the admin gate is dropped.
    it("rejects an anonymous caller with 401", async () => {
        const { repo, getUserWithRoles } = mockRepo([user("u1")]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?ids=u1");

        expect(res.status).toBe(401);
        expect(getUserWithRoles).not.toHaveBeenCalled();
    });

    it("rejects a signed-in non-admin with 403", async () => {
        const { repo, getUserWithRoles } = mockRepo([user("u1", "Priscila")]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?ids=u1", { headers: await bearer("editor-1", ["editor"]) });

        expect(res.status).toBe(403);
        const raw = await res.text();
        expect((JSON.parse(raw) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
        // Nothing about u1 leaked on the way to the refusal.
        expect(getUserWithRoles).not.toHaveBeenCalled();
        expect(raw).not.toContain("Priscila");
    });
});
