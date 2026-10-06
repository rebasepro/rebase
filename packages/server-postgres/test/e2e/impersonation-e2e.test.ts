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
 * built-in auth adapter, the data router's auth middleware, the realtime
 * socket the boot attaches, the guard every other route sits behind, and
 * Postgres RLS.
 * The policies are owner checks, so "B's rows and not A's" can only come from
 * the statement running as `rebase_user` with B's uid; the admin arm of the
 * default policies would hand the administrator both.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
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

/** A realtime frame, as much of one as these tests read. */
type Frame = {
    type: string;
    requestId?: string;
    subscriptionId?: string;
    payload?: { uid?: string; rows?: Array<{ id: string }>; error?: { code?: string } };
    /** A subscription's update carries its rows here rather than in `payload`. */
    rows?: Array<{ id: string }>;
};

describe("x-rebase-impersonate on the data API (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;

    const uid = { admin: "", a: "", b: "", c: "", disabled: "" };
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    let repo: AuthRepository;
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

    /**
     * A socket to the booted server. `send` resolves with the frame answering
     * it; `next` with the next frame the predicate matches, whatever sent it.
     */
    async function openSocket() {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const waiters: Array<{ match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = [];
        ws.on("message", (data) => {
            const frame = JSON.parse(String(data)) as Frame;
            const waiter = waiters.find(w => w.match(frame));
            if (waiter) {
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.resolve(frame);
            }
        });
        const next = (match: (frame: Frame) => boolean): Promise<Frame> => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("No matching frame")), 5_000);
            waiters.push({ match, resolve: (frame) => {
                clearTimeout(timer);
                resolve(frame);
            } });
        });
        let seq = 0;
        const send = (type: string, payload: Record<string, unknown>): Promise<Frame> => {
            const key = `${type}-${++seq}`;
            const answer = next(frame => frame.requestId === key || frame.subscriptionId === key);
            ws.send(JSON.stringify(type.startsWith("subscribe_")
                ? { type, payload: { ...payload, subscriptionId: key } }
                : { type, requestId: key, payload }));
            return answer;
        };
        return { send, next };
    }

    const noteIds = (frame: Frame) => (frame.payload?.rows ?? frame.rows ?? []).map(row => row.id).sort();

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
            // The realtime socket is attached to it; it listens below.
            server,
            collections: [notesCollection],
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY }
        });

        const bootedRepo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!bootedRepo) throw new Error("the boot set up no auth repository");
        repo = bootedRepo;
        const account = async (email: string, roles: string[]) => {
            const user = await repo.createUser({ email, emailVerified: true });
            await repo.setUserRoles(user.id, roles);
            return user.id;
        };
        uid.admin = await account("admin@impersonation.test", ["admin"]);
        uid.a = await account("a@impersonation.test", []);
        uid.b = await account("b@impersonation.test", []);
        uid.c = await account("c@impersonation.test", []);
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

        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    }, 180_000);

    afterAll(async () => {
        for (const ws of sockets) ws.terminate();
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

    it("refuses the header on a route that cannot honour it, rather than answer as the administrator", async () => {
        const { status, json } = await call("/api/admin/users", asAdminImpersonating(uid.b));
        expect(status).toBe(400);
        expect(errorCodeOf(json)).toBe("IMPERSONATION_UNSUPPORTED");
        expect(JSON.stringify(json)).not.toContain("admin@impersonation.test");

        // The same route answers the administrator who leaves the header out.
        const plain = await call("/api/admin/users", bearer(token.admin));
        expect(plain.status).toBe(200);
    });

    describe("over the realtime socket", () => {
        it("signs a socket in as B when the administrator's AUTHENTICATE names B: B's notes, and not A's", async () => {
            const { send } = await openSocket();
            const auth = await send("AUTHENTICATE", { token: token.admin, impersonate: uid.b });
            expect(auth.type).toBe("AUTH_SUCCESS");
            expect(auth.payload?.uid).toBe(uid.b);

            const fetched = await send("FETCH_COLLECTION", { path: "notes" });
            expect(fetched.type).toBe("FETCH_COLLECTION_SUCCESS");
            expect(noteIds(fetched)).toEqual([B_NOTE]);

            const subscribed = await send("subscribe_collection", { path: "notes" });
            expect(subscribed.type).toBe("collection_update");
            expect(noteIds(subscribed)).toEqual([B_NOTE]);
        });

        it("refuses impersonate from an API key, a non-administrator and for an unknown uid — and stays signed out", async () => {
            const refusals: Array<[string, string, string]> = [
                [apiKey, uid.b, "IMPERSONATION_FORBIDDEN"],
                [token.a, uid.b, "IMPERSONATION_FORBIDDEN"],
                [token.admin, "no-such-user", "IMPERSONATION_TARGET_NOT_FOUND"]
            ];
            for (const [credential, target, code] of refusals) {
                const { send } = await openSocket();
                const auth = await send("AUTHENTICATE", { token: credential, impersonate: target });
                expect(auth.type).toBe("AUTH_ERROR");
                expect(auth.payload?.error?.code).toBe(code);

                // Not signed in as the caller either.
                const fetched = await send("FETCH_COLLECTION", { path: "notes" });
                expect(fetched.type).not.toBe("FETCH_COLLECTION_SUCCESS");
            }
        });

        it("ends an impersonated session when the user it runs as is disabled", async () => {
            const { send, next } = await openSocket();
            const auth = await send("AUTHENTICATE", { token: token.admin, impersonate: uid.c });
            expect(auth.type).toBe("AUTH_SUCCESS");

            if (!repo.setUserDisabled) throw new Error("the repository cannot disable an account");
            await repo.setUserDisabled(uid.c, true);

            const ended = next(frame => frame.type === "AUTH_ERROR" && frame.requestId === undefined);
            void send("FETCH_COLLECTION", { path: "notes" }).catch(() => undefined);
            expect((await ended).payload?.error?.code).toBe("IMPERSONATION_TARGET_NOT_FOUND");
        });
    });
});
