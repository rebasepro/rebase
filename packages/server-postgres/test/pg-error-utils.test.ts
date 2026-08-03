import { describe, it, expect, beforeEach } from "@jest/globals";
import { extractPgError, extractCauseMessage, pgErrorToFriendlyMessage, sanitizeErrorForClient, isRoleSwitchingPermissionError, classifyConnectFailure, reachedDatabase } from "../src/utils/pg-error-utils";
import { logger } from "@rebasepro/server";
// Imported from the module rather than the package barrel: the barrel is
// mocked below, so `ApiError` would come back undefined through it.
import { ApiError } from "../../server/src/api/errors";

// Suppress logger output during tests
jest.mock("@rebasepro/server", () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

const mockLogger = logger as unknown as {
    error: jest.Mock;
    warn: jest.Mock;
    info: jest.Mock;
    debug: jest.Mock;
};

beforeEach(() => {
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
});

describe("pg-error-utils", () => {

    describe("extractPgError", () => {
        it("returns null for non-object values", () => {
            expect(extractPgError(null)).toBeNull();
            expect(extractPgError(undefined)).toBeNull();
            expect(extractPgError("string error")).toBeNull();
            expect(extractPgError(42)).toBeNull();
        });

        it("returns null for plain Error without PG code", () => {
            expect(extractPgError(new Error("some error"))).toBeNull();
        });

        it("extracts PG error directly when error has a 5-char alphanumeric code", () => {
            const pgError = Object.assign(new Error("relation \"clients\" does not exist"), {
                code: "42P01",
                table: "clients"
            });
            const result = extractPgError(pgError);
            expect(result).toBe(pgError);
            expect(result?.code).toBe("42P01");
        });

        it("extracts PG error from Drizzle cause chain", () => {
            const pgError = Object.assign(new Error("relation \"clients\" does not exist"), {
                code: "42P01",
                table: "clients"
            });
            const drizzleError = new Error("Failed query: select ...");
            (drizzleError as any).cause = pgError;

            const result = extractPgError(drizzleError);
            expect(result).toBe(pgError);
            expect(result?.code).toBe("42P01");
        });

        it("extracts PG error from deeply nested cause chain", () => {
            const pgError = Object.assign(new Error("column \"foo\" does not exist"), {
                code: "42703",
                column: "foo"
            });
            const mid = new Error("mid-level wrapper");
            (mid as any).cause = pgError;
            const outer = new Error("Failed query: select ...");
            (outer as any).cause = mid;

            const result = extractPgError(outer);
            expect(result).toBe(pgError);
        });

        it("ignores non-PG error codes (not 5-char alphanumeric)", () => {
            const error = Object.assign(new Error("some error"), { code: "ERR_SOMETHING" });
            expect(extractPgError(error)).toBeNull();
        });

        it("handles non-Error objects with cause chain", () => {
            const pgError = Object.assign(new Error("relation does not exist"), {
                code: "42P01"
            });
            const wrapper = { cause: pgError };
            expect(extractPgError(wrapper)).toBe(pgError);
        });
    });

    describe("extractCauseMessage", () => {
        it("returns null for non-Error values", () => {
            expect(extractCauseMessage(null)).toBeNull();
            expect(extractCauseMessage("string")).toBeNull();
            expect(extractCauseMessage({})).toBeNull();
        });

        it("returns null for Error without cause", () => {
            expect(extractCauseMessage(new Error("top level"))).toBeNull();
        });

        it("extracts cause message from single-level cause", () => {
            const inner = new Error("inner message");
            const outer = new Error("outer");
            (outer as any).cause = inner;
            expect(extractCauseMessage(outer)).toBe("inner message");
        });

        it("extracts deepest cause message", () => {
            const deepest = new Error("deepest");
            const mid = new Error("mid");
            (mid as any).cause = deepest;
            const outer = new Error("outer");
            (outer as any).cause = mid;
            expect(extractCauseMessage(outer)).toBe("deepest");
        });
    });

    describe("pgErrorToFriendlyMessage", () => {
        it("maps 42P01 (undefined_table) to a friendly message", () => {
            const pgError = Object.assign(new Error("relation \"clients\" does not exist"), {
                code: "42P01",
                table: "clients"
            });
            const result = pgErrorToFriendlyMessage(pgError as any, "clients");
            expect(result.code).toBe("42P01");
            expect(result.message).toContain("Table not found");
            expect(result.message).toContain("run migrations");
        });

        it("maps 42703 (undefined_column) to a friendly message", () => {
            const pgError = Object.assign(new Error("column \"foo\" of relation \"clients\" does not exist"), {
                code: "42703",
                column: "foo",
                table: "clients"
            });
            const result = pgErrorToFriendlyMessage(pgError as any, "clients");
            expect(result.code).toBe("42703");
            expect(result.message).toContain("Unknown column");
            expect(result.message).toContain("run migrations");
        });

        it("maps 23505 (unique_violation) with detail", () => {
            const pgError = Object.assign(new Error("duplicate key value"), {
                code: "23505",
                detail: "Key (email)=(test@test.com) already exists.",
                constraint: "clients_email_unique"
            });
            const result = pgErrorToFriendlyMessage(pgError as any, "clients");
            expect(result.code).toBe("23505");
            expect(result.message).toContain("Duplicate value");
            expect(result.message).toContain("already exists");
        });

        it("maps 42501 (insufficient_privilege) to permission denied", () => {
            const pgError = Object.assign(new Error("permission denied for table clients"), {
                code: "42501",
                table: "clients"
            });
            const result = pgErrorToFriendlyMessage(pgError as any, "clients");
            expect(result.code).toBe("42501");
            expect(result.message).toContain("Permission denied");
            expect(result.message).toContain("RLS policies");
        });

        it("includes hint when present", () => {
            const pgError = Object.assign(new Error("relation does not exist"), {
                code: "42P01",
                hint: "Perhaps you meant \"client\"?"
            });
            const result = pgErrorToFriendlyMessage(pgError as any, "clients");
            expect(result.message).toContain("Hint: Perhaps you meant");
        });

        it("handles unknown PG codes with full diagnostic info", () => {
            const pgError = Object.assign(new Error("something unusual"), {
                code: "XX000",
                detail: "internal detail",
                column: "col",
                constraint: "some_constraint"
            });
            const result = pgErrorToFriendlyMessage(pgError as any, "my_collection");
            expect(result.code).toBe("XX000");
            expect(result.message).toContain("[XX000]");
            expect(result.message).toContain("something unusual");
            expect(result.message).toContain("internal detail");
        });
    });

    describe("sanitizeErrorForClient", () => {
        it("sanitizes a Drizzle-wrapped PG error", () => {
            const pgError = Object.assign(new Error("relation \"clients\" does not exist"), {
                code: "42P01"
            });
            const drizzleError = new Error(
                'Failed query: select "id", "name" from "clients" where "clients"."id" = $1 limit $2\nparams: some-uuid,1'
            );
            (drizzleError as any).cause = pgError;

            const result = sanitizeErrorForClient(drizzleError, "clients");
            expect(result.code).toBe("42P01");
            expect(result.message).toContain("Table not found");
            // Must NOT contain the raw SQL
            expect(result.message).not.toContain("select");
            expect(result.message).not.toContain("params:");
        });

        it("returns generic message when no PG error is found", () => {
            const error = new Error("something went wrong");
            const result = sanitizeErrorForClient(error, "clients");
            expect(result.message).toContain("clients");
            expect(result.code).toBeUndefined();
        });

        it("uses cause message when available and no PG error", () => {
            const inner = new Error("connection refused");
            const outer = new Error("outer wrapper");
            (outer as any).cause = inner;
            const result = sanitizeErrorForClient(outer, "clients");
            expect(result.message).toContain("connection refused");
        });

        // A subscription failure is sanitized on the same path as a query
        // failure, so a deliberate 400 (e.g. UNKNOWN_FILTER_FIELD) used to be
        // flattened into "Check server logs" and logged as a database error.
        it("passes an ApiError's message and code straight through", () => {
            const error = ApiError.badRequest(
                'Unknown filter field "titlee" in collection "posts". Valid fields: id, title, body.',
                "UNKNOWN_FILTER_FIELD",
                { field: "titlee", collection: "posts", validFields: ["id", "title", "body"] }
            );

            const result = sanitizeErrorForClient(error, "posts");

            expect(result.code).toBe("UNKNOWN_FILTER_FIELD");
            expect(result.message).toBe(error.message);
            expect(result.message).toContain("titlee");
            expect(result.message).toContain("Valid fields");
            expect(result.message).not.toContain("Check server logs");
        });

        it("logs a non-expected ApiError at warn, never at error", () => {
            sanitizeErrorForClient(ApiError.badRequest("bad filter", "UNKNOWN_FILTER_FIELD"), "posts");

            expect(mockLogger.error).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledTimes(1);
            expect(String(mockLogger.warn.mock.calls[0][0])).toContain("UNKNOWN_FILTER_FIELD");
        });

        it("logs an expected ApiError at debug", () => {
            sanitizeErrorForClient(ApiError.unauthenticated("No session"), "posts");

            expect(mockLogger.error).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledTimes(1);
        });

        it("matches an ApiError structurally, without relying on class identity", () => {
            // `@rebasepro/server` can be loaded twice (dist vs. source), which
            // breaks `instanceof` — the guard must not depend on it.
            const error = Object.assign(new Error("Row not visible"), {
                name: "ApiError",
                statusCode: 404,
                code: "NOT_FOUND"
            });

            const result = sanitizeErrorForClient(error, "posts");

            expect(result).toEqual({ message: "Row not visible", code: "NOT_FOUND" });
        });

        it("still sanitizes a 5xx ApiError — server internals stay server-side", () => {
            const result = sanitizeErrorForClient(
                ApiError.internal("connection pool exhausted: host=10.0.0.4 user=rebase_user"),
                "posts"
            );

            expect(result.message).not.toContain("10.0.0.4");
            expect(result.message).toContain("Check server logs");
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it("does not treat a PG error as a client error", () => {
            // PG errors carry `code` but never `statusCode` — they must keep
            // going through the SQLSTATE translation.
            const pgError = Object.assign(new Error("relation \"clients\" does not exist"), {
                code: "42P01"
            });

            const result = sanitizeErrorForClient(pgError, "clients");

            expect(result.code).toBe("42P01");
            expect(result.message).toContain("Table not found");
        });

        it("never leaks SQL in the returned message", () => {
            const error = new Error(
                'Failed query: select "id", "name", "email" from "clients" where "clients"."id" = $1'
            );
            const result = sanitizeErrorForClient(error, "clients");
            expect(result.message).not.toContain("select");
            expect(result.message).not.toContain("Failed query");
            expect(result.message).toContain("Check server logs");
        });
    });

    describe("reachedDatabase", () => {

        // The read paths catch a failed relational query and retry with
        // db.select. That retry is only safe when the first attempt never got
        // as far as Postgres — otherwise the transaction is already aborted and
        // the retry returns 25P02, replacing "invalid input syntax for type
        // uuid" with "current transaction is aborted".

        it("is true for a Drizzle-wrapped PG error, however deep", () => {
            const pgError = Object.assign(new Error("invalid input syntax for type uuid: \"new\""), { code: "22P02" });
            const wrapped = new Error("Failed query: select ...", { cause: pgError });
            expect(reachedDatabase(wrapped)).toBe(true);
            expect(reachedDatabase(new Error("outer", { cause: wrapped }))).toBe(true);
        });

        it("is false for a query the driver could not build", () => {
            // The case the fallback exists for: no statement was ever sent.
            expect(reachedDatabase(new Error("There is not enough information to infer relation"))).toBe(false);
            expect(reachedDatabase(new TypeError("qb.findFirst is not a function"))).toBe(false);
        });

        it("is false for non-errors", () => {
            expect(reachedDatabase(undefined)).toBe(false);
            expect(reachedDatabase("boom")).toBe(false);
        });
    });

    describe("isRoleSwitchingPermissionError", () => {
        it("returns true for 42501 with 'permission denied to set role'", () => {
            const pgError = Object.assign(new Error("permission denied to set role \"demo\""), {
                code: "42501"
            });
            expect(isRoleSwitchingPermissionError(pgError)).toBe(true);
        });

        it("returns true for 42501 with 'must be member of role'", () => {
            const pgError = Object.assign(new Error("must be member of role \"admin\""), {
                code: "42501"
            });
            expect(isRoleSwitchingPermissionError(pgError)).toBe(true);
        });

        it("returns true when PG error is wrapped in Drizzle cause chain", () => {
            const pgError = Object.assign(new Error("permission denied to set role \"viewer\""), {
                code: "42501"
            });
            const drizzleError = new Error("Query failed");
            (drizzleError as { cause?: unknown }).cause = pgError;
            expect(isRoleSwitchingPermissionError(drizzleError)).toBe(true);
        });

        it("returns false for 42501 with 'permission denied for table' (table-level)", () => {
            const pgError = Object.assign(new Error("permission denied for table clients"), {
                code: "42501",
                table: "clients"
            });
            expect(isRoleSwitchingPermissionError(pgError)).toBe(false);
        });

        it("returns false for non-42501 errors", () => {
            const pgError = Object.assign(new Error("relation does not exist"), {
                code: "42P01"
            });
            expect(isRoleSwitchingPermissionError(pgError)).toBe(false);
        });

        it("returns false for non-PG errors", () => {
            expect(isRoleSwitchingPermissionError(new Error("something random"))).toBe(false);
        });

        it("returns false for null/undefined", () => {
            expect(isRoleSwitchingPermissionError(null)).toBe(false);
            expect(isRoleSwitchingPermissionError(undefined)).toBe(false);
        });
    });

    /**
     * The boot-time connection check catches Drizzle's wrapper, whose message
     * is `Failed query: SELECT 1`. Everything a developer needs is one level
     * down. See `PostgresBootstrapper`.
     */
    describe("classifyConnectFailure", () => {
        /** What Drizzle hands the bootstrapper for a failed `SELECT 1`. */
        const wrapped = (code: string, message: string) =>
            Object.assign(new Error("Failed query: SELECT 1\nparams: "), {
                cause: Object.assign(new Error(message), { code })
            });

        it("reports the Postgres message, not the Drizzle wrapper's", () => {
            const result = classifyConnectFailure(wrapped("3D000", 'database "shop" does not exist'));
            expect(result.reason).toBe('database "shop" does not exist');
            expect(result.code).toBe("3D000");
        });

        it("treats a wrong password as unrecoverable", () => {
            expect(classifyConnectFailure(wrapped("28P01", "password authentication failed for user \"app\"")).fatal).toBe(true);
        });

        it("treats a missing database as unrecoverable", () => {
            expect(classifyConnectFailure(wrapped("3D000", 'database "shop" does not exist')).fatal).toBe(true);
        });

        it("treats a transient failure as recoverable, so the pool may retry", () => {
            const result = classifyConnectFailure(wrapped("57P03", "the database system is starting up"));
            expect(result.fatal).toBe(false);
            expect(result.reason).toBe("the database system is starting up");
        });

        it("falls back to the error's own message when nothing carries a PG code", () => {
            const result = classifyConnectFailure(new Error("socket hang up"));
            expect(result).toEqual({ fatal: false,
reason: "socket hang up",
code: undefined });
        });

        it("survives a non-Error", () => {
            expect(classifyConnectFailure("boom").reason).toBe("boom");
        });
    });
});
