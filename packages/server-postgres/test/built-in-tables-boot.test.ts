/**
 * Built-in auth serves its users as a table, and keeps its roles as slugs.
 *
 * Users: a project that declares tables but no `defineAuthTable` is served
 * built-in auth's own `rebase.users` as its auth table, so users are a
 * collection like any other table — the same table `rebase schema introspect
 * --users` writes out for a project that wants to customise it.
 *
 * Roles: a role is a name a user holds. One declared in code (`auth.roles`)
 * grants what the code says and is read-only at runtime; one made at runtime
 * (`rebase.roles`, through `/api/admin/roles`) grants its scopes beside them.
 * Defining a role is granting its scopes, so nobody defines one beyond what
 * they hold, and a role lists only scopes that exist.
 *
 * A project table that already takes the users table's name leaves no room
 * for it (said at boot), and a backend whose `auth` is an `AuthAdapter` gets
 * none: the adapter owns its users. The zero-code half (nothing declared) is
 * in zero-code-baas.test.ts.
 *
 * Real adapter, real boot, on PGlite.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createServer } from "node:http";
import { Hono } from "hono";
import { PGlite } from "@electric-sql/pglite";
import { col, defineAuthTable, defineTable, type AuthAdapter, type TableDescriptor } from "@rebasepro/types";
import type { HonoEnv } from "../../server/src/api/types";
import { initializeRebaseBackend, logger } from "@rebasepro/server";
import { createPostgresAdapter } from "../src/PostgresAdapter";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const JWT_SECRET = "implicit-auth-table-test-jwt-secret-32chars!";

const notes = defineTable("notes", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.text()
    },
    rls: [{ operations: ["select", "insert", "update", "delete"], access: "public" }]
});

/** A project table called `users` that is not its auth table. */
const members = defineTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        nickname: col.text()
    },
    rls: [{ operations: ["select", "insert", "update", "delete"], access: "public" }]
});

function externalAuth(): AuthAdapter {
    return {
        id: "external-test",
        // Everyone is the adapter's admin: enough to read what is served.
        verifyRequest: async () => ({ uid: "external-admin", email: "admin@example.com", roles: ["admin"], isAdmin: true }),
        getCapabilities: () => ({
            hasBuiltInAuthRoutes: false,
            emailPasswordLogin: false,
            registrationEnabled: false,
            passwordReset: false,
            adminPasswordReset: false,
            sessionManagement: false,
            profileUpdate: false,
            emailVerification: false,
            magicLink: false,
            anonymousLogin: false,
            enabledProviders: []
        })
    };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
    jest.restoreAllMocks();
});

async function boot(options: { tables: Parameters<typeof initializeRebaseBackend>[0]["tables"]; auth: Parameters<typeof initializeRebaseBackend>[0]["auth"]; seed?: string }) {
    const db = new PGlite();
    await db.waitReady;
    if (options.seed) await db.exec(options.seed);
    const app = new Hono<HonoEnv>();
    const backend = await initializeRebaseBackend({
        app,
        server: createServer(),
        tables: options.tables,
        database: createPostgresAdapter({ connection: pgliteNodePg(db), rls: { grants: "managed" } }),
        auth: options.auth
    });
    cleanups.push(async () => {
        await backend.shutdown(1_000);
        await db.close();
    });
    return app;
}

async function signUp(app: Hono<HonoEnv>, email: string): Promise<{ headers: Record<string, string>; roles: string[] }> {
    const res = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "StrongPassword123!", displayName: email })
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { tokens: { accessToken: string }; user: { roles: string[] } };
    return { headers: { Authorization: `Bearer ${body.tokens.accessToken}`, "Content-Type": "application/json" }, roles: body.user.roles };
}

async function signUpAdmin(app: Hono<HonoEnv>): Promise<Record<string, string>> {
    const { headers, roles } = await signUp(app, "owner@example.com");
    expect(roles).toContain("admin");
    return headers;
}

