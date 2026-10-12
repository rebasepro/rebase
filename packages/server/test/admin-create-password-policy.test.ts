/**
 * A user created by an administrator with a chosen password is held to the
 * password policy, as a self-service signup is — on every door that creates
 * users.
 *
 * `POST /api/admin/users` and a create on the auth collection through the data
 * API (`POST /api/data/users`, its `/bulk`) hashed whatever `password` they
 * were given, so `"a"` became a working credential while `POST /auth/register`,
 * the reset flows and `PUT /admin/users/:uid` all answered `WEAK_PASSWORD`.
 *
 * An import moves accounts whose passwords were set under another system's
 * rules, so the body may carry `skipPasswordPolicy: true`. Only an
 * administrator (or the service key, which signs in as one) is taken at their
 * word: from anyone else the flag waives nothing. It is an instruction to the
 * door, never data, so it does not reach the row or a create hook.
 */
import { describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { EMPTY_ACCESS_MODEL } from "@rebasepro/types";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { configureAccess } from "../src/auth/access";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const SECRET = "test-secret-for-admin-create-password-policy-0123456789";
const WEAK = "short";
const STRONG = "Str0ngEnough";

/** `support` may manage users without being an administrator. */
const MODEL = { roles: { support: { scopes: ["users:read", "users:write"] } }, scopes: {} };

const ROLES: Record<string, string[]> = { "admin-1": ["admin"], "sup-1": ["support"] };

function harness(hooks?: AuthHooks) {
    const created: Record<string, unknown>[] = [];
    const saved: Record<string, unknown>[] = [];
    const hookBodies: Record<string, unknown>[] = [];
    const user = (id: string): UserData =>
        ({ id, email: `${id}@test.com`, createdAt: new Date(), updatedAt: new Date() }) as UserData;
    const repo = {
        getUserByEmail: async () => null,
        getUserById: async (id: string) => user(id),
        getUserRoleIds: async (id: string) => ROLES[id] ?? [],
        getAccountAccessState: async (id: string) => ({ roles: ROLES[id] ?? [], tokensValidAfter: null }),
        setUserRoles: async () => undefined,
        createUser: async (data: Record<string, unknown>) => {
            created.push(data);
            return { ...user("new-user"), ...data };
        },
        createPasswordResetToken: async () => undefined
    } as unknown as AuthRepository;

    const adapter = createBuiltinAuthAdapter({
        authRepository: repo,
        authHooks: hooks && {
            ...hooks,
            onAdminCreateUser: hooks.onAdminCreateUser && (async (body, ctx) => {
                hookBodies.push(body);
                return hooks.onAdminCreateUser!(body, ctx);
            })
        }
    });

    const driver = {
        save: async ({ values }: { values: Record<string, unknown> }) => {
            saved.push(values);
            return { id: "rest-user", ...values };
        },
        saveMany: async ({ rows }: { rows: Record<string, unknown>[] }) => {
            saved.push(...rows);
            return rows.map((row, index) => ({ id: `bulk-${index}`, ...row }));
        }
    } as unknown as DataDriver;
    const usersCollection = {
        slug: "users",
        name: "Users",
        table: "users",
        auth: { enabled: true },
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            email: { name: "Email", type: "string" },
            displayName: { name: "Name", type: "string" }
        }
    } as unknown as CollectionConfig;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    const adminRoutes = adapter.createAdminRoutes?.();
    if (!adminRoutes) throw new Error("the built-in adapter mounts admin routes");
    app.mount("/api/admin", request => adminRoutes.fetch(request));

    let caller = "admin-1";
    app.use("/api/data/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: caller, roles: ROLES[caller] ?? [] });
        await next();
    });
    app.route("/api/data", new RestApiGenerator([usersCollection], driver, adapter).generateRoutes());

    const post = async (as: string, path: string, body: unknown) => {
        caller = as;
        const token = await generateAccessToken(as, ROLES[as] ?? []);
        return app.request(path, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    };

    return { post, created, saved, hookBodies };
}

