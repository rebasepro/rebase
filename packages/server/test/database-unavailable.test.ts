import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { DataDriver } from "@rebasepro/types";
import { ApiError, errorHandler, isDatabaseUnreachable } from "../src/index";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { createRequireAuth } from "../src/auth/middleware";
import type { HonoEnv } from "../src/api/types";
import { logger } from "../src/utils/logger";

/**
 * With the database stopped, every door gives one answer: `503
 * DATABASE_UNAVAILABLE`, with `Retry-After`.
 *
 * A tester stopped Postgres under a running API. Signed-in data requests and
 * the admin routes answered `503 ROLE_LOOKUP_FAILED` "Could not verify your
 * permissions", sign-in answered `500 INTERNAL_ERROR`, and a service-key read
 * answered `500` with the code `ECONNREFUSED`. The real server is in
 * `server-postgres/test/e2e/database-down-e2e.test.ts`; these pin the
 * classification each of those doors now shares.
 */

/** What `net` raises when a host refuses the connection. */
function refused(address = "127.0.0.1", port = 5432): Error {
    return Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), {
        code: "ECONNREFUSED", errno: -61, syscall: "connect", address, port
    });
}

/** What `net` raises when every address `localhost` resolves to refused. */
function refusedEverywhere(): Error {
    return Object.assign(new AggregateError([refused("::1"), refused("127.0.0.1")], ""), { code: "ECONNREFUSED" });
}

/** Drizzle's wrapper around a query the driver could not run. */
function failedQuery(cause: unknown): Error {
    return Object.assign(new Error("Failed query: select 1\nparams: "), { query: "select 1", params: [], cause });
}

/** A Postgres error, as node-postgres raises it. */
function pgError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code, severity: "FATAL" });
}

describe("isDatabaseUnreachable", () => {
    it("reads a refused connection that node-postgres hands back as it is", () => {
        expect(isDatabaseUnreachable(refused())).toBe(true);
        expect(isDatabaseUnreachable(refusedEverywhere())).toBe(true);
    });

    it("reads a socket failure under a failed Drizzle query", () => {
        expect(isDatabaseUnreachable(failedQuery(refusedEverywhere()))).toBe(true);
        const notFound = Object.assign(new Error("getaddrinfo ENOTFOUND db"), { code: "ENOTFOUND", syscall: "getaddrinfo", hostname: "db" });
        expect(isDatabaseUnreachable(failedQuery(notFound))).toBe(true);
        const pipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" });
        expect(isDatabaseUnreachable(failedQuery(pipe))).toBe(true);
    });

    it("reads the database's own word that the connection is gone", () => {
        expect(isDatabaseUnreachable(failedQuery(pgError("57P01", "terminating connection due to administrator command")))).toBe(true);
        expect(isDatabaseUnreachable(failedQuery(pgError("57P03", "the database system is starting up")))).toBe(true);
        expect(isDatabaseUnreachable(failedQuery(pgError("08006", "connection failure")))).toBe(true);
        expect(isDatabaseUnreachable(failedQuery(new Error("Connection terminated unexpectedly")))).toBe(true);
    });

    it("does not read the database answering a statement as the database being down", () => {
        expect(isDatabaseUnreachable(failedQuery(pgError("42P01", "relation \"x\" does not exist")))).toBe(false);
        expect(isDatabaseUnreachable(failedQuery(pgError("42501", "permission denied for table x")))).toBe(false);
        expect(isDatabaseUnreachable(new Error("boom"))).toBe(false);
        expect(isDatabaseUnreachable(undefined)).toBe(false);
    });

    it("leaves another service's socket failure to that service", () => {
        // `fetch()` to some other host.
        expect(isDatabaseUnreachable(new TypeError("fetch failed", { cause: refused("10.0.0.9", 443) }))).toBe(false);
        // An S3 call that cannot connect: the AWS SDK puts `$metadata` on the raw error.
        expect(isDatabaseUnreachable(Object.assign(refused("10.0.0.9", 9000), { $metadata: { attempts: 3 } }))).toBe(false);
        // Anything else wrapping one.
        expect(isDatabaseUnreachable(new Error("upload failed", { cause: refused() }))).toBe(false);
    });
});

