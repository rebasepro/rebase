/**
 * E2E: an administrator's request carrying `x-rebase-impersonate` runs as the
 * user it names, or is refused — never as the administrator.
 *
 * ## Why this is pinned
 *
 * Studio's API explorer offered "Run as <user>" and sent this header, and no
 * server code read it. The request ran with the administrator's session, the
 * response showed every row the admin role admits, and the panel presented it
 * as what the chosen user would see. That made the most common row-level
 * security check — can B read or write A's rows? — answer "yes" whatever the
 * policies said.
 *
 * Everything here goes through what the server mounts: the real boot, the
 * built-in auth adapter, the data router's auth middleware and Postgres RLS.
 * The policies are owner checks, so "B's rows and not A's" can only come from
 * the statement running as `rebase_user` with B's uid; the admin arm of the
 * default policies would hand the administrator both.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import { IMPERSONATE_HEADER, type CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import { logger } from "../../../server/src/utils/logger.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "impersonation-e2e-secret-that-is-long-enough-0123456789";
const SERVICE_KEY = "impersonation-e2e-service-key-0123456789abcdef";

const notesCollection: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" },
        { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        title: { name: "Title", type: "string" }
    }
};

const A_NOTE = "11111111-1111-4111-8111-111111111111";
const B_NOTE = "22222222-2222-4222-8222-222222222222";

type NoteRow = { id: string; ownerId: string; title: string };

describe("x-rebase-impersonate on the data API (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;

    const uid = { admin: "", a: "", b: "", disabled: "" };
    const token = { admin: "", a: "" };
    let apiKey = "";

    /** A request to the mounted app, with the headers given and nothing else. */
    async function call(path: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}) {
        const response = await app.request(path, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json", ...headers },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        const json: unknown = text ? JSON.parse(text) : undefined;
        return { status: response.status, json };
    }

    const bearer = (credential: string) => ({ Authorization: `Bearer ${credential}` });
    const asAdminImpersonating = (target: string) => ({ ...bearer(token.admin), [IMPERSONATE_HEADER]: target });

    function rowsOf(json: unknown): NoteRow[] {
        if (typeof json !== "object" || json === null || !("data" in json) || !Array.isArray(json.data)) {
            throw new Error(`not a listing: ${JSON.stringify(json)}`);
        }
        return json.data;
    }

    function errorCodeOf(json: unknown): unknown {
        if (typeof json !== "object" || json === null || !("error" in json)) return undefined;
        const error = json.error;
        return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    }

    async function storedNote(id: string): Promise<{ owner_id: string; title: string } | undefined> {
        const { rows } = await admin.query<{ owner_id: string; title: string }>(
            "SELECT owner_id, title FROM public.notes WHERE id = $1", [id]
        );
        return rows[0];
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
            // Never listening: its `close` is all the shutdown needs.
            server: createServer(),
            collections: [notesCollection],
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
        uid.admin = await account("admin@impersonation.test", ["admin"]);
        uid.a = await account("a@impersonation.test", []);
        uid.b = await account("b@impersonation.test", []);
        uid.disabled = await account("gone@impersonation.test", []);
        if (!repo.setUserDisabled) throw new Error("the repository cannot disable an account");
        await repo.setUserDisabled(uid.disabled, true);

        token.admin = await generateAccessToken(uid.admin, ["admin"]);
        // A's token CLAIMS admin; the database says A holds no role. The
        // decision has to rest on the second.
        token.a = await generateAccessToken(uid.a, ["admin"]);

        await admin.query(
            "INSERT INTO public.notes (id, owner_id, title) VALUES ($1, $2, 'A''s note'), ($3, $4, 'B''s note')",
            [A_NOTE, uid.a, B_NOTE, uid.b]
        );

        // A key as strong as one gets: the admin role for RLS, and the data
        // scopes. It is still not a person, so it is still refused.
        const minted = await call("/api/admin/api-keys", bearer(token.admin), {
            method: "POST",
            body: { name: "impersonation-e2e", scopes: ["data:read", "data:write"], roles: ["admin"] }
        });
        expect(minted.status, JSON.stringify(minted.json)).toBe(201);
        const key = (minted.json as { key?: { key?: unknown } }).key?.key;
        if (typeof key !== "string") throw new Error(`no key in ${JSON.stringify(minted.json)}`);
        apiKey = key;
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("lets the administrator's own request read every note — the baseline the header must change", async () => {
        const { status, json } = await call("/api/data/notes", bearer(token.admin));
        expect(status).toBe(200);
        expect(rowsOf(json).map(row => row.id).sort()).toEqual([A_NOTE, B_NOTE].sort());
    });

    it("runs an administrator's read as B: B's notes, and not A's", async () => {
        const { status, json } = await call("/api/data/notes", asAdminImpersonating(uid.b));
        expect(status).toBe(200);
        expect(rowsOf(json).map(row => row.id)).toEqual([B_NOTE]);

        const direct = await call(`/api/data/notes/${A_NOTE}`, asAdminImpersonating(uid.b));
        expect(direct.status).toBe(404);
    });

    it("runs an administrator's writes as B: B's own row changes, A's does not", async () => {
        const own = await call(`/api/data/notes/${B_NOTE}`, asAdminImpersonating(uid.b), {
            method: "PATCH",
            body: { title: "edited as B" }
        });
        expect(own.status, JSON.stringify(own.json)).toBe(200);
        expect((await storedNote(B_NOTE))?.title).toBe("edited as B");

        const theirs = await call(`/api/data/notes/${A_NOTE}`, asAdminImpersonating(uid.b), {
            method: "PATCH",
            body: { title: "edited as B" }
        });
        expect(theirs.status).toBeGreaterThanOrEqual(400);
        expect(await storedNote(A_NOTE)).toEqual({ owner_id: uid.a, title: "A's note" });

        // A create claiming A's ownership fails B's insert check.
        const forged = await call("/api/data/notes", asAdminImpersonating(uid.b), {
            method: "POST",
            body: { ownerId: uid.a, title: "planted as B" }
        });
        expect(forged.status).toBeGreaterThanOrEqual(400);
        const { rows } = await admin.query("SELECT 1 FROM public.notes WHERE title = 'planted as B'");
        expect(rows).toHaveLength(0);
    });

    it("writes a security audit event naming both the administrator and the user", async () => {
        const info = vi.spyOn(logger, "info");
        try {
            await call("/api/data/notes", asAdminImpersonating(uid.b));
            const audit = info.mock.calls.find(([message]) => message.includes("[Security Audit]"));
            expect(audit?.[1]).toMatchObject({
                eventType: "auth.impersonation",
                impersonatorUid: uid.admin,
                targetUid: uid.b
            });
        } finally {
            info.mockRestore();
        }
    });

    it("refuses a non-administrator with 403, even one whose token claims admin", async () => {
        const { status, json } = await call("/api/data/notes", { ...bearer(token.a), [IMPERSONATE_HEADER]: uid.b });
        expect(status).toBe(403);
        expect(errorCodeOf(json)).toBe("IMPERSONATION_FORBIDDEN");
    });

    it("refuses an API key with 403, though it holds the admin role and the key works without the header", async () => {
        const plain = await call("/api/data/notes", bearer(apiKey));
        expect(plain.status, JSON.stringify(plain.json)).toBe(200);

        const { status, json } = await call("/api/data/notes", { ...bearer(apiKey), [IMPERSONATE_HEADER]: uid.b });
        expect(status).toBe(403);
        expect(errorCodeOf(json)).toBe("IMPERSONATION_FORBIDDEN");
    });

    it("refuses the service key and an anonymous caller with 403", async () => {
        const service = await call("/api/data/notes", { ...bearer(SERVICE_KEY), [IMPERSONATE_HEADER]: uid.b });
        expect(service.status).toBe(403);
        expect(errorCodeOf(service.json)).toBe("IMPERSONATION_FORBIDDEN");

        const anonymous = await call("/api/data/notes", { [IMPERSONATE_HEADER]: uid.b });
        expect(anonymous.status).toBe(403);
        expect(errorCodeOf(anonymous.json)).toBe("IMPERSONATION_FORBIDDEN");
    });

    it("refuses a uid that names no active user, rather than running as the administrator", async () => {
        const unknown = await call("/api/data/notes", asAdminImpersonating("no-such-user"));
        expect(unknown.status).toBe(404);
        expect(errorCodeOf(unknown.json)).toBe("IMPERSONATION_TARGET_NOT_FOUND");

        const disabled = await call("/api/data/notes", asAdminImpersonating(uid.disabled));
        expect(disabled.status).toBe(404);
        expect(errorCodeOf(disabled.json)).toBe("IMPERSONATION_TARGET_NOT_FOUND");

        const empty = await call("/api/data/notes", asAdminImpersonating("  "));
        expect(empty.status).toBe(400);
        expect(errorCodeOf(empty.json)).toBe("IMPERSONATION_INVALID");
    });
});
