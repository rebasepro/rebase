import { describe, it, expect } from "@jest/globals";
import { extractPgError, extractCauseMessage, pgErrorToFriendlyMessage, sanitizeErrorForClient, isRoleSwitchingPermissionError } from "../src/utils/pg-error-utils";

// Suppress logger output during tests
jest.mock("@rebasepro/server", () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

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
});