describe("the error handler, with the database unreachable", () => {
    function appThrowing(error: unknown): Hono<HonoEnv> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.get("/x", () => {
            throw error;
        });
        return app;
    }

    it("answers 503 DATABASE_UNAVAILABLE with Retry-After, not a 500 carrying the errno", async () => {
        jest.spyOn(logger, "error").mockImplementation(() => undefined);
        jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        for (const error of [refusedEverywhere(), failedQuery(refused())]) {
            const res = await appThrowing(error).request("/x");
            expect(res.status).toBe(503);
            expect(res.headers.get("Retry-After")).toBe("5");
            const body = await res.json() as { error: { code: string; message: string } };
            expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
            expect(body.error.message).toMatch(/database could not be reached/);
        }
        jest.restoreAllMocks();
    });

    it("says ApiError.databaseUnavailable() the same way", async () => {
        const res = await appThrowing(ApiError.databaseUnavailable()).request("/x");
        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("5");
        expect((await res.json() as { error: { code: string } }).error.code).toBe("DATABASE_UNAVAILABLE");
    });

    it("keeps another service's refused connection a 500 that does not blame the database", async () => {
        const errors: string[] = [];
        jest.spyOn(logger, "error").mockImplementation((message: string) => { errors.push(message); });
        jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        const res = await appThrowing(new TypeError("fetch failed", { cause: refused("10.0.0.9", 443) })).request("/x");
        expect(res.status).toBe(500);
        expect(errors.join("\n")).not.toMatch(/database/i);
        jest.restoreAllMocks();
    });
});

describe("the auth doors, with the database unreachable", () => {
    const unreachableRepo = {
        getUserRoleIds: async () => { throw failedQuery(refused()); },
        getUserById: async () => { throw failedQuery(refused()); }
    } as unknown as AuthRepository;
    const brokenRepo = {
        getUserRoleIds: async () => { throw new Error("relation lookup went wrong"); },
        getUserById: async () => { throw new Error("relation lookup went wrong"); }
    } as unknown as AuthRepository;

    const passThroughDriver = {
        key: "pass",
        initialised: true,
        withAuth: async () => passThroughDriver
    } as unknown as DataDriver;

    beforeAll(() => {
        configureJwt({ secret: "database-unavailable-test-secret-0123456789", accessExpiresIn: "1h" });
        jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        jest.spyOn(logger, "error").mockImplementation(() => undefined);
    });

    async function dataPlane(repo: AuthRepository): Promise<{ status: number; code: string; retryAfter: string | null }> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createAdapterAuthMiddleware({ adapter: createBuiltinAuthAdapter({ authRepository: repo }), driver: passThroughDriver }));
        app.get("/data", (c) => c.json({ ok: true }));
        const res = await app.request("/data", { headers: { Authorization: `Bearer ${await generateAccessToken("u-1", [])}` } });
        return { status: res.status, code: (await res.json() as { error: { code: string } }).error.code, retryAfter: res.headers.get("Retry-After") };
    }

    async function adminGate(resolveRoles: (uid: string) => Promise<string[]>): Promise<{ status: number; code: string }> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createRequireAuth({ resolveRoles }));
        app.get("/admin", (c) => c.json({ ok: true }));
        const res = await app.request("/admin", { headers: { Authorization: `Bearer ${await generateAccessToken("u-1", ["admin"])}` } });
        return { status: res.status, code: (await res.json() as { error: { code: string } }).error.code };
    }

    it("refuses a signed-in data request with DATABASE_UNAVAILABLE, not a doubt about its permissions", async () => {
        expect(await dataPlane(unreachableRepo)).toEqual({ status: 503, code: "DATABASE_UNAVAILABLE", retryAfter: "5" });
    });

    it("still says ROLE_LOOKUP_FAILED when the database answered and the lookup failed", async () => {
        expect(await dataPlane(brokenRepo)).toMatchObject({ status: 503, code: "ROLE_LOOKUP_FAILED" });
    });

    it("refuses an admin-gated request the same way", async () => {
        expect(await adminGate(async () => { throw refusedEverywhere(); })).toEqual({ status: 503, code: "DATABASE_UNAVAILABLE" });
        expect(await adminGate(async () => { throw new Error("lookup went wrong"); })).toEqual({ status: 503, code: "ROLE_LOOKUP_FAILED" });
    });

    it("hands the socket the same refusal to relay", async () => {
        const adapter = createBuiltinAuthAdapter({ authRepository: unreachableRepo });
        await expect(adapter.verifyToken!(await generateAccessToken("u-1", []))).rejects.toMatchObject({ statusCode: 503, code: "DATABASE_UNAVAILABLE" });
    });
});
