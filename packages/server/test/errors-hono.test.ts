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

    it("defaults to 500 for a code that is not in the map", async () => {
        const app = createApp();
        const res = await app.request("/error-with-code");
        // RATE_LIMITED is not in the code-to-status map, so it should default to 500
        expect(res.status).toBe(500);
    });

    describe("maps known error codes to HTTP status codes", () => {
        // A plain Error carrying only a `code` is what a thrower outside this
        // module produces — an adapter, a driver, a user callback — and the map
        // is the only thing that turns it into anything other than a 500. The
        // single case this used to have threw RATE_LIMITED, which is *absent*
        // from the map, so it asserted the default and left all sixteen entries
        // unmeasured: every one of them could have been deleted, or given the
        // wrong status, in silence.
        const cases: [string, number][] = [
            ["BAD_REQUEST", 400],
            ["INVALID_INPUT", 400],
            ["WEAK_PASSWORD", 400],
            ["UNAUTHORIZED", 401],
            ["INVALID_CREDENTIALS", 401],
            ["INVALID_TOKEN", 401],
            ["FORBIDDEN", 403],
            ["NOT_FOUND", 404],
            ["CONFLICT", 409],
            ["EMAIL_EXISTS", 409],
            ["ROLE_EXISTS", 409],
            ["SCHEMA_DRIFT", 500],
            ["DB_PERMISSION_DENIED", 500],
            ["INTERNAL_ERROR", 500],
            ["NOT_CONFIGURED", 503],
            ["SERVICE_UNAVAILABLE", 503]
        ];

        it.each(cases)("%s → %i", async (code, status) => {
            const app = new Hono<HonoEnv>();
            app.onError(errorHandler);
            app.get("/boom", () => {
                const err = new Error("thrown from outside this module") as Error & { code: string };
                err.code = code;
                throw err;
            });

            const res = await app.request("/boom");
            expect(res.status).toBe(status);
            const body = await res.json() as any;
            expect(body.error.code).toBe(code);
        });

        it("lets an explicit statusCode win over the code lookup", async () => {
            // `statusCode` is checked first, so a thrower that knows better is
            // not overruled by a coincidentally-named code.
            const app = new Hono<HonoEnv>();
            app.onError(errorHandler);
            app.get("/boom", () => {
                const err = new Error("gone") as Error & { code: string; statusCode: number };
                err.code = "NOT_FOUND";
                err.statusCode = 410;
                throw err;
            });

            expect((await app.request("/boom")).status).toBe(410);
        });
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

        it("names the callback when a read-only transaction refuses a write (25006)", async () => {
            // The only user code on a read path is `afterRead`, and every
            // request-scoped read opens `READ ONLY`. So this SQLSTATE has one
            // cause, and the answer should say which file to open — rather than
            // the 500 "Internal Server Error" it used to be, which reads as the
            // database being down.
            const app = createDbApp(nestedDbError({
                code: "25006",
                message: "cannot execute INSERT in a read-only transaction"
            }));
            const res = await app.request("/boom");
            expect(res.status).toBe(409);
            const body = await res.json() as any;
            expect(body.error.code).toBe("READ_ONLY_TRANSACTION");
            expect(body.error.message).toContain("afterRead");
            expect(body.error.message).toContain("READ ONLY");
            expect(body.error.details.dbCode).toBe("25006");
            // The 4xx arm must not echo the driver's own "Failed query: …" text.
            expect(body.error.message).not.toContain("Failed query");
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

    /**
     * The envelope is a published contract, and the docs had been publishing a
     * different one — `{ message, code, status }` with kebab-case codes like
     * `"not-found"`. A reader who branched on either got code that never fired.
     *
     * `status` in particular must stay out of the body: it is on the response,
     * and a second copy is a field that can disagree with it. These two assert
     * the shape itself rather than the prose that describes it.
     */
    describe("the envelope is exactly four fields", () => {
        const paths = [
            "/bad-request", "/unauthorized", "/forbidden", "/not-found",
            "/conflict", "/internal", "/service-unavailable", "/generic-error",
            "/error-with-code"
        ];

        it("carries no key outside message / code / details / requestId", async () => {
            const app = createApp();
            for (const path of paths) {
                const body = await (await app.request(path)).json() as { error: Record<string, unknown> };
                expect(Object.keys(body)).toEqual(["error"]);
                for (const key of Object.keys(body.error)) {
                    expect(["message", "code", "details", "requestId"]).toContain(key);
                }
                expect(body.error).not.toHaveProperty("status");
                expect(body.error).not.toHaveProperty("statusCode");
            }
        });

        it("spells every code SCREAMING_SNAKE_CASE", async () => {
            const app = createApp();
            for (const path of paths) {
                const body = await (await app.request(path)).json() as { error: { code: string } };
                expect(body.error.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
            }
        });
    });
});
