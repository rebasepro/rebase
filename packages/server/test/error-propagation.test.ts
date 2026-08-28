import { Hono } from "hono";
import { ApiError, errorHandler } from "../src/api/errors";
import { HonoEnv } from "../src/api/types";
import { createResetPasswordRoute } from "../src/auth/reset-password-admin";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

/**
 * End-to-end tests that verify ApiError thrown inside Hono sub-routers
 * produces the correct HTTP status code and JSON body WHEN the sub-router
 * is mounted on a parent app — exactly simulating the init.ts mounting
 * pattern.
 *
 * This is critical because Hono's `onError` does NOT propagate from parent
 * to child routers. Each sub-router must have its own `router.onError(errorHandler)`.
 */
describe("Error Propagation through Sub-Routers", () => {

    // ── Real routers carry their own onError ────────────────────────

    describe("Routers this package ships, mounted on a bare parent", () => {
        /*
         * This describe used to build a bare Hono app with no `onError` anywhere
         * and assert that Hono answers 500 with plain text. That is a fact about
         * Hono, upheld by Hono's own test suite; nothing in this package could
         * break it and nothing in this package was exercised by it.
         *
         * The invariant that IS ours is the one the comment above was reaching
         * for: because `onError` does not inherit downwards, every router we hand
         * to a consumer has to install `errorHandler` itself — the consumer's app
         * is not guaranteed to have one. So the parent here deliberately has no
         * handler, and a real router is asked to produce a real ApiError.
         */
        beforeAll(() => {
            configureJwt({ secret: "error-propagation-test-secret-at-least-32-chars",
accessExpiresIn: "1h" });
        });

        function mountOnBareParent(): Hono<HonoEnv> {
            const parentApp = new Hono<HonoEnv>();
            // NOTE: no parentApp.onError — this is the consumer's app, and it is
            // under no obligation to install ours.
            parentApp.route("/api/admin", createResetPasswordRoute({
                authRepo: {
                    // The uid in the test below is never found, so the route
                    // throws ApiError.notFound from inside the handler.
                    getUserById: async () => null,
                    getUserRoleIds: async () => ["admin"]
                } as unknown as AuthRepository
            }));
            return parentApp;
        }

        it("surfaces an ApiError as structured JSON with its own status", async () => {
            const app = mountOnBareParent();
            const adminToken = await generateAccessToken("admin-user", ["admin"]);

            const res = await app.request("/api/admin/users/missing-user/reset-password", {
                method: "POST",
                headers: { "Authorization": `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(404);
            const body = await res.json() as { error: { message: string; code: string } };
            expect(body.error.code).toBe("NOT_FOUND");
            expect(body.error.message).toBe("User not found");
        });
    });

    // ── With onError on sub-router (fixed behavior) ─────────────────

    describe("Sub-router WITH onError (correct behavior)", () => {
        function createFixedApp() {
            const parentApp = new Hono<HonoEnv>();
            parentApp.onError(errorHandler);

            const subRouter = new Hono<HonoEnv>();
            subRouter.onError(errorHandler); // ← THE FIX

            subRouter.get("/login", () => {
                throw ApiError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
            });
            subRouter.get("/register", () => {
                throw ApiError.conflict("Email already exists", "EMAIL_EXISTS");
            });
            subRouter.get("/refresh", () => {
                throw ApiError.unauthorized("Refresh token expired", "TOKEN_EXPIRED");
            });
            subRouter.get("/forbidden", () => {
                throw ApiError.forbidden("Admin only");
            });
            subRouter.get("/not-found", () => {
                throw ApiError.notFound("User not found");
            });
            subRouter.get("/bad-request", () => {
                throw ApiError.badRequest("Missing email", "INVALID_INPUT", { field: "email" });
            });
            subRouter.get("/service-unavailable", () => {
                throw ApiError.serviceUnavailable("Google login not configured", "NOT_CONFIGURED");
            });
            subRouter.get("/generic-error", () => {
                throw new Error("Unexpected failure");
            });

            parentApp.route("/api/auth", subRouter);
            return parentApp;
        }

        it("returns 401 for unauthorized errors", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/login");
            expect(res.status).toBe(401);
            const body = await res.json() as { error: { message: string; code: string } };
            expect(body.error.message).toBe("Invalid credentials");
            expect(body.error.code).toBe("INVALID_CREDENTIALS");
        });

        it("returns 409 for conflict errors", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/register");
            expect(res.status).toBe(409);
            const body = await res.json() as { error: { message: string; code: string } };
            expect(body.error.message).toBe("Email already exists");
            expect(body.error.code).toBe("EMAIL_EXISTS");
        });

        it("returns 401 for expired refresh token", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/refresh");
            expect(res.status).toBe(401);
            const body = await res.json() as { error: { message: string; code: string } };
            expect(body.error.code).toBe("TOKEN_EXPIRED");
        });

        it("returns 403 for forbidden errors", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/forbidden");
            expect(res.status).toBe(403);
        });

        it("returns 404 for not found errors", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/not-found");
            expect(res.status).toBe(404);
        });

        it("returns 400 with details for bad request errors", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/bad-request");
            expect(res.status).toBe(400);
            const body = await res.json() as { error: { message: string; code: string; details: unknown } };
            expect(body.error.code).toBe("INVALID_INPUT");
            expect(body.error.details).toEqual({ field: "email" });
        });

        it("returns 503 for service unavailable errors", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/service-unavailable");
            expect(res.status).toBe(503);
            const body = await res.json() as { error: { message: string; code: string } };
            expect(body.error.code).toBe("NOT_CONFIGURED");
        });

        it("returns 500 with sanitized message for generic errors", async () => {
            const app = createFixedApp();
            const res = await app.request("/api/auth/generic-error");
            expect(res.status).toBe(500);
            const body = await res.json() as { error: { message: string; code: string } };
            expect(body.error.code).toBe("INTERNAL_ERROR");
            // Should NOT leak the raw error message
            expect(body.error.message).toBe("Internal Server Error");
        });

        it("returns consistent { error: { message, code } } shape for all error types", async () => {
            const app = createFixedApp();
            const paths = ["/api/auth/login", "/api/auth/register", "/api/auth/forbidden", "/api/auth/not-found", "/api/auth/bad-request"];

            for (const path of paths) {
                const res = await app.request(path);
                const body = await res.json() as Record<string, unknown>;
                expect(body).toHaveProperty("error");
                expect(body.error).toHaveProperty("message");
                expect(body.error).toHaveProperty("code");
            }
        });
    });

    // ── Multi-level nesting ─────────────────────────────────────────

    describe("Deeply nested sub-routers", () => {
        it("error handler works through two levels of nesting", async () => {
            const root = new Hono<HonoEnv>();
            root.onError(errorHandler);

            const level1 = new Hono<HonoEnv>();
            level1.onError(errorHandler);

            const level2 = new Hono<HonoEnv>();
            level2.onError(errorHandler);

            level2.get("/deep", () => {
                throw ApiError.unauthorized("Deep error");
            });

            level1.route("/nested", level2);
            root.route("/api", level1);

            const res = await root.request("/api/nested/deep");
            expect(res.status).toBe(401);
            const body = await res.json() as { error: { message: string } };
            expect(body.error.message).toBe("Deep error");
        });
    });

    // ── Data router simulation ──────────────────────────────────────

    describe("Data router error propagation (simulates init.ts pattern)", () => {
        function createDataApp() {
            const app = new Hono<HonoEnv>();
            app.onError(errorHandler);

            const dataRouter = new Hono<HonoEnv>();
            dataRouter.onError(errorHandler);

            dataRouter.get("/posts/:id", () => {
                throw ApiError.notFound("Entity not found");
            });
            dataRouter.post("/posts", () => {
                throw ApiError.badRequest("Validation failed", "INVALID_INPUT");
            });

            app.route("/api/data", dataRouter);
            return app;
        }

        it("returns 404 for entity not found", async () => {
            const app = createDataApp();
            const res = await app.request("/api/data/posts/999");
            expect(res.status).toBe(404);
        });

        it("returns 400 for validation errors", async () => {
            const app = createDataApp();
            const res = await app.request("/api/data/posts", { method: "POST" });
            expect(res.status).toBe(400);
        });
    });
});
