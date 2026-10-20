/**
 * E2E: the RLS simulator — an administrator's data request carrying
 * `x-rebase-simulate-role` / `-user-id` / `-api-key-id` runs as that role, uid
 * or key against the real policies, or is refused. Never as the administrator.
 *
 * The policies are an owner check, a role grant and a field rule, so "u_1's
 * tickets and not u_2's, without the internal note" can only come from the
 * statement running as `rebase_user` with the simulated identity: the admin arm
 * of the default policies would hand the administrator every row and field.
 * `u_1` and `u_2` are not accounts — a role simulation is a hypothetical.
 *
 * Everything goes through what the server mounts: the real boot, the built-in
 * auth adapter, the data router's auth middleware, the admin gate, the guard
 * every other route sits behind, and Postgres RLS.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import {
    parseSimulatedContext,
    SIMULATE_API_KEY_ID_HEADER,
    SIMULATE_ROLE_HEADER,
    SIMULATE_USER_ID_HEADER,
    SIMULATED_CONTEXT_HEADER,
    type CollectionConfig
} from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import { logger } from "../../../server/src/utils/logger.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "rls-simulator-e2e-secret-that-is-long-enough-0123456789";
const SERVICE_KEY = "rls-simulator-e2e-service-key-0123456789abcdef";

const ticketsCollection: CollectionConfig = {
    name: "Tickets",
    slug: "tickets",
    table: "tickets",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "support_select", operation: "select", roles: ["support"], using: "true" }
    ],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        title: { name: "Title", type: "string" },
        internalNote: { name: "Internal note", type: "string", columnName: "internal_note", access: { read: ["support"] } }
    }
};

/** No rules of its own: the default policies admit administrators only. */
const secretsCollection: CollectionConfig = {
    name: "Secrets",
    slug: "secrets",
    table: "secrets",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        value: { name: "Value", type: "string" }
    }
};

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";

type TicketRow = { id: string; ownerId: string; title: string; internalNote?: string };

