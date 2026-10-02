/**
 * E2E: who a token is, after the account behind it has changed.
 *
 * The identity audit of 2026-10-01 reproduced these against a real server:
 * an account deleted by an administrator brought its revoked tokens back, and
 * an open realtime socket went on reading and writing as an identity that had
 * signed out everywhere, been demoted, deleted, or whose token had expired.
 *
 * What runs here is the real thing — real Postgres, the real
 * `PostgresAuthRepository`, the built-in adapter's routes mounted as `init.ts`
 * mounts them, the real socket handler on a real HTTP server — driven by HTTP
 * requests and a raw `ws` client, as a stolen token would be.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import type { AuthAdapter, CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureAuthTablesExist } from "../../src/auth/ensure-tables.js";
import { PostgresAuthRepository } from "../../src/auth/services.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { createPostgresWebSocket } from "../../src/websocket.js";
import { ensureAppRole, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";

// By relative path: inside a worktree the package name resolves to the primary
// checkout's build. See bootstrap-e2e.test.ts.
import { createBuiltinAuthAdapter } from "../../../server/src/auth/builtin-auth-adapter.js";
import { configureJwt, generateAccessToken } from "../../../server/src/auth/jwt.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import { oauthCodeFlowSchema } from "../../../server/src/auth/oauth-code-flow.js";
import type { HonoEnv } from "../../../server/src/api/types.js";

const JWT_SECRET = "identity-e2e-secret-key-that-is-definitely-32-chars-long!!";
const PASSWORD = "Identity-E2e-Passw0rd";

const notesTable = pgTable("notes", {
    id: varchar("id").primaryKey(),
    body: varchar("body")
});

const notesCollection = {
    slug: "notes",
    name: "Notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        body: { name: "Body", type: "string" }
    }
} as unknown as CollectionConfig;

type Frame = { type: string; requestId?: string; subscriptionId?: string; payload?: any };

describe("identity after the account changes (E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let observer: pg.Client;
    let repo: PostgresAuthRepository;
    let adapter: AuthAdapter;
    let realtime: RealtimeService;
    let server: Server;
    /** The same socket with the default sweep (thirty seconds), for the expiry timer alone. */
    let quietServer: Server;
    let base: string;
    let adminToken: string;
    const sockets: NodeWebSocket[] = [];
    const mails: { to: string; subject: string; text?: string }[] = [];

    beforeAll(async () => {
        configureJwt({ secret: JWT_SECRET, accessExpiresIn: "1h", refreshExpiresIn: "7d" });
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
        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        await ensureAuthTablesExist(db);
        repo = new PostgresAuthRepository(db);

        // Anyone signed in may read and write a note: what the socket answers
        // is then decided by who it believes the caller is, and nothing else.
        await observer.query(`
            CREATE TABLE public.notes (id varchar PRIMARY KEY, body varchar);
            ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
            CREATE POLICY notes_signed_in ON public.notes FOR ALL TO public
                USING (NULLIF(current_setting('app.uid', true), '') IS NOT NULL)
                WITH CHECK (NULLIF(current_setting('app.uid', true), '') IS NOT NULL);
            INSERT INTO public.notes (id, body) VALUES ('n-1', 'Seeded');
        `);
        await ensureAppRole(async (text) => (await pool.query(text)).rows as Record<string, unknown>[], ["public"]);

        adapter = createBuiltinAuthAdapter({
            authRepository: repo,
            allowRegistration: true,
            // Mail is captured, so a test can follow the link the owner was sent.
            emailService: {
                isConfigured: () => true,
                send: async (mail: { to: string; subject: string; text?: string }) => {
                    mails.push(mail);
                    return { messageId: "e2e" };
                }
            } as never,
            emailConfig: { from: "noreply@corp.example", appName: "IdentityE2E", resetPasswordUrl: "https://app.corp.example" },
            // A Google that vouches for whatever address it is asked about:
            // the code is `<subject>|<address>`.
            oauthProviders: [{
                id: "google",
                schema: oauthCodeFlowSchema(),
                verify: async (payload: { code: string }) => {
                    const [providerId, email] = payload.code.split("|");
                    return { providerId, email, emailVerified: true };
                }
            }] as never
        });
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/auth", adapter.createAuthRoutes!() as Hono<HonoEnv>);
        app.route("/api/admin", adapter.createAdminRoutes!() as Hono<HonoEnv>);
        // The data plane, as the adapter middleware asks it.
        app.get("/api/whoami", async (c) => {
            const user = await adapter.verifyRequest(c.req.raw);
            return user ? c.json({ uid: user.uid, roles: user.roles }) : c.json({ error: "unauthenticated" }, 401);
        });

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([notesCollection]);
        registry.registerTable(notesTable, "notes");
        realtime = new RealtimeService(db as never, registry);
        const driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.rlsUserRole = REBASE_USER_ROLE;

        server = createServer(getRequestListener(app.fetch));
        // A short sweep, so a socket that only listens is re-checked within
        // the test's patience rather than the default thirty seconds.
        createPostgresWebSocket(server, realtime, driver, undefined, adapter, { identityRecheckIntervalMs: 400 });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        quietServer = createServer();
        createPostgresWebSocket(quietServer, realtime, driver, undefined, adapter);
        await new Promise<void>(resolve => quietServer.listen(0, "127.0.0.1", resolve));

        const admin = await repo.createUser({ email: "admin@corp.example", emailVerified: true });
        await repo.setUserRoles(admin.id, ["admin"]);
        adminToken = await generateAccessToken(admin.id, ["admin"]);
    }, 180_000);

    afterAll(async () => {
        for (const ws of sockets) ws.terminate();
        await realtime?.destroy();
        for (const open of [server, quietServer]) {
            await new Promise<void>(resolve => (open ? open.close(() => resolve()) : resolve()));
        }
        await observer?.end().catch(() => {});
        await pool?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    async function http(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : undefined };
    }

    async function register(prefix: string): Promise<{ uid: string; accessToken: string; refreshToken: string; email: string }> {
        const email = `${prefix}-${Math.random().toString(36).slice(2, 8)}@corp.example`;
        const res = await http("POST", "/api/auth/register", { email, password: PASSWORD });
        expect(res.status).toBe(201);
        return { uid: res.json.user.uid, accessToken: res.json.tokens.accessToken, refreshToken: res.json.tokens.refreshToken, email };
    }

    /** `iat` is whole seconds: a revocation has to land in a later second than the sign-in. */
    const nextSecond = () => new Promise(resolve => setTimeout(resolve, 1100));

    /** A raw socket, its `send`, and every frame and close it received. */
    async function socket(on: Server = server) {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(on.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const waiters = new Map<string, (frame: Frame) => void>();
        let closed: { code: number; reason: string } | undefined;
        const closedPromise = new Promise<{ code: number; reason: string }>((resolve) => {
            ws.once("close", (code, reason) => {
                closed = { code, reason: String(reason) };
                resolve(closed);
            });
        });
        /** Frames nobody asked for — the session-ended notice among them. */
        const unsolicited: Frame[] = [];
        ws.on("message", (data) => {
            const frame = JSON.parse(String(data)) as Frame;
            const key = frame.requestId ?? frame.subscriptionId;
            if (!key) unsolicited.push(frame);
            const waiter = key && waiters.get(key);
            if (waiter) {
                waiters.delete(key);
                waiter(frame);
            }
        });
        let seq = 0;
        /** Resolves with the answer, or with `{ type: "CLOSED" }` when the socket closes instead. */
        const send = (type: string, payload: Record<string, unknown>): Promise<Frame> => new Promise((resolve, reject) => {
            if (closed) return resolve({ type: "CLOSED", payload: closed });
            const key = `${type}-${++seq}`;
            const timer = setTimeout(() => reject(new Error(`No answer to ${type}`)), 5_000);
            waiters.set(key, (frame) => {
                clearTimeout(timer);
                resolve(frame);
            });
            closedPromise.then((info) => {
                clearTimeout(timer);
                resolve({ type: "CLOSED", payload: info });
            });
            ws.send(JSON.stringify(type.startsWith("subscribe_")
                ? { type, payload: { ...payload, subscriptionId: key } }
                : { type, requestId: key, payload }));
        });
        return { ws, send, closed: () => closed, closedPromise, unsolicited };
    }

    async function signIn(email: string): Promise<{ accessToken: string; refreshToken: string }> {
        const res = await http("POST", "/api/auth/login", { email, password: PASSWORD });
        expect(res.status).toBe(200);
        return { accessToken: res.json.tokens.accessToken, refreshToken: res.json.tokens.refreshToken };
    }

    describe("the session id in the access token", () => {
        it("signs one device out, its access token included, and marks the caller's own session", async () => {
            const owner = await register("devices");
            const laptop = await signIn(owner.email);
            const phone = await signIn(owner.email);

            const listed = await http("GET", "/api/auth/sessions", undefined, laptop.accessToken);
            expect(listed.json.sessions.filter((s: { isCurrentSession: boolean }) => s.isCurrentSession)).toHaveLength(1);

            expect((await http("POST", "/api/auth/logout", { refreshToken: phone.refreshToken })).status).toBe(200);

            expect((await http("GET", "/api/whoami", undefined, phone.accessToken)).status).toBe(401);
            expect((await http("GET", "/api/whoami", undefined, laptop.accessToken)).status).toBe(200);
        });
    });

    describe("IDENTITY-3: an open socket stops acting as an identity that ended", () => {
        const noteCount = async (id: string) =>
            (await observer.query("SELECT count(*)::int AS c FROM public.notes WHERE id = $1", [id])).rows[0].c as number;

        it("after its owner signs out everywhere: the next frame closes the socket, and nothing is written", async () => {
            const victim = await register("signout");
            const { send } = await socket();
            expect((await send("AUTHENTICATE", { token: victim.accessToken })).type).toBe("AUTH_SUCCESS");
            expect((await send("FETCH_COLLECTION", { path: "notes" })).type).toBe("FETCH_COLLECTION_SUCCESS");

            await nextSecond();
            expect((await http("DELETE", "/api/auth/sessions", undefined, victim.accessToken)).status).toBe(200);

            const answer = await send("SAVE", { path: "notes", values: { id: "after-signout", body: "written after sign-out" }, status: "new" });
            expect(answer.type).toBe("CLOSED");
            expect(answer.payload.code).toBe(4001);
            expect(await noteCount("after-signout")).toBe(0);
        });

        it("after the device is signed out by its session alone", async () => {
            const owner = await register("device");
            const phone = await signIn(owner.email);
            const { send } = await socket();
            expect((await send("AUTHENTICATE", { token: phone.accessToken })).type).toBe("AUTH_SUCCESS");

            expect((await http("POST", "/api/auth/logout", { refreshToken: phone.refreshToken })).status).toBe(200);

            expect((await send("FETCH_COLLECTION", { path: "notes" })).type).toBe("CLOSED");
        });

        it("after a demotion: the admin verbs it held are refused on the same socket", async () => {
            const deputy = await register("deputy");
            await repo.setUserRoles(deputy.uid, ["admin"]);
            const deputyToken = (await signIn(deputy.email)).accessToken;
            const { send } = await socket();
            expect((await send("AUTHENTICATE", { token: deputyToken })).type).toBe("AUTH_SUCCESS");
            expect((await send("FETCH_CURRENT_DATABASE", {})).payload?.error?.code).not.toBe("SCOPE_MISSING");

            expect((await http("PUT", `/api/admin/users/${deputy.uid}`, { roles: [] }, adminToken)).status).toBe(200);

            const refused = await send("FETCH_CURRENT_DATABASE", {});
            expect(refused.type).toBe("ERROR");
            expect(refused.payload.error.code).toBe("SCOPE_MISSING");
        });

        it("after the account is deleted: the next write closes the socket, and nothing lands", async () => {
            const victim = await register("ghost");
            const { send } = await socket();
            expect((await send("AUTHENTICATE", { token: victim.accessToken })).type).toBe("AUTH_SUCCESS");

            expect((await http("DELETE", `/api/admin/users/${victim.uid}`, undefined, adminToken)).status).toBe(200);

            const answer = await send("SAVE", { path: "notes", values: { id: "ghost-note", body: "written by a deleted user" }, status: "new" });
            expect(answer.type).toBe("CLOSED");
            expect(await noteCount("ghost-note")).toBe(0);
        });

        it("when it only listens: the sweep closes it, so no further rows are pushed", async () => {
            const victim = await register("listener");
            const { send, closedPromise } = await socket();
            expect((await send("AUTHENTICATE", { token: victim.accessToken })).type).toBe("AUTH_SUCCESS");
            expect((await send("subscribe_collection", { path: "notes" })).type).toBe("collection_update");

            await nextSecond();
            expect((await http("DELETE", "/api/auth/sessions", undefined, victim.accessToken)).status).toBe(200);

            const closed = await Promise.race([
                closedPromise,
                new Promise<null>(resolve => setTimeout(() => resolve(null), 3_000))
            ]);
            expect(closed?.code).toBe(4001);
        });

        it("when its token expires, at that instant, unless it authenticated again", async () => {
            const owner = await register("expiring");
            configureJwt({ secret: JWT_SECRET, accessExpiresIn: "2s", refreshExpiresIn: "7d" });
            let shortLived: string;
            let renewed: string;
            try {
                shortLived = (await signIn(owner.email)).accessToken;
                renewed = (await signIn(owner.email)).accessToken;
            } finally {
                configureJwt({ secret: JWT_SECRET, accessExpiresIn: "1h", refreshExpiresIn: "7d" });
            }
            const renewedAfter = (await signIn(owner.email)).accessToken;

            const expiring = await socket(quietServer);
            expect((await expiring.send("AUTHENTICATE", { token: shortLived })).type).toBe("AUTH_SUCCESS");
            const kept = await socket(quietServer);
            expect((await kept.send("AUTHENTICATE", { token: renewed })).type).toBe("AUTH_SUCCESS");
            // What the SDK does on every refresh: authenticate the socket again.
            expect((await kept.send("AUTHENTICATE", { token: renewedAfter })).type).toBe("AUTH_SUCCESS");

            const closed = await Promise.race([
                expiring.closedPromise,
                new Promise<null>(resolve => setTimeout(() => resolve(null), 4_000))
            ]);
            expect(closed?.code).toBe(4001);
            expect(expiring.unsolicited.map(frame => frame.payload?.error?.code)).toContain("TOKEN_EXPIRED");
            expect(kept.closed()).toBeUndefined();
            expect((await kept.send("FETCH_COLLECTION", { path: "notes" })).type).toBe("FETCH_COLLECTION_SUCCESS");
        });
    });

    describe("IDENTITY-1: the pre-hijack through the verification link", () => {
        /** The token in the latest verification mail to `to`, once the background send has run. */
        async function mailedVerificationToken(to: string): Promise<string> {
            for (let i = 0; i < 20; i++) {
                const mail = [...mails].reverse().find(m => m.to === to && /verify-email\?token=/.test(m.text ?? ""));
                if (mail) return /verify-email\?token=([A-Za-z0-9_-]+)/.exec(mail.text!)![1];
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error(`no verification mail to ${to}`);
        }

        it("is closed: the owner follows the link the attacker asked for, and only the owner gets in", async () => {
            // 1. The attacker registers the owner's address with a password.
            const attacker = await register("victim");
            // 2. … and asks for the genuine verification mail to be sent to it.
            expect((await http("POST", "/api/auth/send-verification", undefined, attacker.accessToken)).status).toBe(200);
            const link = await mailedVerificationToken(attacker.email);

            // 3. The owner follows it, in their own browser.
            const followed = await http("GET", `/api/auth/verify-email?token=${link}`);
            expect(followed.status).toBe(200);
            expect(followed.json.passwordRemoved).toBe(true);

            // 4. The owner later signs in with Google, which auto-links now
            //    that both sides are verified: the same account.
            const owner = await http("POST", "/api/auth/google", { code: `google-${attacker.uid}|${attacker.email}`, redirectUri: "https://app.corp.example/cb" });
            expect(owner.status).toBe(200);
            expect(owner.json.user.uid).toBe(attacker.uid);

            // 5. The attacker's password, session and token are all gone.
            expect((await http("POST", "/api/auth/login", { email: attacker.email, password: PASSWORD })).status).toBe(401);
            expect((await http("POST", "/api/auth/refresh", { refreshToken: attacker.refreshToken })).status).toBe(401);
            expect((await http("GET", "/api/whoami", undefined, attacker.accessToken)).status).toBe(401);
        });

        it("keeps the owner's own password when they follow their link signed in", async () => {
            const owner = await register("owner");
            const link = await mailedVerificationToken(owner.email);

            const followed = await http("GET", `/api/auth/verify-email?token=${link}`, undefined, owner.accessToken);

            expect(followed.json).toMatchObject({ success: true, passwordRemoved: false });
            expect((await http("POST", "/api/auth/login", { email: owner.email, password: PASSWORD })).status).toBe(200);
        });
    });

    describe("IDENTITY-2: deleting an account revokes its tokens", () => {
        it("keeps a token its owner revoked refused after an administrator deletes the account", async () => {
            const victim = await register("stolen");
            await nextSecond();

            expect((await http("DELETE", "/api/auth/sessions", undefined, victim.accessToken)).status).toBe(200);
            expect((await http("GET", "/api/whoami", undefined, victim.accessToken)).status).toBe(401);

            expect((await http("DELETE", `/api/admin/users/${victim.uid}`, undefined, adminToken)).status).toBe(200);

            expect((await http("GET", "/api/whoami", undefined, victim.accessToken)).status).toBe(401);
            const { send } = await socket();
            expect((await send("AUTHENTICATE", { token: victim.accessToken })).type).toBe("AUTH_ERROR");
        });

        it("refuses a deleted account's token with no sign-out first", async () => {
            const victim = await register("deleted");
            expect((await http("GET", "/api/whoami", undefined, victim.accessToken)).status).toBe(200);

            expect((await http("DELETE", `/api/admin/users/${victim.uid}`, undefined, adminToken)).status).toBe(200);

            expect((await http("GET", "/api/whoami", undefined, victim.accessToken)).status).toBe(401);
            expect((await http("GET", "/api/auth/sessions", undefined, victim.accessToken)).status).toBe(401);
        });
    });
});
