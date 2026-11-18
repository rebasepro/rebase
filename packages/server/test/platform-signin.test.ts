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
import { configureJwt } from "../src/auth/jwt";
import { signJwt } from "../src/auth/jwt-crypto";
import { MemoryRateLimitStore } from "../src/auth/rate-limit-store";
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
        authHooks: { hashPassword: async (p: string) => `hashed:${p}`, verifyPassword: async (p: string, h: string) => h === `hashed:${p}` },
        ...(options.door === false ? {} : {
            platformSignIn: {
                tokens: { publicKeys: [publicPem], audience: PROJECT },
                usedTokens: new MemoryRateLimitStore()
            }
        })
    }));
    const signIn = (t: string) => app.request("/auth/platform-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t })
    });
    return { store, app, signIn };
}

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

    it("a sign-in token is no key to the admin surfaces", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("*", createPlatformTokenPreAuth({ publicKeys: [publicPem], audience: PROJECT }));
        app.get("/cron", (c) => c.json({ ok: true }));
        const res = await app.request("/cron", { headers: { authorization: `Bearer ${await token()}` } });
        expect(res.status).toBe(401);
    });
});
