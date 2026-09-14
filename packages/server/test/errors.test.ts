import { ApiError, declaredErrorAnswer, errorHandler } from "../src/api/errors";
import { logger } from "../src/utils/logger";
import { RebaseApiError, RebaseClientError } from "@rebasepro/types";
import { callbackRefusal, toCallbackError } from "@rebasepro/common";

// ── Minimal Hono-context mock ────────────────────────────────────────────
function createMockContext(method = "GET", path = "/test") {
    let capturedStatus: number | undefined;
    let capturedBody: any;

    const c = {
        req: { method,
path },
        json: (body: any, status?: number) => {
            capturedBody = body;
            capturedStatus = status ?? 200;
            return new Response(JSON.stringify(body), { status: capturedStatus });
        }
    } as any;

    return {
        c,
        getStatus: () => capturedStatus,
        getBody: () => capturedBody
    };
}

// ── ApiError class ────────────────────────────────────────────────────────
describe("ApiError", () => {
    describe("constructor", () => {
        it("should create an error with statusCode, code, message, and details", () => {
            const err = new ApiError(422, "VALIDATION_ERROR", "Invalid field", { field: "email" });
            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(ApiError);
            expect(err.statusCode).toBe(422);
            expect(err.code).toBe("VALIDATION_ERROR");
            expect(err.message).toBe("Invalid field");
            expect(err.details).toEqual({ field: "email" });
            expect(err.name).toBe("ApiError");
        });

        it("should default details to undefined", () => {
            const err = new ApiError(400, "BAD_REQUEST", "Bad");
            expect(err.details).toBeUndefined();
        });
    });

    describe("factory methods", () => {
        it("badRequest → 400", () => {
            const err = ApiError.badRequest("Missing field", "MISSING_FIELD");
            expect(err.statusCode).toBe(400);
            expect(err.code).toBe("MISSING_FIELD");
        });

        it("badRequest uses default code", () => {
            const err = ApiError.badRequest("Oops");
            expect(err.code).toBe("BAD_REQUEST");
        });

        it("unauthorized → 401", () => {
            const err = ApiError.unauthorized("Bad token");
            expect(err.statusCode).toBe(401);
            expect(err.code).toBe("UNAUTHORIZED");
            expect(err.expected).toBe(false);
        });

        it("unauthenticated → 401 marked expected", () => {
            const err = ApiError.unauthenticated("No session", "NO_SESSION");
            expect(err.statusCode).toBe(401);
            expect(err.code).toBe("NO_SESSION");
            expect(err.expected).toBe(true);
        });

        it("forbidden → 403", () => {
            const err = ApiError.forbidden("No access");
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe("FORBIDDEN");
        });

        it("notFound → 404", () => {
            const err = ApiError.notFound("Entity not found");
            expect(err.statusCode).toBe(404);
            expect(err.code).toBe("NOT_FOUND");
        });

        it("conflict → 409", () => {
            const err = ApiError.conflict("Already exists", "EMAIL_EXISTS");
            expect(err.statusCode).toBe(409);
            expect(err.code).toBe("EMAIL_EXISTS");
        });

        it("internal → 500", () => {
            const err = ApiError.internal("Boom");
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe("INTERNAL_ERROR");
        });

        it("serviceUnavailable → 503", () => {
            const err = ApiError.serviceUnavailable("Down");
            expect(err.statusCode).toBe(503);
            expect(err.code).toBe("SERVICE_UNAVAILABLE");
        });
    });
});

