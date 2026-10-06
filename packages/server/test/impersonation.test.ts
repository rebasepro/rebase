import { describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import { Hono } from "hono";
import {
    EMPTY_ACCESS_MODEL,
    IMPERSONATE_HEADER,
    type AuthAdapter,
    type AuthenticatedUser,
    type DataDriver
} from "@rebasepro/types";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import type { ApiKeyStore } from "../src/auth/api-keys/api-key-store";
import type { ApiKey } from "../src/auth/api-keys/api-key-types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAuthMiddleware } from "../src/auth/middleware";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureAccess } from "../src/auth/access";
import { sha256Hex } from "../src/utils/portable-crypto";
import type { HonoEnv } from "../src/api/types";

/**
 * The branches of `x-rebase-impersonate` the Postgres e2e
 * (`server-postgres/test/e2e/impersonation-e2e.test.ts`) cannot reach: a key
 * that acts as an administrator *person*, a backend that has no way to read
 * another user, and the claims an impersonated request carries.
 */

function recordingDriver() {
    const scopedAs: Record<string, unknown>[] = [];
    const driver = {
        key: "recording",
        initialised: true,
        withAuth: async (user: Record<string, unknown>) => {
            scopedAs.push(user);
            return driver;
        }
    } as unknown as DataDriver;
    return { driver, scopedAs };
}

/** An app whose one route reports who it ran as — and records that it ran. */
function appWith(middleware: ReturnType<typeof createAuthMiddleware>) {
    const app = new Hono<HonoEnv>();
    const handled: unknown[] = [];
    app.use("/*", middleware);
    app.get("/data", (c) => {
        handled.push(c.get("user"));
        return c.json({ user: c.get("user"), impersonator: c.get("impersonator") ?? null });
    });
    return { app, handled };
}

const ADMIN = "admin-1";
const MEMBER = "member-1";

const accounts: Record<string, { user: UserData; roles: string[] }> = {
    [ADMIN]: { user: account(ADMIN), roles: ["admin"] },
    [MEMBER]: { user: account(MEMBER), roles: ["editor"] }
};

function account(id: string): UserData {
    return { id, email: `${id}@example.test`, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
}

const repo = {
    getUserById: async (id: string) => accounts[id]?.user ?? null,
    getUserRoleIds: async (id: string) => accounts[id]?.roles ?? []
} as unknown as AuthRepository;

async function errorCode(res: Response): Promise<unknown> {
    const body = await res.json() as { error?: { code?: unknown } };
    return body.error?.code;
}

describe("x-rebase-impersonate", () => {
    let adminToken: string;

    beforeAll(async () => {
        configureJwt({ secret: "impersonation-unit-secret-0123456789abcdef", accessExpiresIn: "1h" });
        // The admin's own session carries a claim of its own. It must not
        // survive into the impersonated request.
        adminToken = await generateAccessToken(ADMIN, ["admin"], "aal1", { org_id: "admin-org" });
    });

    afterEach(() => {
        configureAccess({ model: EMPTY_ACCESS_MODEL });
    });

    it("scopes as the target with the claims a token minted for them now would carry, and none of the admin's", async () => {
        const adapter = createBuiltinAuthAdapter({
            authRepository: repo,
            authHooks: {
                // An identity claim from the hook is dropped, as on a real token.
                customizeAccessToken: async (claims, user) => ({ ...claims, org_id: `${user.id}-org`, roles: ["admin"] })
            }
        });
        const { driver, scopedAs } = recordingDriver();
        const { app } = appWith(createAdapterAuthMiddleware({ adapter, driver }));

        const res = await app.request("/data", {
            headers: { Authorization: `Bearer ${adminToken}`, [IMPERSONATE_HEADER]: MEMBER }
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            user: expect.objectContaining({ uid: MEMBER, roles: ["editor"] }),
            impersonator: { uid: ADMIN }
        });
        // The caller's own scoping, then the target's — which is the one the
        // request runs with.
        expect(scopedAs.at(-1)).toEqual({
            uid: MEMBER,
            roles: ["editor"],
            isAnonymous: false,
            claims: { org_id: `${MEMBER}-org` }
        });
    });

    it("refuses a key that acts as an administrator person — the credential decides, not the roles", async () => {
        const plaintext = "rk_test_personal_key_of_an_administrator";
        const stored: ApiKey = {
            id: "key-1",
            name: "admin's key",
            kind: "personal",
            key_prefix: plaintext.slice(0, 12),
            key_hash: await sha256Hex(plaintext),
            scopes: ["data:read"],
            roles: [],
            owner_uid: ADMIN,
            rate_limit: null,
            created_by: ADMIN,
            created_at: new Date(0).toISOString(),
            updated_at: new Date(0).toISOString(),
            last_used_at: null,
            expires_at: null,
            revoked_at: null
        };
        const store = {
            findByKeyHash: async (hash: string) => (hash === stored.key_hash ? stored : null),
            updateLastUsed: async () => undefined
        } as unknown as ApiKeyStore;
        configureAccess({ model: EMPTY_ACCESS_MODEL, resolveKeyOwner: async (uid) => (uid === ADMIN ? { roles: ["admin"] } : null) });

        const adapter = createBuiltinAuthAdapter({ authRepository: repo });
        const { app, handled } = appWith(createAdapterAuthMiddleware({ adapter, driver: recordingDriver().driver, apiKeyStore: store }));

        const plain = await app.request("/data", { headers: { Authorization: `Bearer ${plaintext}` } });
        expect(plain.status).toBe(200);

        const res = await app.request("/data", {
            headers: { Authorization: `Bearer ${plaintext}`, [IMPERSONATE_HEADER]: MEMBER }
        });
        expect(res.status).toBe(403);
        expect(await errorCode(res)).toBe("IMPERSONATION_FORBIDDEN");
        expect(handled).toHaveLength(1);
    });

    it("refuses an administrator with 501 where the auth cannot read another user, and never runs as them", async () => {
        const external: AuthAdapter = {
            id: "external",
            verifyRequest: async (): Promise<AuthenticatedUser> => ({ uid: ADMIN, email: "", roles: ["admin"], isAdmin: true }),
            getCapabilities: () => ({ hasBuiltInAuthRoutes: false, emailPasswordLogin: false })
        };
        const viaAdapter = appWith(createAdapterAuthMiddleware({ adapter: external, driver: recordingDriver().driver }));
        const viaJwt = appWith(createAuthMiddleware({ driver: recordingDriver().driver }));

        for (const { app, handled } of [viaAdapter, viaJwt]) {
            const res = await app.request("/data", {
                headers: { Authorization: `Bearer ${adminToken}`, [IMPERSONATE_HEADER]: MEMBER }
            });
            expect(res.status).toBe(501);
            expect(await errorCode(res)).toBe("IMPERSONATION_UNAVAILABLE");
            expect(handled).toHaveLength(0);
        }
    });

    it("refuses a non-administrator before looking the target up", async () => {
        let lookups = 0;
        const counting = {
            getUserById: async (id: string) => {
                lookups++;
                return accounts[id]?.user ?? null;
            },
            getUserRoleIds: async (id: string) => accounts[id]?.roles ?? []
        } as unknown as AuthRepository;
        const adapter = createBuiltinAuthAdapter({ authRepository: counting });
        const { app } = appWith(createAdapterAuthMiddleware({ adapter, driver: recordingDriver().driver }));
        const memberToken = await generateAccessToken(MEMBER, ["admin"]);

        const res = await app.request("/data", {
            headers: { Authorization: `Bearer ${memberToken}`, [IMPERSONATE_HEADER]: "whoever" }
        });
        expect(res.status).toBe(403);
        expect(await errorCode(res)).toBe("IMPERSONATION_FORBIDDEN");
        expect(lookups).toBe(0);
    });
});