const errorOf = async (res: Response) => (await res.json() as { error: { code: string; message: string } }).error;

/** One user's body, as each door takes it. */
const DOORS = [
    { name: "POST /api/admin/users", path: "/api/admin/users", ok: 201, wrap: (row: Record<string, unknown>) => row },
    { name: "POST /api/data/users", path: "/api/data/users", ok: 201, wrap: (row: Record<string, unknown>) => row },
    { name: "POST /api/data/users/bulk", path: "/api/data/users/bulk", ok: 200, wrap: (row: Record<string, unknown>) => ({ rows: [row] }) }
];

describe("an administrator creating a user with a chosen password", () => {
    beforeAll(() => configureJwt({ secret: SECRET, accessExpiresIn: "1h" }));
    afterEach(() => configureAccess({ model: EMPTY_ACCESS_MODEL }));

    describe.each(DOORS)("$name", ({ path, ok, wrap }) => {
        it("refuses a weak password with 400 WEAK_PASSWORD and creates nobody", async () => {
            const { post, created, saved } = harness();
            const res = await post("admin-1", path, wrap({ email: "new@example.com", password: WEAK }));

            expect(res.status).toBe(400);
            const error = await errorOf(res);
            expect(error.code).toBe("WEAK_PASSWORD");
            expect(error.message).toMatch(/^Password too weak: /);
            expect(created).toHaveLength(0);
            expect(saved).toHaveLength(0);
        });

        it("accepts a password the policy accepts", async () => {
            const { post } = harness();
            const res = await post("admin-1", path, wrap({ email: "new@example.com", password: STRONG }));
            expect(res.status).toBe(ok);
        });

        it("still generates a password when none is given", async () => {
            const { post } = harness();
            const res = await post("admin-1", path, wrap({ email: "new@example.com" }));
            expect(res.status).toBe(ok);
        });

        it("waives the policy for an administrator who sends skipPasswordPolicy, and stores no flag", async () => {
            const { post, created, saved } = harness();
            const res = await post("admin-1", path, wrap({ email: "new@example.com", password: WEAK, skipPasswordPolicy: true }));

            expect(res.status).toBe(ok);
            const row = created[0] ?? saved[0];
            expect(typeof row.passwordHash).toBe("string");
            expect(row).not.toHaveProperty("skipPasswordPolicy");
            expect(row).not.toHaveProperty("password");
        });

        it("waives nothing for a caller who is not an administrator", async () => {
            configureAccess({ model: MODEL });
            const { post, created, saved } = harness();
            const res = await post("sup-1", path, wrap({ email: "new@example.com", password: WEAK, skipPasswordPolicy: true }));

            expect(res.status).toBe(400);
            const error = await errorOf(res);
            expect(error.code).toBe("WEAK_PASSWORD");
            expect(error.message).toMatch(/skipPasswordPolicy/);
            expect(created).toHaveLength(0);
            expect(saved).toHaveLength(0);
        });
    });

    it("holds a create hook's body to the policy too, and hands the hook no flag", async () => {
        const hooks: AuthHooks = {
            onAdminCreateUser: async (body, ctx) => ({
                values: { email: body.email, passwordHash: await ctx.hashPassword(String(body.password)) }
            })
        };
        const weak = harness(hooks);
        expect((await weak.post("admin-1", "/api/admin/users", { email: "a@example.com", password: WEAK })).status).toBe(400);
        expect(weak.hookBodies).toHaveLength(0);

        const waived = harness(hooks);
        const res = await waived.post("admin-1", "/api/admin/users", { email: "a@example.com", password: WEAK, skipPasswordPolicy: true });
        expect(res.status).toBe(201);
        expect(waived.hookBodies[0]).not.toHaveProperty("skipPasswordPolicy");
    });
});