// ── errorHandler (Hono ErrorHandler) ──────────────────────────────────────
describe("errorHandler", () => {
    it("should format ApiError with statusCode, code, message", () => {
        const { c, getStatus, getBody } = createMockContext();
        const err = ApiError.notFound("User not found");
        errorHandler(err, c);

        expect(getStatus()).toBe(404);
        expect(getBody()).toEqual({
            error: { message: "User not found",
code: "NOT_FOUND" }
        });
    });

    it("should include details when present", () => {
        const { c, getBody } = createMockContext();
        const err = ApiError.badRequest("Validation failed", "VALIDATION", { fields: ["email"] });
        errorHandler(err, c);

        expect(getBody()).toEqual({
            error: {
                message: "Validation failed",
                code: "VALIDATION",
                details: { fields: ["email"] }
            }
        });
    });

    it("should handle plain Error with code property", () => {
        const { c, getStatus, getBody } = createMockContext();
        const err = Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
        errorHandler(err, c);

        expect(getStatus()).toBe(404);
        expect(getBody()).toEqual({
            error: { message: "Not found",
code: "NOT_FOUND" }
        });
    });

    it("should default to 500 for unknown errors", () => {
        const { c, getStatus, getBody } = createMockContext();
        const err = new Error("Something broke");
        errorHandler(err, c);

        expect(getStatus()).toBe(500);
        expect(getBody()).toEqual({
            error: { message: "Internal Server Error",
code: "INTERNAL_ERROR" }
        });
    });

    it("should use statusCode from error if present", () => {
        const { c, getStatus } = createMockContext();
        const err = Object.assign(new Error("Rate limited"), { statusCode: 429,
code: "RATE_LIMITED" });
        errorHandler(err, c);

        expect(getStatus()).toBe(429);
    });

    it("logs an ordinary operational error at warn", () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
        const debug = jest.spyOn(logger, "debug").mockImplementation(() => {});
        const { c } = createMockContext();

        errorHandler(ApiError.unauthorized("Bad token"), c);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(debug).not.toHaveBeenCalled();
        warn.mockRestore();
        debug.mockRestore();
    });

    it("answers a collection-callback veto with its own status, code, message and details", () => {
        const { c, getStatus, getBody } = createMockContext("DELETE", "/api/data/contracts/c-1");
        errorHandler(toCallbackError(new Error("This contract is under legal hold."), "beforeDelete", "contracts") as Error, c);

        expect(getStatus()).toBe(400);
        expect(getBody()).toEqual({
            error: {
                message: "This contract is under legal hold.",
                code: "CALLBACK_REJECTED",
                details: { stage: "beforeDelete", path: "contracts" }
            }
        });
    });

    it("logs an expected error at debug, not warn — no noise for anonymous refresh", () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
        const debug = jest.spyOn(logger, "debug").mockImplementation(() => {});
        const { c } = createMockContext();

        errorHandler(ApiError.unauthenticated("No session", "NO_SESSION"), c);

        expect(warn).not.toHaveBeenCalled();
        expect(debug).toHaveBeenCalledTimes(1);
        warn.mockRestore();
        debug.mockRestore();
    });
});

// ── declaredErrorAnswer — the one rule REST and both sockets read ─────────
describe("declaredErrorAnswer", () => {
    it("reads a thrown-Error veto as 400 CALLBACK_REJECTED with the author's message", () => {
        expect(declaredErrorAnswer(toCallbackError(new Error("Locked."), "beforeSave", "posts"))).toEqual({
            status: 400,
            code: "CALLBACK_REJECTED",
            message: "Locked.",
            details: { stage: "beforeSave", path: "posts" },
            expected: false
        });
    });

    it("reads a `return false` veto as 403 CALLBACK_REJECTED", () => {
        expect(declaredErrorAnswer(callbackRefusal("beforeDelete", "posts"))).toMatchObject({
            status: 403,
            code: "CALLBACK_REJECTED",
            message: "beforeDelete refused the operation"
        });
    });

    it("reads an ApiError, and one from a second copy of the package, by name", () => {
        expect(declaredErrorAnswer(ApiError.notFound("No row"))).toMatchObject({ status: 404, code: "NOT_FOUND", message: "No row" });
        const otherCopy = Object.assign(new Error("Refused"), { name: "ApiError", statusCode: 409, code: "CONFLICT" });
        expect(declaredErrorAnswer(otherCopy)).toMatchObject({ status: 409, code: "CONFLICT", message: "Refused" });
    });

    it("reads a RebaseApiError by name, since instanceof fails across copies", () => {
        const otherCopy = Object.assign(new Error("Over quota"), { name: "RebaseApiError", status: 429, code: "RATE_LIMITED" });
        expect(declaredErrorAnswer(otherCopy)).toMatchObject({ status: 429, code: "RATE_LIMITED", message: "Over quota" });
    });

    it("carries `expected` from an ApiError, so a routine outcome logs at debug", () => {
        expect(declaredErrorAnswer(ApiError.unauthenticated("No session"))?.expected).toBe(true);
    });

    it("declines a RebaseApiError with no status — it has not chosen an answer", () => {
        expect(declaredErrorAnswer(new RebaseApiError("x"))).toBeUndefined();
        expect(declaredErrorAnswer(new RebaseClientError("x", { code: "REALTIME_DISABLED" }))).toBeUndefined();
    });

    it("declines everything else, which each door masks as a server fault", () => {
        expect(declaredErrorAnswer(new Error("boom"))).toBeUndefined();
        expect(declaredErrorAnswer(Object.assign(new Error("x"), { statusCode: 400, code: "BAD" }))).toBeUndefined();
        expect(declaredErrorAnswer("a string")).toBeUndefined();
        expect(declaredErrorAnswer(null)).toBeUndefined();
    });
});
