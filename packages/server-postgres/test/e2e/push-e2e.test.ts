/**
 * E2E: Web Push on a real boot against real Postgres.
 *
 * What is pinned:
 *
 * - `push: true` creates `rebase.push_subscriptions` and mounts `/api/push`;
 *   every route needs a signed-in person (no token: 401; the service key: 403);
 * - a subscription is stored under the caller, keyed by the endpoint's hash,
 *   and an endpoint off the push services is refused before anything is kept;
 * - a browser that signs in to another account moves to it;
 * - row-level security: as `rebase_user`, a caller reads and deletes their own
 *   browsers and nobody else's, and cannot insert at all;
 * - `rebase.push.sendToUser` reaches every browser of that user, each with the
 *   payload written for its language, and a 404/410 from the push service
 *   deletes the row while a 500 keeps it;
 * - unsubscribing removes only the caller's own row.
 *
 * The push service is a recording sender (`push.sender`): what is under test
 * here is the server, not Google's or Apple's infrastructure. The encryption
 * and signing it would carry are pinned in `web-push-crypto.test.ts`.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import type { PushSender, PushTarget } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, rebase, generateVapidKeys, subscriptionIdOf, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "push-e2e-secret-that-is-long-enough-0123456789abcdef";
const SERVICE_KEY = "push-e2e-service-key-0123456789abcdef-0123456789";

/** A browser's keys: a real P-256 point and a 16-byte secret, as `toJSON()` gives them. */
function browserKeys(): { p256dh: string; auth: string } {
    return { p256dh: generateVapidKeys().publicKey, auth: Buffer.alloc(16, 7).toString("base64url") };
}

const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

