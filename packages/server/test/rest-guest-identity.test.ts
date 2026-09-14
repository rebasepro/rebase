import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, DataDriver } from "@rebasepro/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAuthMiddleware } from "../src/auth/middleware";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import type { HonoEnv } from "../src/api/types";

/**
 * REST scopes a guest as a guest.
 *
 * Anonymous sign-in mints a real user with a real uid, so the one thing that
 * tells a guest from an account is `isAnonymous`, and `policy.registered()`
 * reads it. Both REST middlewares hand it to `withAuth`. The WebSocket servers
 * and the Mongo realtime service did not, which is what
 * `packages/server-mongo/test/guest-identity-e2e.test.ts` and
 * `packages/server-postgres/test/e2e/socket-guest-identity-e2e.test.ts` cover;
 * this pins the door that was right, so it stays the reference.
 */

/** A driver that records the identity every request scoped it to. */
function recordingDriver() {
    const scopedAs: Record<string, unknown>[] = [];
    const driver = {
        key: "recording",
        initialised: true,
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        withAuth: async (user: Record<string, unknown>) => {
            scopedAs.push(user);
            return driver;
        }
    } as unknown as DataDriver;
    return { driver, scopedAs };
}

function appWith(middleware: ReturnType<typeof createAuthMiddleware>) {
    const app = new Hono<HonoEnv>();
    app.use("/*", middleware);
    app.get("/data", (c) => c.json({ ok: true }));
    return app;
}

describe("REST scopes a guest as a guest", () => {
    beforeAll(() => {
        configureJwt({ secret: "rest-guest-identity-secret-0123456789abcdef", accessExpiresIn: "1h" });
    });

    it("hands withAuth the guest flag from the platform's own token", async () => {
        const { driver, scopedAs } = recordingDriver();
        const token = await generateAccessToken("guest-7", [], "aal1", undefined, true);

        const res = await appWith(createAuthMiddleware({ driver })).request("/data", {
            headers: { Authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(200);
        expect(scopedAs).toEqual([expect.objectContaining({ uid: "guest-7", isAnonymous: true })]);
    });

    it("hands withAuth an account as an account", async () => {
        const { driver, scopedAs } = recordingDriver();
        const token = await generateAccessToken("member-1", []);

        await appWith(createAuthMiddleware({ driver })).request("/data", {
            headers: { Authorization: `Bearer ${token}` }
        });

        expect(scopedAs).toEqual([expect.objectContaining({ uid: "member-1", isAnonymous: false })]);
    });

    it("hands withAuth the guest flag from an auth adapter", async () => {
        const { driver, scopedAs } = recordingDriver();
        const adapter = {
            verifyRequest: async () => ({ uid: "guest-7", email: "", roles: [], isAdmin: false, isAnonymous: true })
        } as unknown as AuthAdapter;

        const res = await appWith(createAdapterAuthMiddleware({ adapter, driver })).request("/data");

        expect(res.status).toBe(200);
        expect(scopedAs).toEqual([expect.objectContaining({ uid: "guest-7", isAnonymous: true })]);
    });
});
