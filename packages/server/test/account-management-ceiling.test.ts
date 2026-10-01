/**
 * `users:write` is the scope that lets a narrower role manage accounts — and
 * the scope that, unbounded, would let that role reset an administrator's
 * password and sign in as them, or hand itself `admin`.
 *
 * So nobody edits, resets or deletes an account holding anything they do not,
 * and nobody grants a role holding anything they do not. Only an admin grants
 * `admin`, which is more than its scopes: it is the RLS role that reads every
 * row.
 */
import { describe, it, expect, beforeAll, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { EMPTY_ACCESS_MODEL } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { createResetPasswordRoute } from "../src/auth/reset-password-admin";
import { configureAccess } from "../src/auth/access";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import type { AuthRepository, UserData } from "../src/auth/interfaces";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const user = (id: string): UserData => ({ id, email: `${id}@test.com`, createdAt: new Date(), updatedAt: new Date() } as UserData);

function repo(initial: Record<string, string[]>) {
    const roles = new Map(Object.entries(initial));
    const users = [...roles.keys()].map(user);
    const writes: string[] = [];
    const authRepo = {
        listUsers: async () => users,
        getUserById: async (id: string) => users.find(u => u.id === id) ?? null,
        getUserByEmail: async () => null,
        getUserRoleIds: async (id: string) => roles.get(id) ?? [],
        getUserWithRoles: async (id: string) => {
            const found = users.find(u => u.id === id);
            return found ? { user: found, roles: roles.get(id) ?? [] } : null;
        },
        setUserRoles: async (id: string, r: string[]) => { writes.push(`roles:${id}`); roles.set(id, r); },
        updateUser: async (id: string) => { writes.push(`update:${id}`); return users.find(u => u.id === id) ?? null; },
        deleteUser: async (id: string) => { writes.push(`delete:${id}`); },
        updatePassword: async (id: string) => { writes.push(`password:${id}`); },
        setTokensValidAfter: async () => undefined,
        getTokensValidAfter: async () => null,
        revokeAllRefreshTokens: async () => undefined,
        deleteAllRefreshTokensForUser: async () => undefined,
        createUser: async (data: { email: string }) => { const created = user(data.email.split("@")[0]); users.push(created); writes.push(`create:${created.id}`); return created; }
    } as unknown as AuthRepository;
    return { authRepo, writes, roles };
}

beforeAll(() => {
    configureJwt({ secret: "account-ceiling-test-secret-1234567890-abcdef", accessExpiresIn: "1h" });
});

afterEach(() => configureAccess({ model: EMPTY_ACCESS_MODEL }));

const MODEL = {
    roles: {
        support: { scopes: ["users:read", "users:write"] },
        ops: { scopes: ["users:read", "users:write", "logs:read"] }
    },
    scopes: {}
};

async function as(uid: string, roles: string[]) {
    return { Authorization: `Bearer ${await generateAccessToken(uid, roles)}`, "Content-Type": "application/json" };
}

function app(authRepo: AuthRepository) {
    const root = new Hono<HonoEnv>();
    root.route("/", createAdminUsersRoute({ authRepo }));
    root.route("/", createResetPasswordRoute({ authRepo } as never));
    return root;
}

describe("a users:write role managing accounts", () => {
    it("edits and deletes an account holding no more than it does", async () => {
        configureAccess({ model: MODEL });
        const { authRepo, writes } = repo({ sup: ["support"], peer: ["support"], plain: [] });
        const headers = await as("sup", ["support"]);
        const a = app(authRepo);

        expect((await a.request("/users/plain", { method: "PUT", headers, body: JSON.stringify({ displayName: "P" }) })).status).toBe(200);
        expect((await a.request("/users/peer", { method: "DELETE", headers })).status).toBe(200);
        expect(writes).toEqual(expect.arrayContaining(["update:plain", "delete:peer"]));
    });

    it.each([
        ["edit", "PUT", "/users/boss", { displayName: "x" }],
        ["delete", "DELETE", "/users/boss", undefined],
        ["reset the password of", "POST", "/users/boss/reset-password", { password: "Another-Str0ng-Pass!" }]
    ])("cannot %s an administrator", async (_verb, method, path, body) => {
        configureAccess({ model: MODEL });
        const { authRepo, writes } = repo({ sup: ["support"], boss: ["admin"] });
        const res = await app(authRepo).request(path, {
            method, headers: await as("sup", ["support"]), ...(body ? { body: JSON.stringify(body) } : {})
        });
        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("ACCOUNT_OUTRANKS_CALLER");
        expect(writes).toEqual([]);
    });

    it("cannot touch an account whose role holds a scope it lacks", async () => {
        configureAccess({ model: MODEL });
        const { authRepo, writes } = repo({ sup: ["support"], op: ["ops"] });
        const res = await app(authRepo).request("/users/op", { method: "DELETE", headers: await as("sup", ["support"]) });
        expect(res.status).toBe(403);
        expect(writes).toEqual([]);
    });

    it("cannot grant admin, nor a role holding more than it does", async () => {
        configureAccess({ model: MODEL });
        const { authRepo, writes } = repo({ sup: ["support"], plain: [] });
        const a = app(authRepo);
        const headers = await as("sup", ["support"]);

        for (const roles of [["admin"], ["ops"]]) {
            const res = await a.request("/users/plain", { method: "PUT", headers, body: JSON.stringify({ roles }) });
            expect(res.status).toBe(403);
            expect((await res.json() as { error: { code: string } }).error.code).toBe("ROLE_EXCEEDS_CALLER");
        }
        const created = await a.request("/users", { method: "POST", headers, body: JSON.stringify({ email: "new@test.com", roles: ["admin"] }) });
        expect(created.status).toBe(403);
        expect(writes).toEqual([]);
    });

    it("can grant a role within its own scopes", async () => {
        configureAccess({ model: MODEL });
        const { authRepo, roles } = repo({ sup: ["support"], plain: [] });
        const res = await app(authRepo).request("/users/plain", {
            method: "PUT", headers: await as("sup", ["support"]), body: JSON.stringify({ roles: ["support"] })
        });
        expect(res.status).toBe(200);
        expect(roles.get("plain")).toEqual(["support"]);
    });
});

describe("an administrator", () => {
    it("manages any account and grants any role", async () => {
        configureAccess({ model: MODEL });
        const { authRepo, roles } = repo({ root: ["admin"], other: ["admin"], plain: [] });
        const a = app(authRepo);
        const headers = await as("root", ["admin"]);
        expect((await a.request("/users/plain", { method: "PUT", headers, body: JSON.stringify({ roles: ["admin"] }) })).status).toBe(200);
        expect(roles.get("plain")).toEqual(["admin"]);
        expect((await a.request("/users/other", { method: "PUT", headers, body: JSON.stringify({ displayName: "O" }) })).status).toBe(200);
    });
});

describe("a role without users:write", () => {
    it("reads accounts with users:read and changes none", async () => {
        configureAccess({ model: { roles: { viewer: { scopes: ["users:read"] } }, scopes: {} } });
        const { authRepo, writes } = repo({ v: ["viewer"], plain: [] });
        const a = app(authRepo);
        const headers = await as("v", ["viewer"]);
        expect((await a.request("/users/plain", { headers })).status).toBe(200);
        const res = await a.request("/users/plain", { method: "PUT", headers, body: JSON.stringify({ displayName: "x" }) });
        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SCOPE_MISSING");
        expect(writes).toEqual([]);
    });
});
