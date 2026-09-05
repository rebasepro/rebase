import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono, Context } from "hono";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { requireAuth, optionalAuth, requireAdmin, createAuthMiddleware, createRequireAuth } from "../src/auth/middleware";
import type { HonoEnv } from "../src/api/types";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import { ANONYMOUS_USER_ID } from "@rebasepro/types";

const TEST_SECRET = "test-secret-key-for-hono-middleware-testing-1234567890";

describe("Auth Middleware (Hono)", () => {

    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    // ── requireAuth ─────────────────────────────────────────
    describe("requireAuth", () => {
        function createApp() {
            const app = new Hono<HonoEnv>();
            app.use("/protected/*", requireAuth);
            app.get("/protected/resource", (c: Context<HonoEnv>) => {
                const user = c.get("user");
                return c.json({ user });
            });
            return app;
        }

        it("passes with valid Bearer token", async () => {
            const app = createApp();
            const token = await generateAccessToken("user-1", ["admin"]);
            const res = await app.request("/protected/resource", {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.uid).toBe("user-1");
            expect(body.user.roles).toEqual(["admin"]);
        });

        it("returns 401 for missing Authorization header", async () => {
            const app = createApp();
            const res = await app.request("/protected/resource");
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("UNAUTHORIZED");
        });

        /**
         * The refusal is formatted by `errorHandler`, not written by hand.
         *
         * Seven near-copies of `c.json({ error: { message, code } }, 401)` used
         * to live in this file's subject, and they had all drifted from the
         * envelope every other error on the server uses: no `requestId`, so a
         * bug report about the error an app hits most could not quote the one
         * string that finds the server-side line. The handler is *called*
         * rather than thrown to, because these middlewares are mounted by
         * callers this package does not control — `defineFunction` hands users
         * a Hono app — and a throw with no `onError` at the mount point is a
         * 500 where a 401 was meant.
         */
        it("answers the canonical envelope, requestId included", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", async (c, next) => { c.set("requestId", "req-abc"); await next(); });
            app.use("/protected/*", requireAuth);
            app.get("/protected/resource", (c) => c.json({ ok: true }));

            const res = await app.request("/protected/resource");
            const body = await res.json() as any;

            expect(res.status).toBe(401);
            expect(Object.keys(body)).toEqual(["error"]);
            expect(body.error.code).toBe("UNAUTHORIZED");
            expect(body.error.requestId).toBe("req-abc");
            expect(body.error).not.toHaveProperty("status");
        });

        it("returns 401 for non-Bearer prefix", async () => {
            const app = createApp();
            const res = await app.request("/protected/resource", {
                headers: { Authorization: "Basic abc123" }
            });
            expect(res.status).toBe(401);
        });

        it("returns 401 for invalid/expired token", async () => {
            const app = createApp();
            const res = await app.request("/protected/resource", {
                headers: { Authorization: "Bearer invalid.token.here" }
            });
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("UNAUTHORIZED");
        });

        it("accepts token via query parameter (with queryTokenAuth)", async () => {
            const { queryTokenAuth } = await import("../src/auth/middleware");
            const app = new Hono<HonoEnv>();
            app.use("/protected/*", queryTokenAuth, requireAuth);
            app.get("/protected/resource", (c: Context<HonoEnv>) => {
                const user = c.get("user");
                return c.json({ user });
            });
            const token = await generateAccessToken("user-2", ["editor"]);
            const res = await app.request(`/protected/resource?token=${token}`);
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.uid).toBe("user-2");
        });

        it("prefers Bearer token over query parameter", async () => {
            const { queryTokenAuth } = await import("../src/auth/middleware");
            const app = new Hono<HonoEnv>();
            app.use("/protected/*", queryTokenAuth, requireAuth);
            app.get("/protected/resource", (c: Context<HonoEnv>) => {
                const user = c.get("user");
                return c.json({ user });
            });
            const bearerToken = await generateAccessToken("bearer-user", ["admin"]);
            const queryToken = await generateAccessToken("query-user", ["viewer"]);
            const res = await app.request(`/protected/resource?token=${queryToken}`, {
                headers: { Authorization: `Bearer ${bearerToken}` }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.uid).toBe("bearer-user");
        });
    });

    // ── requireAdmin ────────────────────────────────────────
    describe("requireAdmin", () => {
        function createApp() {
            const app = new Hono<HonoEnv>();
            app.use("/admin/*", requireAuth, requireAdmin);
            app.get("/admin/dashboard", (c: Context<HonoEnv>) => c.json({ ok: true }));
            return app;
        }

        it("allows admin users", async () => {
            const app = createApp();
            const token = await generateAccessToken("admin-1", ["admin"]);
            const res = await app.request("/admin/dashboard", {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(res.status).toBe(200);
        });

        it("allows schema-admin users", async () => {
            const app = createApp();
            const token = await generateAccessToken("schema-admin-1", ["schema-admin"]);
            const res = await app.request("/admin/dashboard", {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(res.status).toBe(200);
        });

        it("returns 403 for non-admin users", async () => {
            const app = createApp();
            const token = await generateAccessToken("user-1", ["editor"]);
            const res = await app.request("/admin/dashboard", {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.error.code).toBe("FORBIDDEN");
        });

        it("returns 401 when requireAdmin is used without requireAuth", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/admin/*", requireAdmin);
            app.get("/admin/dashboard", (c: Context<HonoEnv>) => c.json({ ok: true }));

            const res = await app.request("/admin/dashboard");
            expect(res.status).toBe(401);
        });
    });

    // ── optionalAuth ────────────────────────────────────────
    describe("optionalAuth", () => {
        function createApp() {
            const app = new Hono<HonoEnv>();
            app.use("/public/*", optionalAuth);
            app.get("/public/feed", (c: Context<HonoEnv>) => {
                const user = c.get("user");
                return c.json({ authenticated: !!user,
user: user ?? null });
            });
            return app;
        }

        it("sets user when valid token is present", async () => {
            const app = createApp();
            const token = await generateAccessToken("opt-user", ["viewer"]);
            const res = await app.request("/public/feed", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json() as any;
            expect(res.status).toBe(200);
            expect(body.authenticated).toBe(true);
            expect(body.user.uid).toBe("opt-user");
        });

        it("proceeds without user when no token", async () => {
            const app = createApp();
            const res = await app.request("/public/feed");
            const body = await res.json() as any;
            expect(res.status).toBe(200);
            expect(body.authenticated).toBe(false);
            expect(body.user).toBeNull();
        });

        it("proceeds without user when token is invalid", async () => {
            const app = createApp();
            const res = await app.request("/public/feed", {
                headers: { Authorization: "Bearer garbage.token.value" }
            });
            const body = await res.json() as any;
            expect(res.status).toBe(200);
            expect(body.authenticated).toBe(false);
        });
    });

    // ── createAuthMiddleware ────────────────────────────────
    describe("createAuthMiddleware", () => {
        const mockDriver: DataDriver = {
            fetchCollection: jest.fn() as any,
            fetchOne: jest.fn() as any,
            save: jest.fn() as any,
            delete: jest.fn() as any
        };

        it("sets driver in context (requireAuth: false)", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({ driver: mockDriver,
requireAuth: false }));
            app.get("/test", (c) => {
                const driver = c.get("driver");
                return c.json({ hasDriver: !!driver });
            });

            const res = await app.request("/test");
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.hasDriver).toBe(true);
        });

        it("enforces auth by default (requireAuth defaults to true)", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({ driver: mockDriver }));
            app.get("/test", (c) => c.json({ ok: true }));

            const res = await app.request("/test");
            expect(res.status).toBe(401);
        });

        it("enforces auth when requireAuth is true", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({ driver: mockDriver,
requireAuth: true }));
            app.get("/test", (c) => c.json({ ok: true }));

            const res = await app.request("/test");
            expect(res.status).toBe(401);
        });

        it("allows anonymous when requireAuth is false", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({ driver: mockDriver,
requireAuth: false }));
            app.get("/test", (c) => c.json({ ok: true }));

            const res = await app.request("/test");
            expect(res.status).toBe(200);
        });

        it("extracts JWT and sets user in context", async () => {
            const app = new Hono<HonoEnv>();
            // Default requireAuth=true, but providing a valid token satisfies it
            app.use("/*", createAuthMiddleware({ driver: mockDriver }));
            app.get("/test", (c) => {
                const user = c.get("user");
                return c.json({ user });
            });

            const token = await generateAccessToken("jwt-user", ["admin"]);
            const res = await app.request("/test", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json() as any;
            expect(body.user.uid).toBe("jwt-user");
            expect(body.user.roles).toEqual(["admin"]);
        });

        it("rejects invalid tokens even with requireAuth: false (fail closed)", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({ driver: mockDriver,
requireAuth: false }));
            app.get("/test", (c) => c.json({ ok: true }));

            const res = await app.request("/test", {
                headers: { Authorization: "Bearer invalid.garbage.token" }
            });
            expect(res.status).toBe(401);
            const body = await res.json() as any;
            expect(body.error.code).toBe("UNAUTHORIZED");
        });

        it("uses custom validator when provided", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: mockDriver,
                validator: async (c: Context<HonoEnv>) => {
                    const apiKey = c.req.header("x-api-key");
                    if (apiKey === "valid-key") {
                        return { uid: "api-user",
roles: ["api"] };
                    }
                    return false;
                }
            }));
            app.get("/test", (c) => {
                const user = c.get("user");
                return c.json({ user: user ?? null });
            });

            // Valid API key
            const res = await app.request("/test", {
                headers: { "x-api-key": "valid-key" }
            });
            const body = await res.json() as any;
            expect(body.user.uid).toBe("api-user");

            // Invalid API key — requireAuth not set, defaults to true,
            // so unauthenticated requests are rejected
            const res2 = await app.request("/test", {
                headers: { "x-api-key": "bad-key" }
            });
            expect(res2.status).toBe(401); // Secure by default
        });

        it("returns 401 when custom validator throws", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: mockDriver,
                validator: async () => { throw new Error("auth failed"); }
            }));
            app.get("/test", (c) => c.json({ ok: true }));

            const res = await app.request("/test");
            expect(res.status).toBe(401);
        });

        it("scopes an unauthenticated request as ANONYMOUS_USER_ID, the id policies exclude", async () => {
            // The whole point. This middleware used to scope anonymous callers
            // as `'anon'` while `policy.authenticated()` compiled to
            // `auth.uid() <> 'anonymous'` — so the sanctioned way to write
            // "signed in" was true for every signed-out visitor, and rebase's
            // own linter flagged the one spelling that actually worked.
            // Whatever this passes to withAuth becomes `auth.uid()` in Postgres.
            const driverWithAuth = {
                ...mockDriver,
                withAuth: jest.fn().mockResolvedValue({ ...mockDriver })
            };

            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({ driver: driverWithAuth as any, requireAuth: false }));
            app.get("/test", (c) => c.json({ ok: true }));

            await app.request("/test");

            expect(driverWithAuth.withAuth).toHaveBeenCalledWith(
                expect.objectContaining({ uid: ANONYMOUS_USER_ID })
            );
            const scopedAs = driverWithAuth.withAuth.mock.calls[0][0] as { uid: string };
            expect(scopedAs.uid).not.toBe("anon");
        });

        it("calls withAuth on driver when available", async () => {
            const scopedDriver = { ...mockDriver,
isScopedDriver: true };
            const driverWithAuth = {
                ...mockDriver,
                withAuth: jest.fn().mockResolvedValue(scopedDriver)
            };

            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({ driver: driverWithAuth as any }));
            app.get("/test", (c) => {
                const driver = c.get("driver") as any;
                return c.json({ scoped: !!driver?.isScopedDriver });
            });

            const token = await generateAccessToken("rls-user", ["editor"]);
            const res = await app.request("/test", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json() as any;
            expect(body.scoped).toBe(true);
            expect(driverWithAuth.withAuth).toHaveBeenCalledWith(
                expect.objectContaining({ uid: "rls-user",
roles: ["editor"] })
            );
        });

        it("handles validator returning true (default user)", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: mockDriver,
                requireAuth: false, // Explicit opt-out for this test
                validator: async () => true
            }));
            app.get("/test", (c) => {
                const user = c.get("user");
                return c.json({ user });
            });

            const res = await app.request("/test");
            const body = await res.json() as any;
            expect(body.user.uid).toBe("default");
        });
    });

    describe("Service Key Authentication", () => {
        const SERVICE_KEY = "a-very-secure-service-key-that-is-at-least-32-characters-long";
        const mockDriver: DataDriver = {
            fetchCollection: jest.fn() as any,
            fetchOne: jest.fn() as any,
            save: jest.fn() as any,
            delete: jest.fn() as any
        };

        it("grants admin access when Bearer token matches the service key", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: mockDriver,
                requireAuth: true,
                serviceKey: SERVICE_KEY
            }));
            app.get("/test", (c) => {
                const user = c.get("user");
                return c.json({ user });
            });

            const res = await app.request("/test", {
                headers: { Authorization: `Bearer ${SERVICE_KEY}` }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.uid).toBe("service");
            expect(body.user.roles).toEqual(["admin"]);
        });

        it("rejects when Bearer token does not match the service key", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: mockDriver,
                requireAuth: true,
                serviceKey: SERVICE_KEY
            }));
            app.get("/test", (c) => c.json({ ok: true }));

            const res = await app.request("/test", {
                headers: { Authorization: "Bearer wrong-key-that-is-definitely-not-correct" }
            });
            // Wrong key is not a valid service key, and also not a valid JWT → 401
            expect(res.status).toBe(401);
        });

        it("still accepts valid JWT tokens when service key is configured", async () => {
            const token = await generateAccessToken("jwt-user", ["editor"]);
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: mockDriver,
                requireAuth: true,
                serviceKey: SERVICE_KEY
            }));
            app.get("/test", (c) => {
                const user = c.get("user");
                return c.json({ user });
            });

            const res = await app.request("/test", {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.user.uid).toBe("jwt-user");
            expect(body.user.roles).toEqual(["editor"]);
        });

        it("scopes driver via withAuth with service identity", async () => {
            const scopedDriver = { scoped: true } as unknown as DataDriver;
            const driverWithAuth = {
                withAuth: jest.fn().mockResolvedValue(scopedDriver)
            } as unknown as DataDriver;

            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: driverWithAuth,
                requireAuth: true,
                serviceKey: SERVICE_KEY
            }));
            app.get("/test", (c) => {
                const d = c.get("driver") as any;
                return c.json({ scoped: d.scoped });
            });

            const res = await app.request("/test", {
                headers: { Authorization: `Bearer ${SERVICE_KEY}` }
            });
            const body = await res.json() as any;
            expect(body.scoped).toBe(true);
            expect((driverWithAuth as any).withAuth).toHaveBeenCalledWith(
                expect.objectContaining({ uid: "service",
roles: ["admin"] })
            );
        });

        it("does not activate service key path when no serviceKey is configured", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createAuthMiddleware({
                driver: mockDriver,
                requireAuth: true
                // No serviceKey configured
            }));
            app.get("/test", (c) => c.json({ ok: true }));

            // Sending a random string should fail as invalid JWT
            const res = await app.request("/test", {
                headers: { Authorization: `Bearer ${SERVICE_KEY}` }
            });
            expect(res.status).toBe(401);
        });
    });

    // ── createRequireAuth (standalone factory) ──────────────
    describe("createRequireAuth", () => {
        const SERVICE_KEY = "a-very-secure-service-key-that-is-at-least-32-characters-long";
        it("returns the default requireAuth when no serviceKey is provided", async () => {
            const middleware = createRequireAuth();
            // The returned function should be the original requireAuth
            expect(middleware).toBe(requireAuth);
        });

        it("returns the default requireAuth when serviceKey is undefined", async () => {
            const middleware = createRequireAuth({ serviceKey: undefined });
            expect(middleware).toBe(requireAuth);
        });

        it("authenticates with a valid service key", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }));
            app.get("/admin/users", (c) => {
                const user = c.get("user");
                return c.json({ uid: user?.uid,
roles: user?.roles });
            });

            const res = await app.request("/admin/users", {
                headers: { Authorization: `Bearer ${SERVICE_KEY}` }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.uid).toBe("service");
            expect(body.roles).toEqual(["admin"]);
        });

        it("rejects an incorrect service key and falls back to JWT (which also fails)", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }));
            app.get("/admin/users", (c) => c.json({ ok: true }));

            const res = await app.request("/admin/users", {
                headers: { Authorization: "Bearer wrong-key" }
            });
            expect(res.status).toBe(401);
        });

        it("falls back to valid JWT when service key doesn't match", async () => {
            const token = await generateAccessToken("user-123", ["admin"]);
            const app = new Hono<HonoEnv>();
            app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }));
            app.get("/admin/users", (c) => {
                const user = c.get("user");
                return c.json({ uid: user?.uid,
roles: user?.roles });
            });

            const res = await app.request("/admin/users", {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.uid).toBe("user-123");
            expect(body.roles).toEqual(["admin"]);
        });

        it("returns 401 when no authorization header is provided", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }));
            app.get("/admin/users", (c) => c.json({ ok: true }));

            const res = await app.request("/admin/users");
            expect(res.status).toBe(401);
        });

        it("works with requireAdmin for service key (admin role is granted)", async () => {
            const app = new Hono<HonoEnv>();
            app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }));
            app.get("/admin/users", requireAdmin, (c) => {
                return c.json({ authorized: true });
            });

            const res = await app.request("/admin/users", {
                headers: { Authorization: `Bearer ${SERVICE_KEY}` }
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.authorized).toBe(true);
        });
    });
});
