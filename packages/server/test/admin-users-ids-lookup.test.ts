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

function bearer(userId: string): Record<string, string> {
    return { authorization: `Bearer ${generateAccessToken(userId, ["admin"])}` };
}

describe("GET /users?ids=", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    it("resolves the requested users in one request", async () => {
        const { repo } = mockRepo([user("u1", "Priscila"), user("u2", "Ada"), user("u3")]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?ids=u1,u3", { headers: bearer("admin-1") });

        expect(res.status).toBe(200);
        const body = await res.json() as { users: { uid: string; displayName: string | null }[] };
        expect(body.users.map(u => u.uid)).toEqual(["u1", "u3"]);
        expect(body.users[0].displayName).toBe("Priscila");
    });

    it("drops ids that resolve to nothing instead of failing", async () => {
        const { repo } = mockRepo([user("u1")]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?ids=u1,missing", { headers: bearer("admin-1") });

        expect(res.status).toBe(200);
        const body = await res.json() as { users: { uid: string }[] };
        expect(body.users.map(u => u.uid)).toEqual(["u1"]);
    });

    it("dedupes and caps the number of lookups", async () => {
        const many = Array.from({ length: 150 }, (_, i) => user(`u${i}`));
        const { repo, getUserWithRoles } = mockRepo(many);
        const app = createAdminUsersRoute({ authRepo: repo });

        const ids = [...many.map(u => u.id), "u0", "u1"].join(",");
        const res = await app.request(`/users?ids=${ids}`, { headers: bearer("admin-1") });

        expect(res.status).toBe(200);
        expect(getUserWithRoles).toHaveBeenCalledTimes(100);
    });

    it("requires admin", async () => {
        const { repo } = mockRepo([user("u1")]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?ids=u1");

        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});
