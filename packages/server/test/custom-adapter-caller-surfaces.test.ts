import { describe, expect, it } from "@jest/globals";
import { Hono, type MiddlewareHandler } from "hono";
import { createServer } from "node:http";
import {
    col,
    defineTable,
    type AuthenticatedUser,
    type BackendBootstrapper,
    type InitializedDriver,
    type TableDescriptor
} from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { initializeRebaseBackend } from "../src/init";
import { createCustomAuthAdapter } from "../src/auth/custom-auth-adapter";
import { fakeDataDriver } from "./helpers/server-a-fakes";
import { createApiKeyRoutes, createPersonalKeyRoutes } from "../src/auth/api-keys/api-key-routes";
import { fakeApiKeyStore } from "./helpers/server-a-g1-fakes";

/**
 * A backend that authenticates through its own `AuthAdapter` — no `jwtSecret`,
 * no framework users table — is answered on the surfaces that read "who is
 * calling" exactly as its data routes answer it: `GET /api/schema/tables`,
 * the OpenAPI document and `/api/admin/ui-config`. They used to check only
 * the framework's JWT, which such a backend never configured, and answered
 * 500 — the admin panel, which loads its tables from `/schema/tables`, was
 * dead for every project with custom auth.
 */

const openNotes = defineTable("open_notes", {
    columns: { id: col.serial().primaryKey(), body: col.text() },
    rls: [{ operation: "select", access: "authenticated" }]
});
const staffOnly = defineTable("staff_only", {
    columns: { id: col.serial().primaryKey(), memo: col.text() },
    rls: [{ operation: "select", roles: ["staff"] }]
});
const secrets = defineTable("admin_secrets", {
    columns: { id: col.serial().primaryKey(), value: col.text() },
    rls: "admin-only"
});

/** The accounts the stub adapter knows, by bearer token. */
const ACCOUNTS: Record<string, AuthenticatedUser> = {
    "adapter-member": { uid: "m-1", email: "m@example.test", roles: [], isAdmin: false },
    "adapter-staff": { uid: "s-1", email: "s@example.test", roles: ["staff"], isAdmin: false },
    "adapter-admin": { uid: "a-1", email: "a@example.test", roles: ["admin"], isAdmin: true },
    // Scopes the adapter names itself: a grant to a role other than `admin`,
    // and an `admin` narrowed below what the role holds.
    "adapter-dev": { uid: "d-1", email: "d@example.test", roles: ["dev"], isAdmin: false, scopes: ["data:read", "logs:read"] },
    "adapter-narrow-admin": { uid: "n-1", email: "n@example.test", roles: ["admin"], isAdmin: true, scopes: ["data:read"] }
};

const adapter = createCustomAuthAdapter({
    async verifyRequest(request: Request) {
        const header = request.headers.get("authorization");
        if (!header?.startsWith("Bearer ")) return null;
        return ACCOUNTS[header.slice("Bearer ".length)] ?? null;
    }
});

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return {
            driver: fakeDataDriver({ fetchCollection: async () => [], count: async () => 0, checkUniqueField: async () => true }),
            tables: [],
            internals: {}
        };
    }
};

async function boot(): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        server: createServer(),
        tables: [openNotes, staffOnly, secrets],
        bootstrappers: [bootstrapper],
        cronPersistence: false,
        auth: adapter
    });
    return app;
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

async function slugsFor(app: Hono<HonoEnv>, token: string): Promise<string[]> {
    const response = await app.request("/api/schema/tables", bearer(token));
    expect(response.status).toBe(200);
    return (await response.json() as TableDescriptor[]).map(table => table.slug).sort();
}

describe("a backend with its own auth adapter", () => {
    it("describes the tables to an adapter-authenticated caller, filtered by the adapter's roles", async () => {
        const app = await boot();
        expect(await slugsFor(app, "adapter-member")).toEqual(["open_notes"]);
        expect(await slugsFor(app, "adapter-staff")).toEqual(["open_notes", "staff_only"]);
        expect(await slugsFor(app, "adapter-admin")).toEqual(["admin_secrets", "open_notes", "staff_only"]);
    });

    it("answers 401 — never 500 — to a caller the adapter does not recognise, and to nobody", async () => {
        const app = await boot();
        for (const path of ["/api/schema/tables", "/api/docs", "/api/admin/ui-config", "/api/auth/scopes"]) {
            const unknown = await app.request(path, bearer("not-an-account"));
            expect([path, unknown.status]).toEqual([path, 401]);
            const nobody = await app.request(path);
            expect([path, nobody.status]).toEqual([path, 401]);
        }
    });

    it("the data routes give the same answer to the same unknown caller", async () => {
        const app = await boot();
        expect((await app.request("/api/data/open_notes", bearer("not-an-account"))).status).toBe(401);
    });

    it("serves the OpenAPI document of the tables each caller is described", async () => {
        const app = await boot();
        const member = await app.request("/api/docs", bearer("adapter-member"));
        expect(member.status).toBe(200);
        const memberText = await member.text();
        expect(memberText).toContain("open_notes");
        expect(memberText).not.toContain("staff_only");
        expect(memberText).not.toContain("admin_secrets");

        const staff = await app.request("/api/docs", bearer("adapter-staff"));
        expect(staff.status).toBe(200);
        expect(await staff.text()).toContain("staff_only");
    });

    it("judges the admin routes by the scopes the adapter named, as verifyCredential and the socket do", async () => {
        const app = await boot();
        // Granted `logs:read` by the adapter, with no `admin` role.
        expect((await app.request("/api/admin/logs", bearer("adapter-dev"))).status).toBe(200);
        // No scopes named: the roles decide, and `staff` holds no admin scope.
        expect((await app.request("/api/admin/logs", bearer("adapter-staff"))).status).toBe(403);
        // Narrowed: the `admin` role would hold `logs:read`; the adapter said less.
        expect((await app.request("/api/admin/logs", bearer("adapter-narrow-admin"))).status).toBe(403);
        expect((await app.request("/api/admin/logs", bearer("adapter-admin"))).status).toBe(200);
    });

    it("serves /api/admin/ui-config to an adapter-authenticated caller", async () => {
        const app = await boot();
        expect((await app.request("/api/admin/ui-config", bearer("adapter-member"))).status).toBe(200);
    });

    it("answers GET /api/auth/scopes with the scopes the adapter's roles hold — it answered 500, \"JWT secret not configured\"", async () => {
        const app = await boot();
        const member = await app.request("/api/auth/scopes", bearer("adapter-member"));
        expect(member.status).toBe(200);
        const memberBody = await member.json() as { scopes: unknown[]; held: string[] };
        expect(memberBody.scopes.length).toBeGreaterThan(0);

        const admin = await app.request("/api/auth/scopes", bearer("adapter-admin"));
        expect(admin.status).toBe(200);
        const adminBody = await admin.json() as { held: string[] };
        expect(adminBody.held.length).toBeGreaterThan(memberBody.held.length);
    });
});

/**
 * The key routes sign their caller in through `require` when the backend
 * passes one (its adapter's resolution), and through the framework's token
 * check only when it does not.
 */
describe("the key routes' caller check", () => {
    const store = fakeApiKeyStore();
    const teapot: MiddlewareHandler<HonoEnv> = async (c) => c.json({ asked: "require" }, 418);

    it("project keys and personal keys answer through `require`", async () => {
        for (const router of [
            createApiKeyRoutes({ store, require: teapot }),
            createPersonalKeyRoutes({ store, enabled: true, require: teapot })
        ]) {
            const response = await router.request("/", bearer("adapter-admin"));
            expect(response.status).toBe(418);
        }
    });
});

