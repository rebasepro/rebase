/**
 * Admin bootstrap endpoint — POST /bootstrap
 *
 * Verifies the self-promotion gate: only the earliest-registered user may claim
 * the initial admin role while no admin exists, and the endpoint is closed once
 * an admin exists.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const TEST_SECRET = "test-secret-key-for-admin-bootstrap-testing-1234567890";

function user(id: string, createdAt: string): UserData {
    return {
        id,
        email: `${id}@test.com`,
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt)
    } as UserData;
}

/**
 * Build a mock repo. `adminIds` are the users that already hold the admin role.
 */
function mockRepo(users: UserData[], adminIds: string[] = []) {
    const roles = new Map<string, string[]>(adminIds.map(id => [id, ["admin"]]));
    const setUserRoles = jest.fn(async (id: string, r: string[]) => { roles.set(id, r); });
    const repo = {
        listUsers: async () => users,
        getUserRoleIds: async (id: string) => roles.get(id) ?? [],
        getUserById: async (id: string) => users.find(u => u.id === id) ?? null,
        setUserRoles
    } as unknown as AuthRepository;
    return { repo, setUserRoles };
}

function bearer(userId: string): Record<string, string> {
    return { authorization: `Bearer ${generateAccessToken(userId, [])}` };
}

describe("POST /bootstrap", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
    });

    it("promotes the earliest-registered user", async () => {
        const users = [user("u1", "2026-01-01"), user("u2", "2026-02-01")];
        const { repo, setUserRoles } = mockRepo(users);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/bootstrap", { method: "POST", headers: bearer("u1") });

        expect(res.status).toBe(200);
        expect(setUserRoles).toHaveBeenCalledWith("u1", ["admin"]);
    });

    it("denies a later user while no admin exists (no land-grab)", async () => {
        const users = [user("u1", "2026-01-01"), user("u2", "2026-02-01")];
        const { repo, setUserRoles } = mockRepo(users);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/bootstrap", { method: "POST", headers: bearer("u2") });

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("BOOTSTRAP_NOT_FIRST_USER");
        expect(setUserRoles).not.toHaveBeenCalled();
    });

    it("is closed once an admin already exists", async () => {
        const users = [user("u1", "2026-01-01"), user("u2", "2026-02-01")];
        const { repo, setUserRoles } = mockRepo(users, ["u1"]);
        const app = createAdminUsersRoute({ authRepo: repo });

        // Even the earliest user is refused once someone is admin.
        const res = await app.request("/bootstrap", { method: "POST", headers: bearer("u1") });

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("BOOTSTRAP_COMPLETED");
        expect(setUserRoles).not.toHaveBeenCalled();
    });

    /**
     * The composed attack this endpoint used to permit, in two requests.
     *
     * `POST /auth/anonymous` mints a real session for anyone, and an anonymous
     * principal is a users-table row like any other — so on a fresh deployment
     * it was also the *earliest* row, which is the only thing the land-grab gate
     * checks. Anonymous session, then bootstrap, and the caller is admin. It
     * worked with `disableSelfRegistration: true` too, the flag documented as
     * leaving "an empty backend with no self-service path in at all".
     */
    describe("an anonymous session cannot seize the initial admin role", () => {
        it.each(["anonymous", "anon"])("refuses the anonymous uid %p", async anonId => {
            // The anonymous row is the only user, and therefore the earliest.
            const users = [user(anonId, "2026-01-01")];
            const { repo, setUserRoles } = mockRepo(users);
            const app = createAdminUsersRoute({ authRepo: repo });

            const res = await app.request("/bootstrap", { method: "POST", headers: bearer(anonId) });

            expect(res.status).toBe(403);
            const body = await res.json() as { error: { code: string } };
            expect(body.error.code).toBe("BOOTSTRAP_ANONYMOUS");
            expect(setUserRoles).not.toHaveBeenCalled();
        });

        it("does not let an anonymous row block the real first user", async () => {
            // The other half: anonymous principals are excluded from "earliest
            // registered", so an anonymous session created before the first real
            // registration must not lock that user out of bootstrapping.
            const users = [user("anonymous", "2026-01-01"), user("u1", "2026-02-01")];
            const { repo, setUserRoles } = mockRepo(users);
            const app = createAdminUsersRoute({ authRepo: repo });

            const res = await app.request("/bootstrap", { method: "POST", headers: bearer("u1") });

            expect(res.status).toBe(200);
            expect(setUserRoles).toHaveBeenCalledWith("u1", ["admin"]);
        });
    });

    it("breaks equal-timestamp ties deterministically by id", async () => {
        const users = [user("u2", "2026-01-01"), user("u1", "2026-01-01")];
        const { repo, setUserRoles } = mockRepo(users);
        const app = createAdminUsersRoute({ authRepo: repo });

        // u1 < u2 lexicographically, so u1 wins the tie.
        const denied = await app.request("/bootstrap", { method: "POST", headers: bearer("u2") });
        expect(denied.status).toBe(403);

        const allowed = await app.request("/bootstrap", { method: "POST", headers: bearer("u1") });
        expect(allowed.status).toBe(200);
        expect(setUserRoles).toHaveBeenCalledWith("u1", ["admin"]);
    });
});
