/**
 * An administrator setting a weak password gets the `WEAK_PASSWORD` code every
 * other door answers with (`POST /auth/register`, the reset and change-password
 * flows). `PUT /api/admin/users/:id` and `POST /users/:uid/reset-password` with
 * a chosen password answered a bare 400 — `BAD_REQUEST`, so a client's
 * `e.code === "WEAK_PASSWORD"` branch never ran. The message is unchanged.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { createResetPasswordRoute } from "../src/auth/reset-password-admin";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const TEST_SECRET = "test-secret-key-for-admin-weak-password-code-123";

function user(id: string, email: string): UserData {
    return { id, email, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
}

function repo() {
    const users = [user("admin-1", "admin@test.com"), user("target", "target@test.com")];
    const updateUser = jest.fn(async (id: string) => users.find(u => u.id === id) ?? null);
    const updatePassword = jest.fn(async () => undefined);
    const authRepo = {
        getUserById: async (id: string) => users.find(u => u.id === id) ?? null,
        getUserByEmail: async (email: string) => users.find(u => u.email === email) ?? null,
        getUserRoleIds: async (id: string) => (id === "admin-1" ? ["admin"] : ["editor"]),
        getAccountAccessState: async (id: string) => ({ roles: id === "admin-1" ? ["admin"] : ["editor"], tokensValidAfter: null }),
        getUserWithRoles: async (id: string) => {
            const found = users.find(u => u.id === id);
            return found ? { user: found, roles: [] } : null;
        },
        updateUser,
        updatePassword
    } as unknown as AuthRepository;
    return { authRepo, updateUser, updatePassword };
}

async function send(app: Hono<HonoEnv>, method: string, path: string, body: unknown): Promise<Response> {
    return app.request(path, {
        method,
        headers: {
            authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
}

type ErrorBody = { error: { code: string; message: string } };

describe("an administrator setting a weak password", () => {
    beforeAll(() => configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" }));

    it("PUT /users/:uid answers 400 WEAK_PASSWORD and writes nothing", async () => {
        const { authRepo, updateUser } = repo();
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/", createAdminUsersRoute({ authRepo }));

        const res = await send(app, "PUT", "/users/target", { password: "short" });

        expect(res.status).toBe(400);
        const { error } = await res.json() as ErrorBody;
        expect(error.code).toBe("WEAK_PASSWORD");
        expect(error.message).toMatch(/^Password too weak: /);
        expect(updateUser).not.toHaveBeenCalled();
    });

    it("POST /users/:uid/reset-password with a chosen password answers 400 WEAK_PASSWORD", async () => {
        const { authRepo, updatePassword } = repo();
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/", createResetPasswordRoute({ authRepo }));

        const res = await send(app, "POST", "/users/target/reset-password", { password: "short" });

        expect(res.status).toBe(400);
        const { error } = await res.json() as ErrorBody;
        expect(error.code).toBe("WEAK_PASSWORD");
        expect(error.message).toMatch(/^Password too weak: /);
        expect(updatePassword).not.toHaveBeenCalled();
    });
});
