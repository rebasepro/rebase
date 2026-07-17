import { Hono } from "hono";
import { ApiError, errorHandler } from "../src/api/errors";
import { HonoEnv } from "../src/api/types";

describe("Error Handler (Hono)", () => {
    function createApp() {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);

        // Test routes that throw different errors
        app.get("/bad-request", () => {
            throw ApiError.badRequest("Missing required field", "MISSING_FIELD", { field: "email" });
        });
        app.get("/unauthorized", () => {
            throw ApiError.unauthorized("Token expired", "TOKEN_EXPIRED");
        });
        app.get("/forbidden", () => {
            throw ApiError.forbidden("Admin only", "FORBIDDEN");
        });
        app.get("/not-found", () => {
            throw ApiError.notFound("Entity not found");
        });
        app.get("/conflict", () => {
            throw ApiError.conflict("Email already exists", "EMAIL_EXISTS");
        });
        app.get("/internal", () => {
            throw ApiError.internal("Database connection failed");
        });
        app.get("/service-unavailable", () => {
            throw ApiError.serviceUnavailable("Feature not configured");
        });
        app.get("/generic-error", () => {
            throw new Error("Something went wrong");
        });
        app.get("/error-with-code", () => {
            const err = new Error("Rate limited") as Error & { code: string };
            err.code = "RATE_LIMITED";
            throw err;
        });

        return app;
    }

    it("formats ApiError with correct status and body structure", async () => {
        const app = createApp();
        const res = await app.request("/bad-request");
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error.message).toBe("Missing required field");
        expect(body.error.code).toBe("MISSING_FIELD");
        expect(body.error.details).toEqual({ field: "email" });
    });

    it("handles 401 Unauthorized", async () => {
        const app = createApp();
        const res = await app.request("/unauthorized");
        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.error.code).toBe("TOKEN_EXPIRED");
    });

    it("handles 403 Forbidden", async () => {
        const app = createApp();
        const res = await app.request("/forbidden");
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.error.code).toBe("FORBIDDEN");
    });

    it("handles 404 Not Found", async () => {
        const app = createApp();
        const res = await app.request("/not-found");
        expect(res.status).toBe(404);
        const body = await res.json() as any;
        expect(body.error.code).toBe("NOT_FOUND");
    });

    it("handles 409 Conflict", async () => {
        const app = createApp();
        const res = await app.request("/conflict");
        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.code).toBe("EMAIL_EXISTS");
    });

    it("handles 500 Internal", async () => {
        const app = createApp();
        const res = await app.request("/internal");
        expect(res.status).toBe(500);
    });

    it("handles 503 Service Unavailable", async () => {
        const app = createApp();
        const res = await app.request("/service-unavailable");
        expect(res.status).toBe(503);
    });

    it("converts generic Error to 500 with INTERNAL_ERROR code", async () => {
        const app = createApp();
        const res = await app.request("/generic-error");
        expect(res.status).toBe(500);
        const body = await res.json() as any;
        expect(body.error.code).toBe("INTERNAL_ERROR");
        expect(body.error.message).toBe("Internal Server Error");
    });

    it("maps known error codes to HTTP status codes", async () => {
        const app = createApp();
        const res = await app.request("/error-with-code");
        // RATE_LIMITED is not in the code-to-status map, so it should default to 500
        expect(res.status).toBe(500);
    });

    it("omits details when not provided", async () => {
        const app = createApp();
        const res = await app.request("/unauthorized");
        const body = await res.json() as any;
        expect(body.error.details).toBeUndefined();
    });

    describe("database error surfacing", () => {
        /** Build a drizzle-style wrapper: outer error with the pg error nested in the cause chain. */
        function nestedDbError(pg: Record<string, unknown>, wraps = 2): Error {
            let inner: Error = Object.assign(new Error(String(pg.message)), pg);
            for (let i = 0; i < wraps; i++) {
                inner = new Error(`Failed query: insert into "rebase"."users" (...)`, { cause: inner });
            }
            return inner;
        }

        function createDbApp(err: Error) {
            const app = new Hono<HonoEnv>();
            app.onError(errorHandler);
            app.get("/boom", () => { throw err; });
            return app;
        }

        it("surfaces an RLS denial (42501) as DB_PERMISSION_DENIED with the SQLSTATE", async () => {
            const app = createDbApp(nestedDbError({
                code: "42501",
                message: "new row violates row-level security policy for table \"users\"",
                table: "users"
            }));
            const res = await app.request("/boom");
            expect(res.status).toBe(500);
            const body = await res.json() as any;
            expect(body.error.code).toBe("DB_PERMISSION_DENIED");
            expect(body.error.message).toContain("row-level security");
            expect(body.error.message).toContain("users");
            expect(body.error.details.dbCode).toBe("42501");
            // NODE_ENV !== "production" in tests → full diagnostics included
            expect(body.error.details.dbMessage).toContain("row-level security policy");
        });

        it("detects schema drift through multiple wrapper levels", async () => {
            const app = createDbApp(nestedDbError({
                code: "42703",
                message: "column \"password_hash\" does not exist"
            }, 3));
            const res = await app.request("/boom");
            expect(res.status).toBe(500);
            const body = await res.json() as any;
            expect(body.error.code).toBe("SCHEMA_DRIFT");
            expect(body.error.message).toContain("password_hash");
        });

        it("exposes the SQLSTATE for other database errors without changing the code", async () => {
            const app = createDbApp(nestedDbError({
                code: "23505",
                message: "duplicate key value violates unique constraint \"users_email_key\"",
                detail: "Key (email)=(a@b.c) already exists.",
                constraint: "users_email_key"
            }));
            const res = await app.request("/boom");
            expect(res.status).toBe(500);
            const body = await res.json() as any;
            expect(body.error.code).toBe("INTERNAL_ERROR");
            expect(body.error.message).toBe("Internal Server Error");
            expect(body.error.details.dbCode).toBe("23505");
            expect(body.error.details.detail).toContain("already exists");
        });

        it("does not treat non-SQLSTATE codes as database errors", async () => {
            const err = new Error("boom") as Error & { code: string };
            err.code = "ERR_SOMETHING";
            const app = createDbApp(err);
            const res = await app.request("/boom");
            const body = await res.json() as any;
            expect(body.error.code).toBe("ERR_SOMETHING");
            expect(body.error.details).toBeUndefined();
        });
    });

    it("returns consistent error shape for all error types", async () => {
        const app = createApp();
        const paths = ["/bad-request", "/unauthorized", "/forbidden", "/not-found", "/internal", "/generic-error"];

        for (const path of paths) {
            const res = await app.request(path);
            const body = await res.json() as any;
            expect(body).toHaveProperty("error");
            expect(body.error).toHaveProperty("message");
            expect(body.error).toHaveProperty("code");
        }
    });
});
