/**
 * E2E: a guest is a guest over the Postgres socket.
 *
 * Anonymous sign-in mints a real user with a real uid, so the database tells a
 * guest from an account by `app.is_anonymous` alone — `rebase.is_anonymous()`,
 * which `policy.registered()` compiles to. The socket read the flag from the
 * token into its session, and then:
 *
 * - `getScopedDelegate` scoped every request frame (`FETCH_*`, `SAVE`,
 *   `DELETE`, …) with `isAnonymous: false`, so a guest read and wrote as an
 *   account there, while its subscriptions — which carried the flag — did not;
 * - a session authenticated through an `AuthAdapter` never read the flag at
 *   all, so its subscriptions lost it too.
 *
 * The Mongo half, where every socket door had the same gap, is
 * `packages/server-mongo/test/guest-identity-e2e.test.ts`.
 *
 * A real Postgres as a superuser with `rebase_user` provisioned, the real socket
 * handler on a real HTTP server, a raw `ws` client, and real tokens.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import type { AuthAdapter, CollectionConfig } from "@rebasepro/types";
// From the file itself: the public entry point exports `configureJwt` only.
import { configureJwt, generateAccessToken } from "../../../server/src/auth/jwt";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { createPostgresWebSocket } from "../../src/websocket.js";
import { ensureAppRole, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";

const briefingsTable = pgTable("briefings", {
    id: varchar("id").primaryKey(),
    title: varchar("title")
});

const lobbyTable = pgTable("lobby", {
    id: varchar("id").primaryKey(),
    title: varchar("title")
});

/** Readable by guests and nobody else: what `rebase.is_anonymous()` grants. */
const lobbyCollection = {
    slug: "lobby",
    name: "Lobby",
    table: "lobby",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

const briefingsCollection = {
    slug: "briefings",
    name: "Briefings",
    table: "briefings",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

/** Trusts two tokens, the way an external identity provider would. */
const adapter = {
    verifyRequest: async () => null,
    verifyToken: async (token: string) => {
        if (token === "guest-token") return { uid: "guest-7", email: "", roles: [], isAdmin: false, isAnonymous: true };
        if (token === "member-token") return { uid: "member-1", email: "", roles: [], isAdmin: false, isAnonymous: false };
        return null;
    }
} as unknown as AuthAdapter;

type Frame = { type: string; requestId?: string; subscriptionId?: string; payload?: any; rows?: unknown[] };

describe("a guest is a guest over the Postgres socket (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let realtime: RealtimeService;
    /** Authenticates by the platform's own JWT. */
    let jwtServer: Server;
    /** Authenticates through the adapter. */
    let adapterServer: Server;
    const sockets: NodeWebSocket[] = [];

    /** A socket signed in with `token`, and a `send` that resolves with the answer. */
    async function signedIn(server: Server, token: string) {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const waiters = new Map<string, (frame: Frame) => void>();
        ws.on("message", (data) => {
            const frame = JSON.parse(String(data)) as Frame;
            const key = frame.requestId ?? frame.subscriptionId;
            const waiter = key && waiters.get(key);
            if (waiter) {
                waiters.delete(key);
                waiter(frame);
            }
        });
        let seq = 0;
        const send = (type: string, payload: Record<string, unknown>): Promise<Frame> =>
            new Promise((resolve, reject) => {
                const key = `${type}-${++seq}`;
                const timer = setTimeout(() => reject(new Error(`No answer to ${type}`)), 5_000);
                waiters.set(key, (frame) => {
                    clearTimeout(timer);
                    resolve(frame);
                });
                ws.send(JSON.stringify(type.startsWith("subscribe_")
                    ? { type, payload: { ...payload, subscriptionId: key } }
                    : { type, requestId: key, payload }));
            });
        const auth = await send("AUTHENTICATE", { token });
        expect(auth.type).toBe("AUTH_SUCCESS");
        return send;
    }

    const guestToken = () => generateAccessToken("guest-7", [], "aal1", undefined, true);
    const memberToken = () => generateAccessToken("member-1", []);

    beforeAll(async () => {
        configureJwt({ secret: "socket-guest-identity-e2e-secret-0123456789", accessExpiresIn: "1h" });

        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                observer = new pg.Client({ connectionString: container.connectionString });
                await observer.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // What `policy.registered()` compiles to, spelled against the GUCs
        // `applyAuthContext` sets: signed in, and not a guest.
        await observer.query(`
            CREATE SCHEMA IF NOT EXISTS auth;
            CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$
                SELECT NULLIF(current_setting('app.uid', true), '');
            $$ LANGUAGE sql STABLE;

            CREATE TABLE public.briefings (id varchar PRIMARY KEY, title varchar);
            ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
            CREATE POLICY briefings_members_read ON public.briefings FOR SELECT TO public
                USING (auth.uid() IS NOT NULL AND auth.uid() <> 'anonymous'
                       AND coalesce(current_setting('app.is_anonymous', true), 'false') <> 'true');
            CREATE POLICY briefings_members_write ON public.briefings FOR INSERT TO public
                WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() <> 'anonymous'
                            AND coalesce(current_setting('app.is_anonymous', true), 'false') <> 'true');
            INSERT INTO public.briefings (id, title) VALUES ('b-1', 'Quarterly plan');

            CREATE TABLE public.lobby (id varchar PRIMARY KEY, title varchar);
            ALTER TABLE public.lobby ENABLE ROW LEVEL SECURITY;
            CREATE POLICY lobby_guests_read ON public.lobby FOR SELECT TO public
                USING (coalesce(current_setting('app.is_anonymous', true), 'false') = 'true');
            INSERT INTO public.lobby (id, title) VALUES ('l-1', 'Welcome, guest');
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([briefingsCollection, lobbyCollection]);
        registry.registerTable(briefingsTable, "briefings");
        registry.registerTable(lobbyTable, "lobby");
        realtime = new RealtimeService(db as never, registry);
        const driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        await ensureAppRole(async (text) => (await pool.query(text)).rows as Record<string, unknown>[], ["public", "auth"]);
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.rlsUserRole = REBASE_USER_ROLE;

        jwtServer = createServer();
        createPostgresWebSocket(jwtServer, realtime, driver, { requireAuth: false });
        await new Promise<void>(resolve => jwtServer.listen(0, resolve));

        adapterServer = createServer();
        createPostgresWebSocket(adapterServer, realtime, driver, undefined, adapter);
        await new Promise<void>(resolve => adapterServer.listen(0, resolve));
    }, 120_000);

    afterAll(async () => {
        for (const ws of sockets) ws.close();
        await realtime?.destroy();
        for (const server of [jwtServer, adapterServer]) {
            await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        }
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    const titles = (frame: Frame) => (frame.payload?.rows ?? frame.rows ?? []).map((row: { title: string }) => row.title);

    describe("signed in by token", () => {
        it("lists nothing a guest may not read", async () => {
            const send = await signedIn(jwtServer, await guestToken());

            const frame = await send("FETCH_COLLECTION", { path: "briefings" });

            expect(frame.type).toBe("FETCH_COLLECTION_SUCCESS");
            expect(titles(frame)).toEqual([]);
        });

        it("does not hand a guest the row by id", async () => {
            const send = await signedIn(jwtServer, await guestToken());

            const frame = await send("FETCH_ONE", { path: "briefings", id: "b-1" });

            expect(JSON.stringify(frame)).not.toContain("Quarterly plan");
        });

        it("refuses a guest's write, and writes nothing", async () => {
            const send = await signedIn(jwtServer, await guestToken());

            const frame = await send("SAVE", { path: "briefings", values: { id: "b-guest", title: "Posted by a guest" }, status: "new" });

            expect(frame.type).not.toBe("SAVE_SUCCESS");
            const stored = await observer.query("SELECT count(*)::int AS c FROM public.briefings WHERE id = 'b-guest'");
            expect(stored.rows[0].c).toBe(0);
        });

        it("subscribes a guest as a guest", async () => {
            const send = await signedIn(jwtServer, await guestToken());

            const frame = await send("subscribe_collection", { path: "briefings" });

            expect(frame.type).toBe("collection_update");
            expect(titles(frame)).toEqual([]);
        });

        it("still serves an account, writes included", async () => {
            const send = await signedIn(jwtServer, await memberToken());

            expect(titles(await send("FETCH_COLLECTION", { path: "briefings" }))).toContain("Quarterly plan");
            expect(titles(await send("subscribe_collection", { path: "briefings" }))).toContain("Quarterly plan");
            const saved = await send("SAVE", { path: "briefings", values: { id: "b-member", title: "Posted by a member" }, status: "new" });
            expect(saved.type).toBe("SAVE_SUCCESS");
        });
    });

    /**
     * The request frames scoped a socket with no session as a guest
     * (`isAnonymous: true`); its subscriptions, and REST, scoped the same
     * caller as not one. No session is not a guest session.
     */
    describe("a socket that never authenticated", () => {
        async function unauthenticated() {
            const ws = new NodeWebSocket(`ws://127.0.0.1:${(jwtServer.address() as AddressInfo).port}`);
            sockets.push(ws);
            await new Promise<void>((resolve, reject) => {
                ws.once("open", () => resolve());
                ws.once("error", reject);
            });
            return (type: string, payload: Record<string, unknown>) => new Promise<Frame>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`No answer to ${type}`)), 5_000);
                ws.once("message", (data) => {
                    clearTimeout(timer);
                    resolve(JSON.parse(String(data)) as Frame);
                });
                ws.send(JSON.stringify({ type, requestId: "probe", payload }));
            });
        }

        it("is not read as a guest", async () => {
            const send = await unauthenticated();

            expect(titles(await send("FETCH_COLLECTION", { path: "lobby" }))).toEqual([]);
        });

        it("while a guest is", async () => {
            const send = await signedIn(jwtServer, await guestToken());

            expect(titles(await send("FETCH_COLLECTION", { path: "lobby" }))).toEqual(["Welcome, guest"]);
        });
    });

    describe("signed in through an adapter", () => {
        it("lists nothing a guest may not read", async () => {
            const send = await signedIn(adapterServer, "guest-token");

            expect(titles(await send("FETCH_COLLECTION", { path: "briefings" }))).toEqual([]);
        });

        it("subscribes a guest as a guest", async () => {
            const send = await signedIn(adapterServer, "guest-token");

            const frame = await send("subscribe_collection", { path: "briefings" });

            expect(frame.type).toBe("collection_update");
            expect(titles(frame)).toEqual([]);
        });

        it("still serves an account", async () => {
            const send = await signedIn(adapterServer, "member-token");

            expect(titles(await send("FETCH_COLLECTION", { path: "briefings" }))).toContain("Quarterly plan");
            expect(titles(await send("subscribe_collection", { path: "briefings" }))).toContain("Quarterly plan");
        });
    });
});
