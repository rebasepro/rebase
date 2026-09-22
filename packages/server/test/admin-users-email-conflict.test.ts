/**
 * PUT /users/:uid — moving an account onto an email another one holds.
 *
 * The route wrote the new address straight through `updateUser` with no
 * pre-check, and neither engine mapped the unique-index violation on that
 * write (Postgres 23505, Mongo 11000), so the administrator got a 500
 * "Internal Server Error" for what is a plain conflict. `POST /auth/register`
 * and `POST /users` already answer the same collision with 409 `EMAIL_EXISTS`.
 *
 * The repositories map it now too (their own tests); this is the route's
 * half, which holds for a custom repository that does not.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { errorHandler } from "../src/api/errors";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const TEST_SECRET = "test-secret-key-for-admin-users-email-conflict-123";

function user(id: string, email: string): UserData {
    return { id, email, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
}

function world() {
    const users = [user("admin-1", "admin@test.com"), user("mover", "mover@test.com"), user("holder", "taken@test.com")];
    // What an engine that does not map the violation throws.
    const updateUser = jest.fn(async (id: string, data: Partial<UserData>) => {
        if (data.email && users.some(u => u.email === data.email && u.id !== id)) {
            throw new Error("duplicate key value violates unique constraint \"users_email_key\"");
        }
        const found = users.find(u => u.id === id);
        if (found && data.email) found.email = data.email;
        return found ?? null;
    });
    const repo = {
        getUserById: async (id: string) => users.find(u => u.id === id) ?? null,
        getUserByEmail: async (email: string) => users.find(u => u.email === email) ?? null,
        getUserRoleIds: async (id: string) => (id === "admin-1" ? ["admin"] : ["editor"]),
        getUserWithRoles: async (id: string) => {
            const found = users.find(u => u.id === id);
            return found ? { user: found, roles: [] } : null;
        },
        updateUser
    } as unknown as AuthRepository;
    const app = new Hono();
    app.onError(errorHandler);
    app.route("/", createAdminUsersRoute({ authRepo: repo }));
    return { app, updateUser };
}

async function put(app: Hono, uid: string, body: unknown): Promise<Response> {
    return app.request(`/users/${uid}`, {
        method: "PUT",
        headers: {
            authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
}

describe("PUT /users/:uid with an email another account holds", () => {
    beforeAll(() => configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" }));

    it("answers 409 EMAIL_EXISTS and writes nothing", async () => {
        const { app, updateUser } = world();

        const res = await put(app, "mover", { email: "Taken@Test.com" });

        expect(res.status).toBe(409);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("EMAIL_EXISTS");
        expect(updateUser).not.toHaveBeenCalled();
    });

    it("still lets an account keep, or re-case, its own address", async () => {
        const { app, updateUser } = world();

        const res = await put(app, "mover", { email: "Mover@Test.com" });

        expect(res.status).toBe(200);
        expect(updateUser).toHaveBeenCalledWith("mover", { email: "mover@test.com" });
    });
});
