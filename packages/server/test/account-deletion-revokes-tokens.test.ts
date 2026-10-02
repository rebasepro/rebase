/**
 * Deleting an account is a revocation, on every door that honours a token.
 *
 * The revocation watermark lives on the user row. Its owner signs out
 * everywhere, the watermark voids the stolen token — and then an administrator
 * deletes the account ("deleting an account is how an administrator bans
 * one"), the row goes, the watermark goes with it, and the read that used to
 * answer "revoked" answered "nothing set". The roles lookup answered `[]`
 * rather than "nobody". So the token its owner had revoked came back, as an
 * authenticated principal with that uid, on the data plane, the admin gates
 * and a new socket, for the rest of its lifetime.
 *
 * MCP refresh and personal API keys already treated a missing account as
 * revoked. This holds the built-in adapter (data plane and socket), the admin
 * gate and the auth routes' live-session guard to the same answer, against a
 * store that drops the row's state with the row, as Postgres does.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";
import { judgeAccessToken } from "../src/auth/token-revocation";
import { createRequireAuth } from "../src/auth/middleware";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const HOOKS = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => configureJwt({ secret: "account-deletion-revokes-tokens-secret-0123", accessExpiresIn: "1h" }));

function world() {
    const store = new MemoryAuthStore();
    const adapter = createBuiltinAuthAdapter({ authRepository: store.repo(), allowRegistration: true, authHooks: HOOKS });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", adapter.createAuthRoutes() as Hono<HonoEnv>);
    app.route("/admin", adapter.createAdminRoutes!() as Hono<HonoEnv>);
    // The data plane: whatever the adapter says the request is.
    app.get("/data", async (c) => {
        const user = await adapter.verifyRequest(c.req.raw);
        return user ? c.json({ uid: user.uid, roles: user.roles }) : c.json({ error: "unauthenticated" }, 401);
    });
    // An admin-gated surface, gated as `init.ts` gates backups, cron and logs.
    const gated = new Hono<HonoEnv>();
    gated.onError(errorHandler);
    gated.use("/*", createRequireAuth({ resolveRoles: uid => store.repo().getUserRoleIds(uid), revocationRepo: store.repo() }));
    gated.get("/", (c) => c.json({ ok: true }));
    app.route("/gated", gated);

    const json = (method: string, body?: unknown, token?: string): RequestInit => ({
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { store, adapter, app, json };
}

describe("a deleted account's tokens", () => {
    it("stay refused after the owner revoked them and an admin deleted the account", async () => {
        const { store, adapter, app, json } = world();
        const admin = await store.repo().createUser({ email: "admin@corp.com", emailVerified: true });
        await store.repo().setUserRoles(admin.id, ["admin"]);
        const adminToken = await generateAccessToken(admin.id, ["admin"]);

        const registered = await app.request("/auth/register", json("POST", { email: "stolen@corp.com", password: "Passw0rd-Stolen" }));
        expect(registered.status).toBe(201);
        const { user, tokens } = await registered.json() as { user: { uid: string }; tokens: { accessToken: string } };
        const stolen = tokens.accessToken;

        // `iat` is whole seconds; the sign-out has to land in a later one.
        await new Promise(resolve => setTimeout(resolve, 1100));
        expect((await app.request("/auth/sessions", json("DELETE", undefined, stolen))).status).toBe(200);
        expect((await app.request("/data", json("GET", undefined, stolen))).status).toBe(401);

        expect((await app.request(`/admin/users/${user.uid}`, json("DELETE", undefined, adminToken))).status).toBe(200);

        expect((await app.request("/data", json("GET", undefined, stolen))).status).toBe(401);
        expect(await adapter.verifyToken!(stolen)).toBeNull();
    });

    it("are refused once the account is deleted, with no sign-out first", async () => {
        const { store, adapter, app, json } = world();
        const user = await store.repo().createUser({ email: "gone@corp.com", emailVerified: true });
        await store.repo().setUserRoles(user.id, ["admin"]);
        const token = await generateAccessToken(user.id, ["admin"]);
        expect((await app.request("/data", json("GET", undefined, token))).status).toBe(200);
        expect((await app.request("/gated", json("GET", undefined, token))).status).toBe(200);

        await store.repo().deleteUser(user.id);

        // The data plane and the socket's AUTHENTICATE.
        expect((await app.request("/data", json("GET", undefined, token))).status).toBe(401);
        expect(await adapter.verifyToken!(token)).toBeNull();
        // The admin gate in front of backups, cron, logs and keys.
        const gated = await app.request("/gated", json("GET", undefined, token));
        expect(gated.status).toBe(401);
        expect((await gated.json() as { error: { code: string } }).error.code).toBe("SESSION_REVOKED");
        // The auth routes' own live-session guard.
        expect((await app.request("/auth/sessions", json("GET", undefined, token))).status).toBe(401);
    });
});

describe("judgeAccessToken", () => {
    const payloadFor = async (uid: string) => (await verifyAccessToken(await generateAccessToken(uid, [])))!;

    it("reads a missing account as deleted when the repository has only getUserWithRoles", async () => {
        const repo = { getUserWithRoles: async () => null, getTokensValidAfter: async () => null };
        expect(await judgeAccessToken(repo, await payloadFor("u1"))).toEqual({ live: false, refusal: "account-deleted" });
    });

    it("reads a missing account as deleted from getAccountAccessState", async () => {
        const repo = { getAccountAccessState: async () => null };
        expect(await judgeAccessToken(repo, await payloadFor("u1"))).toEqual({ live: false, refusal: "account-deleted" });
    });

    it("returns the live roles of an account that exists", async () => {
        const repo = { getAccountAccessState: async () => ({ roles: ["editor"], tokensValidAfter: null }) };
        expect(await judgeAccessToken(repo, await payloadFor("u1"))).toEqual({ live: true, roles: ["editor"] });
    });

    it("refuses a token issued before the watermark", async () => {
        const payload = await payloadFor("u1");
        const repo = { getAccountAccessState: async () => ({ roles: [], tokensValidAfter: new Date((payload.iat! + 60) * 1000) }) };
        expect(await judgeAccessToken(repo, payload)).toEqual({ live: false, refusal: "revoked" });
    });

    it("throws when the repository does, so the caller refuses rather than guesses", async () => {
        const repo = { getAccountAccessState: async () => { throw new Error("db down"); } };
        await expect(judgeAccessToken(repo, await payloadFor("u1"))).rejects.toThrow("db down");
    });
});

/**
 * The guard for the class: a door that honours an access token asks
 * `judgeAccessToken`, which knows a deleted account when it sees one. The
 * watermark read on its own does not — the mark lives on the row — so its only
 * callers are the two MCP paths that pair it with `currentRoles`, which does.
 */
describe("who reads the revocation watermark on its own", () => {
    it("is only the MCP grant paths, which ask whether the account exists beside it", async () => {
        const { readdirSync, readFileSync, statSync } = await import("node:fs");
        const { join, relative } = await import("node:path");
        const root = join(__dirname, "../src");
        const callers: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else if (path.endsWith(".ts") && !path.endsWith(".test.ts")
                    && /\bisAccessTokenRevoked\(/.test(readFileSync(path, "utf8").replace(/export async function isAccessTokenRevoked\(/, ""))) {
                    callers.push(relative(root, path));
                }
            }
        };
        walk(root);
        expect(callers.sort()).toEqual(["mcp/oauth-routes.ts"]);
    });
});

describe("userManagement.createUser", () => {
    it("stores the address verified when told to, as the seeded admin is", async () => {
        const store = new MemoryAuthStore();
        const adapter = createBuiltinAuthAdapter({ authRepository: store.repo(), authHooks: HOOKS });
        const seeded = await adapter.userManagement!.createUser({ email: "ops@corp.com", password: "Passw0rd-Ops", emailVerified: true });
        expect(store.users.get(seeded.id)?.emailVerified).toBe(true);
    });
});