/** The roles `GET /api/admin/roles` answers: the live access model beside the table. */
async function adminRoles(app: Hono<HonoEnv>, headers: Record<string, string>): Promise<Array<{ name: string; source: string; scopes: string[]; isDefault: boolean }>> {
    const res = await app.request("/api/admin/roles", { headers });
    expect(res.status).toBe(200);
    return (await res.json() as { roles: Array<{ name: string; source: string; scopes: string[]; isDefault: boolean }> }).roles;
}


async function servedTables(app: Hono<HonoEnv>, headers: Record<string, string>): Promise<TableDescriptor[]> {
    const res = await app.request("/api/schema/tables", { headers });
    expect(res.status).toBe(200);
    return await res.json() as TableDescriptor[];
}

describe("the implicit auth table", () => {
    it("serves rebase.users as the auth table of a project that declares none", async () => {
        const app = await boot({ tables: [notes], auth: { allowRegistration: true, jwtSecret: JWT_SECRET } });
        const headers = await signUpAdmin(app);

        const tables = await servedTables(app, headers);
        const users = tables.find(table => table.slug === "users");
        expect(users?.auth).toBeDefined();
        expect(users?.schema).toBe("rebase");
        expect(tables.filter(table => table.auth !== undefined)).toHaveLength(1);
        expect(tables.map(table => table.slug)).toContain("notes");

        const rows = await app.request("/api/data/users", { headers });
        expect(rows.status).toBe(200);
        const body = await rows.json() as { data: Array<{ email: string; passwordHash?: unknown }> };
        expect(body.data.map(user => user.email)).toEqual(["owner@example.com"]);
        // The secret columns are private on any auth table, this one included.
        expect(body.data[0]).not.toHaveProperty("passwordHash");
    });

    it("leaves a project table called users alone, and says why users are not served", async () => {
        const warnings: string[] = [];
        jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
            warnings.push(String(message));
        });

        const app = await boot({ tables: [notes, members], auth: { allowRegistration: true, jwtSecret: JWT_SECRET } });
        const headers = await signUpAdmin(app);

        const tables = await servedTables(app, headers);
        const users = tables.find(table => table.slug === "users");
        expect(users?.auth).toBeUndefined();
        expect(users?.schema ?? "public").toBe("public");
        expect(tables.some(table => table.auth !== undefined)).toBe(false);
        expect(warnings.some(message => message.includes("Users are not served as a table")
            && message.includes("rebase schema introspect --users"))).toBe(true);
    });

    it("serves no users table when auth is an AuthAdapter", async () => {
        const app = await boot({ tables: [notes], auth: externalAuth() });

        const tables = await servedTables(app, { Authorization: "Bearer external" });
        expect(tables.map(table => table.slug)).toEqual(["notes"]);
    });
});

