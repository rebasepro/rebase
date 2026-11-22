/**
 * POST /auth/platform-signin — the platform signs a project's owner in.
 *
 * What it must do: turn a fresh sign-in token for this project into an admin
 * session for the email it names, creating the account when there is none.
 * What it must never do: accept a token for another project, an expired one,
 * one without the sign-in scope (a cron token), one that lives too long or
 * names no email, or the same token twice; or hand somebody else's password
 * on an unproven account the admin role.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { forgetRemovedPlatformRoles } from "../src/auth/platform-grants";
import { signJwt } from "../src/auth/jwt-crypto";
import { MemoryRateLimitStore } from "../src/auth/rate-limit-store";
import { createAuthLimiters } from "../src/auth/rate-limiter";
import { createPlatformTokenPreAuth } from "../src/auth/platform-token";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const PROJECT = "11111111-2222-3333-4444-555555555555";
const OWNER = "owner@example.com";
const now = () => Math.floor(Date.now() / 1000);

let privateKey: KeyObject;
let publicPem: string;
let otherPrivateKey: KeyObject;

beforeAll(() => {
    configureJwt({ secret: "test-secret-key-for-platform-signin-1234567890", accessExpiresIn: "1h" });
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    privateKey = pair.privateKey;
    publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    otherPrivateKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
});

let jtiCounter = 0;
async function token(overrides: Record<string, unknown> = {}, key: KeyObject = privateKey): Promise<string> {
    const claims: Record<string, unknown> = {
        iss: "rebase-cloud",
        aud: PROJECT,
        sub: "cloud-user-1",
        scope: "auth:admin-signin",
        email: OWNER,
        jti: `jti-${++jtiCounter}`,
        iat: now(),
        exp: now() + 60,
        ...overrides
    };
    for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
    return `rpt_${await signJwt(claims, key, { algorithm: "ES256" })}`;
}

function world(options: { door?: boolean } = {}) {
    const store = new MemoryAuthStore();
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        // Each world counts its own requests: the suite signs in more often
        // than the process default's strict limit allows one address.
        limiters: createAuthLimiters(),
        authHooks: { hashPassword: async (p: string) => `hashed:${p}`, verifyPassword: async (p: string, h: string) => h === `hashed:${p}` },
        ...(options.door === false ? {} : {
            platformSignIn: {
                tokens: { publicKeys: [publicPem], audience: PROJECT },
                usedTokens: new MemoryRateLimitStore()
            }
        })
    }));
    const post = (path: string, t: string) => app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t })
    });
    const signIn = (t: string) => post("/auth/platform-signin", t);
    const revoke = (t: string) => post("/auth/platform-revoke", t);
    return { store, app, signIn, revoke };
}

const revokeToken = (overrides: Record<string, unknown> = {}) => token({ scope: "auth:admin-revoke", ...overrides });

type AuthBody = { user: { uid: string; email: string; roles: string[]; providerId: string; emailVerified: boolean }; tokens: { accessToken: string } };

describe("POST /auth/platform-signin", () => {
    it("creates the owner's account on an empty project and signs them in as admin", async () => {
        const { store, signIn } = world();
        const res = await signIn(await token());
        expect(res.status).toBe(200);
        const body = await res.json() as AuthBody;
        expect(body.user.email).toBe(OWNER);
        expect(body.user.roles).toContain("admin");
        expect(body.user.providerId).toBe("platform");
        expect(body.user.emailVerified).toBe(true);
        expect(body.tokens.accessToken).toBeTruthy();
        const created = [...store.users.values()].find(u => u.email === OWNER);
        expect(created?.passwordHash ?? null).toBeNull();
        expect(store.roles.get(created!.id)).toEqual(["admin"]);
    });

    it("signs an existing verified account in and adds admin to its roles", async () => {
        const { store, signIn } = world();
        const existing = await store.repo().createUser({ email: OWNER, passwordHash: "hashed:theirs", emailVerified: true });
        await store.repo().setUserRoles(existing.id, ["editor"]);
        const res = await signIn(await token());
        expect(res.status).toBe(200);
        const body = await res.json() as AuthBody;
        expect(body.user.uid).toBe(existing.id);
        expect(store.roles.get(existing.id)).toEqual(["editor", "admin"]);
        // Their own password still works: a verified account is theirs.
        expect(store.users.get(existing.id)?.passwordHash).toBe("hashed:theirs");
    });

    it("removes the password from an unproven account before making it the owner's admin", async () => {
        const { store, signIn } = world();
        // Somebody registered the owner's address first, with a password they know.
        const squatter = await store.repo().createUser({ email: OWNER, passwordHash: "hashed:squatter", emailVerified: false });
        const res = await signIn(await token());
        expect(res.status).toBe(200);
        expect(store.users.get(squatter.id)?.passwordHash ?? null).toBeNull();
        expect(store.users.get(squatter.id)?.emailVerified).toBe(true);
    });

    it("refuses the same token twice", async () => {
        const { signIn } = world();
        const t = await token();
        expect((await signIn(t)).status).toBe(200);
        const again = await signIn(t);
        expect(again.status).toBe(401);
        expect((await again.json() as { error: { code: string } }).error.code).toBe("INVALID_PLATFORM_TOKEN");
    });

    it.each([
        ["another project's token", { aud: "another-project" }],
        ["an expired token", { iat: now() - 300, exp: now() - 200 }],
        ["a cron token", { scope: "cron:read cron:write" }],
        ["a token that lives longer than two minutes", { exp: now() + 300 }],
        ["a token with no email", { email: undefined }],
        ["a token with no jti", { jti: undefined }],
        ["a token from another issuer", { iss: "someone-else" }]
    ])("refuses %s", async (_label, overrides) => {
        const { store, signIn } = world();
        const res = await signIn(await token(overrides));
        expect(res.status).toBe(401);
        expect(store.users.size).toBe(0);
    });

    it("refuses a token signed by a key the platform does not hold", async () => {
        const { store, signIn } = world();
        const res = await signIn(await token({}, otherPrivateKey));
        expect(res.status).toBe(401);
        expect(store.users.size).toBe(0);
    });

    it("is not mounted where the platform set no key", async () => {
        const { signIn } = world({ door: false });
        expect((await signIn(await token())).status).toBe(404);
    });

    it("records admin as the platform's grant when it added the role", async () => {
        const { store, signIn } = world();
        await signIn(await token());
        const created = [...store.users.values()].find(u => u.email === OWNER)!;
        expect(store.users.get(created.id)?.metadata?.platformRoles).toEqual(["admin"]);
    });

    it("does not record an admin the account already held", async () => {
        const { store, signIn } = world();
        const existing = await store.repo().createUser({ email: OWNER, emailVerified: true });
        await store.repo().setUserRoles(existing.id, ["admin"]);
        expect((await signIn(await token())).status).toBe(200);
        expect(store.users.get(existing.id)?.metadata?.platformRoles).toBeUndefined();
    });

    it("refuses a revocation token", async () => {
        const { store, signIn } = world();
        const res = await signIn(await revokeToken());
        expect(res.status).toBe(401);
        expect(store.users.size).toBe(0);
    });

    it("refuses a token carrying both the sign-in and the revocation scope", async () => {
        const { store, signIn } = world();
        const res = await signIn(await token({ scope: "auth:admin-signin auth:admin-revoke" }));
        expect(res.status).toBe(401);
        expect(store.users.size).toBe(0);
    });

    it("a sign-in token is no key to the admin surfaces", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("*", createPlatformTokenPreAuth({ publicKeys: [publicPem], audience: PROJECT }));
        app.get("/cron", (c) => c.json({ ok: true }));
        const res = await app.request("/cron", { headers: { authorization: `Bearer ${await token()}` } });
        expect(res.status).toBe(401);
    });
});

describe("POST /auth/platform-revoke", () => {
    type RevokeBody = { revoked: boolean };

    async function signedInOwner(w: ReturnType<typeof world>) {
        const res = await w.signIn(await token());
        expect(res.status).toBe(200);
        return [...w.store.users.values()].find(u => u.email === OWNER)!.id;
    }

    it("takes back the admin the platform granted and ends every session", async () => {
        const w = world();
        const uid = await signedInOwner(w);
        await w.store.repo().setUserRoles(uid, ["editor", "admin"]);
        expect(w.store.refreshTokens.some(t => t.uid === uid)).toBe(true);

        const res = await w.revoke(await revokeToken());
        expect(res.status).toBe(200);
        expect(await res.json() as RevokeBody).toEqual({ revoked: true });
        expect(w.store.roles.get(uid)).toEqual(["editor"]);
        expect(w.store.refreshTokens.filter(t => t.uid === uid)).toHaveLength(0);
        expect(w.store.validAfter.get(uid)).toBeInstanceOf(Date);
        expect(w.store.users.get(uid)?.metadata?.platformRoles).toBeUndefined();
        // Never the account itself.
        expect(w.store.users.has(uid)).toBe(true);
    });

    it("leaves an admin granted by hand, and the account's sessions", async () => {
        const w = world();
        const existing = await w.store.repo().createUser({ email: OWNER, emailVerified: true });
        await w.store.repo().setUserRoles(existing.id, ["admin"]);
        await w.signIn(await token());
        const sessions = w.store.refreshTokens.filter(t => t.uid === existing.id).length;

        const res = await w.revoke(await revokeToken());
        expect(res.status).toBe(200);
        expect(await res.json() as RevokeBody).toEqual({ revoked: false });
        expect(w.store.roles.get(existing.id)).toEqual(["admin"]);
        expect(w.store.refreshTokens.filter(t => t.uid === existing.id)).toHaveLength(sessions);
        expect(w.store.validAfter.has(existing.id)).toBe(false);
    });

    it("answers revoked: false for an email with no account", async () => {
        const { store, revoke } = world();
        const res = await revoke(await revokeToken());
        expect(res.status).toBe(200);
        expect(await res.json() as RevokeBody).toEqual({ revoked: false });
        expect(store.users.size).toBe(0);
    });

    it("an administrator removing the platform's admin by hand makes a later hand grant the app's", async () => {
        const w = world();
        const uid = await signedInOwner(w);
        await w.store.repo().setUserRoles(uid, []);
        // What `PUT /admin/users/:uid` does after setting roles.
        await forgetRemovedPlatformRoles(w.store.repo(), (await w.store.repo().getUserById(uid))!, []);
        await w.store.repo().setUserRoles(uid, ["admin"]);

        const res = await w.revoke(await revokeToken());
        expect(await res.json() as RevokeBody).toEqual({ revoked: false });
        expect(w.store.roles.get(uid)).toEqual(["admin"]);
    });

    it("refuses the same token twice", async () => {
        const w = world();
        await signedInOwner(w);
        const t = await revokeToken();
        expect((await w.revoke(t)).status).toBe(200);
        const again = await w.revoke(t);
        expect(again.status).toBe(401);
        expect((await again.json() as { error: { code: string } }).error.code).toBe("INVALID_PLATFORM_TOKEN");
    });

    it.each([
        ["a sign-in token", { scope: "auth:admin-signin" }],
        ["a token carrying both scopes", { scope: "auth:admin-signin auth:admin-revoke" }],
        ["a cron token", { scope: "cron:read" }],
        ["another project's token", { aud: "another-project" }],
        ["an expired token", { iat: now() - 300, exp: now() - 200 }],
        ["a token that lives longer than two minutes", { exp: now() + 300 }],
        ["a token with no email", { email: undefined }],
        ["a token with no jti", { jti: undefined }],
        ["a token from another issuer", { iss: "someone-else" }]
    ])("refuses %s and changes nothing", async (_label, overrides) => {
        const w = world();
        const uid = await signedInOwner(w);
        const res = await w.revoke(await revokeToken(overrides));
        expect(res.status).toBe(401);
        expect(w.store.roles.get(uid)).toEqual(["admin"]);
    });

    it("refuses a token signed by a key the platform does not hold", async () => {
        const w = world();
        const uid = await signedInOwner(w);
        const res = await w.revoke(`rpt_${await signJwt({
            iss: "rebase-cloud", aud: PROJECT, sub: "cloud-user-1", scope: "auth:admin-revoke",
            email: OWNER, jti: "foreign", iat: now(), exp: now() + 60
        }, otherPrivateKey, { algorithm: "ES256" })}`);
        expect(res.status).toBe(401);
        expect(w.store.roles.get(uid)).toEqual(["admin"]);
    });

    it("is not mounted where the platform set no key", async () => {
        const { revoke } = world({ door: false });
        expect((await revoke(await revokeToken())).status).toBe(404);
    });

    it("a sign-in after a revocation grants, and records, admin again", async () => {
        const w = world();
        const uid = await signedInOwner(w);
        await w.revoke(await revokeToken());
        expect((await w.signIn(await token())).status).toBe(200);
        expect(w.store.roles.get(uid)).toEqual(["admin"]);
        expect(w.store.users.get(uid)?.metadata?.platformRoles).toEqual(["admin"]);
    });
});

describe("the admin users API says which roles came from the platform", () => {
    it("lists platformRoles, and forgets one an administrator removes by hand", async () => {
        const w = world();
        const uid = await (async () => {
            await w.signIn(await token());
            return [...w.store.users.values()].find(u => u.email === OWNER)!.id;
        })();
        const handAdmin = await w.store.repo().createUser({ email: "hand@example.com", emailVerified: true });
        await w.store.repo().setUserRoles(handAdmin.id, ["admin"]);

        const admin = createAdminUsersRoute({ authRepo: w.store.repo() });
        const headers = { authorization: `Bearer ${await generateAccessToken(handAdmin.id, ["admin"])}`, "Content-Type": "application/json" };
        type Listed = { users: { uid: string; platformRoles?: string[] }[] };

        const listed = await (await admin.request("/users", { headers })).json() as Listed;
        expect(listed.users.find(u => u.uid === uid)?.platformRoles).toEqual(["admin"]);
        expect(listed.users.find(u => u.uid === handAdmin.id)?.platformRoles).toBeUndefined();

        const put = await admin.request(`/users/${uid}`, { method: "PUT", headers, body: JSON.stringify({ roles: ["editor"] }) });
        expect(put.status).toBe(200);
        expect((await put.json() as { user: { platformRoles?: string[] } }).user.platformRoles).toBeUndefined();
        expect(w.store.users.get(uid)?.metadata?.platformRoles).toBeUndefined();
    });
});
