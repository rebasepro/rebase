/**
 * Built-in auth always has exactly one auth table.
 *
 * A project that declares tables but no `defineAuthTable` is served
 * built-in auth's own `rebase.users` as its auth table, so users are a
 * collection like any other table — the same table `rebase schema introspect
 * --users` writes out for a project that wants to customise it. A project
 * table that already takes the name leaves no room for it (said at boot), and
 * a backend whose `auth` is an `AuthAdapter` gets none: the adapter owns its
 * users. The zero-code half (nothing declared) is in zero-code-baas.test.ts.
 *
 * Real adapter, real boot, on PGlite.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createServer } from "node:http";
import { Hono } from "hono";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, type AuthAdapter, type TableDescriptor } from "@rebasepro/types";
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

async function boot(options: { tables: Parameters<typeof initializeRebaseBackend>[0]["tables"]; auth: Parameters<typeof initializeRebaseBackend>[0]["auth"] }) {
    const db = new PGlite();
    await db.waitReady;
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

async function signUpAdmin(app: Hono<HonoEnv>): Promise<Record<string, string>> {
    const res = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.com", password: "StrongPassword123!", displayName: "Owner" })
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { tokens: { accessToken: string }; user: { roles: string[] } };
    expect(body.user.roles).toContain("admin");
    return { Authorization: `Bearer ${body.tokens.accessToken}` };
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
