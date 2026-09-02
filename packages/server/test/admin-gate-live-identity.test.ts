import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createRequireAuth, requireAdmin } from "../src/auth/middleware";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import type { AuthRepository } from "../src/auth/interfaces";

const TEST_SECRET = "test-secret-key-for-admin-gate-live-identity-123456";

/**
 * What an administrative gate has to re-read on every request.
 *
 * `requireAdmin` reads `roles` out of the access token, and that token was
 * minted up to an hour ago — so a demotion, a sign-out-everywhere or a password
 * reset are all invisible to it. The user-management routers close that by
 * asking the database per request; the gate in front of backups, cron, logs,
 * the schema editors, the RLS audit and the API-key router did not, which is to
 * say it did not on the surfaces worth the most.
 */
describe("the admin gate's live identity checks", () => {
    beforeAll(() => configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" }));

    function repoWith(opts: {
        roles?: Record<string, string[]>;
        validAfter?: Record<string, Date | null>;
    }) {
        return {
            getUserRoleIds: jest.fn(async (uid: string) => opts.roles?.[uid] ?? []),
            getTokensValidAfter: jest.fn(async (uid: string) => opts.validAfter?.[uid] ?? null)
        } as unknown as AuthRepository;
    }

    /** A router gated exactly as `applyAdminGate` gates one. */
    function gatedApp(repo: AuthRepository, serviceKey = "service-key-that-is-long-enough-0123") {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createRequireAuth({
            serviceKey,
            resolveRoles: uid => repo.getUserRoleIds(uid),
            revocationRepo: repo
        }), requireAdmin);
        app.get("/dump", c => c.json({ ok: true }));
        return app;
    }

    it("refuses a token that still claims admin for a user who no longer is", async () => {
        const repo = repoWith({ roles: { "demoted-1": ["editor"] } });
        const token = await generateAccessToken("demoted-1", ["admin"]);

        const res = await gatedApp(repo).request("/dump", {
            headers: { authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(403);
    });

    /**
     * Signing out everywhere writes a watermark. Until now the data plane
     * honoured it and the backup dump did not — so the token the victim had
     * just invalidated kept downloading their database for up to an hour.
     */
    it("refuses a token issued before the user signed out everywhere", async () => {
        const repo = repoWith({
            roles: { "admin-1": ["admin"] },
            validAfter: { "admin-1": new Date(Date.now() + 60_000) }
        });
        const token = await generateAccessToken("admin-1", ["admin"]);

        const res = await gatedApp(repo).request("/dump", {
            headers: { authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(401);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SESSION_REVOKED");
    });

    it("still admits a current admin", async () => {
        const repo = repoWith({ roles: { "admin-1": ["admin"] } });
        const token = await generateAccessToken("admin-1", ["admin"]);

        const res = await gatedApp(repo).request("/dump", {
            headers: { authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(200);
    });

    it("still admits the service key, which has no user to look up", async () => {
        const repo = repoWith({});
        const key = "service-key-that-is-long-enough-0123";

        const res = await gatedApp(repo, key).request("/dump", {
            headers: { authorization: `Bearer ${key}` }
        });

        expect(res.status).toBe(200);
        expect(repo.getUserRoleIds).not.toHaveBeenCalled();
    });

    /**
     * Keyed on the service key alone, the factory returned the plain
     * `requireAuth` and dropped both checks — so a caller that wired them
     * without a service key read as protected and behaved as if it were not.
     */
    it("honours the checks even when no service key was configured", async () => {
        const repo = repoWith({ roles: { "demoted-1": ["editor"] } });
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createRequireAuth({
            resolveRoles: uid => repo.getUserRoleIds(uid),
            revocationRepo: repo
        }), requireAdmin);
        app.get("/dump", c => c.json({ ok: true }));

        const token = await generateAccessToken("demoted-1", ["admin"]);
        const res = await app.request("/dump", { headers: { authorization: `Bearer ${token}` } });

        expect(res.status).toBe(403);
    });

    /** The token's claim is exactly what must not be trusted, so a failed lookup denies. */
    it("fails closed when the role lookup errors", async () => {
        const repo = {
            getUserRoleIds: jest.fn(async () => { throw new Error("connection refused"); }),
            getTokensValidAfter: jest.fn(async () => null)
        } as unknown as AuthRepository;
        const token = await generateAccessToken("admin-1", ["admin"]);

        const res = await gatedApp(repo).request("/dump", {
            headers: { authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(503);
    });
});
