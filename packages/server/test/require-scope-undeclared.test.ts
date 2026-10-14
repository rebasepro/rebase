/**
 * `requireScope` with a scope nobody declared says so, instead of refusing everyone.
 *
 * custom-server.md's example guarded a route with
 * `requireScope("project:deploy")` on a backend that declared no such scope.
 * Every caller got `403 SCOPE_MISSING`, the administrator included, with a
 * message saying the admin role holds every scope — which it does, every scope
 * that exists. A typo, `requireScope("data:raed")`, refused everyone the same
 * way, silently. Boot already refuses an unknown scope in `auth.roles`; a
 * guard is the other place a scope is named, and now refuses one too: at
 * registration, for everything that can be known then, and with a 500 naming
 * the fix for an app scope this backend does not declare.
 *
 * Both guards: the one exported from `@rebasepro/server`, and the one custom
 * functions import from `@rebasepro/server/functions`.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import { createRebaseBackend, requireAuth, requireScope, type HonoEnv, type RebaseBackend } from "../src/index";
import { defineFunction, requireScope as functionRequireScope } from "../src/functions";
import { _resetRebaseMock } from "../src/singleton";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

type Guard = (scope: string, target?: string) => MiddlewareHandler<HonoEnv>;
const GUARDS: [string, Guard][] = [
    ["@rebasepro/server", requireScope],
    ["@rebasepro/server/functions", functionRequireScope]
];

describe.each(GUARDS)("requireScope from %s, at registration", (_from, guard) => {
    it("refuses a misspelt built-in scope, naming the real ones", () => {
        expect(() => guard("data:raed")).toThrow(/"data:raed" is not one of Rebase's scopes[^]*data:read, data:write, data:delete/);
    });

    it.each(["deploy", "Project:Deploy", "project: deploy"])("refuses %j, which is not a scope name", (scope) => {
        expect(() => guard(scope)).toThrow(/is not a scope name/);
    });

    it("refuses a target written into the scope, naming the second argument", () => {
        expect(() => guard("data:read:posts")).toThrow(/requireScope\("data:read", "posts"\)/);
    });

    it("refuses a target on a built-in scope that takes none", () => {
        expect(() => guard("users:read", "u1")).toThrow(/"users:read" takes no target/);
    });

    it("accepts a built-in scope, with a target where it takes one, and an app scope", () => {
        expect(() => guard("users:read")).not.toThrow();
        expect(() => guard("data:read", "posts")).not.toThrow();
        expect(() => guard("project:deploy")).not.toThrow();
    });
});

// ── On a backend: declared, or not ───────────────────────────────────────

function collection(slug: string, extra: Record<string, unknown> = {}): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } },
        ...extra
    } as unknown as CollectionConfig;
}

function driver(): DataDriver {
    const scoped = () => ({
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 0
    });
    return { ...scoped(), withAuth: async () => scoped() as unknown as DataDriver } as unknown as DataDriver;
}

const built: RebaseBackend[] = [];
afterEach(async () => {
    while (built.length) await built.pop()!.shutdown(0);
    _resetRebaseMock();
});

async function world(scopes: Record<string, { label: string }>) {
    const store = new MemoryAuthStore();
    const repo = store.repo();
    const bootstrapper = {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: driver(), collections: undefined, internals: {}, realtimeProvider: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: repo, authRepository: repo };
        }
    } as unknown as BackendBootstrapper;

    const deploy = defineFunction((app) => {
        app.post("/", functionRequireScope("project:deploy"), (c) => c.json({ ok: true }));
    });
    const backend = await createRebaseBackend({
        collections: [collection("users", { auth: { enabled: true, scopes } })],
        bootstrappers: [bootstrapper],
        auth: { jwtSecret: "require-scope-undeclared-secret-0123456789" },
        functions: { deploy },
        cronPersistence: false,
        provision: false
    } as never);
    built.push(backend);

    const app = new Hono<HonoEnv>();
    // custom-server.md's route outside the groups, judged by this backend.
    app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
        requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));
    app.route("/functions", backend.routes.functions());

    const tokenFor = async (roles: string[]) => {
        const user = await repo.createUser({ email: `${randomUUID()}@corp.test`, emailVerified: true });
        await repo.setUserRoles(user.id, roles);
        return backend.services.jwt.generateAccessToken(user.id, roles);
    };
    const post = async (path: string, token: string) => {
        const res = await app.request(path, { method: "POST", headers: { authorization: `Bearer ${token}` } });
        return { status: res.status, body: await res.json() as { error?: { code?: string; message?: string } } };
    };
    return { tokenFor, post };
}

describe.each(["/deploy", "/functions/deploy"])("a route guarded by an app scope, at %s", (path) => {
    it("answers an administrator 500 SCOPE_NOT_DECLARED, naming auth.scopes, when the backend declares none", async () => {
        const { tokenFor, post } = await world({});
        const { status, body } = await post(path, await tokenFor(["admin"]));

        expect(status).toBe(500);
        expect(body.error?.code).toBe("SCOPE_NOT_DECLARED");
        expect(body.error?.message).toContain("auth.scopes");
        expect(body.error?.message).not.toContain("holds every scope");
    });

    it("lets every signed-in person through once the scope is declared", async () => {
        const { tokenFor, post } = await world({ "project:deploy": { label: "Deploy projects" } });

        expect((await post(path, await tokenFor(["admin"]))).status).toBe(200);
        expect((await post(path, await tokenFor([]))).status).toBe(200);
    });
});