describe("RLS simulator on the data API (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;

    const uid = { admin: "", member: "" };
    const token = { admin: "", member: "" };
    let apiKey = "";
    let supportKeyId = "";

    async function call(path: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}) {
        const response = await app.request(path, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json", ...headers },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        const json: unknown = text ? JSON.parse(text) : undefined;
        return { status: response.status, json, headers: response.headers };
    }

    const bearer = (credential: string) => ({ Authorization: `Bearer ${credential}` });
    const asAdminSimulating = (headers: Record<string, string>) => ({ ...bearer(token.admin), ...headers });

    function rowsOf(json: unknown): TicketRow[] {
        if (typeof json !== "object" || json === null || !("data" in json) || !Array.isArray(json.data)) {
            throw new Error(`not a listing: ${JSON.stringify(json)}`);
        }
        return json.data;
    }

    const idsOf = (json: unknown) => rowsOf(json).map(row => row.id).sort();

    function errorCodeOf(json: unknown): unknown {
        if (typeof json !== "object" || json === null || !("error" in json)) return undefined;
        const error = json.error;
        return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            // The boot attaches its realtime socket to one; nothing here dials it.
            server: createServer(),
            collections: [ticketsCollection, secretsCollection],
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY }
        });

        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        const account = async (email: string, roles: string[]) => {
            const user = await repo.createUser({ email, emailVerified: true });
            await repo.setUserRoles(user.id, roles);
            return user.id;
        };
        uid.admin = await account("admin@simulator.test", ["admin"]);
        uid.member = await account("member@simulator.test", []);
        token.admin = await generateAccessToken(uid.admin, ["admin"]);
        // The member's token CLAIMS admin; the database says otherwise.
        token.member = await generateAccessToken(uid.member, ["admin"]);

        await admin.query(
            "INSERT INTO public.tickets (id, owner_id, title, internal_note) VALUES " +
            "($1, 'u_1', 'first', 'note 1'), ($2, 'u_2', 'second', 'note 2'), ($3, 'u_1', 'third', 'note 3')",
            [T1, T2, T3]
        );
        await admin.query("INSERT INTO public.secrets (id, value) VALUES (gen_random_uuid(), 'hush')");

        // A key as strong as one gets — still not a person, so it may not simulate.
        const strong = await call("/api/admin/api-keys", bearer(token.admin), {
            method: "POST",
            body: { name: "simulator-e2e-strong", scopes: ["data:read", "data:write"], roles: ["admin"] }
        });
        expect(strong.status, JSON.stringify(strong.json)).toBe(201);
        const key = (strong.json as { key?: { key?: unknown } }).key?.key;
        if (typeof key !== "string") throw new Error(`no key in ${JSON.stringify(strong.json)}`);
        apiKey = key;

        // The key to simulate: the support role, and tickets only.
        const support = await call("/api/admin/api-keys", bearer(token.admin), {
            method: "POST",
            body: { name: "support-agent", scopes: ["data:read:tickets"], roles: ["support"] }
        });
        expect(support.status, JSON.stringify(support.json)).toBe(201);
        const id = (support.json as { key?: { id?: unknown } }).key?.id;
        if (typeof id !== "string") throw new Error(`no key id in ${JSON.stringify(support.json)}`);
        supportKeyId = id;
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("lets the administrator's own request read every ticket and note — the baseline the headers must change", async () => {
        const { status, json, headers } = await call("/api/data/tickets", bearer(token.admin));
        expect(status).toBe(200);
        expect(idsOf(json)).toEqual([T1, T2, T3].sort());
        expect(rowsOf(json).every(row => typeof row.internalNote === "string")).toBe(true);
        expect(headers.get(SIMULATED_CONTEXT_HEADER)).toBeNull();
    });

    it("runs customer + u_1 as u_1's policy allows: u_1's tickets only, the internal note masked", async () => {
        const { status, json, headers } = await call("/api/data/tickets",
            asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "customer", [SIMULATE_USER_ID_HEADER]: "u_1" }));
        expect(status, JSON.stringify(json)).toBe(200);
        expect(idsOf(json)).toEqual([T1, T3].sort());
        expect(rowsOf(json).every(row => row.ownerId === "u_1" && !("internalNote" in row))).toBe(true);

        expect(parseSimulatedContext(headers.get(SIMULATED_CONTEXT_HEADER))).toEqual({
            role: "customer",
            sub: "u_1",
            maskedColumns: ["internalNote"],
            collection: "tickets"
        });

        // One of u_2's tickets, asked for directly, is not there for u_1.
        const direct = await call(`/api/data/tickets/${T2}`,
            asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "customer", [SIMULATE_USER_ID_HEADER]: "u_1" }));
        expect(direct.status).toBe(404);
    });

    it("runs a role alone as a holder who owns nothing, and a granted role with every row and field", async () => {
        const customer = await call("/api/data/tickets", asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "customer" }));
        expect(customer.status).toBe(200);
        expect(rowsOf(customer.json)).toEqual([]);

        const anonymous = await call("/api/data/tickets", asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "anon" }));
        expect(anonymous.status).toBe(200);
        expect(rowsOf(anonymous.json)).toEqual([]);

        const support = await call("/api/data/tickets", asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "support" }));
        expect(support.status).toBe(200);
        expect(idsOf(support.json)).toEqual([T1, T2, T3].sort());
        expect(rowsOf(support.json).every(row => typeof row.internalNote === "string")).toBe(true);
        expect(parseSimulatedContext(support.headers.get(SIMULATED_CONTEXT_HEADER))?.maskedColumns).toEqual([]);

        const secrets = await call("/api/data/secrets", asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "support" }));
        expect(secrets.status).toBe(200);
        expect(rowsOf(secrets.json)).toEqual([]);
    });

    it("runs as a service key: its roles for the rows, its scopes for the collections", async () => {
        const tickets = await call("/api/data/tickets", asAdminSimulating({ [SIMULATE_API_KEY_ID_HEADER]: supportKeyId }));
        expect(tickets.status, JSON.stringify(tickets.json)).toBe(200);
        expect(idsOf(tickets.json)).toEqual([T1, T2, T3].sort());
        expect(parseSimulatedContext(tickets.headers.get(SIMULATED_CONTEXT_HEADER))).toMatchObject({
            sub: `api-key:${supportKeyId}`,
            apiKeyId: supportKeyId
        });

        const secrets = await call("/api/data/secrets", asAdminSimulating({ [SIMULATE_API_KEY_ID_HEADER]: supportKeyId }));
        expect(secrets.status).toBe(403);
        expect(errorCodeOf(secrets.json)).toBe("SCOPE_MISSING");
    });

    it("writes a security audit event naming the administrator and the simulated identity", async () => {
        const info = vi.spyOn(logger, "info");
        try {
            await call("/api/data/tickets", asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "customer", [SIMULATE_USER_ID_HEADER]: "u_1" }));
            const audit = info.mock.calls.find(([message]) => message.includes("simulated access"));
            expect(audit?.[1]).toMatchObject({ eventType: "auth.simulation", simulatorUid: uid.admin, targetUid: "u_1" });
        } finally {
            info.mockRestore();
        }
    });

    it("refuses a non-administrator with 403, even one whose token claims admin", async () => {
        const { status, json } = await call("/api/data/tickets", { ...bearer(token.member), [SIMULATE_ROLE_HEADER]: "customer" });
        expect(status).toBe(403);
        expect(errorCodeOf(json)).toBe("SIMULATION_FORBIDDEN");
    });

    it("refuses an API key, the service key and an anonymous caller with 403", async () => {
        const plain = await call("/api/data/tickets", bearer(apiKey));
        expect(plain.status, JSON.stringify(plain.json)).toBe(200);

        for (const headers of [bearer(apiKey), bearer(SERVICE_KEY), {}]) {
            const { status, json } = await call("/api/data/tickets", { ...headers, [SIMULATE_ROLE_HEADER]: "customer" });
            expect(status).toBe(403);
            expect(errorCodeOf(json)).toBe("SIMULATION_FORBIDDEN");
        }
    });

    it("refuses a malformed simulation, an unknown key, and a route that cannot honour it", async () => {
        const mixed = await call("/api/data/tickets",
            asAdminSimulating({ [SIMULATE_API_KEY_ID_HEADER]: supportKeyId, [SIMULATE_ROLE_HEADER]: "customer" }));
        expect(mixed.status).toBe(400);
        expect(errorCodeOf(mixed.json)).toBe("SIMULATION_INVALID");

        const unknown = await call("/api/data/tickets",
            asAdminSimulating({ [SIMULATE_API_KEY_ID_HEADER]: "00000000-0000-4000-8000-000000000000" }));
        expect(unknown.status).toBe(404);
        expect(errorCodeOf(unknown.json)).toBe("SIMULATION_TARGET_NOT_FOUND");

        const elsewhere = await call("/api/admin/users", asAdminSimulating({ [SIMULATE_ROLE_HEADER]: "customer" }));
        expect(elsewhere.status).toBe(400);
        expect(errorCodeOf(elsewhere.json)).toBe("SIMULATION_UNSUPPORTED");
    });

    describe("the admin overview (/api/admin/rls-simulator)", () => {
        it("lists the roles the rules name and the live service keys", async () => {
            const { status, json } = await call("/api/admin/rls-simulator/options", bearer(token.admin));
            expect(status, JSON.stringify(json)).toBe(200);
            const body = json as { roles: Array<{ id: string }>; apiKeys: Array<{ id: string; name: string }> };
            expect(body.roles.map(role => role.id)).toEqual(expect.arrayContaining(["anon", "admin", "support"]));
            expect(body.apiKeys.map(key => key.name)).toEqual(expect.arrayContaining(["support-agent"]));
        });

        it("previews every collection as customer + u_1: rows hidden by RLS, columns masked", async () => {
            const { status, json } = await call("/api/admin/rls-simulator/preview", bearer(token.admin), {
                method: "POST",
                body: { role: "customer", userId: "u_1" }
            });
            expect(status, JSON.stringify(json)).toBe(200);
            const body = json as {
                collections: Array<{ slug: string; hiddenBy?: string; visibleRows?: number; totalRows?: number; maskedColumns: string[] }>;
                summary: { hiddenCollections: number; maskedColumns: number };
            };
            const bySlug = new Map(body.collections.map(view => [view.slug, view]));
            expect(bySlug.get("tickets")).toMatchObject({ visibleRows: 2, totalRows: 3, maskedColumns: ["internalNote"] });
            expect(bySlug.get("tickets")?.hiddenBy).toBeUndefined();
            expect(bySlug.get("secrets")).toMatchObject({ hiddenBy: "rls", visibleRows: 0, totalRows: 1 });
            expect(body.summary.hiddenCollections).toBeGreaterThanOrEqual(1);
            expect(body.summary.maskedColumns).toBeGreaterThanOrEqual(1);
        });

        it("previews a key's scopes as hidden collections", async () => {
            const { status, json } = await call("/api/admin/rls-simulator/preview", bearer(token.admin), {
                method: "POST",
                body: { apiKeyId: supportKeyId }
            });
            expect(status, JSON.stringify(json)).toBe(200);
            const views = (json as { collections: Array<{ slug: string; hiddenBy?: string }> }).collections;
            expect(views.find(view => view.slug === "secrets")?.hiddenBy).toBe("scope");
            expect(views.find(view => view.slug === "tickets")?.hiddenBy).toBeUndefined();
        });

        it("refuses a non-administrator", async () => {
            const { status } = await call("/api/admin/rls-simulator/preview", bearer(token.member), {
                method: "POST",
                body: { role: "customer" }
            });
            expect(status).toBe(403);
        });
    });
});
