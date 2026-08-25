/**
 * The development mailbox over HTTP, and the gates on it.
 *
 * Captured auth mail contains a working magic link and a working password-reset
 * token — a login, in other words. Printing those to a log was already a
 * deliberate trade; serving them over HTTP widens who can ask for them from
 * "whoever can read stdout" to "whoever can make a request", so the gates are
 * the point of this file, not the feature.
 *
 * Three of them, and each is tested for independently, because a feature
 * defended once is a feature defended until somebody edits that one line:
 *
 *  1. admin-only, through the same gate cron and backups use;
 *  2. a sink must be registered, which the boot path only does without SMTP;
 *  3. `NODE_ENV=production` refuses at request time regardless of the above.
 */
import { describe, expect, it, afterEach, beforeEach, jest } from "@jest/globals";
import { Hono } from "hono";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";
import {
    createDevEmailSink,
    registerDevEmailSink,
    activeDevEmailSink,
    clearActiveDevEmailSink
} from "../src/email/dev-sink";

const JWT_SECRET = "dev-mailbox-route-test-secret-1234567890";
const CRONS_DIR = path.join(__dirname, "fixtures", "crons");

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return {
            driver: {
                fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
                fetchEntity: async () => undefined,
                saveEntity: async () => ({}),
                deleteEntity: async () => undefined,
                countCollection: async () => 0,
                checkUniqueField: async () => true,
                healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
                admin: { executeSql: async () => [] }
            },
            collections: [],
            internals: {}
        } as unknown as InitializedDriver;
    },
    async initializeAuth() {
        // `/api/admin/*` passes through the auth adapter's own gate before it
        // reaches any router mounted under it, and that gate re-reads roles from
        // the repository rather than trusting the token — so a stub without
        // `getUserRoleIds` answers 503 to every authenticated admin request, on
        // every admin surface, not just this one.
        return {
            userService: {},
            authRepository: {
                getUserRoleIds: async (uid: string) => (uid.startsWith("admin") ? ["admin"] : ["editor"]),
                getTokensValidAfter: async () => null
            }
        };
    }
} as unknown as BackendBootstrapper;

type Boot = { app: Hono; stop: () => void };
const started: Boot[] = [];

async function boot(): Promise<Hono> {
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("jobs")],
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        auth: { requireAuth: false, jwtSecret: JWT_SECRET }
    } as never);
    started.push({
        app,
        stop: () => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.()
    });
    return app;
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const adminToken = () => generateAccessToken("admin-1", ["admin"]);

/** A sink holding one message that looks like a real magic-link mail. */
function sinkWithOneMessage() {
    const sink = createDevEmailSink();
    return sink.sendEmail({
        to: "someone@example.com",
        subject: "Sign in to Rebase",
        html: '<a href="http://localhost:5173/magic?token=abc">Sign in</a>'
    }).then(() => sink);
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
    clearActiveDevEmailSink();
});

afterEach(() => {
    while (started.length) started.pop()!.stop();
    clearActiveDevEmailSink();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    jest.restoreAllMocks();
});

describe("GET /api/admin/dev/emails", () => {
    it("serves what the sink captured, links included", async () => {
        registerDevEmailSink(await sinkWithOneMessage());
        const app = await boot();

        const response = await app.request("/api/admin/dev/emails", bearer(adminToken()));
        expect(response.status).toBe(200);

        const body = await response.json() as {
            enabled: boolean;
            messages: Array<{ subject: string; to: string; links: string[] }>;
        };
        expect(body.enabled).toBe(true);
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].subject).toBe("Sign in to Rebase");
        expect(body.messages[0].to).toBe("someone@example.com");
        // The link is the entire reason this route exists.
        expect(body.messages[0].links).toEqual(["http://localhost:5173/magic?token=abc"]);
    });

    it("answers 401 to an unauthenticated request", async () => {
        registerDevEmailSink(await sinkWithOneMessage());
        const app = await boot();

        expect((await app.request("/api/admin/dev/emails")).status).toBe(401);
    });

    it("answers 403 to a signed-in non-admin", async () => {
        registerDevEmailSink(await sinkWithOneMessage());
        const app = await boot();
        const token = generateAccessToken("editor-1", ["editor"]);

        expect((await app.request("/api/admin/dev/emails", bearer(token))).status).toBe(403);
    });

    it("says why rather than 404ing when no sink is registered", async () => {
        // A configured SMTP host is the ordinary case here: mail was delivered,
        // so there is nothing to show. A 404 on a route the panel just called
        // reads as a broken deploy and gets debugged as one.
        const app = await boot();

        const response = await app.request("/api/admin/dev/emails", bearer(adminToken()));
        expect(response.status).toBe(501);
        expect((await response.json() as { error: { code: string } }).error.code)
            .toBe("DEV_MAILBOX_UNAVAILABLE");
    });

    it("refuses in production even when a sink was registered before NODE_ENV was set", async () => {
        // The second gate — `registerDevEmailSink` — cannot help here: it ran
        // while this was still a development process. Only the request-time
        // check stands between a production admin and a live reset token.
        registerDevEmailSink(await sinkWithOneMessage());
        const app = await boot();
        process.env.NODE_ENV = "production";

        const response = await app.request("/api/admin/dev/emails", bearer(adminToken()));
        expect(response.status).toBe(501);
    });
});

describe("DELETE /api/admin/dev/emails", () => {
    it("empties the mailbox", async () => {
        const sink = registerDevEmailSink(await sinkWithOneMessage());
        const app = await boot();

        expect((await app.request("/api/admin/dev/emails", { method: "DELETE", ...bearer(adminToken()) })).status)
            .toBe(200);
        expect(sink.list()).toHaveLength(0);
    });

    it("is admin-gated like the read", async () => {
        registerDevEmailSink(await sinkWithOneMessage());
        const app = await boot();

        expect((await app.request("/api/admin/dev/emails", { method: "DELETE" })).status).toBe(401);
    });
});

describe("registerDevEmailSink", () => {
    it("registers nothing under NODE_ENV=production, and still returns the sink", async () => {
        process.env.NODE_ENV = "production";
        const sink = createDevEmailSink();

        expect(registerDevEmailSink(sink)).toBe(sink);
        expect(activeDevEmailSink()).toBeUndefined();
    });

    it("hides an already-registered sink once the process is production", async () => {
        registerDevEmailSink(createDevEmailSink());
        expect(activeDevEmailSink()).toBeDefined();

        process.env.NODE_ENV = "production";
        expect(activeDevEmailSink()).toBeUndefined();
    });
});
