/**
 * Admin bootstrap endpoint — POST /bootstrap
 *
 * Verifies the self-promotion gate: only the earliest-registered user may claim
 * the initial admin role while no admin exists, and the endpoint is closed once
 * an admin exists.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

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

async function bearer(userId: string): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await generateAccessToken(userId, [])}` };
}

describe("POST /bootstrap", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
    });

    it("promotes the earliest-registered user", async () => {
        const users = [user("u1", "2026-01-01"), user("u2", "2026-02-01")];
        const { repo, setUserRoles } = mockRepo(users);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/bootstrap", { method: "POST", headers: await bearer("u1") });

        expect(res.status).toBe(200);
        expect(setUserRoles).toHaveBeenCalledWith("u1", ["admin"]);
    });

    it("denies a later user while no admin exists (no land-grab)", async () => {
        const users = [user("u1", "2026-01-01"), user("u2", "2026-02-01")];
        const { repo, setUserRoles } = mockRepo(users);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/bootstrap", { method: "POST", headers: await bearer("u2") });

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("BOOTSTRAP_NOT_FIRST_USER");
        expect(setUserRoles).not.toHaveBeenCalled();
    });

    it("is shut in production, where an earliest-user claim is first-to-register one request later", async () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
            const users = [user("u1", "2026-01-01")];
            const { repo, setUserRoles } = mockRepo(users);
            const app = createAdminUsersRoute({ authRepo: repo });

            const res = await app.request("/bootstrap", { method: "POST", headers: await bearer("u1") });

            expect(res.status).toBe(403);
            expect(setUserRoles).not.toHaveBeenCalled();
            const body = await res.json() as { error?: { code?: string; message?: string } };
            expect(body.error?.code).toBe("SETUP_REQUIRED");
            expect(body.error?.message).toContain("REBASE_ADMIN_EMAIL");
        } finally {
            process.env.NODE_ENV = previous;
        }
    });

    it("is closed once an admin already exists", async () => {
        const users = [user("u1", "2026-01-01"), user("u2", "2026-02-01")];
        const { repo, setUserRoles } = mockRepo(users, ["u1"]);
        const app = createAdminUsersRoute({ authRepo: repo });

        // Even the earliest user is refused once someone is admin.
        const res = await app.request("/bootstrap", { method: "POST", headers: await bearer("u1") });

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("BOOTSTRAP_COMPLETED");
        expect(setUserRoles).not.toHaveBeenCalled();
    });

    /**
     * A demoted administrator must lose admin immediately, not when their
     * access token expires.
     *
     * `requireAdmin` read the `roles` array out of the JWT while the data plane
     * re-read them from the database per request. So revoking someone's admin
     * did nothing for up to an hour — and within that window they could call
     * `PUT /api/admin/users/<self>` and put the role back permanently. These
     * routes are the ones that can grant roles, which is exactly why they are
     * the ones that must not trust a claim.
     */
    describe("roles come from the database, not the token", () => {
        it("refuses a caller whose admin role has been revoked since their token was issued", async () => {
            const users = [user("u1", "2026-01-01")];
            // The repo says u1 is not an admin; the token, minted earlier, says
            // otherwise. `bearer` embeds no roles, so the claim is supplied
            // explicitly here to model a stale token.
            const { repo, setUserRoles } = mockRepo(users, []);
            const app = createAdminUsersRoute({ authRepo: repo, serviceKey: "svc-key-not-used-here" } as never);

            const staleAdminToken = await generateAccessToken("u1", ["admin"]);
            const res = await app.request("/users", {
                headers: { authorization: `Bearer ${staleAdminToken}` }
            });

            expect(res.status).toBe(403);
            expect(setUserRoles).not.toHaveBeenCalled();
        });

        it("admits a caller the database still says is an admin", async () => {
            // The control: re-reading must not lock out real admins.
            const users = [user("u1", "2026-01-01")];
            const { repo } = mockRepo(users, ["u1"]);
            const app = createAdminUsersRoute({ authRepo: repo, serviceKey: "svc-key-not-used-here" } as never);

            // Token carries no roles at all; the database is the authority.
            const res = await app.request("/users", { headers: await bearer("u1") });

            expect(res.status).not.toBe(403);
        });
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

            const res = await app.request("/bootstrap", { method: "POST", headers: await bearer(anonId) });

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

            const res = await app.request("/bootstrap", { method: "POST", headers: await bearer("u1") });

            expect(res.status).toBe(200);
            expect(setUserRoles).toHaveBeenCalledWith("u1", ["admin"]);
        });
    });

    /**
     * The same two requests, with a guest the way `POST /auth/anonymous`
     * really makes one.
     *
     * The cases above model a guest as the literal uid `"anonymous"`, which
     * `isAnonymousUid` recognises. The route mints guests with random ids and
     * flags the row instead, so against a real guest the guard matched
     * nothing: the guest claimed admin, and a guest minted on page load before
     * the developer registered was the "earliest registered user" that locked
     * the developer out.
     */
    describe("a guest from POST /auth/anonymous", () => {
        async function world() {
            const store = new MemoryAuthStore();
            const app = new Hono<HonoEnv>();
            app.onError(errorHandler);
            app.route("/auth", createAuthRoutes({
                authRepo: store.repo(),
                allowAnonymous: true,
                allowRegistration: true,
                authHooks: { hashPassword: async (p: string) => `hashed:${p}`, verifyPassword: async (p: string, h: string) => h === `hashed:${p}` }
            }));
            app.route("/admin", createAdminUsersRoute({ authRepo: store.repo() }));
            const signIn = async (path: string, body?: Record<string, unknown>) => {
                const res = await app.request(`/auth${path}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: body === undefined ? undefined : JSON.stringify(body)
                });
                return await res.json() as { user: { uid: string }; tokens: { accessToken: string } };
            };
            const bootstrap = (accessToken: string) => app.request("/admin/bootstrap", {
                method: "POST",
                headers: { authorization: `Bearer ${accessToken}` }
            });
            return { store, signIn, bootstrap };
        }

        it("cannot claim the initial admin role on an empty backend", async () => {
            const { store, signIn, bootstrap } = await world();
            const guest = await signIn("/anonymous");

            const res = await bootstrap(guest.tokens.accessToken);

            expect(res.status).toBe(403);
            expect((await res.json() as { error: { code: string } }).error.code).toBe("BOOTSTRAP_ANONYMOUS");
            expect(store.roles.get(guest.user.uid) ?? []).not.toContain("admin");
        });

        it("does not lock out the developer who registers after it", async () => {
            // An app that signs visitors in as guests on load: the guest row
            // exists before the developer's, so registration does not promote
            // the developer, and bootstrap is how they become admin.
            const { store, signIn, bootstrap } = await world();
            await signIn("/anonymous");
            const developer = await signIn("/register", { email: "dev@example.com", password: "Str0ng-Passw0rd!" });
            expect(store.roles.get(developer.user.uid) ?? []).not.toContain("admin");

            const res = await bootstrap(developer.tokens.accessToken);

            expect(res.status).toBe(200);
            expect(store.roles.get(developer.user.uid)).toEqual(["admin"]);
        });
    });

    it("breaks equal-timestamp ties deterministically by id", async () => {
        const users = [user("u2", "2026-01-01"), user("u1", "2026-01-01")];
        const { repo, setUserRoles } = mockRepo(users);
        const app = createAdminUsersRoute({ authRepo: repo });

        // u1 < u2 lexicographically, so u1 wins the tie.
        const denied = await app.request("/bootstrap", { method: "POST", headers: await bearer("u2") });
        expect(denied.status).toBe(403);

        const allowed = await app.request("/bootstrap", { method: "POST", headers: await bearer("u1") });
        expect(allowed.status).toBe(200);
        expect(setUserRoles).toHaveBeenCalledWith("u1", ["admin"]);
    });
});