describe("roles", () => {
    /** A users table that declares a role in code: support may read and write accounts. */
    const members = defineAuthTable("members", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text().notNull() },
        rls: [{ operation: "select", roles: ["admin"] }],
        auth: { roles: { support: { name: "Support", description: "Answers tickets.", scopes: ["users:read", "users:write"] } } }
    });

    async function asRole(app: Hono<HonoEnv>, admin: Record<string, string>, email: string, roles: string[]): Promise<Record<string, string>> {
        const res = await app.request("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "StrongPassword123!" })
        });
        const { user } = await res.json() as { user: { uid: string } };
        const granted = await app.request(`/api/admin/users/${user.uid}`, { method: "PUT", headers: admin, body: JSON.stringify({ roles }) });
        expect(granted.status).toBe(200);
        const login = await app.request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "StrongPassword123!" })
        });
        const { tokens } = await login.json() as { tokens: { accessToken: string } };
        return { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" };
    }

    it("grants what a role made at runtime lists, beside the ones declared in code", async () => {
        const app = await boot({ tables: [notes, members], auth: { allowRegistration: true, jwtSecret: JWT_SECRET } });
        const admin = await signUpAdmin(app);

        const created = await app.request("/api/admin/roles", { method: "POST", headers: admin, body: JSON.stringify({ name: "reviewer", scopes: ["logs:read"] }) });
        expect(created.status).toBe(201);
        const roles = await adminRoles(app, admin);
        expect(roles.find(role => role.name === "reviewer")).toMatchObject({ source: "database", scopes: ["logs:read"] });
        expect(roles.find(role => role.name === "support")).toMatchObject({ source: "code", scopes: ["users:read", "users:write"] });
        // Roles are slugs: there is no roles table to serve.
        expect((await servedTables(app, admin)).some(table => table.slug === "roles")).toBe(false);
    });

    it("keeps a role declared in code read-only", async () => {
        const app = await boot({ tables: [notes, members], auth: { allowRegistration: true, jwtSecret: JWT_SECRET } });
        const admin = await signUpAdmin(app);

        for (const request of [
            app.request("/api/admin/roles/support", { method: "PUT", headers: admin, body: JSON.stringify({ scopes: ["logs:read"] }) }),
            app.request("/api/admin/roles", { method: "POST", headers: admin, body: JSON.stringify({ name: "support", scopes: ["logs:read"] }) })
        ]) {
            expect((await request).status).toBe(400);
        }
        expect((await adminRoles(app, admin)).find(role => role.name === "support")?.scopes).toEqual(["users:read", "users:write"]);
    });

    it("grants a declared role what the code says, whatever row shares its name", async () => {
        // A row made before declarations won: it granted support database:write.
        const app = await boot({
            tables: [notes, members],
            auth: { allowRegistration: true, jwtSecret: JWT_SECRET },
            seed: `CREATE SCHEMA rebase;
                CREATE TABLE rebase.roles (name text PRIMARY KEY, description text, scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
                    is_default boolean NOT NULL DEFAULT false, assignable boolean NOT NULL DEFAULT true,
                    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
                INSERT INTO rebase.roles (name, scopes) VALUES ('support', ARRAY['database:write']);`
        });
        const admin = await signUpAdmin(app);
        expect((await adminRoles(app, admin)).find(role => role.name === "support")).toMatchObject({ source: "code", scopes: ["users:read", "users:write"] });
        const supporter = await asRole(app, admin, "support@example.com", ["support"]);
        const tables = await app.request("/api/admin/db/tables", { headers: supporter });
        expect(tables.status).toBe(403);
    });

    it("refuses a role that lists a data-plane scope, or one that does not exist", async () => {
        const app = await boot({ tables: [notes, members], auth: { allowRegistration: true, jwtSecret: JWT_SECRET } });
        const admin = await signUpAdmin(app);

        for (const scopes of [["data:write"], ["billing:refund"], ["not a scope"]]) {
            const res = await app.request("/api/admin/roles", { method: "POST", headers: admin, body: JSON.stringify({ name: "odd", scopes }) });
            expect(res.status).toBe(400);
        }
    });

    it("lets nobody define a role beyond what they hold", async () => {
        const app = await boot({ tables: [notes, members], auth: { allowRegistration: true, jwtSecret: JWT_SECRET } });
        const admin = await signUpAdmin(app);
        // support holds users:write, which is what the role routes ask for.
        const supporter = await asRole(app, admin, "support@example.com", ["support"]);

        const minted = await app.request("/api/admin/roles", { method: "POST", headers: supporter, body: JSON.stringify({ name: "helper", scopes: ["database:write"] }) });
        expect(minted.status).toBe(403);
        expect((await minted.json() as { error: { code: string } }).error.code).toBe("ROLE_EXCEEDS_CALLER");

        // Within what they hold, they may.
        const within = await app.request("/api/admin/roles", { method: "POST", headers: supporter, body: JSON.stringify({ name: "helper", scopes: ["users:read"] }) });
        expect(within.status).toBe(201);

        // A role that already holds more than they do is not theirs to change or delete.
        const powerful = await app.request("/api/admin/roles", { method: "POST", headers: admin, body: JSON.stringify({ name: "operator", scopes: ["database:write"] }) });
        expect(powerful.status).toBe(201);
        const narrowed = await app.request("/api/admin/roles/operator", { method: "PUT", headers: supporter, body: JSON.stringify({ scopes: ["users:read"] }) });
        expect(narrowed.status).toBe(403);
        const removed = await app.request("/api/admin/roles/operator", { method: "DELETE", headers: supporter });
        expect(removed.status).toBe(403);
    });
});