describe("Web Push (E2E)", () => {
    let container: PgContainer;
    let db: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;
    const uid = { ada: "", bob: "" };
    const token = { ada: "", bob: "" };

    /** What the push service was handed, and what it answers per endpoint. */
    const delivered: Array<{ target: PushTarget; payload: Record<string, unknown>; options: unknown }> = [];
    const answers = new Map<string, number>();
    const sender: PushSender = {
        async send(target, payload, options) {
            delivered.push({ target, payload: JSON.parse(payload) as Record<string, unknown>, options });
            return { statusCode: answers.get(target.endpoint) ?? 201 };
        }
    };

    async function call(path: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}) {
        const response = await app.request(path, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json", ...headers },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        return { status: response.status, json: (text ? JSON.parse(text) : undefined) as Record<string, unknown> | undefined };
    }
    const bearer = (credential: string) => ({ Authorization: `Bearer ${credential}` });
    const subscribe = (who: string, name: string, lang?: string, keys = browserKeys()) =>
        call("/api/push/subscriptions", bearer(who), { method: "POST", body: { subscription: { endpoint: endpoint(name), keys }, lang } });

    async function rowsAs(user: string, sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
        await db.query("BEGIN");
        try {
            await db.query("SET LOCAL ROLE rebase_user");
            await db.query("SELECT set_config('app.uid', $1, true)", [user]);
            const result = await db.query(sql, params);
            await db.query("COMMIT");
            return result;
        } catch (error) {
            await db.query("ROLLBACK");
            throw error;
        }
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                db = new pg.Client({ connectionString: container.connectionString });
                await db.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            push: { vapid: { ...generateVapidKeys(), subject: "mailto:push-e2e@example.com" }, sender }
        });
        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        uid.ada = (await repo.createUser({ email: "ada@push.test", emailVerified: true })).id;
        uid.bob = (await repo.createUser({ email: "bob@push.test", emailVerified: true })).id;
        token.ada = await generateAccessToken(uid.ada, []);
        token.bob = await generateAccessToken(uid.bob, []);
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await db?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("serves the public key to a signed-in person only", async () => {
        expect((await call("/api/push/key", {})).status).toBe(401);
        const service = await call("/api/push/key", bearer(SERVICE_KEY));
        expect(service.status).toBe(403);
        expect((service.json?.error as { code?: string }).code).toBe("PUSH_NEEDS_A_USER");
        const signedIn = await call("/api/push/key", bearer(token.ada));
        expect(signedIn.status).toBe(200);
        expect(signedIn.json?.key).toBe(rebase.push.publicKey());
    });

    it("stores a subscription under the caller, keyed by the endpoint's hash", async () => {
        const { status, json } = await subscribe(token.ada, "ada-phone", "es");
        expect(status).toBe(200);
        expect(json?.id).toBe(subscriptionIdOf(endpoint("ada-phone")));
        const { rows } = await db.query("SELECT user_id, endpoint, lang FROM rebase.push_subscriptions WHERE id = $1", [json?.id]);
        expect(rows).toEqual([{ user_id: uid.ada, endpoint: endpoint("ada-phone"), lang: "es" }]);
    });

    it("refuses an endpoint that is not a push service, and keeps nothing", async () => {
        const { status, json } = await call("/api/push/subscriptions", bearer(token.ada), {
            method: "POST",
            body: { subscription: { endpoint: "https://169.254.169.254/latest/meta-data", keys: browserKeys() } }
        });
        expect(status).toBe(400);
        expect((json?.error as { code?: string }).code).toBe("PUSH_ENDPOINT_REFUSED");
        const { rows } = await db.query("SELECT count(*)::int AS n FROM rebase.push_subscriptions WHERE endpoint LIKE '%169.254%'");
        expect(rows[0].n).toBe(0);
    });

    it("moves a browser to the account that signs in on it", async () => {
        await subscribe(token.ada, "shared-laptop", "en");
        await subscribe(token.bob, "shared-laptop", "en");
        const { rows } = await db.query("SELECT user_id FROM rebase.push_subscriptions WHERE id = $1", [subscriptionIdOf(endpoint("shared-laptop"))]);
        expect(rows).toEqual([{ user_id: uid.bob }]);
    });

    it("lets a caller read and delete their own browsers under RLS, and nobody else's", async () => {
        const own = await rowsAs(uid.ada, "SELECT id FROM rebase.push_subscriptions");
        expect(own.rows.map(r => r.id)).toEqual([subscriptionIdOf(endpoint("ada-phone"))]);
        const theirs = await rowsAs(uid.ada, "DELETE FROM rebase.push_subscriptions WHERE user_id = $1 RETURNING id", [uid.bob]);
        expect(theirs.rowCount).toBe(0);
        await expect(rowsAs(uid.ada, "INSERT INTO rebase.push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES ('x', $1, 'e', 'p', 'a')", [uid.ada]))
            .rejects.toMatchObject({ code: "42501" });
    });

    it("sends to every browser of a user, each in its own language, and drops the ones that are gone", async () => {
        await subscribe(token.ada, "ada-laptop", "en");
        await subscribe(token.ada, "ada-old-tablet", "en");
        await subscribe(token.ada, "ada-flaky", "en");
        answers.set(endpoint("ada-old-tablet"), 410);
        answers.set(endpoint("ada-flaky"), 500);
        delivered.length = 0;

        const words: Record<string, string> = { en: "Your turn", es: "Te toca" };
        const result = await rebase.push.sendToUser(uid.ada, (s) => ({ title: words[s.lang ?? "en"] ?? words.en, url: "/play" }), {
            ttl: 600, urgency: "high", topic: "daily-go", tag: "daily-go"
        });

        expect(result).toEqual({ sent: 2, removed: 1, failed: 1 });
        const byEndpoint = Object.fromEntries(delivered.map(d => [d.target.endpoint, d]));
        expect(byEndpoint[endpoint("ada-phone")].payload).toEqual({ title: "Te toca", url: "/play", tag: "daily-go" });
        expect(byEndpoint[endpoint("ada-laptop")].payload).toEqual({ title: "Your turn", url: "/play", tag: "daily-go" });
        expect(byEndpoint[endpoint("ada-laptop")].options).toEqual({ ttl: 600, urgency: "high", topic: "daily-go" });
        expect(delivered.some(d => d.target.endpoint === endpoint("shared-laptop"))).toBe(false);

        const left = (await rebase.push.subscriptionsOf(uid.ada)).map(s => s.id).sort();
        expect(left).toEqual([endpoint("ada-phone"), endpoint("ada-laptop"), endpoint("ada-flaky")].map(subscriptionIdOf).sort());
        const sent = await rebase.push.subscriptionsOf(uid.ada);
        expect(sent.find(s => s.id === subscriptionIdOf(endpoint("ada-phone")))?.lastSentAt).toBeInstanceOf(Date);
        expect(sent.find(s => s.id === subscriptionIdOf(endpoint("ada-flaky")))?.lastSentAt).toBeNull();
    });

    it("sends to chosen subscriptions by id", async () => {
        delivered.length = 0;
        const result = await rebase.push.sendToSubscriptions([subscriptionIdOf(endpoint("ada-laptop")), "no-such-id"], { title: "Hi" });
        expect(result).toEqual({ sent: 1, removed: 0, failed: 0 });
        expect(delivered.map(d => d.target.endpoint)).toEqual([endpoint("ada-laptop")]);
    });

    it("unsubscribes only the caller's own browser", async () => {
        const notMine = await call("/api/push/subscriptions", bearer(token.bob), { method: "DELETE", body: { endpoint: endpoint("ada-laptop") } });
        expect(notMine.json).toEqual({ removed: false });
        const mine = await call("/api/push/subscriptions", bearer(token.ada), { method: "DELETE", body: { endpoint: endpoint("ada-laptop") } });
        expect(mine.json).toEqual({ removed: true });
        const { rows } = await db.query("SELECT count(*)::int AS n FROM rebase.push_subscriptions WHERE id = $1", [subscriptionIdOf(endpoint("ada-laptop"))]);
        expect(rows[0].n).toBe(0);
    });
});
