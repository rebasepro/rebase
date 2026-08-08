/**
 * The list window on GET /users.
 *
 * This route has its own default (25) and shares the platform ceiling. It used
 * to clamp: `?limit=100000000` was answered with 1 000 users and a 200, which
 * an admin UI paging on the number it asked for reads as "that is everyone".
 * The rule is the shared one now — default when absent, refuse when unservable.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { MAX_LIST_LIMIT } from "@rebasepro/types";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const TEST_SECRET = "test-secret-key-for-admin-users-list-limit-1234567890";

function mockRepo() {
    const listUsersPaginated = jest.fn(async (_params: unknown) => ({
        users: [] as UserData[],
        total: 0,
        limit: 25,
        offset: 0
    }));
    const repo = {
        listUsersPaginated,
        getUserRoleIds: async () => ["admin"]
    } as unknown as AuthRepository;
    return { repo, listUsersPaginated };
}

function bearer(userId: string, roles: string[] = ["admin"]): Record<string, string> {
    return { authorization: `Bearer ${generateAccessToken(userId, roles)}` };
}

describe("GET /users — list limit", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
    });

    it("refuses a limit above the ceiling instead of serving a shorter page", async () => {
        const { repo, listUsersPaginated } = mockRepo();
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?limit=100000000", { headers: bearer("admin-1") });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("INVALID_LIMIT");
        expect(body.error.message).toContain(String(MAX_LIST_LIMIT));
        expect(listUsersPaginated).not.toHaveBeenCalled();
    });

    it("still applies this route's own default when no limit is sent", async () => {
        const { repo, listUsersPaginated } = mockRepo();
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users", { headers: bearer("admin-1") });

        expect(res.status).toBe(200);
        expect(listUsersPaginated).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 25, offset: 0 })
        );
    });

    it("honours a limit within the ceiling", async () => {
        const { repo, listUsersPaginated } = mockRepo();
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/users?limit=100", { headers: bearer("admin-1") });

        expect(res.status).toBe(200);
        expect(listUsersPaginated).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });
});
